export type ElementKey = 'drums' | 'bass' | 'vocal' | 'melody';
export type MoodKey = 'joyful' | 'calm' | 'sad' | 'intense';

export const BAND_COUNT = 64;

/** One frame of what the music is doing. Everything a visual may react to. */
export interface Features {
  time: number;
  dt: number;
  /** True when there is an audible signal this frame. */
  active: boolean;

  /** Continuous element levels, 0..1. */
  drums: number;
  bass: number;
  vocal: number;
  melody: number;

  /** One-frame impulses, 0 when nothing happened. Safe for motion and shape only. */
  kick: number;
  snare: number;
  hat: number;
  melodyNote: number;
  /** Immediate rhythmic onset; may be a bass note, so it is separate from confirmed drums. Motion only. */
  attack: number;
  /** Estimated tempo; 0 while acquiring. Beat phase is 0 at the estimated beat, approaching 1 before the next. */
  bpm: number;
  beatPhase: number;
  beatConfidence: number;

  /** Brightness envelope that already respects the flash limit. Use this for light. */
  pulse: number;
  reduceFlash: boolean;

  /** Pitch, normalised 0..1 across MIDI 36..96 (bass: 24..60). */
  bassPitch: number;
  vocalPitch: number;
  melodyPitch: number;
  melodyPitchClass: number;

  /** Log-spaced spectrum, low to high, 0..1. */
  spectrum: Float32Array;
  energy: number;

  /** Russell's circumplex: valence 0 sad..1 happy, arousal 0 still..1 charged. */
  valence: number;
  arousal: number;
  mood: MoodKey;
  /** 0 while the mood is still being read from the first seconds of a song. */
  moodConfidence: number;
}

export function emptyFeatures(): Features {
  return {
    time: 0,
    dt: 1 / 60,
    active: false,
    drums: 0,
    bass: 0,
    vocal: 0,
    melody: 0,
    kick: 0,
    snare: 0,
    hat: 0,
    melodyNote: 0,
    attack: 0,
    bpm: 0,
    beatPhase: 0,
    beatConfidence: 0,
    pulse: 0,
    reduceFlash: false,
    bassPitch: 0.3,
    vocalPitch: 0.5,
    melodyPitch: 0.5,
    melodyPitchClass: 0,
    spectrum: new Float32Array(BAND_COUNT),
    energy: 0,
    valence: 0.5,
    arousal: 0.4,
    mood: 'calm',
    moodConfidence: 0,
  };
}

/** A made-up but musical signal, so visuals can run before any song is loaded. */
export function idleFeatures(f: Features, dt: number): Features {
  const t = (f.time += dt);
  f.dt = dt;
  f.active = true;
  const beat = 60 / 76;
  const step = Math.floor(t / beat);
  const prev = Math.floor((t - dt) / beat);
  const onBeat = step !== prev;
  f.attack = onBeat ? 0.7 : 0;
  f.bpm = 76;
  f.beatPhase = (t / beat) % 1;
  f.beatConfidence = 1;
  f.kick = onBeat && step % 2 === 0 ? 0.7 : 0;
  f.snare = onBeat && step % 4 === 3 ? 0.5 : 0;
  f.hat = 0;
  f.melodyNote = onBeat && step % 3 === 1 ? 0.8 : 0;
  f.bass = 0.35 + 0.3 * Math.sin(t * 0.5) ** 2;
  f.vocal = Math.max(0, Math.sin(t * 0.33)) * 0.8;
  f.melody = 0.4 + 0.3 * Math.sin(t * 0.7);
  f.drums = onBeat ? 0.7 : f.drums * 0.94;
  f.vocalPitch = 0.5 + 0.22 * Math.sin(t * 0.61) * Math.cos(t * 0.17);
  if (f.melodyNote) {
    f.melodyPitchClass = (step * 7) % 12;
    f.melodyPitch = 0.45 + (f.melodyPitchClass / 12) * 0.4;
  }
  f.bassPitch = 0.3 + 0.1 * Math.sin(t * 0.25);
  f.pulse = 0;
  for (let i = 0; i < BAND_COUNT; i++) {
    f.spectrum[i] = 0.3 + 0.3 * Math.sin(i * 0.3 + t * 1.3) * Math.sin(i * 0.11 - t * 0.7);
  }
  f.energy = 0.45;
  f.valence = 0.6;
  f.arousal = 0.4;
  f.mood = 'calm';
  f.moodConfidence = 1;
  return f;
}
