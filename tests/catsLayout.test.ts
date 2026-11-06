import { describe, expect, it } from 'vitest';
import { catAtPoint, catBandLayout } from '../src/visuals/catsLayout';

describe('cat band click regions', () => {
  it('recognizes each cat and its instrument at the same size used to draw it', () => {
    const cats = catBandLayout(1280, 720, [0.86, 1.46, 1.0, 1.3]);
    for (const cat of cats) {
      expect(catAtPoint(cat.x, cat.y - cat.scale * 115, cats)).toBe(cat.index);
      expect(catAtPoint(cat.x + cat.scale * 80, cat.y - cat.scale * 40, cats)).toBe(cat.index);
    }
  });
  it('ignores the sky, legend area and ground away from the band', () => {
    const cats = catBandLayout(1280, 720, [1, 1, 1, 1]);
    expect(catAtPoint(640, 80, cats)).toBeNull();
    expect(catAtPoint(1200, 400, cats)).toBeNull();
    expect(catAtPoint(400, 650, cats)).toBeNull();
  });
  it('finds a zoomed and panned cat after converting client coordinates through canvas bounds', () => {
    const cats = catBandLayout(1280, 720, [1, 1, 1, 1]);
    const cat = cats[2];
    const bounds = { left: -300, top: -120, width: 2560, height: 1440 };
    const client = { x: bounds.left + cat.x * 2, y: bounds.top + (cat.y - cat.scale * 115) * 2 };
    const x = (client.x - bounds.left) / bounds.width * 1280;
    const y = (client.y - bounds.top) / bounds.height * 720;
    expect(catAtPoint(x, y, cats)).toBe(2);
  });
});
