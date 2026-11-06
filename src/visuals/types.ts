import type { ElementKey, Features } from '../audio/features';
import type { ElementFocus, ViewState } from './interaction';

export interface LegendEntry {
  color: string;
  /** What this element looks like in this style, in a few words. */
  text: string;
}

export interface VisualInfo {
  id: string;
  name: string;
  needsWebGL: boolean;
  legend: Record<ElementKey, LegendEntry>;
  interaction?: { pointer: string; keyboard?: string };
}

export interface Visual {
  canvas: HTMLCanvasElement;
  focus?: ElementFocus;
  setView?(view: ViewState): void;
  activate?(point?: { x: number; y: number }): boolean;
  drag?(from: { x: number; y: number }, to: { x: number; y: number }): void;
  resize(width: number, height: number): void;
  frame(f: Features): void;
  dispose(): void;
}

export type RGB = [number, number, number];
export const rgb = (c: RGB, a = 1) =>
  `rgba(${Math.round(c[0])},${Math.round(c[1])},${Math.round(c[2])},${a})`;
export const mix = (a: RGB, b: RGB, t: number): RGB => [
  a[0] + (b[0] - a[0]) * t,
  a[1] + (b[1] - a[1]) * t,
  a[2] + (b[2] - a[2]) * t,
];

/** Blends four corner colours by mood: x is valence, y is arousal. */
export function moodBlend(sad: RGB, calm: RGB, intense: RGB, joyful: RGB, v: number, a: number): RGB {
  return mix(mix(sad, calm, v), mix(intense, joyful, v), a);
}

/** Element colours from the TDS palette, shared by the luminous styles. */
export const ELEMENT_RGB: Record<ElementKey, RGB> = {
  drums: [246, 101, 112],
  bass: [69, 147, 252],
  vocal: [255, 209, 88],
  melody: [88, 199, 199],
};

/** Background per mood, deliberately far apart so mood reads at a glance. */
export function moodBackground(v: number, a: number): RGB {
  return moodBlend([10, 14, 32], [6, 34, 44], [46, 6, 18], [52, 18, 58], v, a);
}

/** Pulls colour towards grey when the song is sad, and pushes it when it is joyful. */
export function moodVivid(c: RGB, v: number, a: number): RGB {
  const grey = (c[0] + c[1] + c[2]) / 3;
  const sat = 0.55 + 0.45 * Math.min(1, v * 0.7 + a * 0.6);
  const glow = 0.72 + 0.28 * Math.min(1, a + v * 0.4);
  return [(grey + (c[0] - grey) * sat) * glow, (grey + (c[1] - grey) * sat) * glow, (grey + (c[2] - grey) * sat) * glow];
}

/** Eases towards a target. Tau is roughly the seconds taken to get most of the way there. */
export const approach = (value: number, target: number, dt: number, tau: number) =>
  value + (target - value) * (1 - Math.exp(-dt / tau));

/** A soft rise and a long fall, so a hit swells in rather than appearing on one frame. */
export const swell = (age: number, rise: number, fall: number) => {
  const p = Math.min(1, age / rise);
  return p * p * (3 - 2 * p) * Math.exp(-Math.max(0, age - rise) / fall);
};

/** Slows the spectrum for visuals that would otherwise pop on every drum hit. */
export function easeSpectrum(out: Float32Array, input: Float32Array, dt: number, rise: number, fall: number) {
  for (let i = 0; i < out.length; i++) {
    out[i] = approach(out[i], input[i], dt, input[i] > out[i] ? rise : fall);
  }
}
