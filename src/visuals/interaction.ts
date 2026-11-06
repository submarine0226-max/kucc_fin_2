import type { ElementKey } from '../audio/features';
import type { RGB } from './types';

export interface ViewState { x: number; y: number; zoom: number }
export type ViewMode = 'flat' | 'orbit' | 'tunnel';
const clamp = (v: number, lo: number, hi: number) => Math.max(lo, Math.min(hi, v));

/** Normalized, bounded camera controls shared by all styles. */
export class VisualView {
  readonly state: ViewState = { x: 0, y: 0, zoom: 1 };
  constructor(public mode: ViewMode = 'flat') {}
  reset() { Object.assign(this.state, { x: 0, y: 0, zoom: 1 }); }
  drag(dx: number, dy: number, width: number, height: number) {
    if (this.mode === 'flat' && this.state.zoom === 1) return;
    const sensitivity = this.mode === 'flat' ? 1 / Math.max(0.25, this.state.zoom - 1) : 1;
    this.state.x = clamp(this.state.x + dx / Math.max(1, width) * 2 * sensitivity, -1, 1);
    this.state.y = clamp(this.state.y + dy / Math.max(1, height) * 2 * sensitivity, -1, 1);
  }
  zoomBy(delta: number) {
    this.state.zoom = clamp(this.state.zoom * Math.exp(clamp(delta, -1, 1)), 1, 2.5);
    if (this.state.zoom === 1 && this.mode === 'flat') this.state.x = this.state.y = 0;
  }
}

/** Presentation-only emphasis. Never masks or modifies analyzed musical features. */
export class ElementFocus {
  selected: ElementKey | null = null;
  private readonly weights = { drums: 1, bass: 1, vocal: 1, melody: 1 };
  private readonly colors: { key: ElementKey | null; color: { r: number; g: number; b: number }; base: RGB }[] = [];
  trackColor(key: ElementKey | null, color: { r: number; g: number; b: number }) {
    this.colors.push({ key, color, base: [color.r, color.g, color.b] });
  }
  set(key: ElementKey | null) { this.selected = key; }
  update(dt: number) {
    const alpha = 1 - Math.exp(-Math.max(0, dt) / 0.25);
    for (const key of ['drums', 'bass', 'vocal', 'melody'] as const) {
      const target = this.selected === null || this.selected === key ? 1 : 0.16;
      this.weights[key] += (target - this.weights[key]) * alpha;
    }
    for (const { key, color, base } of this.colors) {
      const weight = key === null ? this.context() : this.weight(key);
      color.r = base[0] * weight;
      color.g = base[1] * weight;
      color.b = base[2] * weight;
    }
  }
  weight(key: ElementKey) { return this.weights[key]; }
  context() { return Math.min(...Object.values(this.weights)) * 0.7 + 0.3; }
  color(key: ElementKey, color: RGB): RGB {
    const weight = this.weight(key);
    const grey = (color[0] + color[1] + color[2]) / 3;
    return color.map((channel) => (channel * weight + grey * (1 - weight) * 0.25) * weight) as RGB;
  }
}
