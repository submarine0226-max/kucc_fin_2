import { ElementFocus, type ViewState } from './interaction';
import { galaxyViewMatrix } from './galaxyView';
import type { Features } from '../audio/features';
import { BAND_COUNT } from '../audio/features';
import { FULLSCREEN_VS, NOISE_GLSL, SpectrumTexture, createProgram, getGL, releaseGL, type Program } from './gl';
import { ELEMENT_RGB, approach, easeSpectrum, moodBackground, moodVivid, swell, type Visual, type VisualInfo } from './types';

/** 은하: a spiral of stars where radius is pitch: low notes at the core, high notes at the rim. */
export const galaxyInfo: VisualInfo = {
  id: 'galaxy',
  name: '은하',
  needsWebGL: true,
  legend: {
    drums: { color: '#f66570', text: '별을 밀어내는 붉은 충격파' },
    bass: { color: '#4593fc', text: '부풀어 오르는 푸른 성운' },
    vocal: { color: '#ffd158', text: '중심에서 빛나는 금빛 별' },
    melody: { color: '#58c7c7', text: '음 높이의 궤도를 도는 혜성' },
  },
};

const STAR_COUNT = 90000;
const RING_COUNT = 6;
const COMET_COUNT = 14;
const TRAIL = 40;
const TRAIL_SPACING = 0.018;
const COMET_FADE_IN = 0.35;

const STAR_VS = `#version 300 es
precision highp float;
layout(location=0) in vec4 aSeed;
uniform float uRot, uAspect, uScale, uPixel, uVivid;
uniform mat3 uView;
uniform sampler2D uSpec;
uniform vec2 uRings[${RING_COUNT}];
uniform vec3 uInner, uOuter;
out vec3 vColor;
out float vBright;
${NOISE_GLSL}
void main() {
  float r = pow(aSeed.x, 0.95) * 1.05;
  float arm = floor(aSeed.y * 3.0) * 2.0944;
  // Cubed, so most stars crowd the middle of an arm and thin out with no hard edge.
  float spread = 2.0 * aSeed.z - 1.0;
  float scatter = spread * spread * spread * (1.25 - 0.7 * r) * (aSeed.w < 0.2 ? 3.2 : 1.0);
  // Rigid rotation: a shear that grows with time would wind the arms into ribbons.
  float angle = arm + log(r + 0.04) * 2.3 + scatter + uRot + 0.05 * sin(uRot * 0.7 + aSeed.w * 40.0);
  float s = spectrumAt(uSpec, r * 0.95 + 0.03);
  float push = 0.0;
  for (int i = 0; i < ${RING_COUNT}; i++) {
    float d = r - uRings[i].x;
    push += uRings[i].y * exp(-d * d * 90.0);
  }
  float radius = r * (1.0 + 0.12 * push);
  vec2 p = vec2(cos(angle), sin(angle)) * radius;
  float lift = (aSeed.w - 0.5) * (0.09 * max(0.0, 1.0 - r) + 0.24 * exp(-r * r * 12.0))
    + push * 0.03 * (aSeed.w - 0.5);
  vec3 point = uView * vec3(p, lift);
  float depth = 3.4 - point.z;
  gl_Position = vec4(point.x * 3.8 * uScale / uAspect, point.y * 3.8 * uScale, 0.0, depth);
  float twinkle = 0.6 + 0.4 * sin(aSeed.w * 300.0 + uRot * 40.0);
  vBright = (0.5 + 2.0 * s * s + push * 0.6) * twinkle * uVivid * (1.3 - 0.8 * r);
  gl_PointSize = uPixel * (0.9 + 2.0 * pow(aSeed.w, 7.0) + 1.6 * s * s) * 3.4 / depth;
  vColor = mix(uInner, uOuter, smoothstep(0.05, 0.8, r + (aSeed.z - 0.5) * 0.25));
}`;

const STAR_FS = `#version 300 es
precision highp float;
in vec3 vColor;
in float vBright;
out vec4 o;
void main() {
  float d = length(gl_PointCoord - 0.5) * 2.0;
  float a = smoothstep(1.0, 0.1, d);
  o = vec4(vColor * vBright * a * 0.7, 1.0);
}`;

const NEBULA_FS = `#version 300 es
precision highp float;
in vec2 vUv;
out vec4 o;
uniform float uAspect, uTime, uBass, uVocal, uPulse, uVocalPitch;
uniform mat3 uView;
uniform float uZoom;
uniform vec3 uBg, uBassColor, uVocalColor, uDrumColor;
uniform vec2 uRings[${RING_COUNT}];
${NOISE_GLSL}
void main() {
  vec2 p = (vUv * 2.0 - 1.0) * vec2(uAspect, 1.0);
  // Trace the gas in galaxy coordinates, rather than rotating a flat screen-space image.
  mat3 inverseView = transpose(uView);
  vec3 origin = inverseView * vec3(0.0, 0.0, 3.4);
  vec3 ray = inverseView * normalize(vec3(p / (3.8 * uZoom), -1.0));
  vec3 col = uBg * (0.7 + 0.3 * exp(-length(p)));
  float b = dot(origin, ray);
  float discriminant = b * b - dot(origin, origin) + 2.89;
  if (discriminant > 0.0) {
    float start = max(0.0, -b - sqrt(discriminant));
    float finish = -b + sqrt(discriminant);
    float stepSize = (finish - start) / 20.0;
    float gas = 0.0;
    for (int i = 0; i < 20; i++) {
      vec3 q = origin + ray * (start + (float(i) + 0.5) * stepSize);
      float r = length(q.xy);
      float n = noise(q.xy * 3.5 + q.z * 2.0 + uTime * 0.035) * 0.65
        + noise(q.xy * 7.0 - q.z * 4.0 - uTime * 0.02) * 0.35;
      float spiral = atan(q.y, q.x) - log(r + 0.04) * 2.3 - uTime * 0.03;
      float arms = 0.55 + 0.45 * pow(abs(cos(spiral * 1.5)), 4.0);
      float density = exp(-q.z * q.z / (0.018 + 0.035 * uBass))
        * exp(-r * r * (1.4 - 0.4 * uBass)) * (0.2 + n * n * 1.7) * arms;
      gas += density * stepSize;
    }
    col += uBassColor * gas * (0.6 + 1.8 * uBass);
  }

  // Shock waves live in the same disc as the stars, including when viewed from below.
  if (abs(ray.z) > 0.015) {
    float planeDistance = -origin.z / ray.z;
    vec3 disc = origin + ray * planeDistance;
    if (planeDistance > 0.0 && length(disc.xy) < 1.6) {
      float r = length(disc.xy);
      for (int i = 0; i < ${RING_COUNT}; i++) {
        float d = r - uRings[i].x;
        float ring = exp(-d * d * 2800.0) + 0.3 * exp(-d * d * 180.0);
        col += uDrumColor * ring * uRings[i].y * (0.35 + 0.65 * abs(ray.z));
      }
    }
  }

  float sp = length(p) / uZoom;
  float size = 0.015 + 0.09 * uVocal;
  float core = size / (sp + size * 0.6);
  float rays = 0.0;
  float a = atan(p.y, p.x);
  rays = pow(abs(cos(a * 6.0 + uTime * 0.2 + uVocalPitch * 2.5)), 26.0) * exp(-sp * (6.0 - 3.4 * uVocal)) * uVocal;
  col += uVocalColor * (core * core * (0.3 + 1.4 * uVocal) + rays * 1.3);
  col += vec3(1.0, 0.86, 0.7) * uPulse * 0.1 * exp(-sp * 2.6);
  o = vec4(col, 1.0);
}`;

const COMET_VS = `#version 300 es
precision highp float;
layout(location=0) in vec4 aPos;
uniform float uPixel, uAspect, uZoom;
uniform mat3 uView;
out float vA;
void main() {
  vec3 point = uView * aPos.xyz;
  float depth = 3.4 - point.z;
  gl_Position = vec4(point.x * 3.8 * uZoom / uAspect, point.y * 3.8 * uZoom, 0.0, depth);
  vA = aPos.w;
  gl_PointSize = uPixel * (1.0 + 7.0 * vA * vA) * 3.4 / depth;
}`;
const COMET_FS = `#version 300 es
precision highp float;
in float vA;
uniform vec3 uColor;
out vec4 o;
void main() {
  float d = length(gl_PointCoord - 0.5) * 2.0;
  float a = smoothstep(1.0, 0.0, d);
  o = vec4((uColor + vec3(0.5) * vA) * a * a * vA * 1.4, 1.0);
}`;

interface Comet {
  angle: number;
  radius: number;
  speed: number;
  life: number;
  age: number;
}

export class GalaxyVisual implements Visual {
  readonly focus = new ElementFocus();
  readonly canvas = document.createElement('canvas');
  private readonly gl = getGL(this.canvas);
  private readonly stars: Program;
  private readonly nebula: Program;
  private readonly comet: Program;
  private readonly spec: SpectrumTexture;
  private readonly starVao: WebGLVertexArrayObject;
  private readonly cometVao: WebGLVertexArrayObject;
  private readonly cometBuffer: WebGLBuffer;
  private readonly cometData = new Float32Array(COMET_COUNT * TRAIL * 4);
  private rotation = galaxyViewMatrix({ x: 0, y: 0, zoom: 1 });
  private zoom = 1;
  private readonly comets: Comet[] = [];
  private readonly rings = new Float32Array(RING_COUNT * 2);
  private readonly ringAge = new Float32Array(RING_COUNT).fill(99);
  private readonly ringPeak = new Float32Array(RING_COUNT);
  private readonly easedSpectrum = new Float32Array(BAND_COUNT);
  private ringIndex = 0;
  private bass = 0;
  private vocal = 0;
  private vocalPitch = 0.5;
  private pulse = 0;
  private aspect = 1;
  private pixel = 1;
  private rot = 0;
  private time = 0;

  constructor() {
    const gl = this.gl;
    this.stars = createProgram(gl, STAR_VS, STAR_FS);
    this.nebula = createProgram(gl, FULLSCREEN_VS, NEBULA_FS);
    this.comet = createProgram(gl, COMET_VS, COMET_FS);
    this.spec = new SpectrumTexture(gl, BAND_COUNT);

    const seeds = new Float32Array(STAR_COUNT * 4);
    for (let i = 0; i < seeds.length; i++) seeds[i] = Math.random();
    this.starVao = gl.createVertexArray()!;
    gl.bindVertexArray(this.starVao);
    const sb = gl.createBuffer()!;
    gl.bindBuffer(gl.ARRAY_BUFFER, sb);
    gl.bufferData(gl.ARRAY_BUFFER, seeds, gl.STATIC_DRAW);
    gl.enableVertexAttribArray(0);
    gl.vertexAttribPointer(0, 4, gl.FLOAT, false, 0, 0);

    this.cometVao = gl.createVertexArray()!;
    gl.bindVertexArray(this.cometVao);
    this.cometBuffer = gl.createBuffer()!;
    gl.bindBuffer(gl.ARRAY_BUFFER, this.cometBuffer);
    gl.bufferData(gl.ARRAY_BUFFER, this.cometData.byteLength, gl.DYNAMIC_DRAW);
    gl.enableVertexAttribArray(0);
    gl.vertexAttribPointer(0, 4, gl.FLOAT, false, 0, 0);
    gl.bindVertexArray(null);
  }

  resize(width: number, height: number) {
    this.pixel = Math.min(window.devicePixelRatio || 1, 1.5);
    this.canvas.width = Math.max(1, Math.round(width * this.pixel));
    this.canvas.height = Math.max(1, Math.round(height * this.pixel));
    this.aspect = width / Math.max(1, height);
    this.gl.viewport(0, 0, this.canvas.width, this.canvas.height);
  }

  private updateRings(f: Features, dt: number) {
    // Take the ring that has faded most, so no visible ring is cut off by a new hit.
    const start = (radius: number, peak: number) => {
      let slot = this.ringIndex;
      for (let i = 0; i < RING_COUNT; i++) if (this.ringAge[i] > this.ringAge[slot]) slot = i;
      this.rings[slot * 2] = radius;
      this.ringAge[slot] = 0;
      this.ringPeak[slot] = peak;
      this.ringIndex = (slot + 1) % RING_COUNT;
    };
    if (f.kick > 0) start(0.02, 0.45 + f.kick * 0.6);
    else if (f.snare > 0) start(0.18, 0.25 + f.snare * 0.3);
    const fall = f.reduceFlash ? 0.28 : 0.45;
    for (let i = 0; i < RING_COUNT; i++) {
      this.ringAge[i] += dt;
      this.rings[i * 2] += dt * 0.5;
      this.rings[i * 2 + 1] = this.ringPeak[i] * swell(this.ringAge[i], 0.14, fall);
    }
  }

  private updateComets(f: Features, dt: number) {
    if (f.melodyNote > 0) {
      const comet: Comet = {
        angle: Math.random() * Math.PI * 2,
        radius: 0.12 + 0.82 * f.melodyPitch,
        speed: 0.9 + f.arousal * 1.8,
        life: 1.6 + f.melodyNote * 1.6,
        age: 0,
      };
      if (this.comets.length >= COMET_COUNT) this.comets.shift();
      this.comets.push(comet);
    }
    const data = this.cometData;
    data.fill(0);
    let w = 0;
    for (let c = this.comets.length - 1; c >= 0; c--) {
      const comet = this.comets[c];
      comet.life -= dt;
      if (comet.life <= 0) {
        this.comets.splice(c, 1);
        continue;
      }
      comet.age += dt;
      comet.angle += (comet.speed * dt) / (comet.radius + 0.25);
      const scale = 0.9;
      const fade = Math.min(1, comet.life) * Math.min(1, comet.age / COMET_FADE_IN);
      // Worked out along the orbit, so the tail stays unbroken at any frame rate.
      const shown = Math.min(TRAIL, (comet.age * comet.speed) / (comet.radius + 0.25) / TRAIL_SPACING);
      for (let i = 0; i < TRAIL; i++) {
        const angle = comet.angle - i * TRAIL_SPACING;
        data[w++] = Math.cos(angle) * comet.radius * scale;
        data[w++] = Math.sin(angle) * comet.radius * scale;
        data[w++] = Math.sin(angle * 2 + comet.radius * 6) * 0.045;
        data[w++] = i < shown ? (1 - i / TRAIL) ** 2 * fade : 0;
      }
    }
    return w / 4;
  }

  frame(f: Features) {
    this.focus.update(f.dt);
    const gl = this.gl;
    const dt = Math.min(f.dt, 0.05);
    this.time += dt;
    this.bass = approach(this.bass, f.bass, dt, 0.28);
    this.vocal = approach(this.vocal, f.vocal, dt, 0.18);
    this.vocalPitch = approach(this.vocalPitch, f.vocalPitch, dt, 0.3);
    this.pulse = approach(this.pulse, f.pulse, dt, 0.12);
    this.rot += dt * (0.05 + 0.42 * f.arousal + 0.25 * this.bass);
    this.updateRings(f, dt);
    const cometPoints = this.updateComets(f, dt);

    easeSpectrum(this.easedSpectrum, f.spectrum, dt, 0.14, 0.4);
    this.spec.update(this.easedSpectrum, 0);
    const bg = moodBackground(f.valence, f.arousal).map((c) => c / 255);
    const n = (c: number[]) => [c[0] / 255, c[1] / 255, c[2] / 255] as const;
    const v = f.valence;
    const a = f.arousal;
    const bassC = n(this.focus.color('bass', moodVivid(ELEMENT_RGB.bass, v, a)));
    const voiceC = n(this.focus.color('vocal', moodVivid(ELEMENT_RGB.vocal, v, a)));
    const drumC = n(this.focus.color('drums', moodVivid(ELEMENT_RGB.drums, v, a)));
    const melC = n(this.focus.color('melody', moodVivid(ELEMENT_RGB.melody, v, a)));

    gl.disable(gl.BLEND);
    gl.useProgram(this.nebula.handle);
    const nu = this.nebula.u;
    gl.uniform1f(nu.uAspect, this.aspect);
    gl.uniformMatrix3fv(nu.uView, false, this.rotation);
    gl.uniform1f(nu.uZoom, this.zoom);
    gl.uniform1f(nu.uTime, this.time);
    gl.uniform1f(nu.uBass, this.bass);
    gl.uniform1f(nu.uVocal, this.vocal);
    gl.uniform1f(nu.uVocalPitch, this.vocalPitch);
    gl.uniform1f(nu.uPulse, this.pulse);
    gl.uniform3f(nu.uBg, bg[0], bg[1], bg[2]);
    gl.uniform3f(nu.uBassColor, bassC[0], bassC[1], bassC[2]);
    gl.uniform3f(nu.uVocalColor, voiceC[0], voiceC[1], voiceC[2]);
    gl.uniform3f(nu.uDrumColor, drumC[0], drumC[1], drumC[2]);
    gl.uniform2fv(nu.uRings, this.rings);
    gl.drawArrays(gl.TRIANGLES, 0, 3);

    gl.enable(gl.BLEND);
    gl.blendFunc(gl.ONE, gl.ONE);
    gl.useProgram(this.stars.handle);
    const su = this.stars.u;
    gl.uniform1i(su.uSpec, 0);
    gl.uniform1f(su.uRot, this.rot);
    gl.uniform1f(su.uAspect, this.aspect);
    gl.uniform1f(su.uScale, this.zoom);
    gl.uniformMatrix3fv(su.uView, false, this.rotation);
    gl.uniform1f(su.uPixel, this.pixel);
    gl.uniform1f(su.uVivid, (0.75 + 0.45 * a) * this.focus.context());
    gl.uniform2fv(su.uRings, this.rings);
    const warm = 0.5 + 0.5 * v;
    gl.uniform3f(su.uInner, 1.0, 0.72 + 0.1 * warm, 0.5 + 0.2 * (1 - warm));
    gl.uniform3f(su.uOuter, 0.45 + 0.3 * warm, 0.62, 1.0 - 0.15 * warm);
    gl.bindVertexArray(this.starVao);
    gl.drawArrays(gl.POINTS, 0, STAR_COUNT);

    if (cometPoints > 0) {
      gl.useProgram(this.comet.handle);
      gl.uniform1f(this.comet.u.uPixel, this.pixel * 1.6);
      gl.uniform1f(this.comet.u.uAspect, this.aspect);
      gl.uniform1f(this.comet.u.uZoom, this.zoom);
      gl.uniformMatrix3fv(this.comet.u.uView, false, this.rotation);
      gl.uniform3f(this.comet.u.uColor, melC[0], melC[1], melC[2]);
      gl.bindVertexArray(this.cometVao);
      gl.bindBuffer(gl.ARRAY_BUFFER, this.cometBuffer);
      gl.bufferSubData(gl.ARRAY_BUFFER, 0, this.cometData.subarray(0, cometPoints * 4));
      gl.drawArrays(gl.POINTS, 0, cometPoints);
    }
    gl.bindVertexArray(null);
  }

  dispose() {
    releaseGL(this.gl);
  }

  setView(view: ViewState) {
    this.rotation = galaxyViewMatrix(view);
    this.zoom = view.zoom;
  }
}
