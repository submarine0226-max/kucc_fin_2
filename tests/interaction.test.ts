import { describe, expect, it } from 'vitest';
import { ElementFocus, VisualView } from '../src/visuals/interaction';

describe('shared view controls', () => {
  it('bounds zoom and pan, and restores the initial view', () => {
    const view = new VisualView('orbit');
    view.drag(100000, -100000, 1280, 720);
    expect(view.state.x).toBe(1);
    expect(view.state.y).toBe(-1);
    for (let i = 0; i < 50; i++) view.zoomBy(1);
    expect(view.state.zoom).toBe(2.5);
    view.reset();
    expect(view.state).toEqual({ x: 0, y: 0, zoom: 1 });
  });

  it('keeps flat images inside their frame and clears the offset at fit-to-screen', () => {
    const view = new VisualView('flat');
    view.drag(200, 200, 1000, 600);
    expect(view.state.x).toBe(0);
    view.zoomBy(0.5);
    view.drag(200, 100, 1000, 600);
    expect(view.state.x).toBeGreaterThan(0);
    for (let i = 0; i < 10; i++) view.zoomBy(-1);
    expect(view.state).toEqual({ x: 0, y: 0, zoom: 1 });
  });

  it('allows tunnel sight movement without zooming or changing its bounded range', () => {
    const view = new VisualView('tunnel');
    view.drag(120, -60, 1200, 600);
    expect(view.state).toEqual({ x: 0.2, y: -0.2, zoom: 1 });
  });
});

describe('presentation-only element focus', () => {
  it('smoothly dims other elements, retains the chosen element, and restores all colors', () => {
    const focus = new ElementFocus();
    const drums = { r: 0.8, g: 0.1, b: 0.1 };
    const vocal = { r: 0.9, g: 0.7, b: 0.1 };
    focus.trackColor('drums', drums);
    focus.trackColor('vocal', vocal);
    focus.set('vocal');
    focus.update(1 / 60);
    expect(focus.weight('drums')).toBeGreaterThan(0.9);
    expect(focus.weight('drums')).toBeLessThan(1);
    for (let i = 0; i < 120; i++) focus.update(1 / 60);
    expect(drums.r).toBeLessThan(0.15);
    expect(vocal).toEqual({ r: 0.9, g: 0.7, b: 0.1 });
    focus.set(null);
    for (let i = 0; i < 180; i++) focus.update(1 / 60);
    expect(drums.r).toBeCloseTo(0.8, 4);
  });

  it('applies emphasis to stored element colors without changing their source palette', () => {
    const focus = new ElementFocus();
    const palette: [number, number, number] = [255, 209, 88];
    focus.set('bass');
    focus.update(2);
    expect(focus.color('vocal', palette)[0]).toBeLessThan(30);
    expect(palette).toEqual([255, 209, 88]);
    expect(focus.color('bass', palette)).toEqual(palette);
  });
});
