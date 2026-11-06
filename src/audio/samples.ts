import type { ElementKey, MoodKey } from './features';

/**
 * Four short pieces synthesised in the browser, one per mood. They need no licence
 * and no network. Every element also has a known schedule, so analysis accuracy can
 * be measured against ground truth.
 */

export interface Section {
  bars: number;
  on: ElementKey[];
}

export interface SampleSpec {
  id: string;
  title: string;
  mood: MoodKey;
  bpm: number;
  root: number;
  minor: boolean;
  /** Chord roots, semitones above the song root. */
  chords: number[];
  sections: Section[];
  density: 'sparse' | 'gentle' | 'driving' | 'furious';
  level: number;
}

const ALL: ElementKey[] = ['drums', 'bass', 'vocal', 'melody'];

export const SAMPLES: SampleSpec[] = [
  {
    id: 'march',
    title: '한낮의 행진',
    mood: 'joyful',
    bpm: 128,
    root: 48,
    minor: false,
    chords: [0, 7, 9, 5],
    density: 'driving',
    level: 0.9,
    sections: [
      { bars: 4, on: ['drums', 'bass'] },
      { bars: 8, on: ['drums', 'bass', 'vocal'] },
      { bars: 8, on: ALL },
      { bars: 4, on: ['melody'] },
      { bars: 4, on: ['vocal'] },
      { bars: 8, on: ALL },
    ],
  },
  {
    id: 'dawn',
    title: '고요한 새벽',
    mood: 'calm',
    bpm: 72,
    root: 53,
    minor: false,
    chords: [0, 5, 9, 7],
    density: 'sparse',
    level: 0.42,
    sections: [
      { bars: 2, on: ['melody'] },
      { bars: 4, on: ['melody', 'bass'] },
      { bars: 6, on: ['melody', 'bass', 'vocal'] },
      { bars: 2, on: ['melody'] },
    ],
  },
  {
    id: 'rain',
    title: '비 오는 창가',
    mood: 'sad',
    bpm: 60,
    root: 45,
    minor: true,
    chords: [0, 5, 0, 8],
    density: 'sparse',
    level: 0.42,
    sections: [
      { bars: 2, on: ['melody'] },
      { bars: 4, on: ['melody', 'vocal'] },
      { bars: 4, on: ['melody', 'vocal', 'bass'] },
      { bars: 2, on: ['melody'] },
    ],
  },
  {
    id: 'storm',
    title: '붉은 폭풍',
    mood: 'intense',
    bpm: 160,
    root: 40,
    minor: true,
    chords: [0, 0, 8, 7],
    density: 'furious',
    level: 1,
    sections: [
      { bars: 4, on: ['drums'] },
      { bars: 8, on: ['drums', 'bass'] },
      { bars: 12, on: ALL },
      { bars: 4, on: ['bass', 'melody'] },
      { bars: 12, on: ALL },
    ],
  },
];

/** A short loop with everything playing throughout, so no instrument's solo falls silent. */
export function tutorialSpec(): SampleSpec {
  return { ...SAMPLES[0], id: 'tutorial', title: '소리결 튜토리얼', sections: [{ bars: 8, on: ALL }] };
}

export function sampleDuration(spec: SampleSpec): number {
  const bars = spec.sections.reduce((n, s) => n + s.bars, 0);
  return (bars * 4 * 60) / spec.bpm;
}

/** Which elements are scheduled to sound at a given time. */
export function elementsAt(spec: SampleSpec, time: number): ElementKey[] {
  const barLength = (4 * 60) / spec.bpm;
  let bar = time / barLength;
  for (const s of spec.sections) {
    if (bar < s.bars) return s.on;
    bar -= s.bars;
  }
  return [];
}

const midiHz = (m: number) => 440 * Math.pow(2, (m - 69) / 12);
const SAMPLE_RATE = 44100;

export interface RenderedAudio {
  left: Float32Array;
  right: Float32Array;
  sampleRate: number;
}

function seeded(seed: number) {
  let s = seed;
  return () => {
    s = (s * 1664525 + 1013904223) >>> 0;
    return s / 4294967296;
  };
}

/** RBJ band-pass biquad, run over a whole buffer and added into the output. */
function addBandpass(input: Float32Array, output: Float32Array, hz: number, q: number, gain: number) {
  const w = (2 * Math.PI * hz) / SAMPLE_RATE;
  const alpha = Math.sin(w) / (2 * q);
  const a0 = 1 + alpha;
  const b0 = alpha / a0;
  const a1 = (-2 * Math.cos(w)) / a0;
  const a2 = (1 - alpha) / a0;
  let x1 = 0;
  let x2 = 0;
  let y1 = 0;
  let y2 = 0;
  for (let i = 0; i < input.length; i++) {
    const x = input[i];
    const y = b0 * x - b0 * x2 - a1 * y1 - a2 * y2;
    x2 = x1;
    x1 = x;
    y2 = y1;
    y1 = y;
    output[i] += y * gain;
  }
}

/** Schroeder reverb: parallel combs per channel. Cheap, and plenty for a demo piece. */
function addReverb(send: Float32Array, left: Float32Array, right: Float32Array, feedback: number, gain: number) {
  const combs = (out: Float32Array, lengths: number[]) => {
    for (const len of lengths) {
      const delay = new Float32Array(len);
      let p = 0;
      for (let i = 0; i < send.length; i++) {
        const v = delay[p];
        delay[p] = send[i] + v * feedback;
        out[i] += v * gain;
        p = (p + 1) % len;
      }
    }
  };
  combs(left, [1557, 1617, 1491, 1422]);
  combs(right, [1277, 1356, 1188, 1116]);
}

/**
 * Plain array synthesis rather than Web Audio nodes. A graph with thousands of
 * scheduled nodes keeps processing silence for every one of them for the whole song,
 * and took over 15 seconds. This only computes samples while a note is sounding.
 */
export function renderSample(spec: SampleSpec, only: ElementKey | null = null): RenderedAudio {
  const seconds = sampleDuration(spec) + 2;
  const length = Math.ceil(seconds * SAMPLE_RATE);
  const left = new Float32Array(length);
  const right = new Float32Array(length);
  const send = new Float32Array(length);
  const voiceRaw = new Float32Array(length);
  const voiceOut = new Float32Array(length);
  const rand = seeded(spec.bpm * 31 + spec.root);
  const noise = seeded(7);
  const SR = SAMPLE_RATE;

  const put = (i: number, v: number, panL: number, panR: number, sendAmount: number) => {
    if (i < 0 || i >= length) return;
    left[i] += v * panL;
    right[i] += v * panR;
    send[i] += v * sendAmount;
  };

  const kick = (t: number, amp: number) => {
    const start = Math.floor(t * SR);
    const n = Math.floor(0.24 * SR);
    let phase = 0;
    for (let i = 0; i < n; i++) {
      const time = i / SR;
      const hz = 46 + 109 * Math.exp(-time / 0.03);
      phase += (2 * Math.PI * hz) / SR;
      put(start + i, Math.sin(phase) * amp * Math.exp(-time / 0.055), 0.7, 0.7, 0);
    }
  };

  /** Noise through a state-variable filter. mode 0 is band-pass, mode 1 is high-pass. */
  const noiseHit = (t: number, amp: number, len: number, mode: number, hz: number, sendAmount = 0) => {
    const start = Math.floor(t * SR);
    const n = Math.floor(len * SR);
    const k = 2 * Math.sin((Math.PI * Math.min(hz, 12000)) / SR);
    let lp = 0;
    let bp = 0;
    for (let i = 0; i < n; i++) {
      const x = (noise() * 2 - 1) * Math.exp((-i / n) * 5);
      lp += k * bp;
      const hp = x - lp - 0.7 * bp;
      bp += k * hp;
      put(start + i, (mode === 0 ? bp : hp) * amp, 0.7, 0.7, sendAmount);
    }
  };

  const bassNote = (t: number, midi: number, len: number, amp: number) => {
    const start = Math.floor(t * SR);
    const n = Math.floor(len * SR);
    const inc = midiHz(midi) / SR;
    const square = spec.density === 'furious';
    const cut = 1 - Math.exp((-2 * Math.PI * (square ? 620 : 360)) / SR);
    let phase = 0;
    let a = 0;
    let b = 0;
    for (let i = 0; i < n; i++) {
      phase = (phase + inc) % 1;
      const raw = square ? (phase < 0.5 ? 1 : -1) : phase * 2 - 1;
      a += cut * (raw - a);
      b += cut * (a - b);
      const env = Math.min(1, i / (0.012 * SR)) * Math.min(1, (n - i) / (0.02 * SR));
      put(start + i, b * amp * env, 0.7, 0.7, 0);
    }
  };

  /** Written to a separate bus, which then passes once through vowel-shaped resonances. */
  const sing = (t: number, midi: number, len: number, amp: number, fromMidi: number) => {
    const start = Math.floor(t * SR);
    const n = Math.floor(len * SR);
    let phase = 0;
    for (let i = 0; i < n; i++) {
      const time = i / SR;
      const glide = midi + (fromMidi - midi) * Math.exp(-time / 0.05);
      const depth = Math.min(1, time / 0.25) * 0.42;
      const pitch = glide + Math.sin(2 * Math.PI * 5.4 * time) * depth;
      phase = (phase + midiHz(pitch) / SR) % 1;
      const env = Math.min(1, i / (0.07 * SR)) * Math.min(1, (n - i) / (0.1 * SR));
      const j = start + i;
      if (j < length) voiceRaw[j] += (phase * 2 - 1) * amp * env;
    }
  };

  const pluck = (t: number, midi: number, len: number, amp: number, pan: number) => {
    const start = Math.floor(t * SR);
    const n = Math.floor(len * SR);
    const w = (2 * Math.PI * midiHz(midi)) / SR;
    const panL = Math.cos(((pan + 1) * Math.PI) / 4);
    const panR = Math.sin(((pan + 1) * Math.PI) / 4);
    const decay = len / 5;
    for (let i = 0; i < n; i++) {
      const env = Math.min(1, i / (0.005 * SR)) * Math.exp(-i / SR / decay);
      const v = (Math.sin(w * i) + 0.3 * Math.sin(2 * w * i) + 0.12 * Math.sin(3 * w * i)) * amp * env;
      put(start + i, v, panL, panR, 0.35);
    }
  };

  const beat = 60 / spec.bpm;
  const scale = spec.minor ? [0, 2, 3, 5, 7, 8, 10] : [0, 2, 4, 5, 7, 9, 11];
  let bar = 0;
  let voiceDegree = 4;
  let lastVoiceMidi = spec.root + 24;
  for (const section of spec.sections) {
    const has = (e: ElementKey) => section.on.includes(e) && (only === null || only === e);
    for (let b = 0; b < section.bars; b++, bar++) {
      const t0 = bar * 4 * beat;
      const chord = spec.chords[bar % spec.chords.length];
      const degree = Math.max(0, scale.indexOf(chord));
      const tone = (step: number) => {
        const i = degree + step;
        return scale[i % scale.length] + 12 * Math.floor(i / scale.length) - chord;
      };

      if (has('drums')) {
        const hitsPerBeat = spec.density === 'furious' ? 2 : 1;
        for (let i = 0; i < 4 * hitsPerBeat; i++) {
          const every = spec.density === 'furious' ? 2 : 1;
          if (i % every === 0 || rand() < 0.3) kick(t0 + (i * beat) / hitsPerBeat, 0.95);
        }
        noiseHit(t0 + beat, 0.55, 0.16, 1, 900, 0.2);
        noiseHit(t0 + 3 * beat, 0.55, 0.16, 1, 900, 0.2);
        for (let i = 0; i < 8; i++) {
          noiseHit(t0 + (i * beat) / 2, i % 2 ? 0.1 : 0.17, 0.05, 1, 7600);
        }
      }

      if (has('bass')) {
        const midi = spec.root - 12 + chord;
        if (spec.density === 'sparse') {
          bassNote(t0, midi, 3.8 * beat, 0.5);
        } else {
          const notes = spec.density === 'furious' ? 16 : 8;
          const step = (4 * beat) / notes;
          for (let i = 0; i < notes; i++) {
            bassNote(t0 + i * step, midi + (i % 8 === 7 ? 7 : 0), step * 0.85, 0.42);
          }
        }
      }

      if (has('melody')) {
        const shape = [0, tone(2), tone(4), 12, tone(4), tone(2)];
        const notes = { sparse: 4, gentle: 6, driving: 8, furious: 12 }[spec.density];
        const step = (4 * beat) / notes;
        for (let i = 0; i < notes; i++) {
          const midi = spec.root + 24 + chord + shape[i % shape.length];
          pluck(t0 + i * step, midi, spec.density === 'sparse' ? 1.8 : 0.5, 0.3, i % 2 ? 0.75 : -0.75);
        }
      }

      if (has('vocal')) {
        const phrase = spec.density === 'sparse' ? 2 : 4;
        const step = (4 * beat) / phrase;
        for (let i = 0; i < phrase; i++) {
          if (rand() < 0.15) continue;
          voiceDegree = Math.max(0, Math.min(9, voiceDegree + Math.floor(rand() * 5) - 2));
          const octave = voiceDegree >= scale.length ? 12 : 0;
          const midi = spec.root + 12 + octave + scale[voiceDegree % scale.length];
          sing(t0 + i * step, midi, step * 0.92, 0.6, lastVoiceMidi);
          lastVoiceMidi = midi;
        }
      }
    }
  }

  addBandpass(voiceRaw, voiceOut, 730, 6, 1);
  addBandpass(voiceRaw, voiceOut, 1090, 8, 0.55);
  addBandpass(voiceRaw, voiceOut, 2440, 10, 0.3);
  for (let i = 0; i < length; i++) {
    const v = voiceOut[i] * 0.9;
    left[i] += v;
    right[i] += v;
    send[i] += v * 0.5;
  }

  const sparse = spec.density === 'sparse';
  addReverb(send, left, right, sparse ? 0.86 : 0.72, sparse ? 0.07 : 0.025);

  // Gentle saturation keeps peaks in range without a separate limiter.
  for (let i = 0; i < length; i++) {
    left[i] = Math.tanh(left[i] * spec.level);
    right[i] = Math.tanh(right[i] * spec.level);
  }
  return { left, right, sampleRate: SR };
}

/** Encodes to 16-bit WAV so samples reach the same audio element as any upload. */
export function audioToWav(audio: RenderedAudio): Blob {
  const frames = audio.left.length;
  const dataSize = frames * 4;
  const out = new DataView(new ArrayBuffer(44 + dataSize));
  const text = (offset: number, s: string) => {
    for (let i = 0; i < s.length; i++) out.setUint8(offset + i, s.charCodeAt(i));
  };
  text(0, 'RIFF');
  out.setUint32(4, 36 + dataSize, true);
  text(8, 'WAVE');
  text(12, 'fmt ');
  out.setUint32(16, 16, true);
  out.setUint16(20, 1, true);
  out.setUint16(22, 2, true);
  out.setUint32(24, audio.sampleRate, true);
  out.setUint32(28, audio.sampleRate * 4, true);
  out.setUint16(32, 4, true);
  out.setUint16(34, 16, true);
  text(36, 'data');
  out.setUint32(40, dataSize, true);
  let p = 44;
  for (let i = 0; i < frames; i++) {
    out.setInt16(p, Math.max(-1, Math.min(1, audio.left[i])) * 0x7fff, true);
    out.setInt16(p + 2, Math.max(-1, Math.min(1, audio.right[i])) * 0x7fff, true);
    p += 4;
  }
  return new Blob([out.buffer], { type: 'audio/wav' });
}
