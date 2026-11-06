/**
 * Measures flashing the way WCAG 2.3.1 defines it: a flash is a pair of opposing
 * changes in relative luminance of at least 0.10, where the darker state is below 0.80.
 */

export const relativeLuminance = (r: number, g: number, b: number) => {
  const lin = (c: number) => {
    const s = c / 255;
    return s <= 0.04045 ? s / 12.92 : Math.pow((s + 0.055) / 1.055, 2.4);
  };
  return 0.2126 * lin(r) + 0.7152 * lin(g) + 0.0722 * lin(b);
};

export function flashTimes(luminance: number[], times: number[]): number[] {
  const flashes: number[] = [];
  if (luminance.length === 0) return flashes;
  let extreme = luminance[0];
  let direction = 0;
  let halves = 0;
  for (let i = 1; i < luminance.length; i++) {
    const v = luminance[i];
    const change = v - extreme;
    const darker = Math.min(v, extreme);
    if (direction >= 0 && change <= -0.1 && darker < 0.8) {
      direction = -1;
      extreme = v;
      if (++halves % 2 === 0) flashes.push(times[i]);
    } else if (direction <= 0 && change >= 0.1 && darker < 0.8) {
      direction = 1;
      extreme = v;
      if (++halves % 2 === 0) flashes.push(times[i]);
    } else if ((direction >= 0 && v > extreme) || (direction <= 0 && v < extreme)) {
      extreme = v;
    }
  }
  return flashes;
}

export function maxFlashesPerSecond(flashes: number[]): number {
  let best = 0;
  let start = 0;
  for (let end = 0; end < flashes.length; end++) {
    while (flashes[end] - flashes[start] >= 1) start++;
    best = Math.max(best, end - start + 1);
  }
  return best;
}

/** Samples a canvas in tiles, since a local flash is hidden by a whole-frame average. */
export class FlashMeter {
  private readonly tiles = 4;
  private readonly probe = document.createElement('canvas');
  private readonly ctx = this.probe.getContext('2d', { willReadFrequently: true })!;
  private readonly series: number[][] = Array.from({ length: this.tiles * this.tiles }, () => []);
  private readonly times: number[] = [];

  constructor() {
    this.probe.width = this.tiles;
    this.probe.height = this.tiles;
  }

  sample(canvas: HTMLCanvasElement, time: number) {
    this.ctx.imageSmoothingEnabled = true;
    this.ctx.imageSmoothingQuality = 'high';
    this.ctx.drawImage(canvas, 0, 0, this.tiles, this.tiles);
    const d = this.ctx.getImageData(0, 0, this.tiles, this.tiles).data;
    for (let i = 0; i < this.series.length; i++) {
      this.series[i].push(relativeLuminance(d[i * 4], d[i * 4 + 1], d[i * 4 + 2]));
    }
    this.times.push(time);
  }

  report() {
    let worst = 0;
    let swing = 0;
    for (const s of this.series) {
      worst = Math.max(worst, maxFlashesPerSecond(flashTimes(s, this.times)));
      for (let i = 1; i < s.length; i++) swing = Math.max(swing, Math.abs(s[i] - s[i - 1]));
    }
    return { frames: this.times.length, worstFlashesPerSecond: worst, biggestFrameStep: +swing.toFixed(3) };
  }
}
