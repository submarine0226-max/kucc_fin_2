export interface CatBounds { index: number; x: number; y: number; scale: number }

export function catBandLayout(width: number, height: number, sizes: readonly number[]): CatBounds[] {
  const bandWidth = width * 0.74;
  const unit = Math.min(bandWidth / (4 * 205 * 1.46), height * 0.5 / (220 * 1.46));
  return sizes.map((size, index) => ({ index,
    x: width * 0.035 + bandWidth * (index + 0.5) / 4,
    y: height * 0.64,
    scale: unit * size,
  }));
}

/** Coordinates refer to the canvas before CSS pan/zoom, as does the drawing layout. */
export function catAtPoint(x: number, y: number, bounds: readonly CatBounds[]): number | null {
  for (let i = bounds.length - 1; i >= 0; i--) {
    const cat = bounds[i];
    const px = (x - cat.x) / cat.scale, py = (y - cat.y) / cat.scale;
    const head = (px / 68) ** 2 + ((py + 115) / 83) ** 2 <= 1;
    const bodyOrInstrument = Math.abs(px) <= 100 && py >= -95 && py <= 28;
    if (head || bodyOrInstrument) return cat.index;
  }
  return null;
}
