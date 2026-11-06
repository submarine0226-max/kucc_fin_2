export interface Palette {
  id: string;
  name: string;
  /** CSS filter applied to the finished picture, so one setting works for every style. */
  filter: string;
}

export const CUSTOM_ID = 'custom';

/**
 * Only colour operations are allowed here. Brightness and contrast would change how strongly
 * the picture flickers, which the flash limit has already settled before this point.
 */
export const PALETTES: Palette[] = [
  { id: 'original', name: '기본', filter: 'none' },
  { id: 'forest', name: '숲', filter: 'hue-rotate(-70deg) saturate(1.1)' },
  { id: 'dream', name: '보랏빛', filter: 'hue-rotate(50deg) saturate(1.15)' },
  { id: 'neon', name: '네온', filter: 'hue-rotate(150deg) saturate(1.4)' },
  { id: 'sunset', name: '노을', filter: 'sepia(0.55) hue-rotate(-20deg) saturate(1.5)' },
  { id: 'ink', name: '흑백', filter: 'grayscale(1)' },
  { id: CUSTOM_ID, name: '사용자 지정', filter: 'none' },
];

export interface CustomColors {
  /** Degrees around the colour wheel, -180..180. */
  hue: number;
  /** Percent, 0..200. 100 leaves saturation unchanged. */
  saturation: number;
  /** Percent, 0..100. 0 leaves the colours as they are. */
  warmth: number;
}

export const DEFAULT_CUSTOM: CustomColors = { hue: 0, saturation: 100, warmth: 0 };

const clampNumber = (value: unknown, lo: number, hi: number, fallback: number) => {
  const n = typeof value === 'number' ? value : Number.NaN;
  return Number.isFinite(n) ? Math.max(lo, Math.min(hi, n)) : fallback;
};

export function normalizeCustom(value: Partial<Record<keyof CustomColors, unknown>>): CustomColors {
  return {
    hue: clampNumber(value.hue, -180, 180, DEFAULT_CUSTOM.hue),
    saturation: clampNumber(value.saturation, 0, 200, DEFAULT_CUSTOM.saturation),
    warmth: clampNumber(value.warmth, 0, 100, DEFAULT_CUSTOM.warmth),
  };
}

/** Saved settings can be stale or edited by hand, so anything unusable becomes the default. */
export function parseCustom(saved: string | null): CustomColors {
  if (!saved) return { ...DEFAULT_CUSTOM };
  try {
    const value: unknown = JSON.parse(saved);
    return normalizeCustom(value && typeof value === 'object' ? value : {});
  } catch {
    return { ...DEFAULT_CUSTOM };
  }
}

export function customFilter(colors: CustomColors): string {
  const { hue, saturation, warmth } = normalizeCustom({ ...colors });
  const parts: string[] = [];
  if (warmth > 0) parts.push(`sepia(${warmth / 100})`);
  if (hue !== 0) parts.push(`hue-rotate(${hue}deg)`);
  if (saturation !== 100) parts.push(`saturate(${saturation / 100})`);
  return parts.length ? parts.join(' ') : 'none';
}

export function paletteById(id: string | null, custom: CustomColors = DEFAULT_CUSTOM): Palette {
  const palette = PALETTES.find((p) => p.id === id) ?? PALETTES[0];
  return palette.id === CUSTOM_ID ? { ...palette, filter: customFilter(custom) } : palette;
}

export function nextPalette(id: string, custom: CustomColors = DEFAULT_CUSTOM): Palette {
  const i = PALETTES.findIndex((p) => p.id === id);
  return paletteById(PALETTES[(i + 1) % PALETTES.length].id, custom);
}
