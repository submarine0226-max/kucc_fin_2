export interface AudioLease { stream: MediaStream; release(): void }
export type ExportRatio = 'portrait' | 'square' | 'screen';

export function capturedRecordingAudio(capture: MediaStream): AudioLease {
  const source = capture.getAudioTracks().find((track) => track.readyState === 'live');
  if (!source) throw new Error('탭 오디오 연결을 확인해 주세요.');
  const track = source.clone();
  return { stream: new MediaStream([track]), release: () => track.stop() };
}

export function exportSize(ratio: ExportRatio, width: number, height: number): [number, number] {
  if (ratio === 'portrait') return [720, 1280];
  if (ratio === 'square') return [1080, 1080];
  const scale = Math.min(1, 1280 / Math.max(width, height));
  return [Math.max(2, Math.round(width * scale / 2) * 2), Math.max(2, Math.round(height * scale / 2) * 2)];
}

export function recordingType(supports: (type: string) => boolean): string {
  return ['video/mp4;codecs=avc1.42E01E,mp4a.40.2', 'video/mp4',
    'video/webm;codecs=vp8,opus', 'video/webm'].find(supports) ?? '';
}

/** Copies frames immediately after rendering, before WebGL discards its drawing buffer. */
export class VideoExport {
  private readonly dialog = document.getElementById('export-dialog') as HTMLDialogElement;
  private readonly preview = document.getElementById('export-preview') as HTMLVideoElement;
  private readonly status = document.getElementById('export-status')!;
  private readonly bar = document.getElementById('recording-bar')!;
  private recorder: MediaRecorder | null = null;
  private audio: AudioLease | null = null;
  private stream: MediaStream | null = null;
  private canvas: HTMLCanvasElement | null = null;
  private timer = 0;
  private started = 0;
  private seconds = 15;
  private url: string | null = null;
  private session = 0;

  constructor(private readonly options: {
    stage: HTMLElement;
    filter?(): string;
    playing(): boolean;
    pause(): void;
    audio(): AudioLease;
  }) {
    document.getElementById('open-export')!.addEventListener('click', () => this.open());
    document.getElementById('close-export')!.addEventListener('click', () => this.close());
    document.getElementById('start-export')!.addEventListener('click', () => this.start());
    document.getElementById('stop-export')!.addEventListener('click', () => this.stop());
    document.getElementById('retry-export')!.addEventListener('click', () => this.open());
    this.dialog.addEventListener('cancel', () => this.preview.pause());
    this.preview.addEventListener('play', () => this.options.pause());
    document.addEventListener('visibilitychange', () => {
      if (document.hidden && this.recorder?.state === 'recording') this.stop();
    });
    window.addEventListener('pagehide', () => this.cancel());
  }

  private clearResult() {
    this.preview.pause();
    this.preview.removeAttribute('src');
    this.preview.load();
    if (this.url) URL.revokeObjectURL(this.url);
    this.url = null;
    document.getElementById('export-download')!.removeAttribute('href');
  }

  private close() { this.preview.pause(); this.dialog.close(); }

  private open() {
    if (this.recorder) return;
    this.clearResult();
    document.getElementById('export-settings')!.hidden = false;
    document.getElementById('export-result')!.hidden = true;
    this.status.textContent = '';
    if (!this.dialog.open) this.dialog.show();
  }

  private start() {
    if (this.recorder) return;
    if (!this.options.playing()) {
      this.status.textContent = '음악을 먼저 재생한 뒤 녹화를 시작해 주세요.';
      return;
    }
    const session = ++this.session;
    try {
      if (typeof MediaRecorder === 'undefined' || !HTMLCanvasElement.prototype.captureStream) {
        throw new Error('이 브라우저는 영상 녹화를 지원하지 않아요. PC Chrome 또는 Edge를 사용해 주세요.');
      }
      const mimeType = recordingType((type) => MediaRecorder.isTypeSupported(type));
      if (!mimeType) throw new Error('소리 포함 영상으로 저장할 수 있는 형식이 없어요. 최신 Chrome 또는 Edge를 사용해 주세요.');
      this.seconds = Number((document.getElementById('export-duration') as HTMLSelectElement).value);
      const ratio = (document.getElementById('export-ratio') as HTMLSelectElement).value as ExportRatio;
      const bounds = this.options.stage.getBoundingClientRect();
      this.canvas = document.createElement('canvas');
      [this.canvas.width, this.canvas.height] = exportSize(ratio, bounds.width, bounds.height);
      const context = this.canvas.getContext('2d');
      if (!context) throw new Error('녹화 화면을 만들지 못했어요.');
      context.fillStyle = '#080d18';
      context.fillRect(0, 0, this.canvas.width, this.canvas.height);
      this.audio = this.options.audio();
      if (!this.audio.stream.getAudioTracks().some((track) => track.readyState === 'live')) {
        throw new Error('녹화할 오디오가 없어요. 음악 연결을 확인해 주세요.');
      }
      this.stream = this.canvas.captureStream(30);
      this.audio.stream.getAudioTracks().forEach((track) => this.stream!.addTrack(track));
      const recorder = new MediaRecorder(this.stream, {
        mimeType, videoBitsPerSecond: 6_000_000, audioBitsPerSecond: 192_000,
      });
      this.recorder = recorder;
      const chunks: Blob[] = [];
      let failed = false;
      recorder.ondataavailable = (event) => { if (event.data.size) chunks.push(event.data); };
      recorder.onerror = () => {
        if (session !== this.session) return;
        failed = true;
        this.status.textContent = '녹화 중 오류가 생겼어요. 다시 시도해 주세요.';
        this.stop();
      };
      recorder.onstop = () => {
        if (session !== this.session) return;
        const blob = new Blob(chunks, { type: recorder.mimeType || mimeType });
        this.release();
        if (!failed && blob.size) {
          this.url = URL.createObjectURL(blob);
          this.preview.src = this.url;
          const mp4 = blob.type.startsWith('video/mp4');
          const link = document.getElementById('export-download') as HTMLAnchorElement;
          link.href = this.url;
          link.download = `소리결-${Date.now()}.${mp4 ? 'mp4' : 'webm'}`;
          document.getElementById('export-settings')!.hidden = true;
          document.getElementById('export-result')!.hidden = false;
          document.getElementById('export-format')!.textContent = mp4
            ? 'MP4 · 소리 포함. 미리보기로 확인한 뒤 다운로드하세요.'
            : 'WebM · 소리 포함. 인스타그램 업로드에는 MP4 변환이 필요할 수 있어요.';
          this.status.textContent = '';
        } else if (!failed) this.status.textContent = '저장할 영상이 없어요. 다시 녹화해 주세요.';
        if (!this.dialog.open) this.dialog.show();
      };
      recorder.start(1000);
      this.started = performance.now();
      this.dialog.close();
      this.bar.hidden = false;
      this.updateTime();
      this.timer = window.setInterval(() => this.updateTime(), 200);
    } catch (error) {
      ++this.session;
      this.release();
      this.status.textContent = error instanceof Error ? error.message : '녹화를 시작하지 못했어요.';
      if (!this.dialog.open) this.dialog.show();
    }
  }

  private updateTime() {
    const elapsed = (performance.now() - this.started) / 1000;
    document.getElementById('recording-time')!.textContent = `소리 포함 녹화 중 · ${Math.min(this.seconds, Math.floor(elapsed))} / ${this.seconds}초`;
    if (elapsed >= this.seconds || !this.options.playing()) this.stop();
  }

  frame(source: HTMLCanvasElement) {
    if (!this.canvas || this.recorder?.state !== 'recording') return;
    try {
      const c = this.canvas.getContext('2d')!;
      const stage = this.options.stage.getBoundingClientRect();
      const bounds = source.getBoundingClientRect();
      const scale = Math.min(this.canvas.width / stage.width, this.canvas.height / stage.height);
      const x = (this.canvas.width - stage.width * scale) / 2;
      const y = (this.canvas.height - stage.height * scale) / 2;
      c.fillStyle = '#080d18';
      c.fillRect(0, 0, this.canvas.width, this.canvas.height);
      c.save();
      c.beginPath();
      c.rect(x, y, stage.width * scale, stage.height * scale);
      c.clip();
      c.filter = this.options.filter?.() ?? 'none';
      c.drawImage(source, x + (bounds.left - stage.left) * scale, y + (bounds.top - stage.top) * scale,
        bounds.width * scale, bounds.height * scale);
      c.restore();
    } catch {
      this.cancel();
      this.status.textContent = '그림을 녹화하지 못했어요. 다시 시도해 주세요.';
      this.dialog.show();
    }
  }

  private stop() {
    window.clearInterval(this.timer);
    if (this.recorder?.state === 'recording') {
      document.getElementById('recording-time')!.textContent = '영상을 마무리하고 있어요…';
      this.recorder.stop();
    }
  }

  private release() {
    window.clearInterval(this.timer);
    this.stream?.getTracks().forEach((track) => track.stop());
    this.audio?.release();
    this.audio = null;
    this.stream = null;
    this.canvas = null;
    this.recorder = null;
    this.bar.hidden = true;
  }

  cancel() {
    ++this.session;
    if (this.recorder && this.recorder.state !== 'inactive') this.recorder.stop();
    this.release();
    this.clearResult();
    this.dialog.close();
  }
}
