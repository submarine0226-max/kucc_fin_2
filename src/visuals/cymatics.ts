import { ElementFocus } from './interaction';
import { sandClickKick } from './interactionEffects';
import type { ElementKey, Features } from '../audio/features';
import { createProgram, getGL, releaseGL, type Program } from './gl';
import { ELEMENT_RGB, moodBackground, moodVivid, type Visual, type VisualInfo } from './types';

/**
 * 사이매틱스: sand on a vibrating plate collects along the lines that do not move.
 * Each element is its own colour and grain shape, shaken into its own Chladni pattern.
 */
export const cymaticsInfo: VisualInfo = {
  id: 'cymatics',
  name: '사이매틱스',
  needsWebGL: true,
  interaction: { pointer: '클릭한 곳 모래 튀기기', keyboard: '가운데 모래 튀기기' },
  legend: {
    drums: { color: '#f66570', text: '튀어 오르는 붉은 마름모 모래' },
    bass: { color: '#4593fc', text: '큰 무늬를 그리는 푸른 둥근 모래' },
    vocal: { color: '#ffd158', text: '음 따라 바뀌는 금빛 고리 모래' },
    melody: { color: '#58c7c7', text: '촘촘한 무늬의 청록 세모 모래' },
  },
};

const GROUPS: { key: ElementKey; count: number; shape: number; size: number }[] = [
  { key: 'bass', count: 22000, shape: 0, size: 2.6 },
  { key: 'melody', count: 20000, shape: 3, size: 3.0 },
  { key: 'vocal', count: 16000, shape: 1, size: 3.4 },
  { key: 'drums', count: 10000, shape: 2, size: 3.6 },
];

const BASS_MODES: [number, number][] = [[1, 2], [1, 3], [2, 3], [1, 4], [3, 4], [2, 5]];
const VOCAL_MODES: [number, number][] = [[2, 3], [3, 4], [2, 5], [3, 5], [4, 5], [1, 6], [3, 7], [4, 7]];
const MELODY_MODES: [number, number][] = [
  [3, 6], [4, 7], [5, 8], [3, 8], [5, 9], [6, 7], [4, 9], [7, 8], [5, 11], [6, 9], [7, 10], [8, 9],
];
const DRUM_MODES: [number, number][] = [[2, 7], [3, 5], [1, 5], [4, 6]];

const VS = `#version 300 es
precision highp float;
layout(location=0) in vec2 aPos;
uniform float uSize, uAspect;
void main() {
  gl_Position = vec4(aPos.x / uAspect, aPos.y, 0.0, 1.0);
  gl_PointSize = uSize;
}`;

const FS = `#version 300 es
precision highp float;
uniform vec3 uColor;
uniform int uShape;
out vec4 o;
void main() {
  vec2 p = gl_PointCoord * 2.0 - 1.0;
  float a = 0.0;
  if (uShape == 0) a = smoothstep(1.0, 0.6, length(p));
  else if (uShape == 1) a = smoothstep(0.34, 0.1, abs(length(p) - 0.66));
  else if (uShape == 2) a = smoothstep(1.0, 0.7, abs(p.x) + abs(p.y));
  else { p.y = -p.y; a = smoothstep(0.08, -0.08, max(abs(p.x) * 0.866 + p.y * 0.5, -p.y) - 0.5); }
  if (a < 0.02) discard;
  o = vec4(uColor * a, a);
}`;

const PI = Math.PI;

// Tens of thousands of grains need eight trig calls each per frame, so use a table.
const TABLE_SIZE = 4096;
const TABLE_MASK = TABLE_SIZE - 1;
const TABLE_QUARTER = TABLE_SIZE / 4;
const TABLE_SCALE = TABLE_SIZE / (2 * PI);
const SINE = Float32Array.from({ length: TABLE_SIZE }, (_, i) => Math.sin((i / TABLE_SIZE) * 2 * PI));

class Sand {
  readonly x: Float32Array;
  readonly y: Float32Array;
  readonly vx: Float32Array;
  readonly vy: Float32Array;
  readonly buffer: Float32Array;
  readonly bounce: Float32Array;
  n = 2;
  m = 3;
  targetN = 2;
  targetM = 3;
  /** Grains stay put while mixing, so a new pattern pours out of the old one. */
  change = 0;
  turn = 0;

  constructor(readonly count: number, aspect: number) {
    this.x = new Float32Array(count);
    this.y = new Float32Array(count);
    this.vx = new Float32Array(count);
    this.vy = new Float32Array(count);
    this.buffer = new Float32Array(count * 2);
    this.bounce = new Float32Array(count);
    for (let i = 0; i < count; i++) {
      this.x[i] = (Math.random() * 2 - 1) * aspect;
      this.y[i] = Math.random() * 2 - 1;
      this.buffer[i * 2] = this.x[i];
      this.buffer[i * 2 + 1] = this.y[i];
    }
  }
}

export class CymaticsVisual implements Visual {
  readonly focus = new ElementFocus();
  readonly canvas = document.createElement('canvas');
  private readonly gl = getGL(this.canvas);
  private readonly program: Program;
  private readonly sands: Sand[] = [];
  private readonly vaos: WebGLVertexArrayObject[] = [];
  private readonly buffers: WebGLBuffer[] = [];
  private aspect = 16 / 9;
  private pixel = 1;
  private bassIndex = 0;
  private lastVocalNote = -1;
  private seed = 12345;

  activate(point = { x: 0.5, y: 0.5 }): boolean {
    if (point.x < 0 || point.x > 1 || point.y < 0 || point.y > 1) return false;
    const x = (point.x * 2 - 1) * this.aspect, y = 1 - point.y * 2;
    let moved = false;
    for (const sand of this.sands) for (let i = 0; i < sand.count; i++) {
      const force = sandClickKick(sand.x[i], sand.y[i], x, y, i);
      if (!force) continue;
      sand.vx[i] = Math.max(-3, Math.min(3, sand.vx[i] + force.vx));
      sand.vy[i] = Math.max(-3, Math.min(3, sand.vy[i] + force.vy));
      sand.bounce[i] = force.life;
      moved = true;
    }
    return moved;
  }

  constructor() {
    const gl = this.gl;
    this.program = createProgram(gl, VS, FS);
    for (const g of GROUPS) {
      const sand = new Sand(g.count, this.aspect);
      this.sands.push(sand);
      const vao = gl.createVertexArray()!;
      gl.bindVertexArray(vao);
      const buf = gl.createBuffer()!;
      gl.bindBuffer(gl.ARRAY_BUFFER, buf);
      gl.bufferData(gl.ARRAY_BUFFER, sand.buffer.byteLength, gl.DYNAMIC_DRAW);
      gl.enableVertexAttribArray(0);
      gl.vertexAttribPointer(0, 2, gl.FLOAT, false, 0, 0);
      this.vaos.push(vao);
      this.buffers.push(buf);
    }
    gl.bindVertexArray(null);
  }

  resize(width: number, height: number) {
    this.pixel = Math.min(window.devicePixelRatio || 1, 1.5);
    this.canvas.width = Math.max(1, Math.round(width * this.pixel));
    this.canvas.height = Math.max(1, Math.round(height * this.pixel));
    this.aspect = width / Math.max(1, height);
    this.gl.viewport(0, 0, this.canvas.width, this.canvas.height);
  }

  private setMode(s: Sand, mode: [number, number]) {
    s.targetN = mode[0];
    s.targetM = mode[1];
  }

  /** Moves grains downhill on the plate's vibration, towards the still lines. */
  private shake(s: Sand, level: number, f: Features, dt: number, gentle: number) {
    if (s.n !== s.targetN || s.m !== s.targetM) {
      s.change += dt;
      if (s.change > 0.03) {
        s.n = s.targetN;
        s.m = s.targetM;
        s.change = 0;
      }
    }
    const n = s.n * PI * 0.5;
    const m = s.m * PI * 0.5;
    // Each frame moves every other grain twice as far, which halves the cost and looks the same.
    s.turn = 1 - s.turn;
    dt *= 2;
    const pull = (0.3 + 1.7 * level) * dt * gentle;
    const shiver = (0.0012 + 0.016 * level * (0.5 + f.arousal)) * gentle;
    const asp = this.aspect;
    const drift = Math.max(0, 0.5 - f.valence) * 0.05 * dt;
    const x = s.x;
    const y = s.y;
    const vx = s.vx;
    const vy = s.vy;
    const decay = Math.exp(-dt * 3.2);
    const out = s.buffer;
    let seed = this.seed;
    for (let i = s.turn; i < s.count; i += 2) {
      const px = x[i];
      const py = y[i];
      const inx = (n * px * TABLE_SCALE) | 0;
      const imy = (m * py * TABLE_SCALE) | 0;
      const imx = (m * px * TABLE_SCALE) | 0;
      const iny = (n * py * TABLE_SCALE) | 0;
      const snx = SINE[inx & TABLE_MASK];
      const cnx = SINE[(inx + TABLE_QUARTER) & TABLE_MASK];
      const smy = SINE[imy & TABLE_MASK];
      const cmy = SINE[(imy + TABLE_QUARTER) & TABLE_MASK];
      const smx = SINE[imx & TABLE_MASK];
      const cmx = SINE[(imx + TABLE_QUARTER) & TABLE_MASK];
      const sny = SINE[iny & TABLE_MASK];
      const cny = SINE[(iny + TABLE_QUARTER) & TABLE_MASK];
      const val = cnx * cmy - cmx * cny;
      const gx = -n * snx * cmy + m * smx * cny;
      const gy = -m * cnx * smy + n * cmx * sny;
      const gl = Math.sqrt(gx * gx + gy * gy) + 0.25;
      const abs = val < 0 ? -val : val;
      const move = val * pull * 1.3;
      const jitter = shiver * abs * 1.6 + 0.00025 * level;
      vx[i] *= decay;
      vy[i] *= decay;
      if (s.bounce[i] > 0) {
        vy[i] -= 1.8 * dt;
        s.bounce[i] = Math.max(0, s.bounce[i] - dt);
      }
      seed = Math.imul(seed, 1664525) + 1013904223;
      const rx = (seed >>> 16) / 65536 - 0.5;
      const ry = (seed & 65535) / 65536 - 0.5;
      let nx = px - (gx / gl) * move + rx * jitter + vx[i] * dt;
      let ny = py - (gy / gl) * move + ry * jitter + vy[i] * dt - drift;
      if (s.bounce[i] > 0) {
        if (nx > asp) { nx = asp; vx[i] = -Math.abs(vx[i]) * 0.3; }
        else if (nx < -asp) { nx = -asp; vx[i] = Math.abs(vx[i]) * 0.3; }
        if (ny > 1) { ny = 1; vy[i] = -Math.abs(vy[i]) * 0.3; }
        else if (ny < -1) { ny = -1; vy[i] = Math.abs(vy[i]) * 0.3; }
      } else {
        if (nx > asp) nx -= 2 * asp;
        else if (nx < -asp) nx += 2 * asp;
        if (ny > 1) ny -= 2;
        else if (ny < -1) ny += 2;
      }
      x[i] = nx;
      y[i] = ny;
      out[i * 2] = nx;
      out[i * 2 + 1] = ny;
    }
    this.seed = seed;
  }

  private kickSand(s: Sand, strength: number) {
    for (let i = 0; i < s.count; i++) {
      const a = Math.random() * PI * 2;
      const v = strength * Math.random() * Math.random();
      s.vx[i] += Math.cos(a) * v;
      s.vy[i] += Math.sin(a) * v;
    }
  }

  frame(f: Features) {
    this.focus.update(f.dt);
    const gl = this.gl;
    const dt = Math.min(f.dt, 0.04);
    const [bass, melody, vocal, drums] = this.sands;

    if (f.bass > 0.2 && Math.random() < dt * 0.22) {
      this.bassIndex = (this.bassIndex + 1) % BASS_MODES.length;
      this.setMode(bass, BASS_MODES[this.bassIndex]);
    }
    if (f.melodyNote > 0) this.setMode(melody, MELODY_MODES[f.melodyPitchClass]);
    if (f.vocal > 0.1) {
      const note = Math.round(f.vocalPitch * 60);
      if (note !== this.lastVocalNote) {
        this.lastVocalNote = note;
        this.setMode(vocal, VOCAL_MODES[((note % 8) + 8) % 8]);
      }
    }
    if (f.kick > 0) {
      this.kickSand(drums, 1.4 * f.kick);
      this.kickSand(bass, 0.13 * f.kick);
      this.setMode(drums, DRUM_MODES[Math.floor(Math.random() * DRUM_MODES.length)]);
    }
    if (f.snare > 0) this.kickSand(drums, 0.8 * f.snare);

    this.shake(bass, f.bass, f, dt, 1);
    this.shake(melody, f.melody, f, dt, 1);
    this.shake(vocal, f.vocal, f, dt, 1);
    this.shake(drums, Math.max(f.drums, 0.12), f, dt, 0.9);

    const bg = moodBackground(f.valence, f.arousal);
    const lift = 1 + f.pulse * 0.1;
    gl.clearColor((bg[0] / 255) * lift, (bg[1] / 255) * lift, (bg[2] / 255) * lift, 1);
    gl.clear(gl.COLOR_BUFFER_BIT);
    gl.enable(gl.BLEND);
    gl.blendFunc(gl.ONE, gl.ONE_MINUS_SRC_ALPHA);
    gl.useProgram(this.program.handle);
    gl.uniform1f(this.program.u.uAspect, this.aspect);

    GROUPS.forEach((g, i) => {
      const level = f[g.key];
      const c = this.focus.color(g.key, moodVivid(ELEMENT_RGB[g.key], f.valence, f.arousal));
      const dim = 0.34 + 0.66 * Math.min(1, level * 1.5);
      gl.uniform3f(this.program.u.uColor, (c[0] / 255) * dim, (c[1] / 255) * dim, (c[2] / 255) * dim);
      gl.uniform1f(this.program.u.uSize, g.size * this.pixel * (0.85 + 0.55 * level));
      gl.uniform1i(this.program.u.uShape, g.shape);
      gl.bindVertexArray(this.vaos[i]);
      gl.bindBuffer(gl.ARRAY_BUFFER, this.buffers[i]);
      // Replacing the whole store avoids waiting on a buffer the GPU is still drawing from.
      gl.bufferData(gl.ARRAY_BUFFER, this.sands[i].buffer, gl.STREAM_DRAW);
      gl.drawArrays(gl.POINTS, 0, g.count);
    });
    gl.bindVertexArray(null);
  }

  dispose() {
    releaseGL(this.gl);
  }
}
