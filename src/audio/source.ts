/** Checks and error wording for the two ways of bringing music in. */

export type UrlCheck = { ok: true; url: string } | { ok: false; message: string };

const STREAMING_HOSTS = [
  'spotify.com',
  'soundcloud.com',
  'music.apple.com',
  'melon.com',
  'genie.co.kr',
  'bugs.co.kr',
  'flo.com',
  'music.line.me',
  'vibe.naver.com',
  'tidal.com',
  'deezer.com',
];

export const MESSAGES = {
  empty: '유튜브나 음악 파일 링크를 입력해 주세요.',
  invalid: '링크 형식이 아니에요. https://로 시작하는 주소를 넣어 주세요.',
  streaming:
    '이 스트리밍 서비스는 아직 지원하지 않아요. 유튜브 링크나 음악 파일 링크를 넣거나 파일을 직접 올려 주세요.',
  youtubeInvalid: '유튜브 영상 주소를 읽지 못했어요. 재생목록 대신 영상 링크를 넣어 주세요.',
  blocked:
    '이 링크는 다른 사이트에서 재생하지 못하도록 막혀 있어요. 파일을 내려받아 직접 올려 주세요.',
  notFound: '이 주소에서 파일을 찾지 못했어요. 링크를 다시 확인해 주세요.',
  notAudio: '이 주소는 음악 파일이 아니에요. .mp3나 .wav로 끝나는 파일 링크를 넣어 주세요.',
  badFile: '이 파일은 재생할 수 없어요. MP3, WAV, OGG, M4A 파일로 올려 주세요.',
  badUrlMedia: '이 링크의 파일은 재생할 수 없어요. MP3, WAV, OGG, M4A 파일 링크를 넣어 주세요.',
} as const;

export function isYouTubeUrl(raw: string): boolean {
  try {
    const url = new URL(raw.trim());
    return (url.protocol === 'https:' || url.protocol === 'http:') &&
      /^(?:(?:www|m|music)\.)?youtube\.com$|^(?:www\.)?youtu\.be$/.test(url.hostname.toLowerCase());
  } catch {
    return false;
  }
}

export function parseYouTubeId(raw: string): string | null {
  if (!isYouTubeUrl(raw)) return null;
  const url = new URL(raw.trim());
  const path = url.pathname.replace(/\/+$/, '');
  let id: string | null = null;
  if (/(^|\.)youtu\.be$/.test(url.hostname)) id = /^\/([\w-]{11})$/.exec(path)?.[1] ?? null;
  else if (path === '/watch') id = url.searchParams.get('v');
  else id = /^\/(?:shorts|embed|live)\/([\w-]{11})$/.exec(path)?.[1] ?? null;
  return id && /^[\w-]{11}$/.test(id) ? id : null;
}

export function checkUrl(raw: string): UrlCheck {
  const text = raw.trim();
  if (!text) return { ok: false, message: MESSAGES.empty };
  let url: URL;
  try {
    url = new URL(text);
  } catch {
    return { ok: false, message: MESSAGES.invalid };
  }
  if (url.protocol !== 'http:' && url.protocol !== 'https:') {
    return { ok: false, message: MESSAGES.invalid };
  }
  const host = url.hostname.toLowerCase();
  if (isYouTubeUrl(text) && !parseYouTubeId(text)) return { ok: false, message: MESSAGES.youtubeInvalid };
  if (STREAMING_HOSTS.some((h) => host === h || host.endsWith(`.${h}`))) {
    return { ok: false, message: MESSAGES.streaming };
  }
  return { ok: true, url: url.href };
}

export function titleFromUrl(url: string): string {
  try {
    const name = decodeURIComponent(new URL(url).pathname.split('/').pop() ?? '');
    return titleFromName(name) || '링크로 연 음악';
  } catch {
    return '링크로 연 음악';
  }
}

export function titleFromName(name: string): string {
  return name.replace(/\.[a-z0-9]{2,5}$/i, '').replace(/[_+]/g, ' ').trim();
}

/** Works out why a link will not play, so the message can name the actual problem. */
export async function probeUrl(url: string): Promise<string | null> {
  const abort = new AbortController();
  try {
    const res = await fetch(url, { mode: 'cors', signal: abort.signal });
    const type = res.headers.get('content-type') ?? '';
    abort.abort();
    if (!res.ok) return MESSAGES.notFound;
    if (/^(text\/|application\/json)/i.test(type)) return MESSAGES.notAudio;
    return null;
  } catch {
    // The browser hides whether this was CORS or the network. CORS is far more common.
    return MESSAGES.blocked;
  }
}
