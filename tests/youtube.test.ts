import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { captureErrorMessage, requestYouTubeCapture, stopCapture, YouTubePlayer, youtubeErrorMessage, YOUTUBE_CAPTURE_OPTIONS, YOUTUBE_MESSAGES } from '../src/audio/youtube';

type Options = ConstructorParameters<NonNullable<Window['YT']>['Player']>[1];
class Element {
  children: Element[] = [];
  removed = false;
  title = '';
  referrerPolicy = '';
  attributes: Record<string, string> = {};
  onerror: (() => void) | null = null;
  append(child: Element) { this.children.push(child); }
  replaceChildren(...children: Element[]) { this.children = children; }
  remove() { this.removed = true; }
  setAttribute(key: string, value: string) { this.attributes[key] = value; }
}

function harness(autoReady = true) {
  const head = new Element();
  const iframe = new Element();
  const callbacks = { onStateChange: vi.fn(), onError: vi.fn(), onAutoplayBlocked: vi.fn() };
  const api = {
    playVideo: vi.fn(), pauseVideo: vi.fn(), seekTo: vi.fn(),
    getCurrentTime: () => 12.5, getDuration: () => 180,
    getIframe: () => iframe as unknown as HTMLIFrameElement, destroy: vi.fn(),
  };
  let events: Options['events'];
  const constructor = vi.fn(function (_element: HTMLElement, options: Options) {
    events = options.events;
    if (autoReady) void Promise.resolve().then(() => options.events.onReady({ target: api, data: 0 }));
    return api;
  });
  const yt = { Player: constructor as unknown as NonNullable<Window['YT']>['Player'] };
  const devices = { getDisplayMedia: vi.fn().mockResolvedValue({}) };
  vi.stubGlobal('window', { YT: yt, isSecureContext: true, setTimeout, clearTimeout });
  vi.stubGlobal('location', { protocol: 'https:', origin: 'https://app.test' });
  vi.stubGlobal('navigator', { userAgent: 'Mozilla/5.0 Chrome/140.0.0.0 Safari/537.36', mediaDevices: devices });
  vi.stubGlobal('document', { head, createElement: () => new Element() });
  const container = new Element();
  const player = new YouTubePlayer(container as unknown as HTMLElement, callbacks);
  return { player, api, callbacks, iframe, head, constructor, yt, devices, getEvents: () => events! };
}
beforeEach(() => vi.useFakeTimers());
afterEach(() => { vi.useRealTimers(); vi.unstubAllGlobals(); });

describe('YouTube capture request', () => {
  it('requests capture synchronously with current-tab hints and original local playback retained', async () => {
    const { devices } = harness();
    const result = requestYouTubeCapture();
    expect(devices.getDisplayMedia).toHaveBeenCalledWith(YOUTUBE_CAPTURE_OPTIONS);
    expect(YOUTUBE_CAPTURE_OPTIONS.video).toEqual({ displaySurface: 'browser' });
    expect(YOUTUBE_CAPTURE_OPTIONS.audio).toMatchObject({ suppressLocalAudioPlayback: false, echoCancellation: false });
    await result;
  });
  it.each(['Mozilla/5.0 Firefox/140.0', 'Mozilla/5.0 Version/18.0 Safari/605.1.15'])(
    'rejects unsupported %s without requesting sharing', (ua) => {
      const { devices } = harness();
      vi.stubGlobal('navigator', { userAgent: ua, mediaDevices: devices });
      expect(() => requestYouTubeCapture()).toThrow(YOUTUBE_MESSAGES.unsupported);
      expect(devices.getDisplayMedia).not.toHaveBeenCalled();
    },
  );
  it('explains why a double-clicked file cannot be used for YouTube', () => {
    const { devices } = harness();
    vi.stubGlobal('location', { protocol: 'file:', origin: 'null' });
    expect(() => requestYouTubeCapture()).toThrow(YOUTUBE_MESSAGES.context);
    expect(devices.getDisplayMedia).not.toHaveBeenCalled();
  });
  it('stops every capture track and explains cancellation', () => {
    const video = { stop: vi.fn() }, audio = { stop: vi.fn() };
    stopCapture({ getTracks: () => [video, audio] } as unknown as MediaStream);
    expect(video.stop).toHaveBeenCalledOnce();
    expect(audio.stop).toHaveBeenCalledOnce();
    expect(captureErrorMessage(new DOMException('Denied', 'NotAllowedError'))).toBe(YOUTUBE_MESSAGES.cancelled);
    expect(captureErrorMessage(new Error(YOUTUBE_MESSAGES.noAudio))).toBe(YOUTUBE_MESSAGES.noAudio);
  });
});

describe('YouTube player adapter (mock API, not an actual shared-tab test)', () => {
  it('wraps playback, seek, time, duration, state and autoplay-block notifications', async () => {
    const { player, api, callbacks, iframe, getEvents } = harness();
    await player.load('cpEeqACsF_Q');
    expect(api.playVideo).toHaveBeenCalledOnce();
    expect(player.currentTime).toBe(12.5);
    expect(player.duration).toBe(180);
    player.play(); player.pause(); player.seek(35);
    expect(api.pauseVideo).toHaveBeenCalledOnce();
    expect(api.seekTo).toHaveBeenCalledWith(35, true);
    getEvents().onStateChange({ target: api, data: 1 });
    expect(player.paused).toBe(false);
    getEvents().onStateChange({ target: api, data: 0 });
    expect(player.state).toBe(0);
    expect(player.paused).toBe(true);
    getEvents().onAutoplayBlocked();
    expect(callbacks.onAutoplayBlocked).toHaveBeenCalledOnce();
    expect(iframe.referrerPolicy).toBe('strict-origin-when-cross-origin');
    player.destroy();
  });
  it('reports embed failures and ignores late events after disposal', async () => {
    const { player, api, callbacks, getEvents } = harness();
    await player.load('cpEeqACsF_Q');
    getEvents().onError({ target: api, data: 101 });
    expect(callbacks.onError).toHaveBeenCalledWith(youtubeErrorMessage(101));
    player.destroy(); player.destroy();
    getEvents().onStateChange({ target: api, data: 1 });
    expect(callbacks.onStateChange).not.toHaveBeenCalled();
    expect(api.destroy).toHaveBeenCalledOnce();
    expect(player.currentTime).toBe(0);
    expect(player.duration).toBe(0);
  });
  it('does not mount a player if navigation cancels before API readiness', async () => {
    const { player, constructor } = harness();
    const loading = player.load('cpEeqACsF_Q');
    player.destroy();
    await expect(loading).rejects.toThrow('disposed');
    expect(constructor).not.toHaveBeenCalled();
  });
  it('times out when the embedded player never becomes ready', async () => {
    const { player } = harness(false);
    const result = expect(player.load('cpEeqACsF_Q')).rejects.toThrow(YOUTUBE_MESSAGES.load);
    await vi.advanceTimersByTimeAsync(15001);
    await result;
    player.destroy();
  });
  it('loads the IFrame API once for concurrent requests and handles script load failure', async () => {
    vi.resetModules();
    const module = await import('../src/audio/youtube');
    const { head, yt, callbacks } = harness();
    window.YT = undefined;
    const first = new module.YouTubePlayer(new Element() as unknown as HTMLElement, callbacks);
    const second = new module.YouTubePlayer(new Element() as unknown as HTMLElement, callbacks);
    const a = first.load('cpEeqACsF_Q'), b = second.load('cpEeqACsF_Q');
    expect(head.children).toHaveLength(1);
    window.YT = yt;
    window.onYouTubeIframeAPIReady!();
    await Promise.all([a, b]);
    first.destroy(); second.destroy();

    vi.resetModules();
    const failedModule = await import('../src/audio/youtube');
    window.YT = undefined;
    const failed = new failedModule.YouTubePlayer(new Element() as unknown as HTMLElement, callbacks);
    const loading = failed.load('cpEeqACsF_Q');
    const assertion = expect(loading).rejects.toThrow(YOUTUBE_MESSAGES.load);
    head.children.at(-1)!.onerror!();
    await assertion;
    failed.destroy();
  });
  it.each([[2, '영상 주소'], [5, '재생할 수 없어요'], [100, '영상을 찾지 못했어요'], [101, '다른 사이트'], [150, '다른 사이트'], [153, '사이트 정보']] as const)(
    'maps error %s to an actionable message', (code, text) => expect(youtubeErrorMessage(code)).toContain(text),
  );
});
