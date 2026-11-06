import type { MoodKey } from './features';

// Krumhansl-Kessler key profiles.
const MAJOR = [6.35, 2.23, 3.48, 2.33, 4.38, 4.09, 2.52, 5.19, 2.39, 3.66, 2.29, 2.88];
const MINOR = [6.33, 2.68, 3.52, 5.38, 2.6, 3.53, 2.54, 4.75, 3.98, 2.69, 3.34, 3.17];

function correlate(chroma: ArrayLike<number>, profile: number[], rotation: number): number {
  let meanA = 0;
  let meanB = 0;
  for (let i = 0; i < 12; i++) {
    meanA += chroma[i];
    meanB += profile[i];
  }
  meanA /= 12;
  meanB /= 12;
  let num = 0;
  let denA = 0;
  let denB = 0;
  for (let i = 0; i < 12; i++) {
    const a = chroma[(i + rotation) % 12] - meanA;
    const b = profile[i] - meanB;
    num += a * b;
    denA += a * a;
    denB += b * b;
  }
  const den = Math.sqrt(denA * denB);
  return den > 1e-9 ? num / den : 0;
}

/** Positive means the pitch content leans major, negative leans minor. */
export function modeScore(chroma: ArrayLike<number>): number {
  let bestMajor = -1;
  let bestMinor = -1;
  for (let r = 0; r < 12; r++) {
    bestMajor = Math.max(bestMajor, correlate(chroma, MAJOR, r));
    bestMinor = Math.max(bestMinor, correlate(chroma, MINOR, r));
  }
  return bestMajor - bestMinor;
}

export interface MoodInput {
  /** Long-term loudness in dB. */
  loudnessDb: number;
  /** Musical events per second. */
  onsetRate: number;
  /** Spectral centroid in Hz. */
  centroidHz: number;
  mode: number;
  /** Average upward spectral change in dB per second. Independent of recording level. */
  activity: number;
}

const clamp01 = (x: number) => Math.max(0, Math.min(1, x));

export function moodAxes(m: MoodInput): { valence: number; arousal: number } {
  const loud = clamp01((m.loudnessDb + 42) / 26);
  const rate = clamp01(m.onsetRate / 5);
  const bright = clamp01((Math.log2(Math.max(m.centroidHz, 100)) - Math.log2(350)) / 3);
  const movement = clamp01((m.activity - 70) / 60);
  // Recording level says little about a track, so it has the smallest say of the loudness-free cues.
  const arousal = clamp01(1.12 * (0.2 * loud + 0.42 * rate + 0.16 * bright + 0.22 * movement));
  const modeTerm = clamp01(0.5 + m.mode * 2.6);
  const valence = clamp01(0.72 * modeTerm + 0.16 * bright + 0.12 * rate);
  return { valence, arousal };
}

const HYSTERESIS = 0.04;
const QUIET_VALENCE_MIDDLE = 0.46;
/** How long a new reading must hold before the label changes. */
export const MOOD_HOLD_SECONDS = 3;

/** Picks a quadrant, staying put near the boundary so the label does not flicker. */
export function classifyMood(valence: number, arousal: number, previous: MoodKey): MoodKey {
  const prevHappy = previous === 'joyful' || previous === 'calm';
  const prevHigh = previous === 'joyful' || previous === 'intense';
  const high = prevHigh ? arousal > 0.5 - HYSTERESIS : arousal > 0.5 + HYSTERESIS;
  // A quiet piece that is neither clearly major nor minor gives no evidence of sadness.
  const middle = high ? 0.5 : QUIET_VALENCE_MIDDLE;
  const happy = prevHappy ? valence > middle - HYSTERESIS : valence > middle + HYSTERESIS;
  if (happy) return high ? 'joyful' : 'calm';
  return high ? 'intense' : 'sad';
}

/** Keeps a passing section or a single loud bar from flipping what is on screen. */
export class MoodLabel {
  private pending: MoodKey | null = null;
  private held = 0;

  constructor(public current: MoodKey = 'calm') {}

  /** While warming up, the first reading of a song replaces the default straight away. */
  update(valence: number, arousal: number, dt: number, warming: boolean): MoodKey {
    const next = classifyMood(valence, arousal, this.current);
    if (next === this.current || warming) {
      this.current = next;
      this.pending = null;
      this.held = 0;
      return this.current;
    }
    this.held = next === this.pending ? this.held + dt : dt;
    this.pending = next;
    if (this.held >= MOOD_HOLD_SECONDS) {
      this.current = next;
      this.pending = null;
      this.held = 0;
    }
    return this.current;
  }

  reset() {
    this.current = 'calm';
    this.pending = null;
    this.held = 0;
  }
}
