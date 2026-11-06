import { BAND_COUNT, emptyFeatures, type Features } from './features';
import { FlashGuard } from './flash';
import { BeatTracker } from './beat';
import { MoodLabel, modeScore, moodAxes } from './mood';

/**
 * Real-time estimate of drums, bass, vocal and melody from a stereo mix.
 *
 * This is signal processing, not a trained source separator, so the elements are
 * informed guesses:
 * - Drums vs. pitched sound: harmonic/percussive separation. Sustained energy is
 *   smooth across time, hits are smooth across frequency.
 * - Bass: the sustained part of the low end.
 * - Vocal: a centre-panned harmonic series whose pitch keeps moving by small amounts.
 * - Melody: the remaining pitched peaks, plus whatever is panned wide.
 */

const BAND_MIN_HZ = 30;
const BAND_MAX_HZ = 14000;
const HISTORY = 17;
const FREQ_MEDIAN_RADIUS = 4;
const FLOOR_DB = -110;
const NOTE_HOLD_SECONDS = 0.05;
const NOTE_MIN_GAP_SECONDS = 0.07;
const NOTE_REATTACK_DB = 4;
const KICK_FALL_DB = 5;
const KICK_WAIT_SECONDS = 0.12;

export interface SpectrumFrame {
  /** dB per bin of the mid channel, short window (good timing). */
  midShort: Float32Array<ArrayBuffer>;
  /** dB per bin of the side channel, short window. */
  sideShort: Float32Array<ArrayBuffer>;
  /** dB per bin of the mid channel, long window (good pitch). */
  midLong: Float32Array<ArrayBuffer>;
}

export interface AnalyzerConfig {
  sampleRate: number;
  shortBins: number;
  longBins: number;
}

class Onset {
  private mean = 0;
  private dev = 0;
  private since = 1;
  constructor(
    private readonly k: number,
    private readonly minValue: number,
    private readonly refractory: number,
  ) {}

  /** Returns a strength above 0 when an onset fires. */
  update(v: number, dt: number): number {
    this.since += dt;
    const threshold = this.mean + this.k * this.dev + this.minValue;
    const a = 1 - Math.exp(-dt / 1.2);
    let out = 0;
    if (v > threshold && this.since > this.refractory) {
      this.since = 0;
      out = Math.min(1, 0.35 + (v - threshold) / (this.minValue * 3 + 1e-6));
    }
    this.mean += a * (v - this.mean);
    this.dev += a * (Math.abs(v - this.mean) - this.dev);
    return out;
  }

  reset() {
    this.mean = 0;
    this.dev = 0;
    this.since = 1;
  }
}

const hzToMidi = (hz: number) => 69 + 12 * Math.log2(hz / 440);
const clamp01 = (x: number) => Math.max(0, Math.min(1, x));
const smoothstep = (a: number, b: number, x: number) => {
  const t = clamp01((x - a) / (b - a));
  return t * t * (3 - 2 * t);
};

function medianOf(buf: Float32Array, n: number): number {
  for (let i = 1; i < n; i++) {
    const v = buf[i];
    let j = i - 1;
    while (j >= 0 && buf[j] > v) {
      buf[j + 1] = buf[j];
      j--;
    }
    buf[j + 1] = v;
  }
  return buf[n >> 1];
}

interface Peak {
  hz: number;
  db: number;
  mag: number;
}

export class Analyzer {
  readonly guard = new FlashGuard();
  readonly features: Features = emptyFeatures();
  private readonly beatTracker = new BeatTracker();

  private readonly shortHz: number;
  private readonly longHz: number;
  private readonly bandLo = new Int32Array(BAND_COUNT);
  private readonly bandHi = new Int32Array(BAND_COUNT);
  private readonly bandHz = new Float32Array(BAND_COUNT);
  private readonly midMag = new Float32Array(BAND_COUNT);
  private readonly midDb = new Float32Array(BAND_COUNT);
  private readonly prevDb = new Float32Array(BAND_COUNT);
  private readonly sideDb = new Float32Array(BAND_COUNT);
  private readonly history: Float32Array[] = [];
  private historyPos = 0;
  private readonly temp = new Float32Array(Math.max(HISTORY, FREQ_MEDIAN_RADIUS * 2 + 1));
  private readonly harmonicMask = new Float32Array(BAND_COUNT);

  private fluxBreadth = 0;
  private pendingKick: { strength: number; peak: number; age: number } | null = null;
  private frame: SpectrumFrame | null = null;
  // A steady beat lifts its own running average, so the multipliers must stay modest.
  private readonly kickOnset = new Onset(1.6, 3.2, 0.11);
  private readonly snareOnset = new Onset(1.8, 1.7, 0.11);
  private readonly hatOnset = new Onset(1.3, 2.0, 0.06);

  private refDb = -40;
  private readonly chroma = new Float32Array(12);
  private readonly frameChroma = new Float32Array(12);
  private peaks: Peak[] = [];

  private f0 = 0;
  private microVariation = 0;
  private vocalness = 0;
  private lastMelodyMidi = -1;
  private lastMelodyDb = FLOOR_DB;
  private noteCandidate = -1;
  private noteAge = 0;
  private sinceNote = 1;
  private melodyEnv = 0;
  private vocalEnv = 0;
  private bassEnv = 0;
  private drumsEnv = 0;
  private onsetRate = 0;
  private activity = 0;
  private readonly moodLabel = new MoodLabel();
  private loudnessDb = -60;
  private centroid = 800;
  private valence = 0.5;
  private arousal = 0.4;
  private heardSeconds = 0;

  constructor(cfg: AnalyzerConfig) {
    const nyquist = cfg.sampleRate / 2;
    this.shortHz = nyquist / cfg.shortBins;
    this.longHz = nyquist / cfg.longBins;
    const ratio = Math.pow(BAND_MAX_HZ / BAND_MIN_HZ, 1 / BAND_COUNT);
    for (let b = 0; b < BAND_COUNT; b++) {
      const lo = BAND_MIN_HZ * Math.pow(ratio, b);
      const hi = lo * ratio;
      this.bandHz[b] = Math.sqrt(lo * hi);
      this.bandLo[b] = Math.floor(lo / this.shortHz);
      this.bandHi[b] = Math.max(this.bandLo[b] + 1, Math.ceil(hi / this.shortHz));
    }
    for (let i = 0; i < HISTORY; i++) this.history.push(new Float32Array(BAND_COUNT));
  }

  /** Forget everything about the previous song. */
  reset() {
    for (const h of this.history) h.fill(0);
    this.prevDb.fill(FLOOR_DB);
    this.chroma.fill(0);
    this.kickOnset.reset();
    this.resetRhythm();
    this.pendingKick = null;
    this.snareOnset.reset();
    this.hatOnset.reset();
    this.refDb = -40;
    this.f0 = 0;
    this.microVariation = 0;
    this.vocalness = 0;
    this.lastMelodyMidi = -1;
    this.melodyEnv = this.vocalEnv = this.bassEnv = this.drumsEnv = 0;
    this.onsetRate = 0;
    this.activity = 0;
    this.moodLabel.reset();
    this.loudnessDb = -60;
    this.centroid = 800;
    this.valence = 0.5;
    this.arousal = 0.4;
    this.heardSeconds = 0;
    this.features.moodConfidence = 0;
    this.features.mood = 'calm';
  }

  process(frame: SpectrumFrame, dt: number): Features {
    const f = this.features;
    f.time += dt;
    f.dt = dt;
    f.reduceFlash = this.guard.reduce;

    this.frame = frame;
    const loudDb = this.computeBands(frame);
    const active = loudDb > -68;
    f.active = active;

    if (loudDb > this.refDb) this.refDb = loudDb;
    else this.refDb += -dt * 0.35;
    this.refDb = Math.max(this.refDb, -60);

    this.separate();
    const percussiveFlux = this.detectDrums(dt, active);
    this.beatTracker.update(f.attack, dt, active);
    f.bpm = this.beatTracker.bpm;
    f.beatPhase = this.beatTracker.phase;
    f.beatConfidence = this.beatTracker.confidence;
    this.findPeaks(frame.midLong, loudDb);
    this.trackPitched(dt, active);
    this.computeLevels(dt, active, percussiveFlux);
    this.updateSpectrum(loudDb);
    this.updateMood(dt, active, loudDb);

    f.pulse = this.guard.update(f.kick || f.snare * 0.7, dt);
    this.prevDb.set(this.midDb);
    return f;
  }

  /** Seeking breaks tempo history, but should not erase the song's mood estimate. */
  resetRhythm() {
    this.beatTracker.reset();
    this.features.attack = this.features.bpm = this.features.beatPhase = this.features.beatConfidence = 0;
  }

  private computeBands(frame: SpectrumFrame): number {
    const { midShort, sideShort } = frame;
    let total = 0;
    let weighted = 0;
    let weightSum = 0;
    for (let b = 0; b < BAND_COUNT; b++) {
      let mid = 0;
      let side = 0;
      const lo = this.bandLo[b];
      const hi = Math.min(this.bandHi[b], midShort.length);
      for (let i = lo; i < hi; i++) {
        mid += dbToPower(midShort[i]);
        side += dbToPower(sideShort[i]);
      }
      total += mid;
      const n = Math.max(1, hi - lo);
      mid /= n;
      side /= n;
      this.midMag[b] = Math.sqrt(mid);
      this.midDb[b] = powerToDb(mid);
      this.sideDb[b] = powerToDb(side);
      weighted += mid * n * this.bandHz[b];
      weightSum += mid * n;
    }
    if (weightSum > 1e-12) {
      this.centroid += 0.05 * (weighted / weightSum - this.centroid);
    }
    return powerToDb(total);
  }

  /** Median filtering: smooth over time is harmonic, smooth over frequency is percussive. */
  private separate() {
    const row = this.history[this.historyPos];
    row.set(this.midMag);
    this.historyPos = (this.historyPos + 1) % HISTORY;
    for (let b = 0; b < BAND_COUNT; b++) {
      for (let i = 0; i < HISTORY; i++) this.temp[i] = this.history[i][b];
      const h = medianOf(this.temp, HISTORY);
      let n = 0;
      const start = Math.max(0, b - FREQ_MEDIAN_RADIUS);
      const end = Math.min(BAND_COUNT - 1, b + FREQ_MEDIAN_RADIUS);
      for (let k = start; k <= end; k++) this.temp[n++] = this.midMag[k];
      const p = medianOf(this.temp, n);
      const hh = h * h;
      const pp = p * p;
      this.harmonicMask[b] = hh + pp > 1e-18 ? hh / (hh + pp) : 1;
    }
  }

  private percussiveFlux(loHz: number, hiHz: number): number {
    let sum = 0;
    let n = 0;
    let broad = 0;
    for (let b = 0; b < BAND_COUNT; b++) {
      const hz = this.bandHz[b];
      if (hz < loHz || hz > hiHz) continue;
      const rise = this.midDb[b] - this.prevDb[b];
      if (rise > 0) sum += rise * (1 - this.harmonicMask[b]);
      // Quiet bands flicker all the time, so only audible, percussive bands count.
      if (rise > 3 && this.harmonicMask[b] < 0.5 && this.midDb[b] > this.refDb - 48) broad++;
      n++;
    }
    this.fluxBreadth = n ? broad / n : 0;
    return n ? sum / n : 0;
  }

  private bandEnergyDb(loHz: number, hiHz: number): number {
    let sum = 0;
    for (let b = 0; b < BAND_COUNT; b++) {
      const hz = this.bandHz[b];
      if (hz >= loHz && hz <= hiHz) sum += this.midMag[b] * this.midMag[b];
    }
    return powerToDb(sum);
  }

  private detectDrums(dt: number, active: boolean): number {
    const f = this.features;
    const low = this.percussiveFlux(35, 150);
    const mid = this.percussiveFlux(200, 5000);
    // A plucked note rises in a few narrow bands. A drum rises across most of them.
    const midBroad = this.fluxBreadth > 0.4;
    const high = this.percussiveFlux(6000, 14000);
    const highBroad = this.fluxBreadth > 0.3;
    const k = this.kickOnset.update(low, dt);
    const s = this.snareOnset.update(mid, dt);
    const h = this.hatOnset.update(high, dt);

    const lowDb = this.bandEnergyDb(35, 150);
    const lowEnough = lowDb > this.refDb - 26;
    const midEnough = this.bandEnergyDb(200, 5000) > this.refDb - 30;
    const highEnough = this.bandEnergyDb(6000, 14000) > this.refDb - 42;
    f.snare = active && midEnough && midBroad ? s : 0;
    // Low-frequency onset is available now; confirmed kick still waits to distinguish bass.
    f.attack = active ? Math.max(lowEnough ? k : 0, f.snare) : 0;
    f.hat = active && highEnough && highBroad ? h : 0;

    // A bass note starts just like a kick, then holds. So wait for the fall, which takes
    // only a few tens of milliseconds and keeps the hit in step with the eye.
    f.kick = 0;
    if (active && lowEnough && k > 0 && !this.pendingKick) {
      this.pendingKick = { strength: k, peak: lowDb, age: 0 };
    }
    const p = this.pendingKick;
    if (p) {
      p.age += dt;
      p.peak = Math.max(p.peak, lowDb);
      if (p.peak - lowDb >= KICK_FALL_DB) {
        f.kick = p.strength;
        this.pendingKick = null;
      } else if (p.age > KICK_WAIT_SECONDS) {
        this.pendingKick = null;
      }
    }
    return low * 0.5 + mid + high * 0.4;
  }

  private findPeaks(mid: Float32Array, loudDb: number) {
    const peaks = this.peaks;
    peaks.length = 0;
    const lo = Math.max(2, Math.floor(70 / this.longHz));
    const hi = Math.min(mid.length - 2, Math.ceil(5200 / this.longHz));
    const floor = Math.max(loudDb - 42, -95);
    for (let i = lo; i < hi; i++) {
      const v = mid[i];
      if (v < floor || v < mid[i - 1] || v <= mid[i + 1]) continue;
      const a = mid[i - 1];
      const c = mid[i + 1];
      const denom = a - 2 * v + c;
      const shift = denom !== 0 ? (0.5 * (a - c)) / denom : 0;
      const hz = (i + Math.max(-0.5, Math.min(0.5, shift))) * this.longHz;
      if (this.harmonicMaskAt(hz) < 0.35) continue;
      peaks.push({ hz, db: v, mag: Math.pow(10, v / 20) });
    }
    peaks.sort((x, y) => y.db - x.db);
    if (peaks.length > 28) peaks.length = 28;
  }

  private bandIndex(hz: number): number {
    const ratio = Math.log(hz / BAND_MIN_HZ) / Math.log(BAND_MAX_HZ / BAND_MIN_HZ);
    return Math.max(0, Math.min(BAND_COUNT - 1, Math.floor(ratio * BAND_COUNT)));
  }

  private harmonicMaskAt(hz: number): number {
    return this.harmonicMask[this.bandIndex(hz)];
  }

  /** How much of a frequency sits in the centre of the stereo field. */
  private centreAt(hz: number): number {
    const { midShort, sideShort } = this.frame!;
    const bin = Math.round(hz / this.shortHz);
    const lo = Math.max(0, bin - 1);
    const hi = Math.min(midShort.length - 1, bin + 1);
    let mid = FLOOR_DB;
    let side = FLOOR_DB;
    for (let i = lo; i <= hi; i++) {
      if (midShort[i] > mid) mid = midShort[i];
      if (sideShort[i] > side) side = sideShort[i];
    }
    return smoothstep(2, 12, mid - side);
  }

  private magNear(hz: number): number {
    let best = 0;
    for (const p of this.peaks) {
      if (Math.abs(1200 * Math.log2(p.hz / hz)) < 45 && p.mag > best) best = p.mag;
    }
    return best;
  }

  /** Finds the strongest centre-panned harmonic series in the singing range. */
  private findVoice(): { hz: number; strength: number } {
    let bestHz = 0;
    let best = 0;
    for (const p of this.peaks) {
      if (p.hz < 120 || p.hz > 950) continue;
      if (this.isHarmonicOf(p.hz, this.bassPeakHz)) continue;
      let score = 0;
      for (let k = 1; k <= 5; k++) score += this.magNear(p.hz * k) / k;
      score *= this.centreAt(p.hz);
      if (this.f0 > 0 && Math.abs(1200 * Math.log2(p.hz / this.f0)) < 150) score *= 1.3;
      if (score > best) {
        best = score;
        bestHz = p.hz;
      }
    }
    return { hz: bestHz, strength: best };
  }

  /** The lowest peak that is reasonably strong: the fundamental, not its louder overtone. */
  private findBass() {
    let strongest = 0;
    for (const p of this.peaks) if (p.hz < 260 && p.mag > strongest) strongest = p.mag;
    let lowest = 0;
    for (const p of this.peaks) {
      if (p.hz < 260 && p.mag > strongest * 0.3 && (lowest === 0 || p.hz < lowest)) lowest = p.hz;
    }
    this.bassPeakHz = lowest;
  }

  private isHarmonicOf(hz: number, f0: number): boolean {
    if (f0 <= 0) return false;
    const k = Math.round(hz / f0);
    return k >= 1 && k <= 8 && Math.abs(1200 * Math.log2(hz / (k * f0))) < 40;
  }

  private voiceDb = FLOOR_DB;
  private melodyDb = FLOOR_DB;
  private bassPeakHz = 0;

  private trackPitched(dt: number, active: boolean) {
    const f = this.features;
    f.melodyNote = 0;
    if (!active) {
      this.voiceDb = this.melodyDb = FLOOR_DB;
      this.f0 = 0;
      return;
    }

    this.findBass();
    const voice = this.findVoice();
    if (voice.hz > 0 && this.f0 > 0) {
      const cents = Math.abs(1200 * Math.log2(voice.hz / this.f0));
      // Big jumps are new notes. Small, constant movement is what a voice does.
      if (cents < 80) this.microVariation += (dt / 0.35) * (cents - this.microVariation);
    } else {
      this.microVariation *= Math.exp(-dt / 0.5);
    }
    this.f0 = voice.hz;
    const target = smoothstep(2.2, 7, this.microVariation);
    this.vocalness += (1 - Math.exp(-dt / 0.25)) * (target - this.vocalness);

    let voiceMag = 0;
    let melodyMag = 0;
    let melodyHz = 0;
    let melodyBest = 0;
    this.frameChroma.fill(0);
    const treatAsVoice = this.vocalness > 0.4;
    for (const p of this.peaks) {
      if (p.hz <= 2200) {
        const midi = hzToMidi(p.hz);
        const pc = ((Math.round(midi) % 12) + 12) % 12;
        this.frameChroma[pc] += Math.sqrt(p.mag) * (p.hz < 260 ? 1.6 : 1);
      }
      if (treatAsVoice && this.isHarmonicOf(p.hz, this.f0)) {
        voiceMag += p.mag * p.mag;
        continue;
      }
      if (p.hz < 280) continue;
      melodyMag += p.mag * p.mag;
      if (p.mag > melodyBest) {
        melodyBest = p.mag;
        melodyHz = p.hz;
      }
    }

    // Anything panned wide and sustained counts as melody even if it has no clean peak.
    let sidePower = 0;
    for (let b = 0; b < BAND_COUNT; b++) {
      const hz = this.bandHz[b];
      if (hz < 300 || hz > 6000) continue;
      const side = Math.pow(10, this.sideDb[b] / 10);
      sidePower += side * this.harmonicMask[b];
    }
    const widePower = sidePower * 0.5;

    this.voiceDb = powerToDb(voiceMag) + 6;
    this.melodyDb = powerToDb(melodyMag + widePower) + 3;

    if (voice.hz > 0 && treatAsVoice) {
      const midi = hzToMidi(voice.hz);
      f.vocalPitch += (1 - Math.exp(-dt / 0.06)) * (clamp01((midi - 36) / 60) - f.vocalPitch);
    }
    if (melodyHz > 0) {
      const midi = hzToMidi(melodyHz);
      f.melodyPitch += (1 - Math.exp(-dt / 0.04)) * (clamp01((midi - 36) / 60) - f.melodyPitch);
      const rounded = Math.round(midi);
      this.noteAge = rounded === this.noteCandidate ? this.noteAge + dt : 0;
      this.noteCandidate = rounded;
      this.sinceNote += dt;
      const repeated = this.melodyDb - this.lastMelodyDb > NOTE_REATTACK_DB;
      const changed = rounded !== this.lastMelodyMidi && this.noteAge >= NOTE_HOLD_SECONDS;
      if ((changed || repeated) && this.melodyEnv > 0.12 && this.sinceNote > NOTE_MIN_GAP_SECONDS) {
        f.melodyNote = Math.min(1, 0.4 + this.melodyEnv);
        f.melodyPitchClass = ((rounded % 12) + 12) % 12;
        this.lastMelodyMidi = rounded;
        this.sinceNote = 0;
      }
    }
    this.lastMelodyDb = this.melodyDb;
    if (this.bassPeakHz > 0) {
      const midi = hzToMidi(this.bassPeakHz);
      f.bassPitch += (1 - Math.exp(-dt / 0.08)) * (clamp01((midi - 24) / 36) - f.bassPitch);
    }
  }

  /** Level on a dB scale relative to the loudest moment heard, so quiet songs still draw. */
  private relativeLevel(db: number, offset: number, range: number): number {
    return clamp01((db - (this.refDb - offset - range)) / range);
  }

  private computeLevels(dt: number, active: boolean, flux: number) {
    const f = this.features;
    let bassTarget = 0;
    let vocalTarget = 0;
    let melodyTarget = 0;
    let drumsTarget = 0;
    if (active) {
      let bassPower = 0;
      for (let b = 0; b < BAND_COUNT; b++) {
        const hz = this.bandHz[b];
        if (hz < 35 || hz > 240) continue;
        const m = this.midMag[b] * this.harmonicMask[b];
        bassPower += m * m;
      }
      bassTarget = this.relativeLevel(powerToDb(bassPower), 2, 26);
      vocalTarget = this.relativeLevel(this.voiceDb, 6, 26) * smoothstep(0.1, 0.6, this.vocalness);
      melodyTarget = this.relativeLevel(this.melodyDb, 8, 26);
      drumsTarget = clamp01(flux / 9);
    }
    const hit = Math.max(f.kick, f.snare * 0.85, f.hat * 0.45);
    this.drumsEnv = Math.max(hit, this.drumsEnv * Math.exp(-dt / 0.14));
    f.drums = Math.max(this.drumsEnv, drumsTarget * 0.35 * this.drumsEnv);

    this.bassEnv = follow(this.bassEnv, bassTarget, dt, 0.03, 0.22);
    this.vocalEnv = follow(this.vocalEnv, vocalTarget, dt, 0.05, 0.25);
    this.melodyEnv = follow(this.melodyEnv, melodyTarget, dt, 0.03, 0.2);
    f.bass = this.bassEnv;
    f.vocal = this.vocalEnv;
    f.melody = this.melodyEnv;
    f.energy = active ? clamp01((this.loudnessDb + 45) / 30) : f.energy * Math.exp(-dt * 2);
  }

  private updateSpectrum(loudDb: number) {
    const s = this.features.spectrum;
    const top = Math.max(this.refDb, loudDb);
    for (let b = 0; b < BAND_COUNT; b++) {
      // High bands carry less energy per octave in almost all music.
      const tilted = this.midDb[b] + 3 * Math.log2(this.bandHz[b] / 200);
      const v = clamp01((tilted - (top - 62)) / 52);
      s[b] += (v > s[b] ? 0.6 : 0.14) * (v - s[b]);
    }
  }

  private updateMood(dt: number, active: boolean, loudDb: number) {
    const f = this.features;
    if (!active) return;
    this.heardSeconds += dt;
    const fast = this.heardSeconds < 6;
    const tau = fast ? 1.5 : 5;
    const a = 1 - Math.exp(-dt / tau);
    this.loudnessDb += a * (loudDb - this.loudnessDb);

    // How hard the sound is moving, in dB per second. Unlike counted onsets, this also sees
    // sustained brass or strings pushing forward, and it does not depend on recording level.
    let rise = 0;
    let audible = 0;
    for (let b = 0; b < BAND_COUNT; b++) {
      if (this.midDb[b] < this.refDb - 50) continue;
      audible++;
      const change = this.midDb[b] - this.prevDb[b];
      if (change > 0) rise += change;
    }
    if (audible > 0) this.activity += (1 - Math.exp(-dt / 4)) * (rise / audible / dt - this.activity);

    const events = (f.kick ? 1 : 0) + (f.snare ? 1 : 0) + (f.hat ? 0.5 : 0) + (f.melodyNote ? 0.5 : 0);
    this.onsetRate += (1 - Math.exp(-dt / 4)) * (events / dt - this.onsetRate);

    const chromaA = 1 - Math.exp(-dt / 10);
    let frameSum = 0;
    for (let i = 0; i < 12; i++) frameSum += this.frameChroma[i];
    if (frameSum > 0) {
      for (let i = 0; i < 12; i++) {
        this.chroma[i] += chromaA * (this.frameChroma[i] / frameSum - this.chroma[i]);
      }
    }

    const axes = moodAxes({
      loudnessDb: this.loudnessDb,
      onsetRate: this.onsetRate,
      centroidHz: this.centroid,
      mode: modeScore(this.chroma),
      activity: this.activity,
    });
    const moodA = 1 - Math.exp(-dt / (fast ? 0.8 : 4));
    this.valence += moodA * (axes.valence - this.valence);
    this.arousal += moodA * (axes.arousal - this.arousal);
    f.valence = this.valence;
    f.arousal = this.arousal;
    f.moodConfidence = clamp01((this.heardSeconds - 1) / 5);
    f.mood = this.moodLabel.update(f.valence, f.arousal, dt, fast);
  }
}

function follow(v: number, target: number, dt: number, attack: number, release: number) {
  const tau = target > v ? attack : release;
  return v + (1 - Math.exp(-dt / tau)) * (target - v);
}

function dbToPower(db: number): number {
  return db <= FLOOR_DB ? 1e-11 : Math.pow(10, db / 10);
}

function powerToDb(p: number): number {
  return p <= 1e-11 ? FLOOR_DB : 10 * Math.log10(p);
}
