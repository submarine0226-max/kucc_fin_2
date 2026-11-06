import { describe, expect, it } from 'vitest';
import { HapticPulse, supportsHaptics } from '../src/audio/haptics';

const vibrate = () => true;
const android = 'Mozilla/5.0 (Linux; Android 14) AppleWebKit/537.36 Chrome/130.0 Mobile Safari/537.36';
const desktop = 'Mozilla/5.0 (Windows NT 10.0) AppleWebKit/537.36 Chrome/130.0 Safari/537.36';
const iphone = 'Mozilla/5.0 (iPhone; CPU iPhone OS 17_0) AppleWebKit/605.1.15 Version/17.0 Safari/604.1';

describe('supportsHaptics', () => {
  it('accepts only Android Chrome with the API present', () => {
    expect(supportsHaptics({ userAgent: android, vibrate })).toBe(true);
    expect(supportsHaptics({ userAgent: android })).toBe(false);
    expect(supportsHaptics({ userAgent: desktop, vibrate })).toBe(false);
    expect(supportsHaptics({ userAgent: iphone })).toBe(false);
  });
});

describe('HapticPulse', () => {
  it('gives a kick a longer pulse than a snare, and nothing otherwise', () => {
    const p = new HapticPulse();
    expect(p.next(0, 0, 0)).toBe(0);
    const kick = p.next(1, 0, 1000);
    const snare = p.next(0, 1, 2000);
    expect(kick).toBeGreaterThan(snare);
    expect(snare).toBeGreaterThan(0);
  });

  it('skips hits that come too soon after the last pulse', () => {
    const p = new HapticPulse();
    expect(p.next(1, 0, 1000)).toBeGreaterThan(0);
    expect(p.next(1, 0, 1050)).toBe(0);
    expect(p.next(1, 0, 1200)).toBeGreaterThan(0);
  });
});
