import type { Features } from '../audio/features';
import { approach } from './types';

/** Fast shape attack and short release. This envelope must never drive light. */
export class RhythmMotion {
  level = 0;
  rate = 2;

  update(f: Features, dt: number) {
    const locked = f.beatConfidence >= 0.55 && f.bpm > 0 && f.active;
    this.rate = approach(this.rate, locked ? f.bpm / 60 : 2, dt, 0.3);
    const predicted = locked ? Math.exp(-f.beatPhase * 12) * 0.45 : 0;
    this.level = f.active ? Math.max(this.level * Math.exp(-dt / 0.12), f.attack, predicted) : this.level * Math.exp(-dt / 0.12);
  }
}
