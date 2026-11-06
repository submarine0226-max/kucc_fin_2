const KICK_MS = 120;
const SNARE_MS = 70;
/** Motors blur together below this gap, and a fast song would otherwise buzz constantly. */
const MIN_GAP_MS = 180;

export function supportsHaptics(nav: Pick<Navigator, 'userAgent'> & { vibrate?: unknown }): boolean {
  return /Android/i.test(nav.userAgent) && /Chrome\//.test(nav.userAgent) && typeof nav.vibrate === 'function';
}

/** Turns drum hits into pulse lengths. The phone can only vary duration, not strength. */
export class HapticPulse {
  private last = -Infinity;

  next(kick: number, snare: number, now: number): number {
    const length = kick > 0 ? KICK_MS : snare > 0 ? SNARE_MS : 0;
    if (!length || now - this.last < MIN_GAP_MS) return 0;
    this.last = now;
    return length;
  }
}
