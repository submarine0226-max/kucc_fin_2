import { describe, expect, it } from 'vitest';
import { emptyFeatures, type ElementKey } from '../src/audio/features';
import { CAT_ELEMENTS, CatsMotion } from '../src/visuals/catsMotion';

function setup() {
  const motion = new CatsMotion();
  const f = emptyFeatures();
  f.active = true;
  f.dt = 1 / 60;
  const advance = (frames = 60) => { for (let i = 0; i < frames; i++) motion.update(f); };
  return { motion, f, advance };
}

describe('four cats musical response', () => {
  it.each(CAT_ELEMENTS)('%s changes only its own cat size', (key: ElementKey) => {
    const { motion, f, advance } = setup();
    const initial = CAT_ELEMENTS.map((_, i) => motion.size(i));
    f[key] = 0.9;
    advance(30);
    CAT_ELEMENTS.forEach((element, i) => {
      if (element === key) expect(motion.size(i)).toBeGreaterThan(initial[i] * 1.5);
      else expect(motion.size(i)).toBe(initial[i]);
    });
  });

  it('shows a drum strike promptly and recovers instead of growing indefinitely', () => {
    const { motion, f, advance } = setup();
    f.kick = 1;
    advance(1);
    expect(motion.size(0)).toBeGreaterThan(1.05);
    f.kick = 0;
    advance(90);
    expect(motion.size(0)).toBeCloseTo(0.86, 3);
  });

  it('uses tempo for the shared dance without changing the cats sizes', () => {
    const slow = setup(), fast = setup();
    Object.assign(slow.f, { bpm: 90, beatConfidence: 0.9 });
    Object.assign(fast.f, { bpm: 180, beatConfidence: 0.9 });
    slow.advance(180);
    fast.advance(180);
    expect(fast.motion.rate / slow.motion.rate).toBeCloseTo(2, 3);
    CAT_ELEMENTS.forEach((_, i) => expect(fast.motion.size(i)).toBe(slow.motion.size(i)));
  });

  it('keeps all four characters visible on silence and settles their dance', () => {
    const { motion, f, advance } = setup();
    CAT_ELEMENTS.forEach((key) => { f[key] = 0.9; });
    advance();
    f.active = false;
    advance(180);
    CAT_ELEMENTS.forEach((_, i) => expect(motion.size(i)).toBeCloseTo(0.86, 4));
    expect(motion.dance).toBeLessThan(0.001);
  });

  it('reduces dance amplitude while retaining the same musical size mapping', () => {
    const normal = setup(), reduced = setup();
    normal.f.vocal = reduced.f.vocal = 0.8;
    reduced.f.reduceFlash = true;
    normal.advance(180);
    reduced.advance(180);
    expect(reduced.motion.dance).toBeCloseTo(normal.motion.dance * 0.35, 4);
    expect(reduced.motion.size(2)).toBe(normal.motion.size(2));
  });
});
