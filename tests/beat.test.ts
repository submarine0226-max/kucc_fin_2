import { describe, expect, it } from 'vitest';
import { BeatTracker } from '../src/audio/beat';
import { emptyFeatures } from '../src/audio/features';
import { RhythmMotion } from '../src/visuals/rhythm';

function feed(tracker: BeatTracker, bpm: number, seconds: number, skip = false) {
  let time = 0;
  let next = 0;
  let beat = 0;
  const phaseErrors: number[] = [];
  for (let frame = 0; time < seconds; frame++) {
    const dt = [0.012, 0.019, 0.015, 0.017][frame % 4];
    time += dt;
    const onset = time >= next;
    let attack = 0;
    if (onset) {
      attack = skip && beat % 5 === 3 ? 0 : 0.8;
      next += 60 / bpm;
      beat++;
    }
    tracker.update(attack, dt, true);
    if (attack && time > seconds - 3 && tracker.confidence >= 0.55) {
      phaseErrors.push(Math.min(tracker.phase, 1 - tracker.phase));
    }
  }
  return phaseErrors;
}

describe('beat tracking', () => {
  it.each([75, 90, 120, 150, 180])('tracks %i BPM with irregular analysis intervals', (bpm) => {
    const tracker = new BeatTracker();
    const errors = feed(tracker, bpm, 12);
    expect(Math.abs(tracker.bpm - bpm)).toBeLessThan(3);
    expect(tracker.confidence).toBeGreaterThan(0.55);
    expect(errors.length).toBeGreaterThan(0);
    expect(Math.max(...errors)).toBeLessThan(0.12);
  });

  it('keeps tempo through occasional missing hits', () => {
    const tracker = new BeatTracker();
    feed(tracker, 120, 14, true);
    expect(Math.abs(tracker.bpm - 120)).toBeLessThan(3);
    expect(tracker.confidence).toBeGreaterThan(0.55);
  });

  it('adapts to a tempo change', () => {
    const tracker = new BeatTracker();
    feed(tracker, 120, 10);
    feed(tracker, 150, 14);
    expect(Math.abs(tracker.bpm - 150)).toBeLessThan(4);
  });

  it('accepts occasional half-beat syncopations without halving the tempo', () => {
    const tracker = new BeatTracker();
    const period = 60 / 160;
    let next = 0;
    let subdivision = 0;
    for (let t = 0; t < 14; t += 0.016) {
      let attack = 0;
      if (t >= next) {
        attack = subdivision % 2 === 0 ? 0.9 : subdivision % 6 === 3 ? 0.5 : 0;
        subdivision++;
        next += period / 2;
      }
      tracker.update(attack, 0.016, true);
    }
    expect(Math.abs(tracker.bpm - 160)).toBeLessThan(3);
    expect(tracker.confidence).toBeGreaterThan(0.55);
  });

  it('does not invent tempo without repeated events, and forgets after silence', () => {
    const tracker = new BeatTracker();
    tracker.update(1, 0.016, true);
    expect(tracker.bpm).toBe(0);
    feed(tracker, 120, 10);
    for (let i = 0; i < 80; i++) tracker.update(0, 0.016, false);
    expect(tracker.bpm).toBe(0);
    expect(tracker.confidence).toBe(0);
    tracker.reset();
    expect(tracker.phase).toBe(0);
  });

  it('releases confidence when rhythm disappears inside a sustained sound', () => {
    const tracker = new BeatTracker();
    feed(tracker, 120, 10);
    for (let i = 0; i < 400; i++) tracker.update(0, 0.016, true);
    expect(tracker.confidence).toBeLessThan(0.1);
    expect(tracker.bpm).toBe(0);
  });
});

describe('rhythm motion', () => {
  it('responds in the same frame and recovers before the next fast beat', () => {
    const f = emptyFeatures();
    f.active = true;
    f.attack = 0.8;
    const motion = new RhythmMotion();
    motion.update(f, 1 / 60);
    expect(motion.level).toBe(0.8);
    f.attack = 0;
    for (let i = 0; i < 15; i++) motion.update(f, 1 / 60);
    expect(motion.level).toBeLessThan(0.11);
    expect(f.pulse).toBe(0);
  });

  it('uses a confident tempo for motion and stops predicting when inactive', () => {
    const f = emptyFeatures();
    Object.assign(f, { active: true, bpm: 180, beatPhase: 0, beatConfidence: 0.9 });
    const motion = new RhythmMotion();
    for (let i = 0; i < 120; i++) motion.update(f, 1 / 60);
    expect(motion.rate).toBeCloseTo(3, 2);
    expect(motion.level).toBe(0.45);
    f.active = false;
    for (let i = 0; i < 60; i++) motion.update(f, 1 / 60);
    expect(motion.level).toBeLessThan(0.001);
  });
});
