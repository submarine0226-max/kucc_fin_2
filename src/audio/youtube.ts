export const YOUTUBE_MESSAGES = {
  unsupported: '이 브라우저는 탭 소리 공유를 지원하지 않아요. PC의 Chrome이나 Edge에서 열어 주세요.',
  context: '유튜브 연결은 https:// 또는 localhost에서 열어 주세요. 파일을 직접 열면 연결되지 않을 수 있어요.',
  cancelled: '공유를 취소했어요. 다시 열려면 열기를 눌러 주세요.',
  noAudio: '탭 오디오 공유가 꺼져 있어요. 켜고 다시 시도해 주세요.',
  wrongSurface: '소리결이 열린 이 탭을 선택하고 탭 오디오 공유를 켜 주세요.',
  stopped: '탭 공유가 끝났어요. 다시 보려면 곡을 다시 열어 주세요.',
  load: '유튜브 플레이어를 불러오지 못했어요. 인터넷 연결을 확인해 주세요.',
  autoplay: '플레이어의 재생 버튼을 눌러 주세요.',
  noSignal: '소리가 들어오지 않아요. 탭 오디오 공유를 켰는지 확인해 주세요.',
  capture: '탭 소리를 연결하지 못했어요. 이 탭과 탭 오디오 공유를 선택하고 다시 시도해 주세요.',
} as const;

export function youtubeErrorMessage(code: number): string {
  switch (code) {
    case 2: return '영상 주소를 읽지 못했어요. 링크를 다시 확인해 주세요.';
    case 5: return '이 영상은 재생할 수 없어요. 다른 영상으로 시도해 주세요.';
    case 100: return '영상을 찾지 못했어요. 링크를 다시 확인해 주세요.';
    case 101:
    case 150: return '이 영상은 다른 사이트에서 재생할 수 없어요. 다른 영상이나 파일로 시도해 주세요.';
    case 153: return '플레이어의 사이트 정보를 확인하지 못했어요. https:// 또는 localhost에서 열어 주세요.';
    default: return '유튜브 영상을 재생하지 못했어요. 다른 영상으로 시도해 주세요.';
  }
}

/** Options are hints: the browser's picker still requires the user to choose this tab. */
export const YOUTUBE_CAPTURE_OPTIONS = {
  video: { displaySurface: 'browser' },
  audio: {
    echoCancellation: false, noiseSuppression: false, autoGainControl: false,
    suppressLocalAudioPlayback: false,
  },
  preferCurrentTab: true,
  selfBrowserSurface: 'include',
  surfaceSwitching: 'exclude',
  systemAudio: 'exclude',
} as DisplayMediaStreamOptions;

/** Call synchronously from the submit/click handler, before any await. */
export function requestYouTubeCapture(): Promise<MediaStream> {
  if (location.protocol === 'file:' || !window.isSecureContext) throw new Error(YOUTUBE_MESSAGES.context);
  const ua = navigator.userAgent;
  if (!/(?:Chrome|Edg)\//.test(ua) || /Firefox|FxiOS|CriOS|EdgiOS|Android|Mobile/i.test(ua) ||
      typeof navigator.mediaDevices?.getDisplayMedia !== 'function') throw new Error(YOUTUBE_MESSAGES.unsupported);
  return navigator.mediaDevices.getDisplayMedia(YOUTUBE_CAPTURE_OPTIONS);
}

export function stopCapture(stream: MediaStream) {
  for (const track of stream.getTracks()) track.stop();
}

export function captureErrorMessage(error: unknown): string {
  if (error instanceof DOMException && error.name === 'NotAllowedError') return YOUTUBE_MESSAGES.cancelled;
  if (error instanceof Error && Object.values(YOUTUBE_MESSAGES).some((message) => message === error.message)) return error.message;
  return YOUTUBE_MESSAGES.capture;
}

interface PlayerApi {
  playVideo(): void;
  pauseVideo(): void;
  seekTo(seconds: number, allowSeekAhead: boolean): void;
  getCurrentTime(): number;
  getDuration(): number;
  getIframe(): HTMLIFrameElement;
  destroy(): void;
}
interface PlayerEvent { target: PlayerApi; data: number }
interface YouTubeApi {
  Player: new (element: HTMLElement, options: {
    width: string; height: string; videoId: string;
    playerVars: { autoplay: number; controls: number; playsinline: number; origin: string };
    events: {
      onReady(event: PlayerEvent): void;
      onStateChange(event: PlayerEvent): void;
      onError(event: PlayerEvent): void;
      onAutoplayBlocked(): void;
    };
  }) => PlayerApi;
}
declare global {
  interface Window {
    YT?: YouTubeApi;
    onYouTubeIframeAPIReady?: () => void;
  }
}

let apiPromise: Promise<YouTubeApi> | null = null;

function loadApi(): Promise<YouTubeApi> {
  if (window.YT?.Player) return Promise.resolve(window.YT);
  if (apiPromise) return apiPromise;
  apiPromise = new Promise<YouTubeApi>((resolve, reject) => {
    const script = document.createElement('script');
    script.src = 'https://www.youtube.com/iframe_api';
    script.async = true;
    const previous = window.onYouTubeIframeAPIReady;
    const cleanup = () => {
      window.clearTimeout(timer);
      script.onerror = null;
      if (window.onYouTubeIframeAPIReady === ready) window.onYouTubeIframeAPIReady = previous;
    };
    const fail = () => {
      cleanup();
      script.remove();
      apiPromise = null;
      reject(new Error(YOUTUBE_MESSAGES.load));
    };
    const ready = () => {
      cleanup();
      if (window.YT?.Player) resolve(window.YT);
      else { apiPromise = null; reject(new Error(YOUTUBE_MESSAGES.load)); }
      previous?.();
    };
    const timer = window.setTimeout(fail, 15000);
    script.onerror = fail;
    window.onYouTubeIframeAPIReady = ready;
    document.head.append(script);
  });
  return apiPromise;
}

export class YouTubePlayer {
  private api: PlayerApi | null = null;
  private readonly host = document.createElement('div');
  private disposed = false;
  private ready = false;
  private readyTimer = 0;
  private rejectReady: ((error: Error) => void) | null = null;
  state = -1;

  constructor(container: HTMLElement, private readonly callbacks: {
    onStateChange(): void;
    onError(message: string): void;
    onAutoplayBlocked(): void;
  }) {
    container.replaceChildren(this.host);
  }

  async load(videoId: string) {
    const yt = await loadApi();
    if (this.disposed) throw new Error('disposed');
    await new Promise<void>((resolve, reject) => {
      this.rejectReady = reject;
      const fail = (message: string) => {
        window.clearTimeout(this.readyTimer);
        this.rejectReady = null;
        reject(new Error(message));
      };
      this.readyTimer = window.setTimeout(() => fail(YOUTUBE_MESSAGES.load), 15000);
      this.api = new yt.Player(this.host, {
        width: '320', height: '200', videoId,
        playerVars: { autoplay: 1, controls: 1, playsinline: 1, origin: location.origin },
        events: {
          onReady: (event) => {
            if (this.disposed) { event.target.destroy(); return; }
            window.clearTimeout(this.readyTimer);
            this.rejectReady = null;
            this.ready = true;
            const iframe = event.target.getIframe();
            iframe.title = '유튜브 음악 플레이어';
            iframe.referrerPolicy = 'strict-origin-when-cross-origin';
            iframe.setAttribute('allow', 'autoplay; encrypted-media; fullscreen; picture-in-picture');
            resolve();
            event.target.playVideo();
          },
          onStateChange: (event) => {
            if (this.disposed) return;
            this.state = event.data;
            this.callbacks.onStateChange();
          },
          onError: (event) => {
            if (this.disposed) return;
            const message = youtubeErrorMessage(event.data);
            if (!this.ready) fail(message);
            else this.callbacks.onError(message);
          },
          onAutoplayBlocked: () => { if (!this.disposed) this.callbacks.onAutoplayBlocked(); },
        },
      });
    });
  }

  get paused() { return this.state !== 1 && this.state !== 3; }
  get currentTime() { return this.ready && !this.disposed ? this.api?.getCurrentTime() ?? 0 : 0; }
  get duration() { return this.ready && !this.disposed ? this.api?.getDuration() ?? 0 : 0; }
  play() { if (this.ready && !this.disposed) this.api?.playVideo(); }
  pause() { if (this.ready && !this.disposed) this.api?.pauseVideo(); }
  seek(time: number) { if (this.ready && !this.disposed && Number.isFinite(time)) this.api?.seekTo(Math.max(0, time), true); }
  destroy() {
    if (this.disposed) return;
    this.disposed = true;
    window.clearTimeout(this.readyTimer);
    this.rejectReady?.(new Error('disposed'));
    this.rejectReady = null;
    this.api?.destroy();
    this.api = null;
    this.host.remove();
  }
}
