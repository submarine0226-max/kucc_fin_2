/** Online tempo and beat phase, independent of rendering and brightness limits. */
export class BeatTracker {
  bpm = 0;
  phase = 0;
  confidence = 0;
  private time = 0;
  private sinceEstimate = 0;
  private silent = 0;
  private events: { time: number; strength: number }[] = [];

  reset() {
    this.bpm = this.phase = this.confidence = 0;
    this.time = this.sinceEstimate = this.silent = 0;
    this.events = [];
  }

  update(attack: number, dt: number, active: boolean) {
    this.time += dt;
    this.sinceEstimate += dt;
    this.silent = active ? 0 : this.silent + dt;
    if (this.silent > 0.75) {
      this.reset();
      return;
    }
    if (this.bpm > 0 && active) this.phase = (this.phase + dt * this.bpm / 60) % 1;
    const last = this.events[this.events.length - 1];
    if (active && attack > 0 && (!last || this.time - last.time >= 0.09)) {
      this.events.push({ time: this.time, strength: attack });
      this.events = this.events.filter((event) => this.time - event.time < 8);
      // Offbeat notes are evidence for tempo, but must not drag the beat onto every subdivision.
      const error = this.phase > 0.5 ? this.phase - 1 : this.phase;
      if (this.confidence > 0.5 && Math.abs(error) < 0.18) {
        this.phase = (this.phase - error * 0.3 + 1) % 1;
      }
      if (this.sinceEstimate >= 0.25 && this.events.length >= 4) {
        this.estimate();
        this.sinceEstimate = 0;
      }
    }
    const latest = this.events[this.events.length - 1];
    if (latest && this.time - latest.time > Math.max(1.5, 120 / Math.max(60, this.bpm))) {
      this.confidence *= Math.exp(-dt * 2);
      if (this.confidence < 0.1) this.bpm = 0;
    }
    if (!active) this.confidence *= Math.exp(-dt * 4);
  }

  private estimate() {
    let bestBpm = 0;
    let bestScore = 0;
    let bestAlignment = 0;
    for (let bpm = 60; bpm <= 200; bpm++) {
      const period = 60 / bpm;
      let score = 0;
      let aligned = 0;
      let total = 0;
      for (let i = 1; i < this.events.length; i++) {
        const newer = this.events[i];
        const recency = Math.exp(-(this.time - newer.time) / 2);
        for (let j = Math.max(0, i - 8); j < i; j++) {
          const older = this.events[j];
          const interval = newer.time - older.time;
          // Compare the same time horizon at every tempo; a beat-count limit otherwise favors slow candidates.
          if (interval > 2.4) continue;
          const cycles = interval / period;
          const beats = Math.round(cycles * 2) / 2;
          if (beats < 0.5 || beats > 8) continue;
          const error = Math.abs(cycles - beats);
          // Half-beat syncopations support a tempo, but full beats carry more evidence.
          const subdivision = Number.isInteger(beats) ? 1 : 0.35;
          const weight = recency * Math.sqrt(newer.strength * older.strength) * subdivision / Math.sqrt(Math.max(1, beats));
          const match = Math.exp(-0.5 * (error / 0.065) ** 2);
          score += weight * match;
          aligned += weight * match;
          total += weight;
        }
      }
      // A small continuity preference prevents switching between nearly equal tempo candidates.
      if (this.bpm > 0 && Math.abs(bpm - this.bpm) < 4) score *= 1.04;
      if (score > bestScore) {
        bestScore = score;
        bestBpm = bpm;
        bestAlignment = total > 0 ? aligned / total : 0;
      }
    }
    const confidence = bestAlignment * Math.min(1, (this.events.length - 2) / 5);
    if (confidence < 0.45) {
      this.confidence *= 0.8;
      return;
    }
    const acquired = this.bpm === 0 || this.confidence < 0.3;
    if (acquired) {
      this.bpm = bestBpm;
      this.phase = 0; // The estimate runs on an observed onset, so this is a real beat anchor.
    } else {
      this.bpm += (bestBpm - this.bpm) * (Math.abs(bestBpm - this.bpm) > 8 ? 0.35 : 0.2);
    }
    this.confidence = confidence;
  }
}
