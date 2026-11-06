import './styles.css';

import { AudioEngine } from './audio/engine';
import { emptyFeatures, idleFeatures, type ElementKey, type Features, type MoodKey } from './audio/features';
import { FlashMeter } from './audio/flashMeter';
import { SAMPLES, audioToWav, elementsAt, renderSample, tutorialSpec, type SampleSpec } from './audio/samples';
import { MESSAGES, checkUrl, isYouTubeUrl, parseYouTubeId, probeUrl, titleFromName, titleFromUrl } from './audio/source';
import { YouTubePlayer, YOUTUBE_MESSAGES, captureErrorMessage, requestYouTubeCapture, stopCapture } from './audio/youtube';
import { hasWebGL2 } from './visuals/gl';
import { InkVisual } from './visuals/ink';
import { TUTORIAL_STEPS, tutorialCopy } from './tutorial';
import { MIC_MESSAGES, micErrorMessage, requestMicrophone } from './audio/mic';
import { activeCue, decodeSubtitles, parseSubtitles, type Cue } from './audio/subtitles';
import { HapticPulse, supportsHaptics } from './audio/haptics';
import { DEFAULT_SCALE, ROOMY_SCALE, clampLegendScale, dragLegendScale, parseLegendScale } from './legendSize';
import { VISUALS } from './visuals/index';
import { CUSTOM_ID, DEFAULT_CUSTOM, PALETTES, nextPalette, normalizeCustom, paletteById, parseCustom } from './visuals/palette';
import type { Visual, VisualInfo } from './visuals/types';
import { VisualView } from './visuals/interaction';
import { VideoExport, capturedRecordingAudio } from './export/video';

const $ = <T extends HTMLElement>(id: string) => document.getElementById(id) as T;
const ELEMENT_NAMES: Record<ElementKey, string> = { drums: '드럼', bass: '베이스', vocal: '보컬', melody: '멜로디' };
const ELEMENT_ORDER: ElementKey[] = ['drums', 'bass', 'vocal', 'melody'];
const MOOD_LABELS: Record<MoodKey, string> = {
  joyful: '신나요',
  calm: '평온해요',
  sad: '슬퍼요',
  intense: '강렬해요',
};
// Each element keeps one shape across styles, so colour is never the only cue.
const GLYPHS: Record<ElementKey, string> = {
  drums: '<path d="M16 3 29 16 16 29 3 16Z" fill="currentColor"/>',
  bass: '<circle cx="16" cy="16" r="13" fill="currentColor"/>',
  vocal: '<circle cx="16" cy="16" r="10" fill="none" stroke="currentColor" stroke-width="5"/>',
  melody: '<path d="M16 4 29 27H3Z" fill="currentColor"/>',
};

const store = {
  get(key: string): string | null {
    try {
      return localStorage.getItem(key);
    } catch {
      return null;
    }
  },
  set(key: string, value: string) {
    try {
      localStorage.setItem(key, value);
    } catch {
      /* Preferences simply do not persist in this browser. */
    }
  },
};

const engine = new AudioEngine();
const el = engine.el;
interface Playback {
  readonly paused: boolean;
  readonly currentTime: number;
  readonly duration: number;
  play(): void | Promise<void>;
  pause(): void;
  seek(time: number): void;
}
const filePlayback: Playback = {
  get paused() { return el.paused; },
  get currentTime() { return el.currentTime; },
  get duration() { return el.duration; },
  play: () => el.play(), pause: () => el.pause(), seek: (time) => { el.currentTime = time; },
};
let playback: Playback = filePlayback;
const webgl = hasWebGL2();
const available = VISUALS.filter((v) => webgl || !v.info.needsWebGL);

const landing = $('landing');
const player = $('player');
const dock = $('dock');
const dockContent = $('dock-content');
const dockToggle = $('toggle-dock');
const stage = $('stage');
const errorBox = $<HTMLParagraphElement>('source-error');
const urlInput = $<HTMLInputElement>('url-input');
const urlSubmit = $<HTMLButtonElement>('url-submit');
const fileInput = $<HTMLInputElement>('file-input');
const drop = $('drop');
const playBtn = $<HTMLButtonElement>('play');
const seek = $<HTMLInputElement>('seek');
const volume = $<HTMLInputElement>('volume');
const flashSwitches = [...document.querySelectorAll<HTMLInputElement>('.reduce-flash')];
const moodLabel = $('mood-label');
const moodDot = $('mood-dot');
const youtubePanel = $('youtube-panel');
const youtubeHost = $('youtube-host');
const youtubeStatus = $('youtube-status');
const volumeControl = $('volume-control');
const muteHint = $('mute-hint');
const micHint = $('mic-hint');
const micButton = $<HTMLButtonElement>('open-mic');
let youtube: YouTubePlayer | null = null;
let capture: MediaStream | null = null;
let captureEnded: (() => void) | null = null;
let cancelCaptureWait: (() => void) | null = null;
let youtubeTimer = 0;
let youtubeStartTimer = 0;
let sourceEpoch = 0;
let lastSignalAt = 0;
const videoExport = new VideoExport({
  stage,
  filter: () => palette.filter,
  playing: () => screen === 'player' && !playback.paused,
  pause: () => playback.pause(),
  audio: () => {
    if (!capture) return engine.recordingAudio();
    return capturedRecordingAudio(capture);
  },
});

let customColors = parseCustom(store.get('paletteCustom'));
let palette = paletteById(store.get('palette'), customColors);
let screen: 'landing' | 'player' = 'landing';
let visual: Visual | null = null;
const view = new VisualView();
let focusedElement: ElementKey | null = null;
let drag: { id: number; x: number; y: number } | null = null;
let activationPointer: { id: number; x: number; y: number; distance: number } | null = null;
let visualIndex = Math.max(0, available.findIndex((v) => v.info.id === store.get('style')));
let objectUrl: string | null = null;
let songEnded = false;
let lastFrame = performance.now();
let lastMoodText = '';
let seeking = false;
const paused = emptyFeatures();

// ---------- Palette ----------
const paletteSelect = $<HTMLSelectElement>('palette');
paletteSelect.replaceChildren(...PALETTES.map((p) => new Option(p.name, p.id)));
const customPanel = $('palette-custom');
const customHue = $<HTMLInputElement>('custom-hue');
const customSaturation = $<HTMLInputElement>('custom-saturation');
const customWarmth = $<HTMLInputElement>('custom-warmth');
const customOpen = $('custom-open');
let customPanelOpen = true;
function applyPalette() {
  paletteSelect.value = palette.id;
  const custom = palette.id === CUSTOM_ID;
  customPanel.hidden = !custom || !customPanelOpen;
  customOpen.hidden = !custom || customPanelOpen;
  player.style.setProperty('--palette-filter', palette.filter);
  customHue.value = String(customColors.hue);
  customSaturation.value = String(customColors.saturation);
  customWarmth.value = String(customColors.warmth);
  for (const slider of [customHue, customSaturation, customWarmth]) setFill(slider);
}
function setCustomColors(next: typeof customColors) {
  customColors = next;
  store.set('paletteCustom', JSON.stringify(customColors));
  palette = paletteById(CUSTOM_ID, customColors);
  applyPalette();
}
for (const slider of [customHue, customSaturation, customWarmth]) {
  slider.addEventListener('input', () => setCustomColors(normalizeCustom({
    hue: Number(customHue.value),
    saturation: Number(customSaturation.value),
    warmth: Number(customWarmth.value),
  })));
}
$('custom-reset').addEventListener('click', () => setCustomColors({ ...DEFAULT_CUSTOM }));
function setCustomPanelOpen(open: boolean) {
  customPanelOpen = open;
  applyPalette();
}
$('custom-close').addEventListener('click', () => {
  setCustomPanelOpen(false);
  customOpen.focus();
});
customOpen.addEventListener('click', () => {
  setCustomPanelOpen(true);
  customHue.focus();
});
function setPalette(next: typeof palette) {
  // Choosing the custom palette is a request to adjust it.
  if (next.id === CUSTOM_ID && palette.id !== CUSTOM_ID) customPanelOpen = true;
  palette = next;
  store.set('palette', palette.id);
  applyPalette();
}
paletteSelect.addEventListener('change', () => setPalette(paletteById(paletteSelect.value, customColors)));
applyPalette();

// ---------- Flash setting ----------
const prefersCalm = window.matchMedia('(prefers-reduced-motion: reduce)').matches;
let reduceFlash = store.get('reduceFlash') === null ? prefersCalm : store.get('reduceFlash') === '1';

function applyFlash() {
  for (const s of flashSwitches) s.checked = reduceFlash;
  if (engine.analyzer) engine.analyzer.guard.reduce = reduceFlash;
}
for (const s of flashSwitches) {
  s.addEventListener('change', () => {
    reduceFlash = s.checked;
    store.set('reduceFlash', reduceFlash ? '1' : '0');
    applyFlash();
  });
}
applyFlash();

// ---------- Landing art ----------
const landingArt = $('landing-art');
const landingInk = new InkVisual({ plainPaper: true });
const idle = emptyFeatures();
landingArt.append(landingInk.canvas);
function sizeLanding() {
  const r = landingArt.getBoundingClientRect();
  if (r.width > 0) landingInk.resize(r.width, r.height);
}

// ---------- Bringing music in ----------
function setError(message: string) {
  errorBox.textContent = message;
  urlInput.setAttribute('aria-invalid', message && document.activeElement === urlInput ? 'true' : 'false');
}

function waitForMedia(): Promise<void> {
  return new Promise((resolve, reject) => {
    const done = () => {
      el.removeEventListener('canplay', ok);
      el.removeEventListener('error', bad);
    };
    const ok = () => {
      done();
      resolve();
    };
    const bad = () => {
      done();
      reject(new Error('media'));
    };
    el.addEventListener('canplay', ok);
    el.addEventListener('error', bad);
  });
}

async function openSource(src: string, title: string, failure: string) {
  stopYouTube();
  const epoch = sourceEpoch;
  setError('');
  await engine.unlock();
  if (epoch !== sourceEpoch) {
    if (src.startsWith('blob:')) URL.revokeObjectURL(src);
    return false;
  }
  engine.analyzer?.reset();
  applyFlash();
  if (objectUrl && objectUrl !== src) URL.revokeObjectURL(objectUrl);
  objectUrl = src.startsWith('blob:') ? src : null;
  el.src = src;
  el.load();
  try {
    await waitForMedia();
  } catch {
    if (epoch !== sourceEpoch) return false;
    el.removeAttribute('src');
    setError(failure);
    return false;
  }
  if (epoch !== sourceEpoch) return false;
  $('song-title').textContent = title;
  showPlayer();
  songEnded = false;
  try {
    await el.play();
  } catch {
    /* Autoplay can still be refused. The play button remains available. */
  }
  syncPlayButton();
  return true;
}

function setLoading(btn: HTMLElement, on: boolean) {
  btn.classList.toggle('loading', on);
  if (btn instanceof HTMLButtonElement) btn.disabled = on;
}

function setYouTubeStatus(message: string) {
  if (youtubeStatus.textContent !== message) youtubeStatus.textContent = message;
}

function stopYouTube() {
  clearSubtitles();
  endTutorial();
  videoExport.cancel();
  sourceEpoch++;
  cancelCaptureWait?.();
  cancelCaptureWait = null;
  window.clearInterval(youtubeTimer);
  window.clearTimeout(youtubeStartTimer);
  youtubeTimer = youtubeStartTimer = 0;
  playback = filePlayback;
  if (capture) {
    for (const track of capture.getTracks()) if (captureEnded) track.removeEventListener('ended', captureEnded);
  }
  captureEnded = null;
  const oldPlayer = youtube;
  youtube = null;
  oldPlayer?.destroy();
  engine.detachStream();
  if (capture) stopCapture(capture);
  capture = null;
  youtubeHost.replaceChildren();
  youtubePanel.hidden = true;
  delete youtubePanel.dataset.audioChannels;
  player.classList.remove('youtube-mode', 'mic-mode');
  micHint.hidden = true;
  volumeControl.hidden = false;
  muteHint.hidden = false;
  playBtn.disabled = false;
  setYouTubeStatus('');
}

function finishYouTube(message: string) {
  showLanding();
  setError(message);
}

/** Pausing mutes the track instead of ending it, so resuming does not ask for permission again. */
function microphonePlayback(stream: MediaStream): Playback {
  const tracks = stream.getAudioTracks();
  return {
    get paused() { return tracks.every((track) => !track.enabled); },
    currentTime: 0,
    duration: Number.NaN,
    play() { for (const track of tracks) track.enabled = true; },
    pause() { for (const track of tracks) track.enabled = false; },
    seek() { /* Live sound has no position. */ },
  };
}

async function openMicrophone() {
  stopYouTube();
  const epoch = sourceEpoch;
  setError('');
  el.pause();
  setLoading(micButton, true);
  let stream: MediaStream | null = null;
  try {
    // Both start inside this click, because of autoplay rules.
    const requested = requestMicrophone();
    const unlocked = engine.unlock();
    stream = await requested;
    await unlocked;
    if (epoch !== sourceEpoch) { stopCapture(stream); return; }
    const audio = stream.getAudioTracks().find((track) => track.readyState === 'live');
    if (!audio) throw new Error(MIC_MESSAGES.notFound);
    capture = stream;
    captureEnded = () => { if (epoch === sourceEpoch) finishYouTube(MIC_MESSAGES.stopped); };
    audio.addEventListener('ended', captureEnded, { once: true });
    // Analysis only. Sending this to the speakers would feed back into the microphone.
    engine.attachStream(stream);
    engine.analyzer?.reset();
    applyFlash();
    hits.attack = hits.kick = hits.snare = hits.hat = hits.melodyNote = 0;
    activeSample = null;
    songEnded = false;
    playback = microphonePlayback(stream);
    $('song-title').textContent = '마이크로 듣는 중';
    showPlayer();
    player.classList.add('mic-mode');
    volumeControl.hidden = true;
    muteHint.hidden = true;
    micHint.hidden = false;
    micHint.textContent = MIC_MESSAGES.listening;
    syncPlayButton();
    lastSignalAt = performance.now();
    youtubeTimer = window.setInterval(() => {
      if (epoch !== sourceEpoch) return;
      if (playback.paused || engine.analyzer?.features.active) {
        lastSignalAt = performance.now();
        micHint.textContent = MIC_MESSAGES.listening;
      } else if (performance.now() - lastSignalAt >= 5000) micHint.textContent = MIC_MESSAGES.noSignal;
    }, 250);
  } catch (error) {
    if (stream && stream !== capture) stopCapture(stream);
    if (epoch === sourceEpoch) finishYouTube(micErrorMessage(error));
  } finally {
    setLoading(micButton, false);
  }
}
micButton.addEventListener('click', () => void openMicrophone());

async function openYouTube(videoId: string) {
  stopYouTube();
  const epoch = sourceEpoch;
  let stream: MediaStream | null = null;
  let phase: 'capture' | 'player' = 'capture';
  setError('');
  el.pause();
  try {
    // Both calls start in this click. Never await unlock or the IFrame API before the picker.
    const requested = requestYouTubeCapture();
    const unlocked = engine.unlock().then(() => null, (error: unknown) => error);
    stream = await requested;
    if (epoch !== sourceEpoch) { stopCapture(stream); return; }
    const audio = stream.getAudioTracks().find((track) => track.readyState === 'live');
    if (!audio) throw new Error(YOUTUBE_MESSAGES.noAudio);
    const surface = stream.getVideoTracks()[0]?.getSettings().displaySurface;
    if (surface && surface !== 'browser') throw new Error(YOUTUBE_MESSAGES.wrongSurface);
    // Own the tracks before waiting for Web Audio, so sharing can be stopped even during resume.
    capture = stream;
    captureEnded = () => { if (epoch === sourceEpoch) finishYouTube(YOUTUBE_MESSAGES.stopped); };
    for (const track of stream.getTracks()) track.addEventListener('ended', captureEnded, { once: true });
    let cancelWait: () => void = () => undefined;
    const cancelled = new Promise<unknown>((resolve) => {
      cancelWait = () => resolve(new Error(YOUTUBE_MESSAGES.stopped));
      cancelCaptureWait = cancelWait;
    });
    const unlockError = await Promise.race([unlocked, cancelled]);
    if (cancelCaptureWait === cancelWait) cancelCaptureWait = null;
    if (epoch !== sourceEpoch) { stopCapture(stream); return; }
    if (unlockError) throw unlockError;
    if (audio.readyState !== 'live') throw new Error(YOUTUBE_MESSAGES.stopped);

    engine.attachStream(stream);
    engine.analyzer?.reset();
    applyFlash();
    hits.attack = hits.kick = hits.snare = hits.hat = hits.melodyNote = 0;
    activeSample = null;
    songEnded = false;
    $('song-title').textContent = '유튜브로 연 음악';
    showPlayer();
    player.classList.add('youtube-mode');
    youtubePanel.hidden = false;
    youtubePanel.dataset.audioChannels = String(engine.streamChannelCount ?? 'unknown');
    volumeControl.hidden = true;
    muteHint.hidden = true;
    playBtn.disabled = true;
    setYouTubeStatus('유튜브 플레이어를 불러오고 있어요.');
    phase = 'player';
    const current = new YouTubePlayer(youtubeHost, {
      onStateChange: () => {
        if (epoch !== sourceEpoch || !youtube) return;
        songEnded = youtube.state === 0;
        lastSignalAt = performance.now();
        if ([0, 1, 2, 3].includes(youtube.state)) setYouTubeStatus('');
        syncPlayButton();
        updatePlaybackTime();
        wakeControls();
      },
      onError: (message) => { if (epoch === sourceEpoch) finishYouTube(message); },
      onAutoplayBlocked: () => { if (epoch === sourceEpoch) setYouTubeStatus(YOUTUBE_MESSAGES.autoplay); },
    });
    youtube = current;
    playback = current;
    updatePlaybackTime();
    await current.load(videoId);
    if (epoch !== sourceEpoch) { current.destroy(); return; }
    playBtn.disabled = false;
    syncPlayButton();
    if (youtubeStatus.textContent === '유튜브 플레이어를 불러오고 있어요.') setYouTubeStatus('');
    lastSignalAt = performance.now();
    youtubeStartTimer = window.setTimeout(() => {
      if (epoch === sourceEpoch && youtube && ![0, 1, 3].includes(youtube.state)) setYouTubeStatus(YOUTUBE_MESSAGES.autoplay);
    }, 1500);
    youtubeTimer = window.setInterval(() => {
      if (epoch !== sourceEpoch || !youtube) return;
      updatePlaybackTime();
      syncPlayButton();
      if (youtube.state !== 1 || engine.analyzer?.features.active) {
        lastSignalAt = performance.now();
        if (youtubeStatus.textContent === YOUTUBE_MESSAGES.noSignal) setYouTubeStatus('');
      } else if (performance.now() - lastSignalAt >= 5000) setYouTubeStatus(YOUTUBE_MESSAGES.noSignal);
    }, 250);
    // Keep the unused video track live until a human verifies stopping it preserves this browser's audio.
  } catch (error) {
    if (stream && stream !== capture) stopCapture(stream);
    if (epoch !== sourceEpoch) return;
    const message = phase === 'player' ? (error instanceof Error ? error.message : YOUTUBE_MESSAGES.load) : captureErrorMessage(error);
    finishYouTube(message);
  }
}

async function playSample(spec: SampleSpec, btn: HTMLButtonElement) {
  stopYouTube();
  const epoch = sourceEpoch;
  setLoading(btn, true);
  try {
    await engine.unlock();
    // Synthesis blocks briefly, so let the spinner paint first.
    await new Promise((resolve) => setTimeout(resolve, 30));
    if (epoch !== sourceEpoch) return;
    const wav = audioToWav(renderSample(spec));
    activeSample = spec;
    await openSource(URL.createObjectURL(wav), spec.title, MESSAGES.badFile);
  } finally {
    setLoading(btn, false);
  }
}

let activeSample: SampleSpec | null = null;

async function playFile(file: File) {
  activeSample = null;
  drop.classList.add('loading');
  await openSource(URL.createObjectURL(file), titleFromName(file.name) || file.name, MESSAGES.badFile);
  drop.classList.remove('loading');
  fileInput.value = '';
}

const sampleMain = $<HTMLButtonElement>('sample-main');
sampleMain.addEventListener('click', () => playSample(SAMPLES[0], sampleMain));
const sampleList = $('sample-list');
for (const spec of SAMPLES.slice(1)) {
  const b = document.createElement('button');
  b.type = 'button';
  b.className = 'btn btn-weak';
  b.innerHTML = `<span class="btn-label"><span class="sample-mood">${MOOD_LABELS[spec.mood]}</span><span class="sample-title">${spec.title}</span></span>`;
  b.addEventListener('click', () => playSample(spec, b));
  sampleList.append(b);
}

fileInput.addEventListener('change', () => {
  const file = fileInput.files?.[0];
  if (file) void playFile(file);
});
for (const type of ['dragenter', 'dragover'] as const) {
  drop.addEventListener(type, (e) => {
    e.preventDefault();
    drop.classList.add('dragging');
  });
}
for (const type of ['dragleave', 'drop'] as const) {
  drop.addEventListener(type, (e) => {
    e.preventDefault();
    drop.classList.remove('dragging');
  });
}
drop.addEventListener('drop', (e) => {
  const file = (e as DragEvent).dataTransfer?.files?.[0];
  if (file) void playFile(file);
});
// Dropping anywhere else must not navigate the page away to the file.
for (const type of ['dragover', 'drop'] as const) window.addEventListener(type, (e) => e.preventDefault());

urlInput.addEventListener('input', () => {
  urlSubmit.disabled = urlInput.value.trim() === '';
  urlInput.setAttribute('aria-invalid', 'false');
  errorBox.textContent = '';
});
$('url-form').addEventListener('submit', async (e) => {
  e.preventDefault();
  // Route YouTube before file URL checks or any asynchronous work.
  if (isYouTubeUrl(urlInput.value)) {
    const id = parseYouTubeId(urlInput.value);
    if (!id) { urlInput.focus(); setError(MESSAGES.youtubeInvalid); return; }
    setLoading(urlSubmit, true);
    try { await openYouTube(id); }
    finally { setLoading(urlSubmit, false); urlSubmit.disabled = urlInput.value.trim() === ''; }
    return;
  }
  const check = checkUrl(urlInput.value);
  if (!check.ok) {
    urlInput.focus();
    setError(check.message);
    return;
  }
  activeSample = null;
  stopYouTube();
  const epoch = sourceEpoch;
  setLoading(urlSubmit, true);
  try {
    await engine.unlock();
    const problem = await probeUrl(check.url);
    if (epoch !== sourceEpoch) return;
    if (problem) { urlInput.focus(); setError(problem); }
    else await openSource(check.url, titleFromUrl(check.url), MESSAGES.badUrlMedia);
  } catch {
    if (epoch === sourceEpoch) setError(MESSAGES.badUrlMedia);
  } finally {
    setLoading(urlSubmit, false);
    urlSubmit.disabled = urlInput.value.trim() === '';
  }
});

// ---------- Player ----------
/** A phone has no room to spare, so the picture comes first. The panel is one tap away. */
let legendPlaced = false;
function placeLegendForScreen() {
  if (legendPlaced) return;
  legendPlaced = true;
  if (window.matchMedia('(max-width: 760px)').matches && !$('legend').classList.contains('hidden')) toggleLegend();
}

function showPlayer() {
  placeLegendForScreen();
  screen = 'player';
  landing.hidden = true;
  player.hidden = false;
  setDockCollapsed(false);
  useVisual(visualIndex);
  wakeControls();
}

function showLanding() {
  screen = 'landing';
  stopYouTube();
  el.pause();
  if (document.fullscreenElement) void document.exitFullscreen();
  player.hidden = true;
  landing.hidden = false;
  disposeVisual();
  sizeLanding();
}

function disposeVisual() {
  activationPointer = null;
  if (drag && stage.hasPointerCapture(drag.id)) stage.releasePointerCapture(drag.id);
  drag = null;
  stage.classList.remove('dragging');
  if (!visual) return;
  const old = visual;
  visual = null;
  old.canvas.classList.remove('shown');
  window.setTimeout(() => {
    old.dispose();
    old.canvas.remove();
  }, 500);
}

function useVisual(index: number) {
  visualIndex = index;
  const entry = available[index];
  store.set('style', entry.info.id);
  disposeVisual();
  const next = entry.create();
  stage.append(next.canvas);
  const r = stage.getBoundingClientRect();
  next.resize(r.width, r.height);
  visual = next;
  view.mode = entry.info.id === 'orbit' || entry.info.id === 'galaxy' ? 'orbit' : entry.info.id === 'tunnel' ? 'tunnel' : 'flat';
  view.reset();
  next.focus?.set(focusedElement);
  applyView();
  $('view-hint').textContent = `${view.mode === 'flat' ? '휠로 확대한 뒤 드래그로 이동' : view.mode === 'orbit' ? '드래그로 입체 회전 · 휠로 확대·축소' : '드래그로 시선 이동 · 휠로 확대·축소'} · 더블클릭으로 초기화`;
  if (entry.info.interaction) $('view-hint').textContent = `${entry.info.interaction.pointer} · ${next.drag ? 'Shift+드래그로 화면 이동 · 휠로 확대 · 더블클릭 초기화' : $('view-hint').textContent}`;
  stage.setAttribute('aria-label', `음악 시각화. 시점 조절: Shift와 방향키, 확대·축소: 더하기·빼기, 초기화: Home${entry.info.interaction?.keyboard ? `, Enter: ${entry.info.interaction.keyboard}` : ''}`);
  requestAnimationFrame(() => next.canvas.classList.add('shown'));
  renderPicker();
  renderLegend(entry.info);
  renderTutorialCard();
}

const picker = $('style-picker');
function renderPicker() {
  picker.replaceChildren(
    ...available.map((v, i) => {
      const b = document.createElement('button');
      b.type = 'button';
      b.className = 'style-option';
      b.setAttribute('role', 'radio');
      b.setAttribute('aria-checked', String(i === visualIndex));
      b.tabIndex = i === visualIndex ? 0 : -1;
      b.textContent = v.info.name;
      b.addEventListener('click', () => {
        if (i !== visualIndex) useVisual(i);
        focusPicked();
      });
      return b;
    }),
  );
}
function focusPicked() {
  picker.querySelector<HTMLButtonElement>('[aria-checked="true"]')?.focus();
}
picker.addEventListener('keydown', (e) => {
  const step = e.key === 'ArrowRight' ? 1 : e.key === 'ArrowLeft' ? -1 : 0;
  if (!step) return;
  e.preventDefault();
  e.stopPropagation();
  useVisual((visualIndex + step + available.length) % available.length);
  focusPicked();
});

const legendRows = new Map<ElementKey, { glyph: HTMLElement; meter: HTMLElement }>();
function renderLegend(info: VisualInfo) {
  const list = $('legend-list');
  list.replaceChildren();
  legendRows.clear();
  for (const key of ELEMENT_ORDER) {
    const entry = info.legend[key];
    const li = document.createElement('li');
    const button = document.createElement('button');
    button.type = 'button';
    button.className = 'legend-item';
    button.dataset.element = key;
    button.setAttribute('aria-label', `${ELEMENT_NAMES[key]} 집중해서 보기`);
    button.setAttribute('aria-pressed', String(focusedElement === key));
    button.addEventListener('click', () => {
      focusedElement = focusedElement === key ? null : key;
      visual?.focus?.set(focusedElement);
      syncFocus();
    });
    button.innerHTML = `
      <svg class="glyph" viewBox="0 0 32 32" style="color:${entry.color}" aria-hidden="true">${GLYPHS[key]}</svg>
      <span class="legend-name">${ELEMENT_NAMES[key]}</span>
      <span class="legend-text">${entry.text}</span>
      <span class="meter" aria-hidden="true"><i style="background:${entry.color}"></i></span>`;
    li.append(button);
    list.append(li);
    legendRows.set(key, { glyph: li.querySelector('svg') as unknown as HTMLElement, meter: li.querySelector('.meter i')! });
  }
  syncFocus();
}

function syncFocus() {
  for (const button of document.querySelectorAll<HTMLButtonElement>('[data-element]')) {
    button.setAttribute('aria-pressed', String(button.dataset.element === focusedElement));
  }
  $('focus-status').textContent = focusedElement ? `${ELEMENT_NAMES[focusedElement]} 집중 중 · 같은 항목을 다시 누르면 전체 보기` : '항목을 눌러 소리 요소에 집중해 보세요';
}

// ---------- Vibration (Android Chrome, sample songs only) ----------
const hapticsButton = $<HTMLButtonElement>('haptics-button');
const hapticPulse = new HapticPulse();
let hapticsOn = store.get('haptics') !== '0';

hapticsButton.addEventListener('click', () => {
  hapticsOn = !hapticsOn;
  store.set('haptics', hapticsOn ? '1' : '0');
  // A test pulse separates a phone that cannot vibrate from a song with no drums to follow.
  if (hapticsOn && supportsHaptics(navigator)) navigator.vibrate(300);
  hapticsButton.setAttribute('aria-pressed', String(hapticsOn));
  hapticsButton.querySelector('.btn-label')!.textContent = hapticsOn ? '진동 켜짐' : '진동 꺼짐';
});
hapticsButton.setAttribute('aria-pressed', String(hapticsOn));
hapticsButton.querySelector('.btn-label')!.textContent = hapticsOn ? '진동 켜짐' : '진동 꺼짐';

function playHaptics(f: Features) {
  const available = supportsHaptics(navigator) && activeSample !== null;
  if (hapticsButton.hidden === available) hapticsButton.hidden = !available;
  if (!available || !hapticsOn || playback.paused) return;
  const length = hapticPulse.next(f.kick, f.snare, performance.now());
  if (length) navigator.vibrate(length);
}

// ---------- Legend size ----------
const legendPanel = $('legend');
const legendResize = $('legend-resize');
let legendScale = parseLegendScale(store.get('legendScale'));

function applyLegendScale(next: number, save = true) {
  // Unscaled height, so a big panel still fits above the menu.
  const fit = legendPanel.offsetHeight > 0 ? (window.innerHeight - 200) / legendPanel.offsetHeight : undefined;
  legendScale = clampLegendScale(next, fit);
  player.style.setProperty('--legend-scale', String(legendScale));
  legendPanel.classList.toggle('roomy', legendScale >= ROOMY_SCALE);
  if (save) store.set('legendScale', String(legendScale));
}
applyLegendScale(legendScale, false);

// The panel is pinned top-right, so its free corner is bottom-left.
let legendDrag: { id: number; x: number; y: number; scale: number; width: number; height: number } | null = null;
legendResize.addEventListener('pointerdown', (e) => {
  const box = legendPanel.getBoundingClientRect();
  legendDrag = { id: e.pointerId, x: e.clientX, y: e.clientY, scale: legendScale, width: box.width, height: box.height };
  legendResize.setPointerCapture(e.pointerId);
  e.preventDefault();
  e.stopPropagation();
});
legendResize.addEventListener('pointermove', (e) => {
  if (!legendDrag || legendDrag.id !== e.pointerId) return;
  applyLegendScale(dragLegendScale(legendDrag.scale, legendDrag.width, legendDrag.height, e.clientX - legendDrag.x, e.clientY - legendDrag.y));
});
const endLegendDrag = () => { legendDrag = null; };
legendResize.addEventListener('pointerup', endLegendDrag);
legendResize.addEventListener('pointercancel', endLegendDrag);
legendResize.addEventListener('dblclick', () => applyLegendScale(DEFAULT_SCALE));
legendResize.addEventListener('keydown', (e) => {
  const step = e.key === 'ArrowLeft' || e.key === 'ArrowDown' ? 0.05 : e.key === 'ArrowRight' || e.key === 'ArrowUp' ? -0.05 : 0;
  if (!step) return;
  e.preventDefault();
  e.stopPropagation();
  applyLegendScale(legendScale + step);
});

// ---------- Subtitles ----------
let subtitleCues: Cue[] = [];
let subtitleNoticeUntil = 0;
const subtitleBox = $('subtitle');
const subtitleButton = $('subtitle-button');
const subtitleInput = $<HTMLInputElement>('subtitle-input');

function showSubtitleText(text: string) {
  if (subtitleBox.textContent !== text) subtitleBox.textContent = text;
  subtitleBox.hidden = !text;
}

function clearSubtitles() {
  subtitleCues = [];
  subtitleNoticeUntil = 0;
  showSubtitleText('');
  subtitleButton.querySelector('.btn-label')!.textContent = '자막 올리기';
}

function notifySubtitles(message: string) {
  subtitleNoticeUntil = performance.now() + 3000;
  showSubtitleText(message);
}

function updateSubtitle() {
  if (performance.now() < subtitleNoticeUntil) return;
  showSubtitleText(activeCue(subtitleCues, playback.currentTime)?.text ?? '');
}

subtitleButton.addEventListener('click', () => {
  if (subtitleCues.length) clearSubtitles();
  else subtitleInput.click();
});
subtitleInput.addEventListener('change', async () => {
  const file = subtitleInput.files?.[0];
  subtitleInput.value = '';
  if (!file) return;
  const cues = parseSubtitles(decodeSubtitles(await file.arrayBuffer()));
  if (!cues.length) {
    notifySubtitles('자막을 읽지 못했어요. SRT, VTT, LRC 파일을 올려 주세요.');
    return;
  }
  subtitleCues = cues;
  subtitleButton.querySelector('.btn-label')!.textContent = '자막 지우기';
  notifySubtitles(`자막 ${cues.length}줄을 불러왔어요.`);
});

// ---------- Tutorial ----------
let tutorial: { index: number; solo: boolean; mix: ElementKey | null } | null = null;
let tutorialRequest = 0;
const tutorialCard = $('tutorial-card');
const tutorialNext = $<HTMLButtonElement>('tutorial-next');
const tutorialBack = $<HTMLButtonElement>('tutorial-back');
const tutorialError = $('tutorial-error');

function renderTutorialCard() {
  tutorialCard.hidden = !tutorial;
  if (!tutorial) return;
  const legend = available[visualIndex].info.legend;
  const copy = tutorialCopy(tutorial.index, tutorial.solo, (key) => legend[key].text);
  const step = TUTORIAL_STEPS[tutorial.index].element;
  const glyph = $('tutorial-glyph') as unknown as SVGElement;
  glyph.innerHTML = step ? GLYPHS[step] : '';
  glyph.style.color = step ? legend[step].color : '';
  glyph.style.display = step ? '' : 'none';
  $('tutorial-title').textContent = copy.title;
  $('tutorial-progress').textContent = copy.progress;
  $('tutorial-body').textContent = copy.body;
  $('tutorial-look').textContent = copy.note;
  tutorialNext.querySelector('.btn-label')!.textContent = copy.nextLabel;
  tutorialBack.disabled = !copy.canGoBack;
}

function focusOn(key: ElementKey | null) {
  focusedElement = key;
  visual?.focus?.set(key);
  syncFocus();
}

/** Swaps to another mix of the same loop at the same moment, so the music carries on. */
async function playTutorialMix(step: ElementKey | null) {
  const request = ++tutorialRequest;
  const time = el.currentTime;
  const wasPlaying = !el.paused;
  // Synthesis blocks briefly, so let the button's spinner paint first.
  await new Promise((resolve) => setTimeout(resolve, 30));
  if (request !== tutorialRequest) return false;
  const url = URL.createObjectURL(audioToWav(renderSample(tutorialSpec(), step)));
  if (objectUrl) URL.revokeObjectURL(objectUrl);
  objectUrl = url;
  el.src = url;
  el.load();
  await waitForMedia();
  if (request !== tutorialRequest) return false;
  el.currentTime = Number.isFinite(el.duration) && el.duration > 0 ? time % el.duration : 0;
  // Level meters measure against the loudest moment heard, which would be the previous mix.
  engine.analyzer?.reset();
  applyFlash();
  if (wasPlaying) await el.play().catch(() => undefined);
  syncPlayButton();
  return true;
}

function pointAt(targets: string[]) {
  for (const old of document.querySelectorAll('.tour-target')) old.classList.remove('tour-target');
  for (const selector of targets) document.querySelector(selector)?.classList.add('tour-target');
}

/** Everything a step points at has to be on screen, however the viewer left things. */
function revealControls(targets: string[]) {
  player.classList.add('touring');
  // On a phone the panel would cover the card, so it only appears for the steps about it.
  const narrow = window.matchMedia('(max-width: 760px)').matches;
  const wanted = !narrow || targets.some((target) => target === '#legend-list' || target === '.mood');
  if ($('legend').classList.contains('hidden') === wanted) toggleLegend();
  setDockCollapsed(false);
}

async function showTutorialStep(index: number) {
  if (!tutorial) return;
  tutorial.index = index;
  tutorialError.hidden = true;
  const { element, targets } = TUTORIAL_STEPS[index];
  revealControls(targets ?? []);
  renderTutorialCard();
  pointAt(targets ?? []);
  focusOn(element);
  if (!tutorial.solo || tutorial.mix === element) return;
  tutorial.mix = element;
  setLoading(tutorialNext, true);
  try {
    await playTutorialMix(element);
  } catch {
    tutorialError.textContent = '소리를 바꾸지 못했어요. 그림은 계속 볼 수 있어요.';
    tutorialError.hidden = false;
  }
  setLoading(tutorialNext, false);
  renderTutorialCard();
}

async function startSoloTutorial(button: HTMLButtonElement) {
  setLoading(button, true);
  try {
    await engine.unlock();
    await new Promise((resolve) => setTimeout(resolve, 30));
    const spec = tutorialSpec();
    const url = URL.createObjectURL(audioToWav(renderSample(spec)));
    activeSample = spec;
    const opened = await openSource(url, spec.title, MESSAGES.badFile);
    if (!opened) return;
    el.loop = true;
    tutorial = { index: 0, solo: true, mix: null };
    await showTutorialStep(0);
  } finally {
    setLoading(button, false);
  }
}

/** Leaves the tutorial state only. Callers replacing the source need nothing else. */
function endTutorial() {
  if (!tutorial && !el.loop) return;
  tutorial = null;
  tutorialRequest++;
  el.loop = false;
  player.classList.remove('touring');
  pointAt([]);
  setLoading(tutorialNext, false);
  focusOn(null);
  renderTutorialCard();
}

/** Closing early must not leave someone listening to one lonely instrument. */
function closeTutorial() {
  if (!tutorial) return;
  const wasSolo = tutorial.solo;
  const onFullMix = tutorial.mix === null;
  endTutorial();
  if (wasSolo && !onFullMix) void playTutorialMix(null).catch(() => undefined);
}

$('tutorial-landing').addEventListener('click', (e) => void startSoloTutorial(e.currentTarget as HTMLButtonElement));
$('tutorial-player').addEventListener('click', (e) => {
  if (tutorial) return;
  if (activeSample) void startSoloTutorial(e.currentTarget as HTMLButtonElement);
  else {
    tutorial = { index: 0, solo: false, mix: null };
    void showTutorialStep(0);
  }
});
tutorialNext.addEventListener('click', () => {
  if (!tutorial) return;
  if (tutorial.index === TUTORIAL_STEPS.length - 1) closeTutorial();
  else void showTutorialStep(tutorial.index + 1);
});
tutorialBack.addEventListener('click', () => {
  if (tutorial && tutorial.index > 0) void showTutorialStep(tutorial.index - 1);
});
$('tutorial-close').addEventListener('click', closeTutorial);

function applyView() {
  if (!visual) return;
  const state = view.state;
  if (visual.setView) {
    visual.setView(state);
    visual.canvas.style.transform = '';
  } else {
    const r = stage.getBoundingClientRect();
    visual.canvas.style.transform = `translate(${state.x * (state.zoom - 1) * r.width / 2}px, ${state.y * (state.zoom - 1) * r.height / 2}px) scale(${state.zoom})`;
  }
}

stage.tabIndex = 0;
stage.setAttribute('aria-describedby', 'view-hint');
stage.setAttribute('aria-label', '음악 시각화. 시점 조절: Shift와 방향키, 확대·축소: 더하기·빼기, 초기화: Home');
stage.addEventListener('pointerdown', (e) => {
  if (e.button !== 0) return;
  stage.focus({ preventScroll: true });
  stage.setPointerCapture(e.pointerId);
  drag = { id: e.pointerId, x: e.clientX, y: e.clientY };
  activationPointer = visual?.activate ? { id: e.pointerId, x: e.clientX, y: e.clientY, distance: 0 } : null;
  stage.classList.add('dragging');
});
stage.addEventListener('pointermove', (e) => {
  if (!drag || drag.id !== e.pointerId) return;
  if (activationPointer?.id === e.pointerId) {
    activationPointer.distance = Math.max(activationPointer.distance, Math.hypot(e.clientX - activationPointer.x, e.clientY - activationPointer.y));
  }
  const r = stage.getBoundingClientRect();
  if (visual?.drag && !e.shiftKey) {
    const bounds = visual.canvas.getBoundingClientRect();
    visual.drag(
      { x: (drag.x - bounds.left) / Math.max(1, bounds.width), y: (drag.y - bounds.top) / Math.max(1, bounds.height) },
      { x: (e.clientX - bounds.left) / Math.max(1, bounds.width), y: (e.clientY - bounds.top) / Math.max(1, bounds.height) },
    );
  } else view.drag(e.clientX - drag.x, e.clientY - drag.y, r.width, r.height);
  drag.x = e.clientX;
  drag.y = e.clientY;
  applyView();
});
const endDrag = () => { drag = null; activationPointer = null; stage.classList.remove('dragging'); };
stage.addEventListener('pointerup', (e) => {
  if (activationPointer?.id === e.pointerId && visual?.activate &&
    Math.max(activationPointer.distance, Math.hypot(e.clientX - activationPointer.x, e.clientY - activationPointer.y)) < 5) {
    const r = visual.canvas.getBoundingClientRect();
    visual.activate({ x: (e.clientX - r.left) / Math.max(1, r.width), y: (e.clientY - r.top) / Math.max(1, r.height) });
  }
  if (stage.hasPointerCapture(e.pointerId)) stage.releasePointerCapture(e.pointerId);
  endDrag();
});
stage.addEventListener('pointercancel', endDrag);
stage.addEventListener('lostpointercapture', endDrag);
stage.addEventListener('wheel', (e) => {
  if (e.ctrlKey || e.metaKey) return;
  e.preventDefault();
  const delta = e.deltaY * (e.deltaMode === 1 ? 16 : e.deltaMode === 2 ? stage.clientHeight : 1);
  view.zoomBy(-delta * 0.0015);
  applyView();
  wakeControls();
}, { passive: false });
stage.addEventListener('dblclick', () => { view.reset(); applyView(); });
stage.addEventListener('keydown', (e) => {
  if (e.ctrlKey || e.metaKey || e.altKey) return;
  if (e.key === 'Enter' && visual?.activate) {
    if (!e.repeat) visual.activate();
  } else if (e.key === '+' || e.key === '=' || e.key === '-') {
    view.zoomBy(e.key === '-' ? -0.15 : 0.15);
  } else if (e.key === 'Home') {
    view.reset();
  } else if (e.shiftKey && ['ArrowLeft', 'ArrowRight', 'ArrowUp', 'ArrowDown'].includes(e.key)) {
    const r = stage.getBoundingClientRect();
    view.drag(e.key === 'ArrowLeft' ? -40 : e.key === 'ArrowRight' ? 40 : 0,
      e.key === 'ArrowUp' ? -40 : e.key === 'ArrowDown' ? 40 : 0, r.width, r.height);
  } else return;
  e.preventDefault();
  e.stopPropagation();
  applyView();
});

function updateLegend(f: Features) {
  for (const key of ELEMENT_ORDER) {
    const row = legendRows.get(key);
    if (!row) continue;
    const v = f[key];
    row.glyph.style.transform = `scale(${(0.62 + 0.38 * v).toFixed(3)})`;
    row.meter.style.transform = `scaleX(${v.toFixed(3)})`;
  }
  moodDot.style.left = `${(f.valence * 100).toFixed(1)}%`;
  moodDot.style.top = `${((1 - f.arousal) * 100).toFixed(1)}%`;
  const text = f.moodConfidence < 0.5 ? '읽는 중' : MOOD_LABELS[f.mood];
  if (text !== lastMoodText) {
    moodLabel.textContent = text;
    lastMoodText = text;
  }
}

const formatTime = (s: number) => {
  if (!Number.isFinite(s)) return '0:00';
  const m = Math.floor(s / 60);
  return `${m}:${String(Math.floor(s % 60)).padStart(2, '0')}`;
};

function setFill(input: HTMLInputElement) {
  const pct = ((Number(input.value) - Number(input.min)) / (Number(input.max) - Number(input.min))) * 100;
  input.style.setProperty('--fill', `${pct}%`);
}

function syncPlayButton() {
  const label = playBtn.querySelector('.btn-label')!;
  label.textContent = songEnded ? '다시 재생' : playback.paused ? '재생' : '일시정지';
}

async function togglePlay() {
  await engine.unlock();
  if (songEnded) {
    playback.seek(0);
    songEnded = false;
    engine.analyzer?.reset();
    applyFlash();
  }
  if (playback.paused) {
    try { await playback.play(); } catch { /* The visible source player remains available. */ }
  } else playback.pause();
  syncPlayButton();
}

function seekBy(delta: number) {
  if (Number.isFinite(playback.duration) && playback.duration > 0) seekPlayback(playback.currentTime + delta);
}

function seekPlayback(time: number) {
  playback.seek(Math.max(0, Math.min(playback.duration, time)));
  engine.analyzer?.resetRhythm();
  hits.attack = hits.kick = hits.snare = hits.hat = hits.melodyNote = 0;
  if (songEnded) { songEnded = false; syncPlayButton(); }
  lastSignalAt = performance.now();
  updatePlaybackTime();
}

function updatePlaybackTime() {
  const duration = playback.duration;
  const valid = Number.isFinite(duration) && duration > 0;
  $('time-total').textContent = formatTime(duration);
  $('time-now').textContent = formatTime(playback.currentTime);
  seek.disabled = !valid;
  if (!seeking) {
    seek.value = valid ? String(Math.round(playback.currentTime / duration * 1000)) : '0';
    setFill(seek);
  }
}

function toggleFullscreen() {
  if (document.fullscreenElement) void document.exitFullscreen();
  else void player.requestFullscreen();
}

function toggleLegend() {
  const legend = $('legend');
  const hidden = legend.classList.toggle('hidden');
  $('toggle-legend').querySelector('.btn-label')!.textContent = hidden ? '설명 보기' : '설명 숨기기';
}

function setDockCollapsed(collapsed: boolean) {
  dock.classList.toggle('collapsed', collapsed);
  dockContent.inert = collapsed;
  dockToggle.setAttribute('aria-expanded', String(!collapsed));
  dockToggle.textContent = collapsed ? '메뉴 펼치기 ▴' : '메뉴 접기 ▾';
}

dockToggle.addEventListener('click', () => {
  setDockCollapsed(!dock.classList.contains('collapsed'));
});

playBtn.addEventListener('click', togglePlay);
$('back').addEventListener('click', showLanding);
$('fullscreen').addEventListener('click', toggleFullscreen);
$('toggle-legend').addEventListener('click', toggleLegend);
el.addEventListener('ended', () => {
  if (playback !== filePlayback) return;
  songEnded = true;
  syncPlayButton();
});
el.addEventListener('pause', () => { if (playback === filePlayback) syncPlayButton(); });
el.addEventListener('seeking', () => {
  if (playback !== filePlayback) return;
  engine.analyzer?.resetRhythm();
  hits.attack = hits.kick = hits.snare = hits.hat = hits.melodyNote = 0;
});
el.addEventListener('play', () => {
  if (playback !== filePlayback) return;
  songEnded = false;
  syncPlayButton();
});
el.addEventListener('durationchange', () => {
  if (playback === filePlayback) updatePlaybackTime();
});
el.addEventListener('timeupdate', () => {
  if (playback === filePlayback) updatePlaybackTime();
});
seek.addEventListener('input', () => {
  seeking = true;
  setFill(seek);
  if (playback.duration) $('time-now').textContent = formatTime((Number(seek.value) / 1000) * playback.duration);
});
seek.addEventListener('change', () => {
  if (playback.duration) seekPlayback(Number(seek.value) / 1000 * playback.duration);
  seeking = false;
  updatePlaybackTime();
});
volume.addEventListener('input', () => {
  engine.setVolume(Number(volume.value) / 100);
  setFill(volume);
});
engine.setVolume(Number(volume.value) / 100);
setFill(volume);
setFill(seek);

window.addEventListener('keydown', (e) => {
  if (screen !== 'player' || e.metaKey || e.ctrlKey || e.altKey) return;
  if (e.target instanceof Element && e.target.closest('#export-dialog')) return;
  const onControl = e.target instanceof Element && e.target.matches('button, input, select, textarea');
  wakeControls();
  if (e.key === ' ' && !onControl) {
    e.preventDefault();
    void togglePlay();
  } else if (e.key === 'ArrowRight' && !onControl) {
    seekBy(5);
  } else if (e.key === 'ArrowLeft' && !onControl) {
    seekBy(-5);
  } else if (/^[1-9]$/.test(e.key)) {
    const i = Number(e.key) - 1;
    if (i < available.length && i !== visualIndex) useVisual(i);
  } else if (e.key.toLowerCase() === 'f') {
    toggleFullscreen();
  } else if (e.key.toLowerCase() === 'h') {
    toggleLegend();
  } else if (e.key === 'Escape' && tutorial) {
    closeTutorial();
  } else if (e.key.toLowerCase() === 'c') {
    setPalette(nextPalette(palette.id, customColors));
  }
});

let idleTimer = 0;
function wakeControls() {
  player.classList.remove('idle');
  window.clearTimeout(idleTimer);
  idleTimer = window.setTimeout(() => {
    if (!playback.paused) player.classList.add('idle');
  }, 3500);
}
player.addEventListener('pointermove', wakeControls);
player.addEventListener('pointerdown', wakeControls);

new ResizeObserver(() => {
  if (screen === 'player' && visual) {
    const r = stage.getBoundingClientRect();
    if (r.width > 0) visual.resize(r.width, r.height);
    applyView();
  } else if (screen === 'landing') {
    sizeLanding();
  }
}).observe(document.body);

// ---------- Main loop ----------
const debug = import.meta.env.DEV || new URLSearchParams(location.search).has('debug');
const dev = { meter: null as FlashMeter | null, trace: null as null | { t: number; f: Record<string, number>; on: string[]; mood: string; v: number; a: number }[] };

function tick(now: number) {
  requestAnimationFrame(tick);
  const dt = Math.min(0.1, (now - lastFrame) / 1000);
  lastFrame = now;

  if (screen === 'landing') {
    if (dt > 0) landingInk.frame(idleFeatures(idle, dt));
    return;
  }
  const f = engine.analyzer?.features ?? paused;
  // Hand over everything that happened since the last paint, then clear it.
  f.dt = dt;
  f.kick = hits.kick;
  f.snare = hits.snare;
  f.hat = hits.hat;
  f.melodyNote = hits.melodyNote;
  f.attack = hits.attack;
  hits.attack = hits.kick = hits.snare = hits.hat = hits.melodyNote = 0;
  if (visual) {
    visual.frame(f);
    videoExport.frame(visual.canvas);
  }
  updateLegend(f);
  updateSubtitle();
  playHaptics(f);
  if (debug) {
    if (dev.meter && visual) dev.meter.sample(visual.canvas, now / 1000);
    if (dev.trace && activeSample && !playback.paused) {
      dev.trace.push({
        t: el.currentTime,
        f: { drums: f.drums, bass: f.bass, vocal: f.vocal, melody: f.melody, kick: f.kick, snare: f.snare, note: f.melodyNote, pitch: f.vocalPitch },
        on: elementsAt(activeSample, el.currentTime),
        mood: f.mood,
        v: f.valence,
        a: f.arousal,
      });
    }
  }
}
/**
 * Analysis runs on its own clock. Tied to painting, a slow frame rate lost half the kicks,
 * because a drum hit lasts only a few tens of milliseconds. Hits are held until painted.
 */
const ANALYSIS_INTERVAL_MS = 16;
const hits = { kick: 0, snare: 0, hat: 0, melodyNote: 0, attack: 0 };
let lastAnalysis = performance.now();
window.setInterval(() => {
  const now = performance.now();
  const dt = Math.min(0.1, (now - lastAnalysis) / 1000);
  lastAnalysis = now;
  if (screen !== 'player' || dt <= 0) return;
  const f = engine.analyse(dt);
  if (!f) return;
  hits.kick = Math.max(hits.kick, f.kick);
  hits.snare = Math.max(hits.snare, f.snare);
  hits.hat = Math.max(hits.hat, f.hat);
  hits.melodyNote = Math.max(hits.melodyNote, f.melodyNote);
  hits.attack = Math.max(hits.attack, f.attack);
}, ANALYSIS_INTERVAL_MS);

sizeLanding();
requestAnimationFrame(tick);

if (debug) {
  Object.assign(window, {
    __sori: {
      engine,
      el,
      dev,
      FlashMeter,
      features: () => engine.analyzer?.features,
      samples: SAMPLES,
      useVisual,
      visual: () => visual,
    },
  });
}
