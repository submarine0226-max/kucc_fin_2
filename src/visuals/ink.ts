import type { ElementKey, Features } from '../audio/features';
import { ElementFocus } from './interaction';
import { mix, moodBlend, rgb, type RGB, type Visual, type VisualInfo } from './types';

/** 수묵화: the sound soaks into paper and stays for a while before it fades. */
export const inkInfo: VisualInfo = {
  id: 'ink',
  name: '수묵화',
  needsWebGL: false,
  legend: {
    drums: { color: '#e42939', text: '튀어 번지는 붉은 먹물' },
    bass: { color: '#4593fc', text: '번지는 굵은 붓질' },
    vocal: { color: '#ffa927', text: '굵기가 변하는 황토색 곡선' },
    melody: { color: '#30b6b6', text: '음마다 뻗는 가는 난초 잎' },
  },
};

const VERMILION: RGB = [214, 44, 44];
const SUMI: RGB = [20, 26, 44];
const OCHRE: RGB = [200, 120, 18];
const LEAF: RGB = [10, 110, 110];

interface Blot {
  key: ElementKey;
  x: number;
  y: number;
  r: number;
  age: number;
  life: number;
  spin: number;
  sprite: HTMLCanvasElement;
}

interface Stroke {
  x: number;
  y: number;
  angle: number;
  curl: number;
  left: number;
  total: number;
  width: number;
}

/** Value noise on a small grid, used to give a blot its feathered, fibrous edge. */
function makeNoise(size: number) {
  const grid = new Float32Array(size * size);
  for (let i = 0; i < grid.length; i++) grid[i] = Math.random();
  return (x: number, y: number) => {
    const xi = Math.floor(x);
    const yi = Math.floor(y);
    const fx = x - xi;
    const fy = y - yi;
    const sx = fx * fx * (3 - 2 * fx);
    const sy = fy * fy * (3 - 2 * fy);
    const at = (a: number, b: number) => grid[(a & (size - 1)) + (b & (size - 1)) * size];
    return (at(xi, yi) * (1 - sx) + at(xi + 1, yi) * sx) * (1 - sy) + (at(xi, yi + 1) * (1 - sx) + at(xi + 1, yi + 1) * sx) * sy;
  };
}

const spriteCache = new Map<string, HTMLCanvasElement[]>();

function inkSprite(color: RGB): HTMLCanvasElement {
  const key = color.map(Math.round).join();
  let set = spriteCache.get(key);
  if (!set) {
    set = Array.from({ length: 5 }, () => buildSprite(color));
    spriteCache.set(key, set);
  }
  return set[Math.floor(Math.random() * set.length)];
}

function buildSprite(color: RGB): HTMLCanvasElement {
  const size = 256;
  const canvas = document.createElement('canvas');
  canvas.width = canvas.height = size;
  const c = canvas.getContext('2d')!;
  const img = c.createImageData(size, size);
  const noise = makeNoise(64);
  const ox = Math.random() * 64;
  const oy = Math.random() * 64;
  for (let y = 0; y < size; y++) {
    for (let x = 0; x < size; x++) {
      const dx = x / size - 0.5;
      const dy = y / size - 0.5;
      const dist = Math.sqrt(dx * dx + dy * dy) * 2;
      const a = (x / size) * 5 + ox;
      const b = (y / size) * 5 + oy;
      const n = noise(a, b) * 0.6 + noise(a * 2.3, b * 2.3) * 0.28 + noise(a * 6.1, b * 6.1) * 0.12;
      const edge = 0.42 + n * 0.62;
      const body = Math.max(0, Math.min(1, (edge - dist) / 0.14));
      // Pigment pools at the edge of a drying blot and thins out in the middle.
      const rim = Math.exp(-((dist - edge + 0.05) ** 2) / 0.003);
      const alpha = body * (0.5 + 0.3 * noise(a * 3, b * 3)) + rim * body * 0.5;
      const i = (x + y * size) * 4;
      img.data[i] = color[0];
      img.data[i + 1] = color[1];
      img.data[i + 2] = color[2];
      img.data[i + 3] = Math.min(255, alpha * 255);
    }
  }
  c.putImageData(img, 0, 0);
  return canvas;
}

export interface InkOptions {
  /** Plain white paper with no grain, for sitting directly on the landing page. */
  plainPaper?: boolean;
}

export class InkVisual implements Visual {
  readonly focus = new ElementFocus();
  readonly canvas = document.createElement('canvas');
  private readonly ctx = this.canvas.getContext('2d', { alpha: false })!;
  private readonly layers = Object.fromEntries((['drums', 'bass', 'vocal', 'melody'] as const).map((key) => {
    const canvas = document.createElement('canvas');
    return [key, { canvas, context: canvas.getContext('2d')! }];
  })) as Record<ElementKey, { canvas: HTMLCanvasElement; context: CanvasRenderingContext2D }>;
  private lx = this.layers.drums.context;
  private readonly grain = document.createElement('canvas');
  private w = 1;
  private h = 1;
  private scale = 1;
  private t = 0;
  private paper: RGB = [244, 239, 226];
  private readonly blots: Blot[] = [];
  private readonly strokes: Stroke[] = [];
  private readonly drips: { x: number; y: number; left: number; w: number }[] = [];
  private brush = { x: 0, y: 0, load: 1, angle: 0 };
  private readonly bristles = Array.from({ length: 30 }, () => ({
    offset: Math.random() * 2 - 1,
    ink: 0.4 + Math.random() * 0.6,
  }));
  private voice = { x: 0, y: 0, drawing: false, width: 0, baseY: 0.5, pitch: 0.5 };
  private blotIndex = 0;

  constructor(private readonly options: InkOptions = {}) {}

  resize(width: number, height: number) {
    this.scale = Math.min(window.devicePixelRatio || 1, 1.5);
    this.w = Math.max(1, Math.round(width * this.scale));
    this.h = Math.max(1, Math.round(height * this.scale));
    this.canvas.width = this.w;
    this.canvas.height = this.h;
    for (const layer of Object.values(this.layers)) {
      layer.canvas.width = this.w;
      layer.canvas.height = this.h;
    }
    this.paper = this.paperColor(0.6, 0.4);
    this.brush = { x: this.w * 0.2, y: this.h * 0.6, load: 1, angle: 0 };
    this.makeGrain();
  }

  private paperColor(v: number, a: number): RGB {
    if (this.options.plainPaper) return [255, 255, 255];
    return moodBlend([196, 203, 212], [226, 232, 214], [214, 190, 176], [250, 236, 200], v, a);
  }

  private makeGrain() {
    const g = this.grain;
    g.width = g.height = 256;
    const c = g.getContext('2d')!;
    const img = c.createImageData(256, 256);
    for (let i = 0; i < img.data.length; i += 4) {
      const n = 200 + Math.random() * 55;
      img.data[i] = img.data[i + 1] = img.data[i + 2] = n;
      img.data[i + 3] = 26;
    }
    c.putImageData(img, 0, 0);
    c.strokeStyle = 'rgba(120,110,90,0.05)';
    for (let i = 0; i < 90; i++) {
      const x = Math.random() * 256;
      const y = Math.random() * 256;
      c.beginPath();
      c.moveTo(x, y);
      c.lineTo(x + (Math.random() - 0.5) * 50, y + (Math.random() - 0.5) * 14);
      c.stroke();
    }
  }

  private spawnBlot(x: number, y: number, r: number, color: RGB, life: number, key: ElementKey) {
    const b: Blot = { key, x, y, r, age: 0, life, spin: Math.random() * Math.PI * 2, sprite: inkSprite(color) };
    if (this.blots.length < 28) this.blots.push(b);
    else this.blots[this.blotIndex++ % 28] = b;
  }

  /** Ink bleeding outward: a soft irregular sprite, re-stamped larger as it soaks in. */
  private drawBlots(dt: number) {
    for (const b of this.blots) {
      if (b.age >= b.life) continue;
      const c = this.layers[b.key].context;
      c.globalCompositeOperation = 'multiply';
      b.age += dt;
      const p = b.age / b.life;
      const r = b.r * (0.4 + 0.6 * Math.sqrt(p));
      c.globalAlpha = 0.16 * (1 - p) * (dt * 60);
      c.save();
      c.translate(b.x, b.y);
      c.rotate(b.spin);
      c.drawImage(b.sprite, -r, -r, r * 2, r * 2);
      c.restore();
      c.globalAlpha = 1;
      c.globalCompositeOperation = 'source-over';
    }
  }

  private splash(f: Features, strength: number, big: boolean) {
    const c = this.lx;
    const u = this.scale;
    const angle = this.t * 2.399 * 3;
    const x = this.w * (0.5 + 0.38 * Math.cos(angle));
    const y = this.h * (0.5 + 0.34 * Math.sin(angle * 1.3));
    const excite = 0.6 + f.arousal;
    if (big) this.spawnBlot(x, y, (50 + 120 * strength) * u * excite, VERMILION, 1.1, 'drums');
    const drops = Math.floor((big ? 34 : 18) * excite);
    c.globalCompositeOperation = 'multiply';
    for (let i = 0; i < drops; i++) {
      const a = Math.random() * Math.PI * 2;
      const d = Math.pow(Math.random(), 1.8) * (big ? 300 : 150) * u * strength;
      const r = Math.pow(Math.random(), 3) * (big ? 9 : 5) * u + 0.6 * u;
      c.fillStyle = rgb(VERMILION, 0.45 + Math.random() * 0.45);
      c.beginPath();
      c.ellipse(x + Math.cos(a) * d, y + Math.sin(a) * d, r * (1 + d / (300 * u)), r, a, 0, Math.PI * 2);
      c.fill();
    }
    c.globalCompositeOperation = 'source-over';
    if (f.valence < 0.45 && big) {
      this.drips.push({ x, y: y + 20 * u, left: 0.8 + Math.random() * 1.6, w: (1 + Math.random() * 3) * u });
    }
  }

  private drawBass(f: Features, dt: number) {
    const b = this.brush;
    const u = this.scale;
    const speed = (90 + 260 * f.arousal) * u * (0.4 + f.bass);
    const wander = Math.sin(this.t * 0.37) * 1.4 + Math.sin(this.t * 0.11 + 2) * 1.1;
    const toCentre = Math.atan2(this.h * 0.55 - b.y, this.w * 0.5 - b.x);
    const edge = Math.hypot((b.x - this.w / 2) / this.w, (b.y - this.h / 2) / this.h);
    const turn = Math.atan2(Math.sin(toCentre - b.angle), Math.cos(toCentre - b.angle));
    b.angle += wander * dt * 1.2 + turn * Math.min(1, Math.max(0, edge - 0.3) * dt * 30);
    const nx = b.x + Math.cos(b.angle) * speed * dt;
    const ny = b.y + Math.sin(b.angle) * speed * dt;

    if (f.bass > 0.08) {
      const c = this.lx;
      const width = (30 + 220 * f.bass * f.bass) * u;
      const px = -Math.sin(b.angle);
      const py = Math.cos(b.angle);
      c.globalCompositeOperation = 'multiply';
      c.lineCap = 'round';
      for (const br of this.bristles) {
        const o = br.offset * width * 0.5;
        const dry = 0.5 + 0.5 * Math.sin(this.t * 3 + br.offset * 13);
        c.strokeStyle = rgb(SUMI, 0.42 * br.ink * dry * (0.4 + f.bass));
        c.lineWidth = (1 + 3.5 * br.ink * f.bass) * u;
        c.beginPath();
        c.moveTo(b.x + px * o, b.y + py * o);
        c.lineTo(nx + px * o, ny + py * o);
        c.stroke();
      }
      c.globalCompositeOperation = 'source-over';
      if (Math.random() < f.bass * dt * 3) {
        this.spawnBlot(nx, ny, width * 0.75, mix(SUMI, [40, 70, 130], 0.3), 2, 'bass');
      }
    }
    b.x = nx;
    b.y = ny;
  }

  private drawVoice(f: Features, dt: number) {
    const v = this.voice;
    const u = this.scale;
    if (f.vocal < 0.07) {
      v.drawing = false;
      v.width *= 0.9;
      return;
    }
    const nx = v.x + (70 + 120 * f.arousal) * u * dt;
    const wave = Math.sin(this.t * 1.4) * this.h * 0.02;
    v.pitch += (f.vocalPitch - v.pitch) * Math.min(1, dt * 3.5);
    const ny = this.h * (v.baseY + (0.5 - v.pitch) * 1.1) + wave;
    const targetWidth = (1.5 + 15 * f.vocal * f.vocal) * u;
    v.width += (targetWidth - v.width) * 0.2;
    if (v.drawing && nx < this.w) {
      const c = this.lx;
      c.lineCap = 'round';
      c.strokeStyle = rgb(OCHRE);
      c.lineWidth = v.width;
      c.beginPath();
      c.moveTo(v.x, v.y);
      c.quadraticCurveTo((v.x + nx) / 2, v.y, nx, ny);
      c.stroke();
    }
    v.x = nx;
    v.y = ny;
    v.drawing = true;
    if (v.x > this.w) {
      v.x = 0;
      v.drawing = false;
      v.baseY = 0.3 + Math.random() * 0.4;
    }
  }

  private drawMelody(f: Features, dt: number) {
    const u = this.scale;
    if (f.melodyNote > 0) {
      const x = this.w * (0.08 + 0.84 * ((f.melodyPitchClass * 7) % 12) / 12 + (Math.random() - 0.5) * 0.04);
      const y = this.h * (1 - 0.72 * f.melodyPitch);
      const count = 2 + Math.floor(f.melodyNote * 2);
      for (let i = 0; i < count; i++) {
        const droop = f.valence < 0.45 ? 0.9 : -0.25;
        this.strokes.push({
          x,
          y,
          angle: -Math.PI / 2 + (i - count / 2) * 0.55 + (Math.random() - 0.5) * 0.25,
          curl: (Math.random() - 0.5) * 1.5 + droop,
          left: 0,
          total: (0.45 + Math.random() * 0.5) * (0.6 + f.melodyNote),
          width: (0.8 + 2.2 * f.melodyNote) * u,
        });
      }
      if (this.strokes.length > 60) this.strokes.splice(0, this.strokes.length - 60);
    }
    const c = this.lx;
    c.lineCap = 'round';
    for (const s of this.strokes) {
      if (s.left >= s.total) continue;
      s.left += dt;
      const p = s.left / s.total;
      const speed = 300 * u * (1 - p * 0.5);
      s.angle += s.curl * dt * 1.8;
      const nx = s.x + Math.cos(s.angle) * speed * dt;
      const ny = s.y + Math.sin(s.angle) * speed * dt;
      c.strokeStyle = rgb(LEAF);
      c.lineWidth = s.width * Math.sin(Math.PI * Math.min(1, p + 0.08)) + 0.4 * u;
      c.beginPath();
      c.moveTo(s.x, s.y);
      c.lineTo(nx, ny);
      c.stroke();
      s.x = nx;
      s.y = ny;
    }
  }

  private drawDrips(dt: number) {
    const c = this.lx;
    c.globalCompositeOperation = 'multiply';
    for (let i = this.drips.length - 1; i >= 0; i--) {
      const d = this.drips[i];
      const ny = d.y + 90 * this.scale * dt;
      c.strokeStyle = rgb(VERMILION, 0.6);
      c.lineWidth = d.w;
      c.beginPath();
      c.moveTo(d.x, d.y);
      c.lineTo(d.x, ny);
      c.stroke();
      d.y = ny;
      d.left -= dt;
      if (d.left <= 0) this.drips.splice(i, 1);
    }
    c.globalCompositeOperation = 'source-over';
  }

  frame(f: Features) {
    this.focus.update(f.dt);
    const dt = Math.min(f.dt, 0.05);
    this.t += dt;
    this.lx = this.layers.drums.context;
    const c = this.lx;

    this.paper = mix(this.paper, this.paperColor(f.valence, f.arousal), dt * 0.5);
    // The paper slowly reclaims old ink. The rate rises with energy to stop a busy song going black.
    for (const { context } of Object.values(this.layers)) {
      context.globalCompositeOperation = 'destination-out';
      context.fillStyle = `rgba(0,0,0,${(0.012 + 0.03 * f.arousal) * dt * 60})`;
      context.fillRect(0, 0, this.w, this.h);
      context.globalCompositeOperation = 'source-over';
    }

    if (f.kick > 0) this.splash(f, f.kick, true);
    if (f.snare > 0) this.splash(f, f.snare * 0.8, false);
    if (f.hat > 0) {
      c.fillStyle = rgb(SUMI, 0.4);
      for (let i = 0; i < 4; i++) {
        c.fillRect(Math.random() * this.w, Math.random() * this.h, 1.6 * this.scale, 1.6 * this.scale);
      }
    }

    this.drawBlots(dt);
    this.lx = this.layers.bass.context;
    this.drawBass(f, dt);
    this.lx = this.layers.vocal.context;
    this.drawVoice(f, dt);
    this.lx = this.layers.melody.context;
    this.drawMelody(f, dt);
    this.lx = this.layers.drums.context;
    this.drawDrips(dt);

    this.ctx.fillStyle = rgb(this.paper);
    this.ctx.fillRect(0, 0, this.w, this.h);
    // Four persistent layers let focus reveal old strokes as well as newly drawn ones.
    for (const key of ['drums', 'bass', 'vocal', 'melody'] as const) {
      this.ctx.globalAlpha = this.focus.weight(key);
      this.ctx.drawImage(this.layers[key].canvas, 0, 0);
    }
    this.ctx.globalAlpha = 1;
    if (!this.options.plainPaper) {
      const pattern = this.ctx.createPattern(this.grain, 'repeat');
      if (pattern) {
        this.ctx.globalCompositeOperation = 'multiply';
        this.ctx.fillStyle = pattern;
        this.ctx.fillRect(0, 0, this.w, this.h);
        this.ctx.globalCompositeOperation = 'source-over';
      }
    }
  }

  dispose() {
    this.blots.length = 0;
  }
}
