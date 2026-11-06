export interface Cue {
  start: number;
  end: number;
  text: string;
}

const LRC_LAST_LINE_SECONDS = 6;
const TIMING = /((?:\d{1,2}:)?\d{1,2}:\d{2}[,.]\d{1,3})\s*-->\s*((?:\d{1,2}:)?\d{1,2}:\d{2}[,.]\d{1,3})/;
const LRC_TIME = /\[(\d{1,3}):(\d{2}(?:[.:]\d{1,3})?)\]/g;

function seconds(stamp: string): number {
  const parts = stamp.replace(',', '.').split(':').map(Number);
  return parts.reduce((total, part) => total * 60 + part, 0);
}

function parseTimed(text: string): Cue[] {
  const cues: Cue[] = [];
  let current: Cue | null = null;
  const lines: string[] = [];
  const flush = () => {
    if (current && lines.length) cues.push({ ...current, text: lines.join('\n').replace(/<[^>]+>/g, '').trim() });
    current = null;
    lines.length = 0;
  };
  for (const line of text.split(/\r?\n/)) {
    const timing = TIMING.exec(line);
    if (timing) {
      flush();
      current = { start: seconds(timing[1]), end: seconds(timing[2]), text: '' };
    } else if (!line.trim()) {
      flush();
    } else if (current) {
      lines.push(line.trim());
    }
  }
  flush();
  return cues;
}

function parseLrc(text: string): Cue[] {
  const stamped: { start: number; text: string }[] = [];
  for (const line of text.split(/\r?\n/)) {
    const times = [...line.matchAll(LRC_TIME)];
    if (!times.length) continue;
    const words = line.replace(LRC_TIME, '').trim();
    for (const t of times) stamped.push({ start: Number(t[1]) * 60 + Number(t[2].replace(':', '.')), text: words });
  }
  stamped.sort((a, b) => a.start - b.start);
  return stamped
    .map((line, i) => ({ ...line, end: stamped[i + 1]?.start ?? line.start + LRC_LAST_LINE_SECONDS }))
    .filter((cue) => cue.text);
}

/** Reads SRT, VTT or LRC by content, so a wrong file extension does not matter. */
export function parseSubtitles(text: string): Cue[] {
  const cues = TIMING.test(text) ? parseTimed(text) : parseLrc(text);
  return cues.filter((cue) => cue.end > cue.start).sort((a, b) => a.start - b.start);
}

export function activeCue(cues: Cue[], time: number): Cue | null {
  return cues.find((cue) => time >= cue.start && time < cue.end) ?? null;
}

/** Korean subtitle files are often saved as EUC-KR rather than UTF-8. */
export function decodeSubtitles(bytes: ArrayBuffer): string {
  try {
    return new TextDecoder('utf-8', { fatal: true }).decode(bytes);
  } catch {
    return new TextDecoder('euc-kr').decode(bytes);
  }
}
