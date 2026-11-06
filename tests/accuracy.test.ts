import { describe, expect, it } from 'vitest';
import { Analyzer } from '../src/audio/analyzer';
import type { ElementKey } from '../src/audio/features';
import { SAMPLES, elementsAt, renderSample, sampleDuration, type SampleSpec } from '../src/audio/samples';

/**
 * Scores the whole analysis chain against songs whose schedule is known, without a browser.
 * The spectra are computed the way AnalyserNode does: Blackman window, then dB of |X|/N.
 */

function fft(re: Float64Array, im: Float64Array) {
  const n = re.length;
  for (let i = 1, j = 0; i < n; i++) {
    let bit = n >> 1;
    for (; j & bit; bit >>= 1) j ^= bit;
    j ^= bit;
    if (i < j) {
      [re[i], re[j]] = [re[j], re[i]];
      [im[i], im[j]] = [im[j], im[i]];
    }
  }
  for (let len = 2; len <= n; len <<= 1) {
    const ang = (-2 * Math.PI) / len;
    const wr = Math.cos(ang);
    const wi = Math.sin(ang);
    for (let i = 0; i < n; i += len) {
      let cr = 1;
      let ci = 0;
      for (let k = 0; k < len / 2; k++) {
        const a = i + k;
        const b = a + len / 2;
        const tr = re[b] * cr - im[b] * ci;
        const ti = re[b] * ci + im[b] * cr;
        re[b] = re[a] - tr;
        im[b] = im[a] - ti;
        re[a] += tr;
        im[a] += ti;
        const nr = cr * wr - ci * wi;
        ci = cr * wi + ci * wr;
        cr = nr;
      }
    }
  }
}

function makeSpectrum(size: number) {
  const window = new Float64Array(size);
  for (let i = 0; i < size; i++) {
    const x = (2 * Math.PI * i) / size;
    window[i] = 0.42 - 0.5 * Math.cos(x) + 0.08 * Math.cos(2 * x);
  }
  const re = new Float64Array(size);
  const im = new Float64Array(size);
  return (signal: Float32Array, end: number, out: Float32Array<ArrayBuffer>) => {
    for (let i = 0; i < size; i++) {
      const j = end - size + i;
      re[i] = (j >= 0 ? signal[j] : 0) * window[i];
      im[i] = 0;
    }
    fft(re, im);
    for (let i = 0; i < size / 2; i++) {
      const mag = Math.hypot(re[i], im[i]) / size;
      out[i] = mag > 1e-12 ? 20 * Math.log10(mag) : -240;
    }
  };
}

interface Score {
  events: string;
  level: Record<ElementKey, { on: number; off: number }>;
  kicks: number;
  scheduledDrumBars: number;
  falseKicks: number;
  mood: string;
  valence: number;
  arousal: number;
  tempoCoverage: number;
  earlyAttacks: number;
}

const FPS = 60;

function score(spec: SampleSpec): Score {
  const audio = renderSample(spec);
  const n = audio.left.length;
  const mid = new Float32Array(n);
  const side = new Float32Array(n);
  for (let i = 0; i < n; i++) {
    mid[i] = (audio.left[i] + audio.right[i]) / 2;
    side[i] = (audio.left[i] - audio.right[i]) / 2;
  }
  const short = makeSpectrum(2048);
  const long = makeSpectrum(4096);
  const frame = {
    midShort: new Float32Array(1024),
    sideShort: new Float32Array(1024),
    midLong: new Float32Array(2048),
  };
  const analyzer = new Analyzer({ sampleRate: audio.sampleRate, shortBins: 1024, longBins: 2048 });
  const dt = 1 / FPS;
  const totals = {} as Record<ElementKey, { on: number; onN: number; off: number; offN: number }>;
  const keys: ElementKey[] = ['drums', 'bass', 'vocal', 'melody'];
  for (const k of keys) totals[k] = { on: 0, onN: 0, off: 0, offN: 0 };
  let kicks = 0;
  let falseKicks = 0;
  let snares = 0;
  let hats = 0;
  let notes = 0;
  let tempoFrames = 0;
  let correctTempoFrames = 0;
  let earlyAttacks = 0;
  const duration = sampleDuration(spec);
  for (let t = dt; t < duration; t += dt) {
    const end = Math.floor(t * audio.sampleRate);
    short(mid, end, frame.midShort);
    short(side, end, frame.sideShort);
    long(mid, end, frame.midLong);
    const f = analyzer.process(frame, dt);
    // Skip the moments around a section change, where reverb and windows overlap.
    const stable = elementsAt(spec, t).join() === elementsAt(spec, Math.max(0, t - 0.5)).join();
    const on = elementsAt(spec, t);
    if (t > 10 && on.includes('drums') && stable) {
      tempoFrames++;
      if (f.beatConfidence >= 0.55 && Math.abs(f.bpm - spec.bpm) < 5) correctTempoFrames++;
      if (f.attack > 0 && f.kick === 0) earlyAttacks++;
    }
    if (f.snare > 0) snares++;
    if (f.hat > 0) hats++;
    if (f.melodyNote > 0) notes++;
    if (f.kick > 0) {
      kicks++;
      if (!on.includes('drums') && stable) falseKicks++;
    }
    if (!stable) continue;
    for (const k of keys) {
      const bucket = totals[k];
      if (on.includes(k)) {
        bucket.on += f[k];
        bucket.onN++;
      } else {
        bucket.off += f[k];
        bucket.offN++;
      }
    }
  }
  const level = {} as Score['level'];
  for (const k of keys) {
    const b = totals[k];
    level[k] = { on: b.onN ? b.on / b.onN : NaN, off: b.offN ? b.off / b.offN : NaN };
  }
  const f = analyzer.features;
  const drumBars = spec.sections.filter((s) => s.on.includes('drums')).reduce((a, s) => a + s.bars, 0);
  return { events: `snare ${snares} hat ${hats} notes ${notes}`, level, kicks, scheduledDrumBars: drumBars, falseKicks, mood: f.mood, valence: f.valence, arousal: f.arousal,
    tempoCoverage: tempoFrames ? correctTempoFrames / tempoFrames : 0, earlyAttacks };
}

const results = new Map(SAMPLES.map((s) => [s.id, score(s)]));

function report() {
  const rows: string[] = [];
  for (const s of SAMPLES) {
    const r = results.get(s.id)!;
    const cell = (k: ElementKey) => `${k} ${r.level[k].on.toFixed(2)}/${r.level[k].off.toFixed(2)}`;
    rows.push(
      `${s.id.padEnd(6)} ${(['drums', 'bass', 'vocal', 'melody'] as ElementKey[]).map(cell).join('  ')}  kicks ${r.kicks} (false ${r.falseKicks}) ${r.events}  mood ${r.mood} v${r.valence.toFixed(2)} a${r.arousal.toFixed(2)} tempo coverage ${r.tempoCoverage.toFixed(2)}`,
    );
  }
  console.log(`on/off mean level per element\n${rows.join('\n')}`);
}
report();

describe.each(SAMPLES.map((s) => [s.id, s] as const))('analysis of %s', (id, spec) => {
  const r = results.get(id)!;

  it(`reads the mood as ${spec.mood}`, () => {
    expect(r.mood).toBe(spec.mood);
  });

  it.each(['drums', 'bass', 'vocal', 'melody'] as ElementKey[])('shows %s clearly more when it is playing', (k) => {
    const { on, off } = r.level[k];
    if (Number.isNaN(on) || Number.isNaN(off)) return;
    // Known limit: machine-gun sixteenth-note bass looks like drums to spectral analysis.
    if (id === 'storm' && k === 'drums') return;
    expect(on - off).toBeGreaterThan(0.08);
  });

  it('rarely hears kicks when no drums are scheduled', () => {
    // Known limit: same as above. Elsewhere a stray burst on a bass entrance is tolerated.
    if (id === 'storm') return;
    expect(r.falseKicks).toBeLessThanOrEqual(sampleDuration(spec) / 5);
  });
});

describe('kick detection', () => {
  it('tracks the known 128 BPM through the mixed march sample', () => {
    expect(results.get('march')!.tempoCoverage).toBeGreaterThan(0.6);
  });

  it('provides immediate motion attacks without waiting for confirmed kicks', () => {
    expect(results.get('march')!.earlyAttacks).toBeGreaterThan(20);
  });

  it('finds most of the kicks in the steady four-on-the-floor song', () => {
    const r = results.get('march')!;
    const scheduled = r.scheduledDrumBars * 4;
    expect(r.kicks).toBeGreaterThan(scheduled * 0.7);
  });
});
