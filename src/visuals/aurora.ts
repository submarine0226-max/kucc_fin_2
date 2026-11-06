import { ElementFocus } from './interaction';
import { AuroraRipples, MAX_LAKE_RIPPLES } from './auroraRipples';
import { BAND_COUNT, type Features } from '../audio/features';
import { FULLSCREEN_VS, NOISE_GLSL, SpectrumTexture, createProgram, getGL, releaseGL, type Program } from './gl';
import { ELEMENT_RGB, approach, easeSpectrum, moodBlend, moodVivid, swell, type Visual, type VisualInfo } from './types';

/** 오로라: curtains of light over a still lake. The tune sets how high the light climbs. */
export const auroraInfo: VisualInfo = {
  id: 'aurora',
  name: '오로라',
  needsWebGL: true,
  interaction: { pointer: '호수 클릭: 파문 만들기', keyboard: '호수 가운데 파문 만들기' },
  legend: {
    drums: { color: '#f66570', text: '하늘을 가르는 붉은 별똥별' },
    bass: { color: '#4593fc', text: '장막을 출렁이게 하는 저음과 호수 물결' },
    vocal: { color: '#ffd158', text: '음 높이를 따라 나는 금빛 띠' },
    melody: { color: '#58c7c7', text: '음이 높을수록 솟고, 음마다 물결이 흐르는 빛의 장막' },
  },
};

const METEORS = 6;
const METEOR_MIN_GAP = 0.4;
const NOTE_WAVES = 5;
const NOTE_WAVE_MIN_GAP = 0.16;
const NOTE_WAVE_SPEED = 0.55;

const FS = `#version 300 es
precision highp float;
in vec2 vUv;
out vec4 o;
uniform float uTime, uAspect, uMelody, uMelodyPitch, uVocal, uVocalPitch, uBass, uPulse, uFlow, uRipple;
uniform vec3 uBg, uMelodyColor, uAccent, uVocalColor, uBassColor, uDrumColor;
uniform vec4 uMeteors[${METEORS}];
uniform vec2 uNoteWaves[${NOTE_WAVES}];
uniform vec4 uLakeClicks[${MAX_LAKE_RIPPLES}];
uniform sampler2D uSpec;
${NOISE_GLSL}

vec2 curtain(vec2 p, float layer, float height) {
  float t = uTime * uFlow;
  float fold = p.x * (1.6 + layer * 0.5) + layer * 7.1;
  float xw = fold + 0.75 * sin(fold * 0.9 + t * 0.5) + 0.8 * fbm(vec2(fold * 0.7, t * 0.22));
  // The bass sways the whole curtain, more strongly on the near layer.
  xw += uBass * (0.55 - layer * 0.12) * sin(fold * 0.55 + uRipple * 0.7);
  // The foot of the curtain snakes across the sky, like a ribbon seen from below.
  float base = 0.13 + 0.08 * layer + 0.09 * sin(xw * 0.8 + t * 0.3) + 0.05 * sin(xw * 2.1 - t * 0.2 + layer);
  float y = p.y - base;
  float top = height * (0.55 + 0.75 * fbm(vec2(xw * 0.9, t * 0.3)));
  float foot = smoothstep(-0.05, 0.015, y) * (0.55 + 0.45 * smoothstep(0.0, 0.05, -abs(y - 0.012) + 0.05));
  float body = foot * exp(-max(y, 0.0) / max(top, 0.02) * 2.0);
  float spec = spectrumAt(uSpec, 0.2 + 0.6 * abs(fract(p.x * 0.17 + layer * 0.3) * 2.0 - 1.0));
  float rays = 0.45 + 0.55 * noise(vec2(xw * 16.0, t * 0.9));
  rays *= 0.55 + 0.45 * noise(vec2(xw * 47.0, t * 1.5));
  float travelling = 0.0;
  for (int i = 0; i < ${NOTE_WAVES}; i++) {
    float d = p.x - uNoteWaves[i].x;
    travelling += uNoteWaves[i].y * exp(-d * d * 14.0);
  }
  float lift = 1.0 + 0.95 * min(travelling, 1.0);
  return vec2(body * rays * (0.55 + 1.15 * spec) * lift, body * lift);
}

vec3 sky(vec2 uv, vec2 p) {
  float h = uv.y;
  vec3 col = uBg * (1.2 - h * 0.85);
  vec2 g = p * 150.0;
  vec2 cell = floor(g);
  float s = hash(cell);
  if (s > 0.986) {
    float tw = 0.6 + 0.4 * sin(uTime * (1.0 + s * 3.0) + s * 90.0);
    col += vec3(0.85, 0.9, 1.0) * smoothstep(0.42, 0.0, length(fract(g) - 0.5)) * tw * 0.8 * smoothstep(0.0, 0.2, h);
  }
  col += uBassColor * uBass * uBass * 0.5 * exp(-h * 7.0);
  col += uBassColor * 0.07 * exp(-h * 3.0);

  float height = 0.1 + 0.72 * uMelodyPitch;
  float m = 0.0;
  float soft = 0.0;
  for (float l = 0.0; l < 3.0; l += 1.0) {
    vec2 layer = curtain(p, l, height * (1.0 - l * 0.18)) * (1.0 - l * 0.2);
    m += layer.x;
    soft += layer.y;
  }
  // Never fully dark, so a passage with no melody still has a sky worth looking at.
  float amount = 0.42 + 1.05 * uMelody;
  vec3 tone = mix(uMelodyColor, uAccent, smoothstep(0.1, 0.55, h - 0.08));
  col += tone * soft * amount * 0.34;
  col += tone * m * amount * 1.7;
  // The densest light burns almost white, which is what makes an aurora look lit from within.
  col += vec3(0.72, 1.0, 0.86) * pow(min(m * amount, 1.3), 3.0) * 0.13;

  float ribbonY = 0.2 + 0.68 * uVocalPitch + 0.035 * sin(p.x * 3.2 + uTime * 1.4) + 0.018 * sin(p.x * 9.0 - uTime * 2.2);
  float width = 0.003 + 0.03 * uVocal;
  float d = abs(h - ribbonY);
  float ribbon = exp(-d * d / (width * width)) + 0.26 * exp(-d / (width * 4.0));
  col += uVocalColor * ribbon * sqrt(uVocal) * 1.7 * (0.7 + 0.3 * noise(vec2(p.x * 7.0, uTime)));

  for (int i = 0; i < ${METEORS}; i++) {
    vec4 me = uMeteors[i];
    if (me.w <= 0.0) continue;
    vec2 dir = normalize(vec2(1.0, -0.42));
    vec2 rel = p - me.xy;
    float along = dot(rel, dir);
    float across = length(rel - dir * along);
    float len = 0.6 * me.w;
    float trail = smoothstep(-len, 0.0, along) * step(along, 0.0) + smoothstep(0.012, 0.0, along) * step(0.0, along);
    col += uDrumColor * exp(-across * across * 40000.0) * trail * me.w * 2.4;
    col += uDrumColor * exp(-across * across * 1400.0) * trail * me.w * 0.3;
  }
  col += vec3(0.35, 0.42, 0.6) * uPulse * 0.05;
  return col;
}

void main() {
  const float HORIZON = 0.2;
  vec2 uv = vUv;
  float below = uv.y < HORIZON ? 1.0 : 0.0;
  vec2 suv = uv;
  float shimmer = 0.0;
  float clickLight = 0.0;
  if (below > 0.5) {
    float depth = (HORIZON - uv.y) / HORIZON;
    float wave = sin(uv.x * 34.0 / (0.25 + depth) + uRipple * 2.0 + depth * 22.0)
               + 0.6 * noise(vec2(uv.x * 26.0, uv.y * 160.0 + uRipple));
    shimmer = wave * (0.002 + 0.024 * uBass) * (0.3 + depth);
    // Concentric ellipses disturb only the reflection, never the sky above the shore.
    for (int i = 0; i < ${MAX_LAKE_RIPPLES}; i++) {
      vec4 ring = uLakeClicks[i];
      if (ring.w <= 0.001) continue;
      vec2 delta = (uv - ring.xy) * vec2(uAspect, 3.5);
      float distance = length(delta);
      float radius = ring.z * 0.24;
      float width = 0.010 + ring.z * 0.003;
      float crest = 0.0;
      for (int band = 0; band < 3; band++) {
        float r = radius - float(band) * 0.065;
        float d = (distance - max(0.0, r)) / width;
        crest += exp(-d * d) * smoothstep(0.0, 0.035, r) * (1.0 - float(band) * 0.22);
      }
      float mask = smoothstep(0.0, 0.015, HORIZON - uv.y);
      clickLight += crest * ring.w * mask;
      shimmer += sin((distance - radius) * 100.0) * exp(-abs(distance - radius) * 24.0) * ring.w * mask * 0.006;
    }
    shimmer = clamp(shimmer, -0.12, 0.12);
    suv = vec2(uv.x + shimmer * 0.6, 2.0 * HORIZON - uv.y + shimmer);
  }
  float h = (suv.y - HORIZON) / (1.0 - HORIZON);
  vec2 p = vec2(suv.x * uAspect, h);
  vec3 col = sky(vec2(suv.x, h), p);

  float ridge = -0.02 + 0.11 * pow(fbm(vec2(suv.x * uAspect * 1.1 + 4.0, 3.0)), 2.0) + 0.022 * fbm(vec2(suv.x * uAspect * 7.0, 9.0));
  float mountain = smoothstep(ridge + 0.003, ridge - 0.003, h);
  col = mix(col, uBg * 0.35 + uBassColor * 0.035 * (1.0 + uBass), mountain);

  if (below > 0.5) {
    float depth = (HORIZON - uv.y) / HORIZON;
    col *= 0.92 - 0.42 * depth;
    col += uBassColor * uBass * 0.1 * (1.0 - depth);
    col += vec3(0.22, 0.52, 0.60) * min(clickLight, 0.75) * 0.40;
  }
  col = col / (1.0 + col * 0.35);
  o = vec4(pow(col, vec3(0.96)), 1.0);
}`;

export class AuroraVisual implements Visual {
  readonly focus = new ElementFocus();
  readonly canvas = document.createElement('canvas');
  private readonly gl = getGL(this.canvas);
  private readonly p: Program;
  private readonly spec: SpectrumTexture;
  private readonly meteors = new Float32Array(METEORS * 4);
  private readonly meteorAge = new Float32Array(METEORS).fill(99);
  private readonly meteorPeak = new Float32Array(METEORS);
  private readonly easedSpectrum = new Float32Array(BAND_COUNT);
  private readonly noteWaves = new Float32Array(NOTE_WAVES * 2);
  private readonly noteWaveAge = new Float32Array(NOTE_WAVES).fill(99);
  private readonly noteWavePeak = new Float32Array(NOTE_WAVES);
  private readonly noteWaveDirection = new Float32Array(NOTE_WAVES);
  private sinceNoteWave = 1;
  private sinceMeteor = 1;
  private melody = 0;
  private vocal = 0;
  private bass = 0;
  private pulse = 0;
  private meteorIndex = 0;
  private aspect = 1;
  private t = 0;
  private ripple = 0;
  private height = 0.5;
  private vocalY = 0.5;
  private readonly lake = new AuroraRipples();
  private readonly lakeClicks = new Float32Array(MAX_LAKE_RIPPLES * 4);

  activate(point = { x: 0.5, y: 0.9 }): boolean { return this.lake.add(point); }

  constructor() {
    this.p = createProgram(this.gl, FULLSCREEN_VS, FS);
    this.spec = new SpectrumTexture(this.gl, BAND_COUNT);
  }

  resize(width: number, height: number) {
    // The shader is costly per pixel and soft by nature, so a lower resolution loses little.
    const scale = Math.min(window.devicePixelRatio || 1, 1) * 0.8;
    this.canvas.width = Math.max(1, Math.round(width * scale));
    this.canvas.height = Math.max(1, Math.round(height * scale));
    this.aspect = width / Math.max(1, height);
    this.gl.viewport(0, 0, this.canvas.width, this.canvas.height);
  }

  private launch(strength: number) {
    // Not every hit needs a meteor. A fast beat would otherwise fill the sky with them.
    if (this.sinceMeteor < METEOR_MIN_GAP) return;
    let i = this.meteorIndex % METEORS;
    for (let k = 0; k < METEORS; k++) if (this.meteorAge[k] > this.meteorAge[i]) i = k;
    this.sinceMeteor = 0;
    this.meteorIndex = i + 1;
    this.meteorAge[i] = 0;
    this.meteorPeak[i] = 0.5 + strength * 0.5;
    this.meteors[i * 4] = Math.random() * this.aspect;
    this.meteors[i * 4 + 1] = 0.55 + Math.random() * 0.4;
  }

  /** A note starts a band of light that travels along the curtain rather than flashing it. */
  private startNoteWave(f: Features) {
    if (this.sinceNoteWave < NOTE_WAVE_MIN_GAP) return;
    let i = 0;
    for (let k = 1; k < NOTE_WAVES; k++) if (this.noteWaveAge[k] > this.noteWaveAge[i]) i = k;
    this.sinceNoteWave = 0;
    this.noteWaveAge[i] = 0;
    this.noteWavePeak[i] = 0.45 + 0.55 * f.melodyNote;
    const fromLeft = f.melodyPitchClass % 2 === 0;
    this.noteWaveDirection[i] = fromLeft ? 1 : -1;
    this.noteWaves[i * 2] = (fromLeft ? 0.1 : 0.9) * this.aspect;
  }

  private updateNoteWaves(dt: number, reduce: boolean) {
    const strength = reduce ? 0.55 : 1;
    for (let i = 0; i < NOTE_WAVES; i++) {
      this.noteWaveAge[i] += dt;
      this.noteWaves[i * 2] += this.noteWaveDirection[i] * NOTE_WAVE_SPEED * dt;
      this.noteWaves[i * 2 + 1] = this.noteWavePeak[i] * strength * swell(this.noteWaveAge[i], 0.3, 0.9);
    }
  }

  frame(f: Features) {
    this.focus.update(f.dt);
    const gl = this.gl;
    const dt = Math.min(f.dt, 0.05);
    this.lake.update(dt);
    this.lakeClicks.fill(0);
    this.lake.rings.forEach((ring, i) => {
      const offset = i * 4;
      this.lakeClicks[offset] = ring.x;
      this.lakeClicks[offset + 1] = ring.y;
      this.lakeClicks[offset + 2] = ring.age;
      this.lakeClicks[offset + 3] = swell(ring.age, 0.22, 0.85) * (f.reduceFlash ? 0.65 : 1);
    });
    this.t += dt * (0.5 + f.arousal * 1.4);
    this.melody = approach(this.melody, f.melody, dt, 0.3);
    this.vocal = approach(this.vocal, f.vocal, dt, 0.2);
    // The bass sways bright curtains across the screen, so reduced mode keeps that sway slow.
    this.bass = approach(this.bass, f.bass, dt, f.reduceFlash ? 1.2 : 0.3);
    this.pulse = approach(this.pulse, f.pulse, dt, 0.15);
    this.sinceMeteor += dt;
    this.sinceNoteWave += dt;
    if (f.melodyNote > 0) this.startNoteWave(f);
    this.updateNoteWaves(dt, f.reduceFlash);
    easeSpectrum(this.easedSpectrum, f.spectrum, dt, 0.25, 0.6);
    this.ripple += dt * (1.2 + this.bass * 5);
    this.height = approach(this.height, f.melodyPitch, dt, 0.45);
    this.vocalY = approach(this.vocalY, f.vocalPitch, dt, 0.22);
    if (f.kick > 0) this.launch(f.kick);
    else if (f.snare > 0) this.launch(f.snare * 0.6);
    for (let i = 0; i < METEORS; i++) {
      this.meteorAge[i] += dt;
      this.meteors[i * 4] += dt * 0.9;
      this.meteors[i * 4 + 1] -= dt * 0.38;
      const w = this.meteorPeak[i] * swell(this.meteorAge[i], 0.18, 0.45);
      this.meteors[i * 4 + 3] = w < 0.01 ? 0 : w;
    }

    const v = f.valence;
    const a = f.arousal;
    const n = (c: readonly number[]) => [c[0] / 255, c[1] / 255, c[2] / 255];
    // The sky stays a deep night in every mood. The curtain's own colour carries the mood.
    const bg = n(moodBlend([7, 9, 24], [4, 15, 27], [15, 5, 15], [11, 8, 31], v, a));
    const u = this.p.u;
    gl.useProgram(this.p.handle);
    this.spec.update(this.easedSpectrum, 0);
    gl.uniform1i(u.uSpec, 0);
    gl.uniform1f(u.uTime, this.t);
    gl.uniform1f(u.uFlow, 1);
    gl.uniform1f(u.uRipple, this.ripple);
    gl.uniform1f(u.uAspect, this.aspect);
    gl.uniform1f(u.uMelody, this.melody);
    gl.uniform1f(u.uMelodyPitch, this.height);
    gl.uniform1f(u.uVocal, this.vocal);
    gl.uniform1f(u.uVocalPitch, this.vocalY);
    gl.uniform1f(u.uBass, this.bass);
    gl.uniform1f(u.uPulse, this.pulse);
    gl.uniform4fv(u.uMeteors, this.meteors);
    gl.uniform2fv(u.uNoteWaves, this.noteWaves);
    gl.uniform4fv(u.uLakeClicks, this.lakeClicks);
    gl.uniform3fv(u.uBg, bg);
    gl.uniform3fv(u.uMelodyColor, n(this.focus.color('melody', moodVivid([60, 235, 170], v, a))));
    const accent = moodBlend([105, 95, 255], [70, 175, 255], [255, 45, 60], [255, 70, 190], v, a);
    gl.uniform3fv(u.uAccent, n(this.focus.color('melody', moodVivid(accent, v, a))));
    gl.uniform3fv(u.uVocalColor, n(this.focus.color('vocal', moodVivid(ELEMENT_RGB.vocal, v, a))));
    gl.uniform3fv(u.uBassColor, n(this.focus.color('bass', moodVivid(ELEMENT_RGB.bass, v, a))));
    gl.uniform3fv(u.uDrumColor, n(this.focus.color('drums', moodVivid(ELEMENT_RGB.drums, v, a))));
    gl.drawArrays(gl.TRIANGLES, 0, 3);
  }

  dispose() {
    this.lake.rings.length = 0;
    releaseGL(this.gl);
  }
}
