import { Analyzer, type SpectrumFrame } from './analyzer';

const SHORT_FFT = 2048;
const LONG_FFT = 4096;

/**
 * Owns the audio element and graph. Analysis taps the signal before the volume
 * control, so turning the sound all the way down leaves the visuals untouched.
 */
export class AudioEngine {
  readonly el = new Audio();
  analyzer: Analyzer | null = null;

  private ctx: AudioContext | null = null;
  private master: GainNode | null = null;
  private analysisInput: GainNode | null = null;
  private fileSource: MediaElementAudioSourceNode | null = null;
  private streamSource: MediaStreamAudioSourceNode | null = null;
  streamChannelCount: number | null = null;
  private midShort: AnalyserNode | null = null;
  private sideShort: AnalyserNode | null = null;
  private midLong: AnalyserNode | null = null;
  private frame: SpectrumFrame | null = null;
  private volume = 1;

  constructor() {
    this.el.crossOrigin = 'anonymous';
    this.el.preload = 'auto';
  }

  /** Must run inside a user gesture the first time, because of autoplay rules. */
  async unlock() {
    if (!this.ctx) this.build();
    if (this.ctx!.state !== 'running') await this.ctx!.resume();
  }

  private build() {
    const ctx = new AudioContext();
    this.ctx = ctx;
    const source = ctx.createMediaElementSource(this.el);
    this.fileSource = source;
    this.analysisInput = ctx.createGain();
    // A splitter leaves channel 2 silent for mono input, so left minus right would equal left and
    // every sound would look panned wide. Up-mixing makes mono correctly read as centred.
    this.analysisInput.channelCount = 2;
    this.analysisInput.channelCountMode = 'explicit';
    this.analysisInput.channelInterpretation = 'speakers';
    source.connect(this.analysisInput);

    const splitter = ctx.createChannelSplitter(2);
    this.analysisInput.connect(splitter);

    const mid = ctx.createGain();
    const side = ctx.createGain();
    const leftToMid = ctx.createGain();
    const rightToMid = ctx.createGain();
    const leftToSide = ctx.createGain();
    const rightToSide = ctx.createGain();
    leftToMid.gain.value = 0.5;
    rightToMid.gain.value = 0.5;
    leftToSide.gain.value = 0.5;
    rightToSide.gain.value = -0.5;
    splitter.connect(leftToMid, 0);
    splitter.connect(rightToMid, 1);
    splitter.connect(leftToSide, 0);
    splitter.connect(rightToSide, 1);
    leftToMid.connect(mid);
    rightToMid.connect(mid);
    leftToSide.connect(side);
    rightToSide.connect(side);

    const make = (size: number) => {
      const a = ctx.createAnalyser();
      a.fftSize = size;
      a.smoothingTimeConstant = 0;
      a.minDecibels = -120;
      return a;
    };
    this.midShort = make(SHORT_FFT);
    this.sideShort = make(SHORT_FFT);
    this.midLong = make(LONG_FFT);
    mid.connect(this.midShort);
    mid.connect(this.midLong);
    side.connect(this.sideShort);

    this.master = ctx.createGain();
    this.master.gain.value = this.volume;
    source.connect(this.master);
    this.master.connect(ctx.destination);

    this.frame = {
      midShort: new Float32Array(SHORT_FFT / 2),
      sideShort: new Float32Array(SHORT_FFT / 2),
      midLong: new Float32Array(LONG_FFT / 2),
    };
    this.analyzer = new Analyzer({
      sampleRate: ctx.sampleRate,
      shortBins: SHORT_FFT / 2,
      longBins: LONG_FFT / 2,
    });
  }

  setVolume(v: number) {
    this.volume = v;
    if (this.master) this.master.gain.value = v;
  }

  /** A recording-only output. Never connects captured tab sound to speakers. */
  recordingAudio() {
    if (!this.ctx || !this.master) throw new Error('음악을 먼저 재생해 주세요.');
    const output = this.ctx.createMediaStreamDestination();
    const master = this.master;
    master.connect(output);
    let released = false;
    return {
      stream: output.stream,
      release() {
        if (released) return;
        released = true;
        master.disconnect(output);
        output.stream.getTracks().forEach((track) => track.stop());
      },
    };
  }

  /** The capture is analyzed only. Replaying it would feed this tab back into itself. */
  attachStream(stream: MediaStream) {
    const audio = stream.getAudioTracks().find((track) => track.readyState === 'live');
    if (!audio) throw new Error('탭 오디오 공유가 꺼져 있어요. 켜고 다시 시도해 주세요.');
    this.el.pause();
    if (!this.ctx) this.build();
    this.detachStream();
    const node = this.ctx!.createMediaStreamSource(stream);
    this.fileSource!.disconnect(this.analysisInput!);
    node.connect(this.analysisInput!);
    this.streamSource = node;
    this.streamChannelCount = audio.getSettings().channelCount ?? null;
  }

  detachStream() {
    if (!this.streamSource) return;
    this.streamSource.disconnect();
    this.streamSource = null;
    this.streamChannelCount = null;
    this.fileSource!.connect(this.analysisInput!);
  }

  /** Reads the current spectra and runs one analysis step. */
  analyse(dt: number) {
    if (!this.analyzer || !this.frame) return null;
    this.midShort!.getFloatFrequencyData(this.frame.midShort);
    this.sideShort!.getFloatFrequencyData(this.frame.sideShort);
    this.midLong!.getFloatFrequencyData(this.frame.midLong);
    return this.analyzer.process(this.frame, dt);
  }
}
