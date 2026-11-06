import { describe, expect, it } from 'vitest';
import { CUSTOM_ID, DEFAULT_CUSTOM, PALETTES, customFilter, nextPalette, paletteById, parseCustom } from '../src/visuals/palette';

describe('palettes', () => {
  it('starts from the original colours, with no filter', () => {
    expect(PALETTES[0].filter).toBe('none');
  });

  it('falls back to the original for a missing or stale saved value', () => {
    expect(paletteById(null).id).toBe('original');
    expect(paletteById('removed-palette').id).toBe('original');
  });

  it('cycles through every palette and wraps around', () => {
    const seen = new Set<string>();
    let id = PALETTES[0].id;
    for (let i = 0; i < PALETTES.length; i++) {
      seen.add(id);
      id = nextPalette(id).id;
    }
    expect(seen.size).toBe(PALETTES.length);
    expect(id).toBe(PALETTES[0].id);
  });

  it('never changes brightness or contrast, so the flash limit still holds', () => {
    for (const p of PALETTES) expect(p.filter).not.toMatch(/brightness|contrast/);
  });
});

describe('custom palette', () => {
  it('leaves the picture untouched at the default values', () => {
    expect(customFilter(DEFAULT_CUSTOM)).toBe('none');
  });

  it('builds a filter from the chosen values, in a fixed order', () => {
    expect(customFilter({ hue: 40, saturation: 150, warmth: 30 })).toBe('sepia(0.3) hue-rotate(40deg) saturate(1.5)');
  });

  it('uses the chosen values only when the custom palette is selected', () => {
    const colors = { hue: 40, saturation: 100, warmth: 0 };
    expect(paletteById(CUSTOM_ID, colors).filter).toBe('hue-rotate(40deg)');
    expect(paletteById('original', colors).filter).toBe('none');
  });

  it('keeps the chosen values when cycling back onto the custom palette', () => {
    const colors = { hue: 40, saturation: 100, warmth: 0 };
    const beforeCustom = PALETTES[PALETTES.length - 2].id;
    expect(nextPalette(beforeCustom, colors).filter).toBe('hue-rotate(40deg)');
  });

  it('clamps out-of-range saved values', () => {
    expect(parseCustom('{"hue":999,"saturation":-5,"warmth":500}')).toEqual({ hue: 180, saturation: 0, warmth: 100 });
  });

  it.each([null, '', 'not json', '[]', '{"hue":"red"}'])('falls back to defaults for %s', (saved) => {
    expect(parseCustom(saved)).toEqual(DEFAULT_CUSTOM);
  });

  it('never adds brightness or contrast', () => {
    expect(customFilter({ hue: 180, saturation: 200, warmth: 100 })).not.toMatch(/brightness|contrast/);
  });
});
