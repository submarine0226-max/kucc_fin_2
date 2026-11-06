export const LEGEND_BASE_WIDTH = 208;
export const MIN_SCALE = 0.6;
export const MAX_SCALE = 1.6;
export const DEFAULT_SCALE = 1;
/** From this scale there is room to show each instrument's description all the time. */
export const ROOMY_SCALE = 1.25;

/** The panel shrinks as a whole, so nothing inside it is ever cut off. */
export function clampLegendScale(scale: number, maxScale = MAX_SCALE): number {
  const upper = Math.max(MIN_SCALE, Math.min(MAX_SCALE, maxScale));
  return Math.round(Math.max(MIN_SCALE, Math.min(upper, scale)) * 100) / 100;
}

export function parseLegendScale(saved: string | null): number {
  if (!saved) return DEFAULT_SCALE;
  const value = Number(saved);
  return Number.isFinite(value) ? clampLegendScale(value) : DEFAULT_SCALE;
}

/** Dragging the bottom-left corner: left and down both mean bigger. */
export function dragLegendScale(start: number, width: number, height: number, dx: number, dy: number): number {
  const grow = (-dx + dy * (width / Math.max(1, height))) / 2;
  return start * (width + grow) / Math.max(1, width);
}
