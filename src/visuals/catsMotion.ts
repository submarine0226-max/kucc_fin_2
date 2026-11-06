import type { ElementKey, Features } from '../audio/features';
import { approach } from './types';

export const CAT_ELEMENTS: ElementKey[] = ['drums', 'bass', 'vocal', 'melody'];

/** Musical levels change each performer independently; a shared beat drives the band gestures. */
export class CatsMotion {
  readonly levels = [0, 0, 0, 0];
  phase = 0;
  time = 0;
  rate = 2;
  dance = 0;
  update(f: Features) {
    const dt = Math.max(0, Math.min(f.dt, 0.05));
    this.time += dt;
    const rate = f.active && f.beatConfidence >= 0.55 && f.bpm > 0 ? f.bpm / 60 : 2;
    this.rate = approach(this.rate, rate, dt, 0.3);
    this.phase = (this.phase + dt * this.rate * Math.PI * 2) % (Math.PI * 2);
    this.dance = approach(this.dance, f.active ? (f.reduceFlash ? 0.35 : 1) : 0, dt, 0.2);
    for (let i = 0; i < CAT_ELEMENTS.length; i++) {
      const value = i === 0 ? Math.max(f.drums, f.kick, f.snare * 0.85, f.hat * 0.4) : f[CAT_ELEMENTS[i]];
      const target = f.active ? Math.max(0, Math.min(1, value)) : 0;
      this.levels[i] = approach(this.levels[i], target, dt, target > this.levels[i] ? 0.035 : 0.18);
    }
  }
  size(index: number) { return 0.86 + this.levels[index] * 0.6; }
}
