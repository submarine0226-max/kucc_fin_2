/**
 * Turns drum hits into a brightness envelope that cannot strobe.
 *
 * WCAG 2.3.1 allows at most three flashes per second, so that ceiling holds in
 * both modes. Reduced mode also swaps sudden jumps for a slow, faint swell: the
 * beat stays readable through shape and motion rather than through light.
 */
export const MAX_FLASHES_PER_SECOND = 3;
const REDUCED_CEILING = 0.18;
const REDUCED_SLEW_PER_SECOND = 0.5;

export class FlashGuard {
  reduce = false;
  private value = 0;
  private sinceLast = Infinity;

  update(impulse: number, dt: number): number {
    this.sinceLast += dt;
    const fire = impulse > 0 && this.sinceLast >= 1 / MAX_FLASHES_PER_SECOND;
    if (fire) this.sinceLast = 0;

    if (this.reduce) {
      const target = fire ? REDUCED_CEILING * Math.min(1, impulse) : 0;
      const decayed = this.value * Math.exp(-dt * 1.2);
      const goal = Math.max(target, decayed);
      const limit = REDUCED_SLEW_PER_SECOND * dt;
      this.value += Math.max(-limit, Math.min(limit, goal - this.value));
    } else {
      this.value *= Math.exp(-dt * 7);
      if (fire) this.value = Math.max(this.value, Math.min(1, impulse));
    }
    return this.value;
  }
}
