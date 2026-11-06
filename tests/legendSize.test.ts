import { describe, expect, it } from 'vitest';
import { DEFAULT_SCALE, MAX_SCALE, MIN_SCALE, clampLegendScale, dragLegendScale, parseLegendScale } from '../src/legendSize';

describe('clampLegendScale', () => {
  it('keeps the scale between its limits', () => {
    expect(clampLegendScale(0.1)).toBe(MIN_SCALE);
    expect(clampLegendScale(9)).toBe(MAX_SCALE);
  });
  it('respects a smaller limit from a short window, but never goes below the minimum', () => {
    expect(clampLegendScale(1.5, 1.2)).toBe(1.2);
    expect(clampLegendScale(1.5, 0.1)).toBe(MIN_SCALE);
  });
});

describe('parseLegendScale', () => {
  it('restores a saved scale', () => expect(parseLegendScale('0.8')).toBe(0.8));
  it.each([null, '', 'nope', '{"width":300,"height":250}'])('falls back to the default for %s', (saved) => {
    expect(parseLegendScale(saved)).toBe(DEFAULT_SCALE);
  });
});

describe('dragLegendScale', () => {
  it('grows when dragged away from the panel, down and to the left', () => {
    expect(dragLegendScale(1, 200, 200, -50, 50)).toBeCloseTo(1.25);
  });
  it('shrinks when dragged into the panel', () => {
    expect(dragLegendScale(1, 200, 200, 50, -50)).toBeCloseTo(0.75);
  });
  it('builds on the scale it started from', () => {
    expect(dragLegendScale(0.8, 200, 200, -50, 50)).toBeCloseTo(1);
  });
});
