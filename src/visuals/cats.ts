import type { Features } from '../audio/features';
import { CAT_ELEMENTS, CatsMotion } from './catsMotion';
import { ElementFocus } from './interaction';
import { catAtPoint, catBandLayout, type CatBounds } from './catsLayout';
import { ELEMENT_RGB, mix, moodBackground, rgb, type RGB, type Visual, type VisualInfo } from './types';

export const catsInfo: VisualInfo = {
  id: 'cats', name: '고양이 밴드', needsWebGL: false,
  interaction: { pointer: '고양이 클릭: ❤️', keyboard: '고양이에게 차례로 하트 보내기' },
  legend: {
    drums: { color: '#f66570', text: '드럼을 치는 회색 고양이 · 클릭하면 ❤️' },
    bass: { color: '#4593fc', text: '베이스를 연주하는 크림 고양이 · 클릭하면 ❤️' },
    vocal: { color: '#ffd158', text: '마이크 앞에서 노래하는 치즈 고양이 · 클릭하면 ❤️' },
    melody: { color: '#58c7c7', text: '피아노를 치는 턱시도 고양이 · 클릭하면 ❤️' },
  },
};

const FUR: RGB[] = [[150, 164, 188], [239, 222, 191], [235, 163, 86], [77, 85, 111]];
const LIGHT: RGB[] = [[208, 218, 233], [255, 246, 226], [255, 225, 173], [236, 238, 242]];
const NAMES = ['드럼', '베이스', '보컬', '피아노 · 멜로디'];
const INK = '#253047';

/** Four animated vector sprites performing together as a little cat band. */
export class CatsVisual implements Visual {
  readonly focus = new ElementFocus();
  readonly canvas = document.createElement('canvas');
  private readonly c = this.canvas.getContext('2d', { alpha: false })!;
  private readonly motion = new CatsMotion();
  private w = 1;
  private h = 1;
  private pixel = 1;
  private background: RGB = [17, 22, 40];
  private disposed = false;
  private bounds: CatBounds[] = [];
  private readonly hearts: { index: number; age: number }[] = [];
  private keyboardCat = 0;

  activate(point?: { x: number; y: number }): boolean {
    const index = point ? catAtPoint(point.x * this.w, point.y * this.h, this.bounds) : this.keyboardCat++ % 4;
    if (index === null) return false;
    if (this.hearts.length >= 12) this.hearts.shift();
    this.hearts.push({ index, age: 0 });
    return true;
  }

  resize(width: number, height: number) {
    this.pixel = Math.min(window.devicePixelRatio || 1, 1.5);
    this.w = Math.max(1, width);
    this.h = Math.max(1, height);
    this.canvas.width = Math.round(this.w * this.pixel);
    this.canvas.height = Math.round(this.h * this.pixel);
  }

  private oval(x: number, y: number, rx: number, ry: number, fill: string) {
    this.c.beginPath();
    this.c.ellipse(x, y, rx, ry, 0, 0, Math.PI * 2);
    this.c.fillStyle = fill;
    this.c.fill();
  }

  private ear(side: number, fur: string) {
    const c = this.c;
    c.beginPath();
    c.moveTo(side * 52, -23);
    c.quadraticCurveTo(side * 63, -85, side * 49, -78);
    c.lineTo(side * 16, -45);
    c.closePath();
    c.fillStyle = fur;
    c.fill();
    c.beginPath();
    c.moveTo(side * 45, -40);
    c.lineTo(side * 49, -65);
    c.lineTo(side * 30, -46);
    c.closePath();
    c.fillStyle = '#de9da7';
    c.fill();
  }

  private line(x1: number, y1: number, x2: number, y2: number, color: string, width: number) {
    const c = this.c;
    c.beginPath(); c.moveTo(x1, y1); c.lineTo(x2, y2); c.strokeStyle = color; c.lineWidth = width; c.stroke();
  }

  private panel(x: number, y: number, w: number, h: number, fill: string, radius = 5) {
    this.c.fillStyle = fill; this.c.beginPath(); this.c.roundRect(x, y, w, h, radius); this.c.fill();
  }

  private paw(index: number, x: number, y: number) {
    this.oval(x, y, 10, 9, rgb(FUR[index]));
    this.line(x - 3, y + 2, x - 3, y + 6, INK, 1);
    this.line(x + 3, y + 2, x + 3, y + 6, INK, 1);
  }

  private drums(pulse: number) {
    const c = this.c, beat = this.motion.phase, dance = this.motion.dance;
    // Cymbal stands, toms and kick form a complete drum kit, not a single prop.
    for (const side of [-1, 1]) {
      this.line(side * 77, -112, side * 77, 8, '#8c9aaf', 3);
      this.line(side * 77, 2, side * 94, 14, '#8c9aaf', 3);
      this.line(side * 77, 2, side * 60, 14, '#8c9aaf', 3);
      c.save(); c.translate(side * 77, -111); c.rotate(Math.sin(beat * 2 + side) * dance * 0.045);
      this.oval(0, 0, 26, 6, '#f7c66c'); this.oval(0, -2, 6, 4, '#ffe3a1'); c.restore();
      this.panel(side * 38 - 22, -69, 44, 24, '#c34659');
      this.oval(side * 38, -69, 23, 8, '#f4e8df');
      this.oval(side * 38, -47, 23, 6, '#8e364b');
      this.line(side * 53, -65, side * 53, -48, '#d4d9e3', 2);
    }
    this.oval(0, -28, 46, 46, '#a52e49');
    this.oval(0, -28, 40, 40, '#e8e0d9');
    this.oval(0, -28, 34, 34, '#243047');
    c.shadowColor = '#f66570'; c.shadowBlur = 2 + pulse * 4;
    this.line(-28, -1, -39, 18, '#a7b1c3', 4); this.line(28, -1, 39, 18, '#a7b1c3', 4);
    c.fillStyle = '#f66570'; c.beginPath(); c.moveTo(0, -43); c.lineTo(13, -28); c.lineTo(0, -13); c.lineTo(-13, -28); c.closePath(); c.fill();
    c.shadowBlur = 0;
    for (const side of [-1, 1]) {
      const hit = (0.5 + 0.5 * Math.sin(beat * 2 + (side > 0 ? Math.PI : 0))) * dance;
      const px = side * 34, py = -89 + hit * 17;
      this.line(side * 25, -78, px, py, rgb(FUR[0]), 14);
      this.paw(0, px, py);
      this.line(px, py - 3, side * 55, py - 31 + hit * 25, '#f3d29f', 3);
    }
  }

  private bass() {
    const c = this.c, phase = this.motion.phase, dance = this.motion.dance;
    this.line(-26, -78, 14, -8, '#35425b', 8);
    c.save(); c.translate(-8, -28); c.rotate(0.50);
    this.panel(-6, -108, 12, 98, '#bc9872', 2);
    this.panel(-9, -126, 18, 25, '#d6b48a', 4);
    for (const side of [-1, 1]) for (let j = 0; j < 2; j++) this.oval(side * 12, -120 + j * 11, 4, 3, '#dbe4ee');
    c.beginPath(); c.moveTo(-9, -24); c.bezierCurveTo(-36, -42, -43, -3, -26, 10);
    c.bezierCurveTo(-38, 40, 28, 42, 30, 12); c.bezierCurveTo(42, -8, 28, -40, 9, -24); c.closePath();
    c.fillStyle = '#3478cf'; c.fill(); c.strokeStyle = '#91b9f0'; c.lineWidth = 2; c.stroke();
    this.panel(-12, -16, 24, 35, '#e7e6dc', 7);
    this.panel(-11, 13, 22, 5, '#27334b', 1); this.panel(-10, -9, 20, 4, '#27334b', 1);
    for (const x of [-3, -1, 1, 3]) this.line(x, -119, x, 24, '#d6e1eb', 0.8);
    for (let y = -98; y < -25; y += 10) this.line(-6, y, 6, y, '#777d8d', 1);
    this.oval(18, 15, 3, 3, '#e7d4aa'); this.oval(18, 25, 3, 3, '#e7d4aa'); c.restore();
    this.line(-27, -68, -9 + Math.sin(phase * 2) * dance * 5, -28, rgb(FUR[1]), 15);
    this.paw(1, -9 + Math.sin(phase * 2) * dance * 5, -28);
    this.line(28, -70, 29, -96 + Math.sin(phase) * dance * 5, rgb(FUR[1]), 14);
    this.paw(1, 29, -96 + Math.sin(phase) * dance * 5);
  }

  private microphone() {
    const c = this.c, swing = Math.sin(this.motion.phase) * this.motion.dance;
    this.oval(54, 15, 28, 6, '#111b2d');
    this.line(54, 12, 54, -91, '#9dabc1', 4);
    this.line(54, -91, 9, -88, '#9dabc1', 4);
    this.line(0, -87, 22, -89, '#2d374e', 10);
    this.oval(-2, -87, 10, 8, '#cfdae6');
    for (const y of [-91, -87, -83]) this.line(-9, y, 3, y, '#8192aa', 1);
    c.strokeStyle = '#18243b'; c.lineWidth = 2; c.beginPath(); c.moveTo(22, -89); c.bezierCurveTo(102, -75, 42, 8, 102, 15); c.stroke();
    this.line(28, -68, 48, -62, rgb(FUR[2]), 15); this.paw(2, 48, -62);
    this.line(-28, -64, -43 + swing * 5, -77 - swing * 9, rgb(FUR[2]), 14);
    this.paw(2, -43 + swing * 5, -77 - swing * 9);
  }

  private piano() {
    const c = this.c, phase = this.motion.phase, dance = this.motion.dance;
    this.line(-59, -23, 45, 17, '#8b9aaf', 5); this.line(59, -23, -45, 17, '#8b9aaf', 5);
    this.panel(-91, -60, 182, 43, '#202d43', 7);
    this.panel(-86, -56, 172, 27, '#e3e7ec', 2);
    for (let k = 0; k < 14; k++) {
      const x = -84 + k * 12;
      this.line(x, -55, x, -30, '#8993a4', 1);
      if (k % 7 !== 2 && k % 7 !== 6 && k !== 13) this.panel(x + 8, -56, 7, 17, '#172238', 1);
    }
    this.panel(-82, -24, 164, 3, '#58c7c7', 1);
    this.panel(54, -56, 23, 9, '#326566', 2);
    for (const side of [-1, 1]) {
      const shift = Math.sin(phase * 2 + side) * dance;
      const x = side * 28 + shift * 10, y = -59 - (0.5 + 0.5 * Math.sin(phase * 2 + side)) * dance * 7;
      this.line(side * 28, -76, x, y, rgb(FUR[3]), 14); this.paw(3, x, y);
    }
    c.fillStyle = '#b9e9e3'; c.font = '600 7px system-ui'; c.textAlign = 'left'; c.fillText('PIANO', -76, -20);
  }

  private cat(index: number, pulse: number) {
    const c = this.c;
    const key = CAT_ELEMENTS[index];
    const fur = rgb(FUR[index]);
    const light = rgb(LIGHT[index]);
    const accent = rgb(ELEMENT_RGB[key]);
    const beat = this.motion.phase + index * 0.36;
    const dance = this.motion.dance;
    const swing = Math.sin(beat) * dance;
    c.lineCap = 'round';
    c.lineJoin = 'round';

    // Curled tail and a tiny swaying body under the oversized head.
    c.save();
    c.translate(swing * 4, 0);
    c.strokeStyle = fur;
    c.lineWidth = 18;
    c.beginPath();
    c.moveTo(23, -24);
    c.bezierCurveTo(82, -6, 91, -48 - swing * 7, 65, -48 - swing * 7);
    c.stroke();
    this.oval(0, -43, 35, 48, fur);
    this.oval(0, -35, 23, 32, light);
    this.oval(-23, -2, 20, 10, fur);
    this.oval(23, -2, 20, 10, fur);
    c.strokeStyle = rgb(mix(FUR[index], [38, 44, 64], 0.25));
    c.lineWidth = 1.4;
    for (const x of [-29, -22, 17, 24]) {
      c.beginPath(); c.moveTo(x, -3); c.lineTo(x, 2); c.stroke();
    }
    // A matching shape badge makes the roles readable without color alone.
    c.save();
    c.translate(0, -35);
    c.fillStyle = accent;
    c.strokeStyle = accent;
    c.lineWidth = 3;
    c.beginPath();
    if (index === 0) {
      c.moveTo(0, -8); c.lineTo(7, 0); c.lineTo(0, 8); c.lineTo(-7, 0); c.closePath(); c.fill();
    } else if (index === 1) {
      c.arc(0, 0, 7, 0, Math.PI * 2); c.fill();
    } else if (index === 2) {
      c.arc(0, 0, 7, 0, Math.PI * 2); c.stroke();
    } else {
      c.moveTo(0, -8); c.lineTo(8, 6); c.lineTo(-8, 6); c.closePath(); c.fill();
    }
    c.restore();
    c.restore();

    c.save();
    c.translate(swing * 2, -105 - Math.abs(Math.sin(beat)) * dance * 7);
    c.rotate(swing * 0.07);
    this.ear(-1, fur);
    this.ear(1, fur);
    c.beginPath();
    c.moveTo(0, -51);
    c.bezierCurveTo(36, -54, 58, -33, 60, -5);
    c.bezierCurveTo(66, 28, 31, 43, 0, 42);
    c.bezierCurveTo(-31, 43, -66, 28, -60, -5);
    c.bezierCurveTo(-58, -33, -36, -54, 0, -51);
    const head = c.createLinearGradient(0, -50, 0, 45);
    head.addColorStop(0, light);
    head.addColorStop(0.4, fur);
    head.addColorStop(1, rgb(mix(FUR[index], [40, 48, 72], 0.14)));
    c.fillStyle = head;
    c.fill();
    if (index === 3) {
      c.fillStyle = light;
      c.beginPath(); c.moveTo(0, -25); c.quadraticCurveTo(-8, 5, -27, 28);
      c.quadraticCurveTo(0, 45, 27, 28); c.quadraticCurveTo(8, 5, 0, -25); c.fill();
    } else {
      c.strokeStyle = rgb(mix(FUR[index], [58, 57, 70], 0.22));
      c.lineWidth = 5;
      for (let stripe = -1; stripe <= 1; stripe++) {
        c.beginPath(); c.moveTo(stripe * 15, -43); c.lineTo(stripe * 12, -30); c.stroke();
      }
    }
    this.oval(-13, 21, 18, 12, light);
    this.oval(13, 21, 18, 12, light);
    this.oval(-39, 17, 8, 4, 'rgba(230,125,144,0.35)');
    this.oval(39, 17, 8, 4, 'rgba(230,125,144,0.35)');
    const happy = this.motion.levels[index] > 0.42;
    const blink = Math.sin(this.motion.time * 0.9 + index * 2.1) > 0.986;
    c.strokeStyle = INK;
    c.lineWidth = 3.3;
    for (const x of [-23, 23]) {
      if (happy || blink) {
        c.beginPath(); c.moveTo(x - 9, 4); c.quadraticCurveTo(x, happy ? -5 : 5, x + 9, 4); c.stroke();
      } else {
        this.oval(x, 3, 4, 6, INK);
        this.oval(x + 1, 1, 1.1, 1.4, '#fff5e5');
      }
    }
    c.fillStyle = '#b97785';
    c.beginPath(); c.moveTo(-4, 13); c.lineTo(4, 13); c.quadraticCurveTo(0, 20, -4, 13); c.fill();
    c.lineWidth = 2;
    if (index === 2 && this.motion.levels[2] > 0.12) {
      this.oval(0, 25, 8, 9, '#6d3548'); this.oval(0, 29, 5, 3, '#e3a1ad');
    } else {
      c.beginPath(); c.moveTo(0, 18); c.lineTo(0, 22);
      c.quadraticCurveTo(-6, 29, -11, 23); c.moveTo(0, 22); c.quadraticCurveTo(6, 29, 11, 23); c.stroke();
    }
    c.lineWidth = 1.4;
    for (const side of [-1, 1]) for (let line = 0; line < 2; line++) {
      c.beginPath(); c.moveTo(side * 29, 19 + line * 7); c.lineTo(side * 49, 16 + line * 12); c.stroke();
    }
    c.restore();
    if (index === 0) this.drums(pulse);
    else if (index === 1) this.bass();
    else if (index === 2) this.microphone();
    else this.piano();
  }

  frame(f: Features) {
    if (this.disposed) return;
    this.motion.update(f);
    this.focus.update(f.dt);
    const c = this.c;
    c.setTransform(this.pixel, 0, 0, this.pixel, 0, 0);
    this.background = mix(this.background, moodBackground(f.valence, f.arousal), 1 - Math.exp(-f.dt / 3));
    const backdrop = c.createLinearGradient(0, 0, 0, this.h);
    backdrop.addColorStop(0, rgb(mix(this.background, [26, 29, 49], 0.65)));
    backdrop.addColorStop(1, '#111724');
    c.fillStyle = backdrop;
    c.fillRect(0, 0, this.w, this.h);
    this.bounds = catBandLayout(this.w, this.h, CAT_ELEMENTS.map((_, i) => this.motion.size(i)));
    const floor = this.h * 0.64;
    c.strokeStyle = 'rgba(185,200,230,0.09)';
    c.lineWidth = 1;
    c.beginPath(); c.moveTo(this.w * 0.045, floor + 8); c.lineTo(this.w * 0.76, floor + 8); c.stroke();
    for (let i = 0; i < CAT_ELEMENTS.length; i++) {
      const { x, scale } = this.bounds[i];
      const unit = scale / this.motion.size(i);
      const accent = rgb(ELEMENT_RGB[CAT_ELEMENTS[i]]);
      c.save();
      c.globalAlpha = this.focus.weight(CAT_ELEMENTS[i]);
      this.oval(x, floor + 16, scale * 83, unit * 9, 'rgba(0,0,0,0.3)');
      c.translate(x, floor);
      c.scale(scale, scale);
      this.cat(i, f.pulse);
      c.restore();
      c.save();
      c.globalAlpha = 0.65 + this.focus.weight(CAT_ELEMENTS[i]) * 0.35;
      c.font = `600 ${Math.max(12, 14 * unit)}px Pretendard, system-ui, sans-serif`;
      c.textAlign = 'center';
      c.fillStyle = accent;
      c.fillText(NAMES[i], x, floor + 48 * unit);
      c.restore();
    }
    for (let i = this.hearts.length - 1; i >= 0; i--) {
      const heart = this.hearts[i];
      heart.age += Math.max(0, Math.min(f.dt, 0.1));
      if (heart.age > 1.35) { this.hearts.splice(i, 1); continue; }
      const cat = this.bounds[heart.index];
      c.save();
      c.globalAlpha = Math.min(1, heart.age / 0.10) * Math.min(1, (1.35 - heart.age) / 0.4);
      c.font = `${Math.max(22, cat.scale * 30)}px "Segoe UI Emoji", "Apple Color Emoji", sans-serif`;
      c.textAlign = 'center'; c.textBaseline = 'middle';
      c.fillStyle = '#ff6b8a';
      c.fillText('❤️', cat.x + Math.sin(heart.age * 3) * 7, cat.y - cat.scale * 198 - heart.age * 38);
      c.restore();
    }
  }

  dispose() { this.disposed = true; }
}
