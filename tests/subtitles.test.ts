import { describe, expect, it } from 'vitest';
import { activeCue, decodeSubtitles, parseSubtitles } from '../src/audio/subtitles';

describe('parseSubtitles', () => {
  it('reads SRT, including CRLF, two lines and styling tags', () => {
    const cues = parseSubtitles('1\r\n00:00:01,500 --> 00:00:03,000\r\n<i>첫 줄</i>\r\n둘째 줄\r\n\r\n2\r\n00:01:00,000 --> 00:01:02,000\r\n다음\r\n');
    expect(cues).toEqual([
      { start: 1.5, end: 3, text: '첫 줄\n둘째 줄' },
      { start: 60, end: 62, text: '다음' },
    ]);
  });

  it('reads VTT, with or without hours', () => {
    const cues = parseSubtitles('WEBVTT\n\n00:05.000 --> 00:07.000\n가사\n\n01:00:00.000 --> 01:00:01.000\n끝\n');
    expect(cues.map((c) => c.start)).toEqual([5, 3600]);
  });

  it('reads LRC: each line lasts until the next, and metadata and blank lines are skipped', () => {
    const cues = parseSubtitles('[ar:가수]\n[00:01.50]하나\n[00:04.00]\n[00:05.00]둘\n');
    expect(cues).toEqual([
      { start: 1.5, end: 4, text: '하나' },
      { start: 5, end: 11, text: '둘' },
    ]);
  });

  it('finds nothing in a file that is not subtitles', () => {
    expect(parseSubtitles('그냥 메모입니다')).toEqual([]);
  });
});

describe('activeCue', () => {
  const cues = [{ start: 1, end: 2, text: 'a' }];
  it('shows a cue only during its time', () => {
    expect(activeCue(cues, 0.9)).toBeNull();
    expect(activeCue(cues, 1)?.text).toBe('a');
    expect(activeCue(cues, 2)).toBeNull();
  });
});

describe('decodeSubtitles', () => {
  it('reads UTF-8', () => {
    expect(decodeSubtitles(new TextEncoder().encode('가사').buffer as ArrayBuffer)).toBe('가사');
  });
  it('falls back to EUC-KR', () => {
    expect(decodeSubtitles(new Uint8Array([0xb0, 0xa1, 0xbb, 0xe7]).buffer)).toBe('가사');
  });
});
