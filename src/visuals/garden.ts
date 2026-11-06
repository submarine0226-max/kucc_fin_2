import { ElementFocus } from './interaction';
import { bloomAfterPluck, pickFlower, type FlowerHit } from './interactionEffects';
import type { Features } from '../audio/features';
import { ELEMENT_RGB, approach, mix, moodBlend, moodVivid, rgb, type RGB, type Visual, type VisualInfo } from './types';

/** 정원: every note plants something, and the mood of the song decides the weather. */
export const gardenInfo: VisualInfo = {
  id: 'garden',
  name: '정원',
  needsWebGL: false,
  interaction: { pointer: '꽃 클릭: 떨어진 뒤 같은 줄기에서 다시 피어나요', keyboard: '앞쪽 꽃 떨어뜨리기' },
  legend: {
    drums: { color: '#f66570', text: '바람에 터지는 붉은 꽃잎' },
    bass: { color: '#4593fc', text: '꿈틀거리는 푸른 언덕' },
    vocal: { color: '#ffd158', text: '음 높이만큼 자라는 해바라기' },
    melody: { color: '#58c7c7', text: '음마다 피어나는 줄기와 꽃' },
  },
};

const MAX_PLANTS = 70;
const STEM_SEGMENTS = 14;

interface Plant {
  x: number;
  height: number;
  lean: number;
  curl: number;
  growth: number;
  age: number;
  life: number;
  size: number;
  petals: number;
  color: RGB;
  layer: number;
  bloom: number;
  bloomDelay: number;
}

interface GardenFlower extends FlowerHit {
  plant?: Plant;
  key: 'vocal' | 'melody';
  color: RGB;
  petals: number;
  alpha: number;
  spin: number;
  droop: number;
}

interface Particle {
  x: number;
  y: number;
  vx: number;
  vy: number;
  life: number;
  age: number;
  size: number;
  spin: number;
  color: RGB;
}

export class GardenVisual implements Visual {
  readonly focus = new ElementFocus();
  readonly canvas = document.createElement('canvas');
  private readonly c = this.canvas.getContext('2d', { alpha: false })!;
  private w = 1;
  private h = 1;
  private u = 1;
  private t = 0;
  private readonly plants: Plant[] = [];
  private readonly particles: Particle[] = [];
  private readonly rain: { x: number; y: number; s: number }[] = [];
  private wind = 0;
  private windTarget = 0;
  private bass = 0;
  private pulse = 0;
  private flowerTarget = 0.4;
  private flowerRise = 0.4;
  private windPhase = 0;
  private bassWave = 0;
  private flowerHeight = 0.4;
  private flowerOpen = 0;
  private sunflowerBloom = 1;
  private sunflowerDelay = 0;
  private sunflowerPlucked = false;
  private readonly flowerHits: GardenFlower[] = [];
  private readonly falling: (GardenFlower & { age: number; vx: number; vy: number })[] = [];

  activate(point?: { x: number; y: number }): boolean {
    const index = point ? pickFlower(point.x * this.w, point.y * this.h, this.flowerHits) : this.flowerHits.length - 1;
    if (index === null || index < 0) return false;
    const hit = this.flowerHits[index];
    if (hit.plant) {
      hit.plant.bloom = 0;
      hit.plant.bloomDelay = 1.4;
      hit.plant.life = Math.max(hit.plant.life, hit.plant.age + 6);
    } else { this.sunflowerBloom = 0; this.sunflowerDelay = 1.4; this.sunflowerPlucked = true; }
    if (this.falling.length >= 16) this.falling.shift();
    this.falling.push({ ...hit, plant: undefined, age: 0, vx: this.wind * 25 * this.u, vy: -15 * this.u });
    this.flowerHits.splice(index, 1);
    return true;
  }

  resize(width: number, height: number) {
    this.u = Math.min(window.devicePixelRatio || 1, 1.5);
    this.w = this.canvas.width = Math.max(1, Math.round(width * this.u));
    this.h = this.canvas.height = Math.max(1, Math.round(height * this.u));
  }

  private ground(x: number, layer: number): number {
    const nx = x / this.w;
    const base = this.h * (0.74 + layer * 0.08);
    const roll =
      Math.sin(nx * (4 + layer * 2) + layer * 2.1) * this.h * 0.035 +
      Math.sin(nx * (11 - layer * 3) + layer) * this.h * 0.012;
    const heave = Math.sin(nx * 9 - this.bassWave * 2.6 + layer) * this.h * 0.055 * this.groundLift;
    return base + roll + heave;
  }
  private groundLift = 0;

  private plantNote(f: Features) {
    const x = this.w * (0.05 + 0.9 * (((f.melodyPitchClass * 7) % 12) / 12) + (Math.random() - 0.5) * 0.06);
    const layer = Math.floor(Math.random() * 3);
    const base = moodVivid(ELEMENT_RGB.melody, f.valence, f.arousal);
    const accent: RGB = f.valence > 0.5 ? [255, 190, 220] : [190, 200, 245];
    const plant: Plant = {
      x,
      height: this.h * (0.14 + 0.55 * f.melodyPitch) * (0.7 + layer * 0.2),
      lean: (Math.random() - 0.5) * 0.5,
      curl: (Math.random() - 0.5) * 0.08,
      growth: 0,
      age: 0,
      life: 16 + Math.random() * 12,
      size: (6 + 22 * f.melodyNote) * this.u * (0.7 + layer * 0.2),
      petals: 5 + (f.melodyPitchClass % 3),
      color: mix(base, accent, Math.random() * 0.35),
      layer,
      bloom: 1,
      bloomDelay: 0,
    };
    if (this.plants.length >= MAX_PLANTS) {
      // Keep the clicked stem alive until its replacement bloom has finished growing.
      const oldest = this.plants.findIndex((p) => p.bloomDelay === 0 && p.bloom >= 1);
      if (oldest < 0) return;
      this.plants.splice(oldest, 1);
    }
    this.plants.push(plant);
  }

  private burst(strength: number, f: Features, count: number) {
    const color = moodVivid(ELEMENT_RGB.drums, f.valence, f.arousal);
    const x = Math.random() * this.w;
    const y = this.ground(x, 1);
    for (let i = 0; i < count && this.particles.length < 500; i++) {
      const a = -Math.PI / 2 + (Math.random() - 0.5) * 1.5;
      const s = (110 + Math.random() * 340) * strength * this.u;
      this.particles.push({
        x: x + (Math.random() - 0.5) * 40 * this.u,
        y,
        vx: Math.cos(a) * s,
        vy: Math.sin(a) * s,
        life: 1.4 + Math.random() * 1.8,
        age: 0,
        size: (2.5 + Math.random() * 6) * this.u,
        spin: Math.random() * 6,
        color,
      });
    }
  }

  private drawSky(f: Features) {
    const c = this.c;
    const v = f.valence;
    const a = f.arousal;
    const top = moodBlend([18, 24, 46], [18, 56, 92], [34, 8, 28], [38, 58, 150], v, a);
    const low = moodBlend([62, 72, 92], [168, 186, 170], [150, 44, 34], [255, 170, 110], v, a);
    const g = c.createLinearGradient(0, 0, 0, this.h * 0.86);
    g.addColorStop(0, rgb(top));
    g.addColorStop(1, rgb(low));
    c.fillStyle = g;
    c.fillRect(0, 0, this.w, this.h);

    const lightX = this.w * 0.78;
    const lightY = this.h * (0.42 - 0.2 * v);
    const glow = c.createRadialGradient(lightX, lightY, 0, lightX, lightY, this.h * 0.45);
    const sun = moodBlend([200, 210, 225], [240, 240, 210], [255, 90, 60], [255, 226, 150], v, a);
    glow.addColorStop(0, rgb(sun, 0.45 + 0.18 * this.pulse));
    glow.addColorStop(1, rgb(sun, 0));
    c.fillStyle = glow;
    c.fillRect(0, 0, this.w, this.h);
    c.fillStyle = rgb(sun, 0.85);
    c.beginPath();
    c.arc(lightX, lightY, this.h * 0.05, 0, Math.PI * 2);
    c.fill();
  }

  private drawHill(layer: number, f: Features) {
    const c = this.c;
    const shallow = moodVivid(ELEMENT_RGB.bass, f.valence, f.arousal);
    const deep: RGB = moodBlend([18, 26, 44], [14, 44, 50], [40, 14, 24], [32, 28, 76], f.valence, f.arousal);
    const col = mix(mix(deep, shallow, 0.12 + 0.75 * this.bass * (1 - layer * 0.28)), deep, layer * 0.25);
    c.fillStyle = rgb(this.focus.color('bass', col));
    c.beginPath();
    c.moveTo(0, this.h);
    const step = Math.max(12, this.w / 90);
    for (let x = 0; x <= this.w + step; x += step) c.lineTo(x, this.ground(x, layer));
    c.lineTo(this.w, this.h);
    c.closePath();
    c.fill();
  }

  private drawPlant(p: Plant, f: Features) {
    const c = this.c;
    const fadeOut = Math.min(1, (p.life - p.age) / 4);
    const wilt = Math.max(0, 0.55 - f.valence) * 1.6 + Math.max(0, 1 - fadeOut) * 1.1;
    const segment = (p.height * p.growth) / STEM_SEGMENTS;
    let x = p.x;
    let y = this.ground(p.x, p.layer) + 4 * this.u;
    let angle = -Math.PI / 2 + p.lean * 0.5;
    c.strokeStyle = rgb(mix(p.color, [20, 60, 60], 0.45), fadeOut);
    c.lineWidth = (1.2 + p.size * 0.1) * (0.5 + 0.5 * p.growth);
    c.lineCap = 'round';
    c.beginPath();
    c.moveTo(x, y);
    const sway = Math.sin(this.t * (1 + f.arousal * 2) + p.x * 0.01) * 0.018 + this.wind * Math.sin(this.windPhase - p.x * 0.004) * 0.05;
    for (let i = 0; i < STEM_SEGMENTS; i++) {
      const tip = i / STEM_SEGMENTS;
      angle += p.curl + sway + wilt * tip * tip * 0.22 * (p.lean >= 0 ? 1 : -1);
      x += Math.cos(angle) * segment;
      y += Math.sin(angle) * segment;
      c.lineTo(x, y);
    }
    c.stroke();

    const open = Math.max(0, (p.growth - 0.65) / 0.35) * p.bloom;
    if (open > 0) {
      this.drawFlower(x, y, p.size * open, p.petals, p.color, fadeOut, angle + Math.PI / 2, 0.5);
      if (open > 0.12 && fadeOut > 0.1) this.flowerHits.push({ x, y, radius: p.size * open, plant: p,
        key: 'melody', color: p.color, petals: p.petals, alpha: fadeOut, spin: angle + Math.PI / 2, droop: 0 });
    }
  }

  private drawFlower(x: number, y: number, r: number, petals: number, color: RGB, alpha: number, spin: number, ratio: number) {
    const c = this.c;
    c.fillStyle = rgb(color, alpha);
    for (let i = 0; i < petals; i++) {
      const a = spin + (i / petals) * Math.PI * 2;
      c.beginPath();
      c.ellipse(x + Math.cos(a) * r * 0.62, y + Math.sin(a) * r * 0.62, r * 0.62, r * 0.62 * ratio, a, 0, Math.PI * 2);
      c.fill();
    }
    c.fillStyle = rgb(mix(color, [255, 255, 255], 0.7), alpha);
    c.beginPath();
    c.arc(x, y, r * 0.24, 0, Math.PI * 2);
    c.fill();
  }

  /** The vocal is one great sunflower. Its head rises and falls with the pitch of the voice. */
  private drawSunflower(f: Features, dt: number) {
    const c = this.c;
    if (f.vocal > 0.06) this.flowerTarget = 0.16 + 0.6 * f.vocalPitch;
    this.flowerRise = approach(this.flowerRise, this.flowerTarget, dt, 0.28);
    this.flowerHeight = approach(this.flowerHeight, this.flowerRise, dt, 0.28);
    this.flowerOpen = approach(this.flowerOpen, f.vocal, dt, f.vocal > this.flowerOpen ? 0.3 : 0.7);
    if (this.flowerOpen < 0.01 && !this.sunflowerPlucked) return;

    const x0 = this.w * 0.42;
    const y0 = this.ground(x0, 1);
    const top = y0 - this.h * this.flowerHeight * 1.05;
    const bend = Math.sin(this.t * 0.7) * this.w * 0.03 + this.wind * this.w * 0.012;
    const x1 = x0 + bend;
    const color = moodVivid(ELEMENT_RGB.vocal, f.valence, f.arousal);
    c.strokeStyle = rgb(mix(color, [40, 90, 50], 0.72));
    c.lineWidth = (3 + 8 * this.flowerOpen) * this.u;
    c.lineCap = 'round';
    c.beginPath();
    c.moveTo(x0, y0);
    c.quadraticCurveTo(x0 - bend * 0.3, (y0 + top) / 2, x1, top);
    c.stroke();

    const R = (18 + this.h * 0.13 * this.flowerOpen) * Math.max(0.6, f.valence * 0.5 + 0.75) * this.sunflowerBloom;
    const droop = (0.5 - f.valence) * 0.6;
    if (R > 0.1) this.drawSunflowerHead(x1, top, R, color, droop, this.t * 0.06);
    if (this.sunflowerBloom > 0.12) this.flowerHits.push({ x: x1, y: top, radius: R, key: 'vocal', color,
      petals: 18, alpha: 1, spin: this.t * 0.06, droop });
  }

  private drawSunflowerHead(x1: number, top: number, R: number, color: RGB, droop: number, spin: number) {
    const c = this.c;
    for (let ring = 2; ring >= 0; ring--) {
      const n = 14 + ring * 4;
      const r = R * (1 - ring * 0.14);
      c.fillStyle = rgb(mix(color, [255, 130, 40], ring * 0.2));
      for (let i = 0; i < n; i++) {
        const a = (i / n) * Math.PI * 2 + ring * 0.2 + spin;
        const lift = 1 + droop * Math.sin(a);
        c.beginPath();
        c.ellipse(x1 + Math.cos(a) * r * 0.66, top + Math.sin(a) * r * 0.66 * lift, r * 0.42, r * 0.11, a, 0, Math.PI * 2);
        c.fill();
      }
    }
    c.fillStyle = 'rgb(58,36,20)';
    c.beginPath();
    c.arc(x1, top, R * 0.31, 0, Math.PI * 2);
    c.fill();
    c.fillStyle = 'rgba(180,120,60,0.8)';
    for (let i = 0; i < 40; i++) {
      const a = i * 2.399;
      const d = Math.sqrt(i / 40) * R * 0.29;
      c.fillRect(x1 + Math.cos(a) * d, top + Math.sin(a) * d, 1.6 * this.u, 1.6 * this.u);
    }
  }

  private drawParticles(f: Features, dt: number) {
    const c = this.c;
    for (let i = this.particles.length - 1; i >= 0; i--) {
      const p = this.particles[i];
      p.life -= dt;
      p.age += dt;
      if (p.life <= 0) {
        this.particles.splice(i, 1);
        continue;
      }
      p.vy += 150 * this.u * dt;
      p.vx += this.wind * 90 * this.u * dt;
      p.vx *= 0.985;
      p.vy *= 0.985;
      p.x += p.vx * dt;
      p.y += p.vy * dt;
      p.spin += dt * 4;
      c.save();
      c.translate(p.x, p.y);
      c.rotate(p.spin);
      const grow = Math.min(1, p.age / 0.25);
      c.scale(grow, grow);
      c.fillStyle = rgb(p.color, Math.min(1, p.life * 1.4) * grow);
      c.beginPath();
      c.moveTo(0, -p.size);
      c.lineTo(p.size * 0.65, 0);
      c.lineTo(0, p.size);
      c.lineTo(-p.size * 0.65, 0);
      c.closePath();
      c.fill();
      c.restore();
    }
    void f;
  }

  private drawFallingFlowers(dt: number) {
    const c = this.c;
    for (let i = this.falling.length - 1; i >= 0; i--) {
      const flower = this.falling[i];
      flower.age += dt;
      if (flower.age >= 1.4) { this.falling.splice(i, 1); continue; }
      flower.vy += this.h * 0.32 * dt;
      flower.x += flower.vx * dt;
      flower.y += flower.vy * dt;
      c.save(); c.translate(flower.x, flower.y); c.rotate(flower.age * 0.7);
      c.globalAlpha = this.focus.weight(flower.key) * flower.alpha * Math.min(1, (1.4 - flower.age) / 0.45);
      if (flower.key === 'vocal') this.drawSunflowerHead(0, 0, flower.radius, flower.color, flower.droop, flower.spin);
      else this.drawFlower(0, 0, flower.radius, flower.petals, flower.color, 1, flower.spin, 0.5);
      c.restore();
    }
  }

  private drawRain(f: Features, dt: number) {
    const amount = Math.max(0, 0.5 - f.valence) * 2 * (0.5 + f.energy);
    const wanted = Math.floor(amount * 260);
    while (this.rain.length < wanted) {
      this.rain.push({ x: Math.random() * this.w, y: Math.random() * this.h, s: 0.7 + Math.random() * 0.6 });
    }
    if (this.rain.length > wanted) this.rain.length = wanted;
    if (!wanted) return;
    const c = this.c;
    c.strokeStyle = 'rgba(190,210,235,0.28)';
    c.lineWidth = this.u;
    c.beginPath();
    for (const d of this.rain) {
      d.y += 620 * this.u * d.s * dt;
      d.x += this.wind * 80 * dt;
      if (d.y > this.h) {
        d.y = -10;
        d.x = Math.random() * this.w;
      }
      c.moveTo(d.x, d.y);
      c.lineTo(d.x + this.wind * 2, d.y + 16 * this.u * d.s);
    }
    c.stroke();
  }

  frame(f: Features) {
    this.focus.update(f.dt);
    const dt = Math.min(f.dt, 0.05);
    this.flowerHits.length = 0;
    const sunflower = bloomAfterPluck(this.sunflowerBloom, this.sunflowerDelay, dt);
    this.sunflowerBloom = sunflower.bloom; this.sunflowerDelay = sunflower.delay;
    this.t += dt;
    this.bass = approach(this.bass, f.bass, dt, 0.3);
    this.pulse = approach(this.pulse, f.pulse, dt, 0.15);
    this.groundLift = approach(this.groundLift, f.bass, dt, 0.4);
    this.bassWave += dt * (0.5 + 1.8 * this.bass);
    if (f.kick > 0) {
      // A gust builds and passes. The kick sets where the wind is heading, not where it is.
      this.windTarget = Math.min(1.6, this.windTarget + f.kick * 0.7);
      this.burst(f.kick, f, Math.floor(10 + 26 * f.arousal));
    }
    if (f.snare > 0) this.burst(f.snare * 0.75, f, 8);
    this.windTarget *= Math.exp(-dt * 1.4);
    this.wind = approach(this.wind, this.windTarget, dt, 0.25);
    this.windPhase += dt * 3.2;
    if (f.melodyNote > 0) this.plantNote(f);

    this.drawSky(f);
    this.drawHill(0, f);
    for (let i = this.plants.length - 1; i >= 0; i--) {
      const p = this.plants[i];
      p.age += dt;
      p.growth = Math.min(1, p.growth + dt * (0.8 + f.arousal * 1.6));
      const bloom = bloomAfterPluck(p.bloom, p.bloomDelay, dt);
      p.bloom = bloom.bloom; p.bloomDelay = bloom.delay;
      if (p.age >= p.life) this.plants.splice(i, 1);
    }
    const draw = (key: 'drums' | 'vocal' | 'melody', paint: () => void) => {
      this.c.save();
      this.c.globalAlpha = this.focus.weight(key);
      paint();
      this.c.restore();
    };
    draw('melody', () => { for (const p of this.plants) if (p.layer === 0) this.drawPlant(p, f); });
    this.drawHill(1, f);
    draw('melody', () => { for (const p of this.plants) if (p.layer === 1) this.drawPlant(p, f); });
    draw('vocal', () => this.drawSunflower(f, dt));
    this.drawHill(2, f);
    draw('melody', () => { for (const p of this.plants) if (p.layer === 2) this.drawPlant(p, f); });
    draw('drums', () => this.drawParticles(f, dt));
    this.drawRain(f, dt);
    this.drawFallingFlowers(dt);
  }

  dispose() {
    this.plants.length = 0;
    this.falling.length = this.flowerHits.length = 0;
  }
}
