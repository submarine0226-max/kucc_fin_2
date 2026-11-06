import {
  BufferAttribute, BufferGeometry, Color, DoubleSide, Float32BufferAttribute, FogExp2, Group,
  LineBasicMaterial, LineSegments, Material, Mesh, MeshBasicMaterial,
  PerspectiveCamera, Scene, TorusGeometry, WebGLRenderer, DynamicDrawUsage,
} from 'three';
import type { ElementKey, Features } from '../audio/features';
import { ElementFocus, type ViewState } from './interaction';
import { approach, moodBackground, type Visual, type VisualInfo } from './types';
import { RhythmMotion } from './rhythm';

export const tunnelInfo: VisualInfo = {
  id: 'tunnel', name: '네온 터널', needsWebGL: true,
  legend: {
    drums: { color: '#f66570', text: '타격마다 크게 벌어졌다 돌아오는 붉은 게이트' },
    bass: { color: '#4593fc', text: '저음에 크게 부풀고 일렁이는 푸른 벽' },
    vocal: { color: '#ffd158', text: '일정한 크기로 비행하는 금빛 기체 · 목소리에 반응하는 주변 떨림' },
    melody: { color: '#58c7c7', text: '음 높이에 따라 굽고 비틀리는 청록 터널' },
  },
};

const SIDES = 8;
const GATES = 48;
const SPACING = 3;
const LENGTH = GATES * SPACING;
const SAMPLES = 144;
const TAU = Math.PI * 2;

/** A continuous flight through octagonal gates and curved longitudinal rails. */
export class TunnelVisual implements Visual {
  readonly focus = new ElementFocus();
  readonly canvas = document.createElement('canvas');
  private readonly renderer = new WebGLRenderer({ canvas: this.canvas, antialias: true, alpha: false });
  private readonly scene = new Scene();
  private readonly camera = new PerspectiveCamera(78, 1, 0.1, LENGTH + 10);
  private readonly background = new Color('#080d1d');
  private readonly targetBackground = new Color();
  private readonly ringGeometry = new TorusGeometry(1, 0.007, 5, SIDES);
  private readonly haloGeometry = new TorusGeometry(1, 0.025, 5, SIDES);
  private readonly geometries = new Set<BufferGeometry>();
  private readonly materials = new Set<Material>();
  private readonly gates: { group: Group; face: MeshBasicMaterial; halo: MeshBasicMaterial; drum: boolean; melody: boolean }[] = [];
  private readonly railsGeometry = new BufferGeometry();
  private readonly voiceGeometry = new BufferGeometry();
  private readonly voice = new Group();
  private readonly voicePlane: Mesh;
  private readonly railMaterial: LineBasicMaterial;
  private readonly voiceMaterial: MeshBasicMaterial;
  private time = 0;
  private travel = 0;
  private bass = 0;
  private vocal = 0;
  private melody = 0;
  private energy = 0;
  private vocalPitch = 0.5;
  private voicePhase = 0;
  private flightTime = 0;
  private melodyPitch = 0.5;
  private arousal = 0.4;
  private beat = 0;
  private readonly rhythm = new RhythmMotion();
  private pulse = 0;
  private strength = 1;
  private disposed = false;

  constructor() {
    const keep = <T extends Material>(material: T, key: ElementKey) => {
      this.materials.add(material);
      if ('color' in material && material.color instanceof Color) this.focus.trackColor(key, material.color);
      return material;
    };
    this.camera.position.z = 0;
    this.camera.lookAt(0, 0, -1);
    this.scene.fog = new FogExp2(this.background, 0.018);
    this.geometries.add(this.ringGeometry).add(this.haloGeometry).add(this.railsGeometry).add(this.voiceGeometry);
    for (let i = 0; i < GATES; i++) {
      const drum = i % 4 === 0;
      const melody = !drum && i % 2 === 0;
      const color = drum ? '#f66570' : melody ? '#58c7c7' : '#4593fc';
      const element = drum ? 'drums' : melody ? 'melody' : 'bass';
      const face = keep(new MeshBasicMaterial({ color, transparent: true, opacity: 0.8, depthWrite: false }), element);
      const halo = keep(new MeshBasicMaterial({ color, transparent: true, opacity: 0.09, depthWrite: false }), element);
      const group = new Group();
      group.name = drum ? 'drum-gate' : melody ? 'melody-gate' : 'bass-gate';
      group.add(new Mesh(this.ringGeometry, face), new Mesh(this.haloGeometry, halo));
      this.gates.push({ group, face, halo, drum, melody });
      this.scene.add(group);
    }
    const rails = new Float32BufferAttribute(new Float32Array(SIDES * (SAMPLES - 1) * 6), 3);
    rails.setUsage(DynamicDrawUsage);
    this.railsGeometry.setAttribute('position', rails);
    this.railMaterial = keep(new LineBasicMaterial({ color: '#4593fc', transparent: true, opacity: 0.55 }), 'bass');
    const railLines = new LineSegments(this.railsGeometry, this.railMaterial);
    railLines.frustumCulled = false;
    this.scene.add(railLines);
    // A folded, arrow-shaped aircraft points down the tunnel (-Z), viewed from behind and above.
    const planeGeometry = new BufferGeometry();
    planeGeometry.setAttribute('position', new Float32BufferAttribute([
      0, 0.12, -1.25, -0.95, -0.04, 0.65, -0.12, 0.2, 0.4,
      0, 0.12, -1.25, 0.12, 0.2, 0.4, 0.95, -0.04, 0.65,
      0, 0.12, -1.25, -0.12, 0.2, 0.4, 0, -0.12, 0.75,
      0, 0.12, -1.25, 0, -0.12, 0.75, 0.12, 0.2, 0.4,
      -0.12, 0.2, 0.4, 0, 0.43, 0.85, 0, -0.12, 0.75,
      0.12, 0.2, 0.4, 0, -0.12, 0.75, 0, 0.43, 0.85,
    ], 3));
    this.geometries.add(planeGeometry);
    this.voiceMaterial = keep(new MeshBasicMaterial({ color: '#ffd158', transparent: true, opacity: 0.9, side: DoubleSide }), 'vocal');
    this.voicePlane = new Mesh(planeGeometry, this.voiceMaterial);
    this.voice.name = 'vocal';
    this.voicePlane.name = 'vocal-plane';
    this.voice.add(this.voicePlane);
    const vibration = new Float32BufferAttribute(new Float32Array(2 * 3 * 24 * 2 * 3), 3);
    vibration.setUsage(DynamicDrawUsage);
    this.voiceGeometry.setAttribute('position', vibration);
    const waves = new LineSegments(this.voiceGeometry, keep(new LineBasicMaterial({ color: '#ffd158', transparent: true, opacity: 0.65 }), 'vocal'));
    waves.name = 'vocal-vibration';
    waves.frustumCulled = false;
    this.voice.add(waves);
    this.scene.add(this.voice);

    this.renderer.setClearColor(this.background);
  }

  resize(width: number, height: number) {
    if (this.disposed) return;
    this.renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 1.5));
    this.renderer.setSize(Math.max(1, width), Math.max(1, height), false);
    this.camera.aspect = Math.max(1, width) / Math.max(1, height);
    this.camera.updateProjectionMatrix();
  }

  private radius(depth: number) {
    return 4.1 + this.bass * this.strength * (2.8 + Math.sin(depth * 0.2 - this.time * 2.6) * 0.8);
  }

  private twist(depth: number) {
    return depth * 0.011 + Math.sin(this.time * 0.16) * 0.2;
  }

  /** Center-line bends grow with depth: the entrance stays centered while the horizon curves. */
  private centerX(depth: number) {
    return Math.sin(depth * 0.025 + this.time * 0.18) * depth * 0.075 * this.strength
      + (this.melodyPitch - 0.5) * depth * 0.15 * this.melody * this.strength;
  }

  private centerY(depth: number) {
    return Math.sin(depth * 0.018 - this.time * 0.13) * depth * 0.05 * this.strength
      + (this.melodyPitch - 0.5) * depth * 0.12 * this.melody * this.strength;
  }

  frame(f: Features) {
    this.focus.update(f.dt);
    if (this.disposed) return;
    const dt = Math.max(0, Math.min(f.dt, 0.05));
    this.strength = approach(this.strength, f.reduceFlash ? 0.35 : 1, dt, 0.4);
    this.time += dt * this.strength;
    this.bass = approach(this.bass, f.active ? f.bass : 0, dt, f.bass > this.bass ? 0.04 : 0.18);
    this.vocal = approach(this.vocal, f.active ? f.vocal : 0, dt, 0.07);
    this.melody = approach(this.melody, f.active ? f.melody : 0, dt, 0.06);
    this.energy = approach(this.energy, f.active ? f.energy : 0, dt, 0.4);
    this.vocalPitch = approach(this.vocalPitch, f.vocalPitch, dt, 0.08);
    this.melodyPitch = approach(this.melodyPitch, f.melodyPitch, dt, 0.08);
    this.voicePhase = (this.voicePhase + dt * TAU * (3 + this.vocalPitch * 9)) % TAU;
    this.flightTime += dt * 0.95 * this.strength;
    this.arousal = approach(this.arousal, f.arousal, dt, 2);
    this.pulse = approach(this.pulse, f.pulse, dt, 0.15);
    this.rhythm.update(f, dt);
    // Two gates per estimated beat. Keep the beat timing when reducing motion; reduce distance instead.
    const speed = this.rhythm.rate * SPACING * 2 * (1 + this.rhythm.level * 0.2);
    this.travel = (this.travel + dt * this.strength * speed) % LENGTH;
    // Confirmed drum activity gates the red response, so bass-only onsets do not impersonate drums.
    const drumHit = f.active ? Math.max(f.kick, f.snare * 0.85, f.drums, this.rhythm.level * Math.min(1, f.drums * 3)) : 0;
    this.beat = Math.max(this.beat * Math.exp(-dt / 0.11), drumHit * this.strength);
    const bg = moodBackground(f.valence, f.arousal);
    this.targetBackground.setRGB(bg[0] / 510, bg[1] / 510, bg[2] / 510, 'srgb');
    this.background.lerp(this.targetBackground, 1 - Math.exp(-dt / 3));
    this.renderer.setClearColor(this.background);
    for (let i = 0; i < GATES; i++) {
      const gate = this.gates[i];
      const depth = 1 + ((i * SPACING - this.travel + LENGTH) % LENGTH);
      const radius = this.radius(depth) + (gate.drum ? this.beat * 2.5 : 0);
      gate.group.position.set(this.centerX(depth), this.centerY(depth), -depth);
      gate.group.rotation.z = this.twist(depth)
        + (gate.melody ? (this.melodyPitch - 0.5) * this.melody * this.strength * 0.7 : 0);
      const wallSway = this.bass * this.strength * Math.sin(depth * 0.2 - this.time * 2.6) * 0.16;
      gate.group.scale.set(radius * (1 + wallSway), radius * (1 - wallSway), radius);
      // Fade the recycled entrance/far gate to avoid popping. Audio light uses pulse only.
      const fade = Math.min(1, (depth - 1) / 3) * Math.min(1, (LENGTH + 1 - depth) / 14);
      gate.face.opacity = fade * (0.72 + this.pulse * 0.12);
      gate.halo.opacity = fade * (0.07 + this.pulse * 0.025);
    }
    const rails = this.railsGeometry.getAttribute('position') as BufferAttribute;
    let vertex = 0;
    for (let side = 0; side < SIDES; side++) {
      for (let j = 0; j < SAMPLES - 1; j++) {
        for (let end = 0; end < 2; end++) {
          const depth = 1 + (j + end) / (SAMPLES - 1) * LENGTH;
          const angle = side / SIDES * TAU + this.twist(depth);
          const radius = this.radius(depth);
          const sway = this.bass * this.strength * Math.sin(depth * 0.2 - this.time * 2.6) * 0.16;
          rails.setXYZ(vertex++, this.centerX(depth) + Math.cos(angle) * radius * (1 + sway),
            this.centerY(depth) + Math.sin(angle) * radius * (1 - sway), -depth);
        }
      }
    }
    rails.needsUpdate = true;
    this.updateVoice();
    this.railMaterial.opacity = 0.55 + this.pulse * 0.05;
    this.voiceMaterial.opacity = 0.9 + this.pulse * 0.08;
    this.renderer.render(this.scene, this.camera);
  }

  private updateVoice() {
    const presence = Math.sqrt(this.vocal);
    const amount = presence * this.strength;
    const depth = 12 + Math.sin(this.flightTime * 0.45) * this.strength * 2.2;
    this.voice.position.set(this.centerX(depth) + Math.sin(this.flightTime * 0.8) * this.strength * 1.35,
      this.centerY(depth) + Math.sin(this.flightTime * 1.1) * this.strength * 0.4, -depth);
    // Keep the aircraft's apparent size constant, including perspective during forward/backward flight.
    // Vocal loudness and pitch affect the surrounding waves only.
    this.voice.scale.setScalar(1.4 * depth / 12);
    this.voicePlane.rotation.set(0.5 + Math.sin(this.flightTime * 0.7) * this.strength * 0.12,
      Math.cos(this.flightTime * 0.8) * this.strength * 0.25,
      -Math.cos(this.flightTime * 0.8) * this.strength * 0.3);
    const vibration = this.voiceGeometry.getAttribute('position');
    let vertex = 0;
    for (const side of [-1, 1]) {
      for (let wave = 0; wave < 3; wave++) {
        for (let segment = 0; segment < 24; segment++) {
          for (let end = 0; end < 2; end++) {
            const angle = ((segment + end) / 24 - 0.5) * 2;
            const tremble = Math.sin(this.voicePhase + wave * 0.8 + angle * 4) * amount * (0.035 + this.vocalPitch * 0.12);
            const radius = 0.83 + wave * 0.24 + tremble;
            vibration.setXYZ(vertex++, side * (Math.cos(angle) * radius), Math.sin(angle) * radius * 0.75, 0.015);
          }
        }
      }
    }
    vibration.needsUpdate = true;
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
    this.camera.rotation.set(view.y * 0.1, view.x * 0.14, 0);
    this.camera.fov = 78 / view.zoom;
    this.camera.updateProjectionMatrix();
  }
}
