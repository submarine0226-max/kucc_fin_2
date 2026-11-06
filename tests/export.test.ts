import { describe, expect, it, vi } from 'vitest';
import { capturedRecordingAudio, exportSize, recordingType } from '../src/export/video';

describe('video export', () => {
  it('copies tab audio without owning or stopping the original capture track', () => {
    const stop = vi.fn();
    const originalStop = vi.fn();
    const copy = { stop };
    const original = { readyState: 'live', clone: () => copy, stop: originalStop };
    vi.stubGlobal('MediaStream', class {
      constructor(readonly tracks: unknown[]) {}
      getAudioTracks() { return this.tracks; }
    });
    try {
      const capture = { getAudioTracks: () => [original] } as unknown as MediaStream;
      const lease = capturedRecordingAudio(capture);
      expect(lease.stream.getAudioTracks()).toEqual([copy]);
      lease.release();
      expect(stop).toHaveBeenCalledOnce();
      expect(originalStop).not.toHaveBeenCalled();
      expect(() => capturedRecordingAudio({ getAudioTracks: () => [] } as unknown as MediaStream)).toThrow('탭 오디오');
    } finally { vi.unstubAllGlobals(); }
  });
  it('uses portrait and square sizes without depending on the browser window', () => {
    expect(exportSize('portrait', 1920, 1080)).toEqual([720, 1280]);
    expect(exportSize('square', 1920, 1080)).toEqual([1080, 1080]);
  });
  it('caps screen output at 1280 pixels and uses even dimensions for encoding', () => {
    expect(exportSize('screen', 1920, 1080)).toEqual([1280, 720]);
    const [width, height] = exportSize('screen', 1233, 777);
    expect(width % 2).toBe(0);
    expect(height % 2).toBe(0);
    expect(exportSize('screen', 0, 0)).toEqual([2, 2]);
  });
  it('prefers supported MP4 with AAC audio, with WebM as an honest fallback', () => {
    expect(recordingType(() => true)).toBe('video/mp4;codecs=avc1.42E01E,mp4a.40.2');
    expect(recordingType((type) => type === 'video/webm;codecs=vp8,opus')).toBe('video/webm;codecs=vp8,opus');
    expect(recordingType(() => false)).toBe('');
  });
});
