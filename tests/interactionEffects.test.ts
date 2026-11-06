import { describe, expect, it } from 'vitest';
import { MarblingBrush, bloomAfterPluck, pickFlower, sandClickKick } from '../src/visuals/interactionEffects';

describe('localized sand click', () => {
  it('gives nearby sand an upward impulse and leaves distant grains alone', () => {
    expect(sandClickKick(0.4, 0.3, 0, 0, 1)).toBeNull();
    const force = sandClickKick(0.01, 0, 0, 0, 4)!;
    expect(force.vx).toBeGreaterThan(0);
    expect(force.vy).toBeGreaterThan(0);
    expect(force.life).toBeGreaterThan(0.8);
    const center = sandClickKick(0, 0, 0, 0, 2)!;
    expect(Number.isFinite(center.vx)).toBe(true);
    expect(Number.isFinite(center.vy)).toBe(true);
  });
});

describe('pluck and regrow a flower', () => {
  it('picks the frontmost flower under the pointer and ignores empty ground', () => {
    const flowers = [{ x: 100, y: 100, radius: 20 }, { x: 105, y: 102, radius: 12 }];
    expect(pickFlower(104, 101, flowers)).toBe(1);
    expect(pickFlower(82, 100, flowers)).toBe(0);
    expect(pickFlower(200, 300, flowers)).toBeNull();
  });
  it('waits for the dropped flower to disappear, then grows a new bloom gradually', () => {
    let state = { bloom: 0, delay: 1.4 };
    for (let i = 0; i < 13; i++) state = bloomAfterPluck(state.bloom, state.delay, 0.1);
    expect(state.bloom).toBe(0);
    for (let i = 0; i < 5; i++) state = bloomAfterPluck(state.bloom, state.delay, 0.1);
    expect(state.bloom).toBeGreaterThan(0);
    expect(state.bloom).toBeLessThan(1);
    for (let i = 0; i < 20; i++) state = bloomAfterPluck(state.bloom, state.delay, 0.1);
    expect(state).toEqual({ bloom: 1, delay: 0 });
  });
});

describe('marbling drag path', () => {
  it('interpolates a long stroke and converts downward pointer movement to negative fluid Y', () => {
    const brush = new MarblingBrush();
    brush.stroke({ x: 0.1, y: 0.2 }, { x: 0.6, y: 0.5 }, 16 / 9);
    const path = brush.take(24);
    expect(path.length).toBeGreaterThan(1);
    expect(path.at(-1)).toMatchObject({ x: 0.6, y: 0.5 });
    expect(path.every((p) => p.vx > 0 && p.vy < 0)).toBe(true);
    expect(path.every((p) => Math.hypot(p.vx, p.vy) <= 850)).toBe(true);
  });
  it('bounds pending strokes, clamps captured pointers outside the canvas, and drains work per frame', () => {
    const brush = new MarblingBrush();
    for (let i = 0; i < 100; i++) brush.stroke({ x: -1, y: 0.2 }, { x: 2, y: 0.8 }, 1);
    const first = brush.take();
    const rest = brush.take(100);
    expect(first).toHaveLength(8);
    expect(rest.length).toBeLessThanOrEqual(16);
    expect([...first, ...rest].every((p) => p.x >= 0 && p.x <= 1 && p.y >= 0 && p.y <= 1)).toBe(true);
    expect(brush.take()).toHaveLength(0);
  });
  it('does nothing for a stationary pointer and never adds dye fields', () => {
    const brush = new MarblingBrush();
    brush.stroke({ x: 0.5, y: 0.5 }, { x: 0.5, y: 0.5 }, 2);
    expect(brush.take()).toHaveLength(0);
    brush.stroke({ x: 0.5, y: 0.5 }, { x: 0.55, y: 0.5 }, 2);
    expect(Object.keys(brush.take()[0]).sort()).toEqual(['vx', 'vy', 'x', 'y']);
  });
});
