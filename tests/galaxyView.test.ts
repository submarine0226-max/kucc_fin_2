import { describe, expect, it } from 'vitest';
import { galaxyViewMatrix } from '../src/visuals/galaxyView';

const dot = (a: number[], b: number[]) => a.reduce((sum, v, i) => sum + v * b[i], 0);
const cross = (a: number[], b: number[]) => [a[1] * b[2] - a[2] * b[1], a[2] * b[0] - a[0] * b[2], a[0] * b[1] - a[1] * b[0]];

describe('galaxy 3D view', () => {
  it('gives the default tilted disc real depth instead of flattening its Y coordinate', () => {
    const matrix = galaxyViewMatrix({ x: 0, y: 0, zoom: 1 });
    const yAxis = Array.from(matrix.slice(3, 6));
    expect(yAxis[1]).toBeCloseTo(0.46, 6);
    expect(yAxis[2]).toBeGreaterThan(0.8);
    expect(dot(yAxis, yAxis)).toBeCloseTo(1, 6);
  });

  it.each([-1, -0.5, 0, 0.5, 1])('preserves lengths and handedness throughout yaw %s', (x) => {
    for (const y of [-1, -0.5, 0, 0.5, 1]) {
      const matrix = galaxyViewMatrix({ x, y, zoom: 1 });
      const axes = [Array.from(matrix.slice(0, 3)), Array.from(matrix.slice(3, 6)), Array.from(matrix.slice(6, 9))];
      for (const axis of axes) expect(dot(axis, axis)).toBeCloseTo(1, 6);
      expect(dot(axes[0], axes[1])).toBeCloseTo(0, 6);
      expect(dot(axes[1], axes[2])).toBeCloseTo(0, 6);
      expect(dot(cross(axes[0], axes[1]), axes[2])).toBeCloseTo(1, 6);
    }
  });

  it('can view the disc from the top and edge without a singular transform', () => {
    const initialPitch = Math.acos(0.46);
    const top = galaxyViewMatrix({ x: 0, y: -initialPitch / Math.PI, zoom: 1 });
    const edge = galaxyViewMatrix({ x: 0, y: (Math.PI / 2 - initialPitch) / Math.PI, zoom: 1 });
    expect(top[4]).toBeCloseTo(1, 6);
    expect(top[5]).toBeCloseTo(0, 6);
    expect(edge[4]).toBeCloseTo(0, 6);
    expect(edge[5]).toBeCloseTo(1, 6);
    expect(Array.from(edge).every(Number.isFinite)).toBe(true);
  });

  it('keeps zoom separate from rotation so gas rays can use its transpose as the inverse', () => {
    expect(galaxyViewMatrix({ x: 0.4, y: -0.3, zoom: 1 }))
      .toEqual(galaxyViewMatrix({ x: 0.4, y: -0.3, zoom: 2.5 }));
  });
});
