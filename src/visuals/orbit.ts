import {
  BufferGeometry, Color, Float32BufferAttribute, Group, Mesh, MeshBasicMaterial,
  OctahedronGeometry, PerspectiveCamera, Points, PointsMaterial, Scene,
  SphereGeometry, TorusGeometry, ConeGeometry, WebGLRenderer,
} from 'three';
import type { ElementKey, Features } from '../audio/features';
import { ElementFocus, type ViewState } from './interaction';
import { approach, moodBackground, type Visual, type VisualInfo } from './types';

export const orbitInfo: VisualInfo = {
  id: 'orbit',
  name: '궤도',
  needsWebGL: true,
  legend: {
    drums: { color: '#f66570', text: '드럼이 강할수록 커지는 붉은 마름모' },
    bass: { color: '#4593fc', text: '저음이 강할수록 커지는 푸른 중앙 구체' },
    vocal: { color: '#ffd158', text: '목소리가 강할수록 커지는 금빛 고리' },
    melody: { color: '#58c7c7', text: '멜로디가 강할수록 커지는 청록 삼각뿔' },
  },
};

const KEYS: ElementKey[] = ['drums', 'bass', 'vocal', 'melody'];
const COLORS = ['#f66570', '#4593fc', '#ffd158', '#58c7c7'];

/** BPM controls orbital rotation; each musical element controls one shape's size. */
export class OrbitVisual implements Visual {
  readonly focus = new ElementFocus();
  readonly canvas = document.createElement('canvas');
  private readonly renderer = new WebGLRenderer({ canvas: this.canvas, antialias: true, alpha: false });
  private readonly scene = new Scene();
  private readonly camera = new PerspectiveCamera(40, 1, 0.1, 50);
  private readonly system = new Group();
  private readonly viewRoot = new Group();
  private readonly background = new Color('#080e20');
  private readonly targetBackground = new Color();
  private readonly geometries = new Set<BufferGeometry>();
  private readonly materials = new Set<MeshBasicMaterial | PointsMaterial>();
  private readonly orbits: {
    plane: Group; body: Mesh; beads: Mesh[]; material: MeshBasicMaterial; radius: number; angle: number;
    spin: number;
  }[] = [];
  private readonly core: Mesh;
  private readonly levels = [0, 0, 0, 0];
  private time = 0;
  private beatRate = 2;
  private disposed = false;

  constructor() {
    this.renderer.setClearColor(this.background);
    this.camera.position.set(0, 0.35, 10);
    this.camera.lookAt(0, 0, 0);
    this.viewRoot.add(this.system);
    this.scene.add(this.viewRoot);

    const keep = <T extends BufferGeometry>(geometry: T): T => {
      this.geometries.add(geometry);
      return geometry;
    };
    const material = (color: string, opacity = 1, key: ElementKey | null = null) => {
      const m = new MeshBasicMaterial({ color, transparent: opacity < 1, opacity, depthWrite: opacity === 1 });
      this.materials.add(m);
      this.focus.trackColor(key, m.color);
      return m;
    };
    const beadGeometry = keep(new SphereGeometry(0.014, 6, 4));
    const shapes = [
      keep(new OctahedronGeometry(0.105)),
      keep(new SphereGeometry(0.11, 20, 12)),
      keep(new TorusGeometry(0.1, 0.024, 8, 24)),
      keep(new ConeGeometry(0.105, 0.22, 3)),
    ];
    for (let i = 0; i < KEYS.length; i++) {
      const plane = new Group();
      plane.name = `orbit-${KEYS[i]}`;
      const radius = 1.5 + i * 0.38;
      const ringMaterial = material(COLORS[i], 0.65, KEYS[i]);
      plane.add(new Mesh(keep(new TorusGeometry(radius, 0.016, 8, 192)), ringMaterial));
      plane.add(new Mesh(keep(new TorusGeometry(radius + 0.045, 0.004, 4, 192)), material(COLORS[i], 0.2, KEYS[i])));
      const body = new Mesh(shapes[i], material(COLORS[i], 1, KEYS[i]));
      body.name = `element-${KEYS[i]}`;
      // Bass is represented by the central sphere, so there is no second bass satellite.
      body.visible = i !== 1;
      plane.add(body);
      const beads: Mesh[] = [];
      for (let j = 0; j < (i === 1 ? 0 : 48); j++) {
        const bead = new Mesh(beadGeometry, material(COLORS[i], 0.12 + 0.5 * (1 - j / 48) ** 2, KEYS[i]));
        beads.push(bead);
        plane.add(bead);
      }
      this.orbits.push({ plane, body, beads, material: ringMaterial, radius, angle: i * 1.7,
        spin: 0 });
      this.system.add(plane);
    }

    const coreMaterial = material('#4593fc', 0.3, 'bass');
    this.core = new Mesh(keep(new SphereGeometry(0.38, 32, 24)), coreMaterial);
    this.core.name = 'bass-core';
    this.system.add(this.core);
    const cageMaterial = material('#cadcf1', 0.45, 'bass');
    cageMaterial.wireframe = true;
    this.core.add(new Mesh(keep(new SphereGeometry(0.4, 20, 12)), cageMaterial));
    const inner = new Mesh(keep(new OctahedronGeometry(0.19)), material('#cadcf1', 0.65, 'bass'));
    this.core.add(inner);

    // Fixed, dim dust gives depth without introducing independent twinkling.
    const positions = new Float32Array(600 * 3);
    for (let i = 0; i < 600; i++) {
      const angle = i * 2.399963;
      const radius = 3.2 + (i % 59) / 59 * 5;
      positions[i * 3] = Math.cos(angle) * radius;
      positions[i * 3 + 1] = Math.sin(angle) * radius;
      positions[i * 3 + 2] = -2 - (i % 17) * 0.2;
    }
    const dustGeometry = keep(new BufferGeometry());
    dustGeometry.setAttribute('position', new Float32BufferAttribute(positions, 3));
    const dustMaterial = new PointsMaterial({ color: '#7793b8', size: 0.012, transparent: true, opacity: 0.35 });
    this.materials.add(dustMaterial);
    this.focus.trackColor(null, dustMaterial.color);
    this.scene.add(new Points(dustGeometry, dustMaterial));
  }

  resize(width: number, height: number) {
    if (this.disposed) return;
    this.renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 1.5));
    this.renderer.setSize(Math.max(1, width), Math.max(1, height), false);
    this.camera.aspect = Math.max(1, width) / Math.max(1, height);
    // Keep the outermost orbit in frame in both narrow and wide windows.
    this.camera.position.z = Math.max(9.5, 9 / this.camera.aspect);
    this.camera.updateProjectionMatrix();
  }

  frame(f: Features) {
    this.focus.update(f.dt);
    if (this.disposed) return;
    const dt = Math.max(0, Math.min(f.dt, 0.05));
    const motion = f.reduceFlash ? 0.45 : 1;
    const targetRate = f.active && f.beatConfidence >= 0.55 && f.bpm > 0 ? f.bpm / 60 : 2;
    this.beatRate = approach(this.beatRate, targetRate, dt, 0.3);
    this.time += dt * motion * this.beatRate / 2;
    const strength = f.reduceFlash ? 0.45 : 1;
    for (let i = 0; i < KEYS.length; i++) {
      const input = i === 0 ? Math.max(f.drums, f.kick, f.snare * 0.85, f.hat * 0.45) : f[KEYS[i]];
      const target = f.active ? Math.max(0, Math.min(1, input)) : 0;
      this.levels[i] = approach(this.levels[i], target, dt, target > this.levels[i] ? 0.025 : 0.14);
    }
    const bg = moodBackground(f.valence, f.arousal);
    this.targetBackground.setRGB(bg[0] / 255, bg[1] / 255, bg[2] / 255, 'srgb');
    this.background.lerp(this.targetBackground, 1 - Math.exp(-dt / 3));
    this.renderer.setClearColor(this.background);
    this.system.rotation.set(0.13 * Math.sin(this.time * 0.12), Math.sin(this.time * 0.09) * 0.25, -0.12);
    this.core.rotation.set(this.time * 0.1, -this.time * 0.16, 0.25);
    this.core.scale.setScalar(1 + this.levels[1] * strength * 1.25);

    for (let i = 0; i < this.orbits.length; i++) {
      const orbit = this.orbits[i];
      const level = this.levels[i];
      orbit.angle += dt * motion * this.beatRate * (0.2 + i * 0.04) * (i % 2 ? -1 : 1);
      // Turn each plane in depth, rather than just moving its satellite around a fixed ring.
      // Rotation depends on tempo only, independently of element loudness, pitch, and drum hits.
      orbit.spin += dt * motion * this.beatRate * (0.2 + i * 0.025);
      const direction = i % 2 ? -1 : 1;
      orbit.plane.rotation.set(
        0.25 + i * 0.24 + orbit.spin * direction,
        -0.48 + i * 0.28 + orbit.spin * 0.65,
        i * 0.7 + orbit.spin * direction * 0.35,
      );
      const radius = orbit.radius;
      const angle = orbit.angle;
      orbit.body.position.set(Math.cos(angle) * radius, Math.sin(angle) * radius, 0);
      orbit.body.rotation.set(this.time * 0.5, this.time * 0.4, angle);
      orbit.body.scale.setScalar(0.85 + level * strength * 2.8);
      // No raw beat/energy brightness: light modulation comes exclusively from pulse.
      orbit.material.opacity = 0.65 + Math.min(1, Math.max(0, f.pulse)) * 0.1;
      for (let j = 0; j < orbit.beads.length; j++) {
        const a = angle - (i % 2 ? -1 : 1) * (j + 1) * 0.027;
        const bead = orbit.beads[j];
        bead.position.set(Math.cos(a) * radius, Math.sin(a) * radius, 0);
        bead.scale.setScalar(1 - j / orbit.beads.length);
      }
    }
    this.renderer.render(this.scene, this.camera);
  }

  dispose() {
    if (this.disposed) return;
    this.disposed = true;
    for (const geometry of this.geometries) geometry.dispose();
    for (const material of this.materials) material.dispose();
    this.scene.clear();
    this.renderer.dispose();
    this.renderer.forceContextLoss();
  }

  setView(view: ViewState) {
    this.viewRoot.rotation.set(view.y * 1.1, view.x * Math.PI, 0);
    this.camera.fov = 40 / view.zoom;
    this.camera.updateProjectionMatrix();
  }
}
