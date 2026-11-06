import { describe, expect, it } from 'vitest';
import { AURORA_LAKE_TOP, AuroraRipples, MAX_LAKE_RIPPLES } from '../src/visuals/auroraRipples';

describe('aurora lake click ripples', () => {
  it('accepts lake clicks and maps top-origin canvas coordinates into shader UVs', () => {
    const lake = new AuroraRipples();
    expect(lake.add({ x: 0.3, y: 0.9 })).toBe(true);
    expect(lake.rings[0].x).toBe(0.3);
    expect(lake.rings[0].y).toBeCloseTo(0.1);
    expect(lake.rings[0].age).toBe(0);
  });
  it('ignores sky, shoreline, outside-canvas and invalid coordinates', () => {
    const lake = new AuroraRipples();
    for (const point of [{ x: 0.5, y: 0.4 }, { x: 0.5, y: AURORA_LAKE_TOP },
      { x: -0.1, y: 0.9 }, { x: 1.1, y: 0.9 }, { x: 0.5, y: 1.1 }, { x: NaN, y: 0.9 }]) {
      expect(lake.add(point)).toBe(false);
    }
    expect(lake.rings).toHaveLength(0);
  });
  it('bounds rapid repeated clicks and removes the oldest ripple first', () => {
    const lake = new AuroraRipples();
    for (let i = 0; i < 20; i++) lake.add({ x: i / 20, y: 0.9 });
    expect(lake.rings).toHaveLength(MAX_LAKE_RIPPLES);
    expect(lake.rings[0].x).toBe(12 / 20);
    expect(lake.rings.at(-1)!.x).toBe(19 / 20);
  });
  it('ages ripples independently and clears them after their lifetime', () => {
    const lake = new AuroraRipples();
    lake.add({ x: 0.2, y: 0.9 });
    for (let i = 0; i < 20; i++) lake.update(0.1);
    lake.add({ x: 0.8, y: 0.95 });
    for (let i = 0; i < 12; i++) lake.update(0.1);
    expect(lake.rings).toHaveLength(1);
    expect(lake.rings[0].x).toBe(0.8);
  });
});
