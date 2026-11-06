import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { AudioEngine } from '../src/audio/engine';

class Node {
  readonly connections = new Set<Node>();
  gain = { value: 1 };
  fftSize = 0;
  smoothingTimeConstant = 0;
  minDecibels = 0;
  connect(target: Node) { this.connections.add(target); return target; }
  disconnect(target?: Node) { if (target) this.connections.delete(target); else this.connections.clear(); }
  getFloatFrequencyData(out: Float32Array) { out.fill(-120); }
}
class Context {
  static current: Context;
  destination = new Node();
  file = new Node();
  gains: Node[] = [];
  streams: Node[] = [];
  recordings: (Node & { stream: MediaStream })[] = [];
  sampleRate = 44100;
  state = 'running';
  constructor() { Context.current = this; }
  createMediaElementSource() { return this.file; }
  createGain() { const node = new Node(); this.gains.push(node); return node; }
  createChannelSplitter() { return new Node(); }
  createAnalyser() { return new Node(); }
  createMediaStreamSource() { const node = new Node(); this.streams.push(node); return node; }
  createMediaStreamDestination() {
    const stop = vi.fn();
    const node = Object.assign(new Node(), { stream: { getTracks: () => [{ stop }] } as unknown as MediaStream });
    this.recordings.push(node);
    return node;
  }
  async resume() { this.state = 'running'; }
}
const pause = vi.fn();
beforeEach(() => {
  pause.mockClear();
  vi.stubGlobal('Audio', class { pause = pause; crossOrigin = ''; preload = ''; });
  vi.stubGlobal('AudioContext', Context);
});
afterEach(() => vi.unstubAllGlobals());

function stream(channels = 2) {
  return { getAudioTracks: () => [{ readyState: 'live', getSettings: () => ({ channelCount: channels }) }] } as unknown as MediaStream;
}
function reaches(node: Node, target: Node, visited = new Set<Node>()): boolean {
  if (node === target) return true;
  if (visited.has(node)) return false;
  visited.add(node);
  return [...node.connections].some((next) => reaches(next, target, visited));
}

describe('audio source routing', () => {
  it('records file output without replacing speakers and releases only the recording branch', async () => {
    const engine = new AudioEngine();
    expect(() => engine.recordingAudio()).toThrow('먼저 재생');
    await engine.unlock();
    const ctx = Context.current;
    const audio = engine.recordingAudio();
    const output = ctx.recordings[0];
    expect(audio.stream).toBe(output.stream);
    expect(reaches(ctx.file, output)).toBe(true);
    expect(reaches(ctx.file, ctx.destination)).toBe(true);
    audio.release();
    audio.release();
    expect(output.stream.getTracks()[0].stop).toHaveBeenCalledOnce();
    expect(reaches(ctx.file, output)).toBe(false);
    expect(reaches(ctx.file, ctx.destination)).toBe(true);
  });
  it('keeps files connected to both analysis and volume output', async () => {
    const engine = new AudioEngine();
    await engine.unlock();
    const ctx = Context.current;
    expect(ctx.file.connections.has(ctx.gains[0])).toBe(true);
    expect(reaches(ctx.file, ctx.destination)).toBe(true);
    engine.setVolume(0.25);
    expect(ctx.gains.at(-1)!.gain.value).toBe(0.25);
  });
  it('routes capture only to analysis, never to speakers, and pauses file playback', async () => {
    const engine = new AudioEngine();
    await engine.unlock();
    engine.attachStream(stream());
    const ctx = Context.current;
    expect(pause).toHaveBeenCalled();
    expect(ctx.streams[0].connections.has(ctx.gains[0])).toBe(true);
    expect(reaches(ctx.streams[0], ctx.destination)).toBe(false);
    expect(ctx.file.connections.has(ctx.gains[0])).toBe(false);
    expect(engine.streamChannelCount).toBe(2);
  });
  it('disconnects the capture node and restores the file analysis path on detach', async () => {
    const engine = new AudioEngine();
    await engine.unlock();
    engine.attachStream(stream(1));
    expect(engine.streamChannelCount).toBe(1);
    engine.detachStream();
    engine.detachStream();
    const ctx = Context.current;
    expect(ctx.streams[0].connections.size).toBe(0);
    expect(ctx.file.connections.has(ctx.gains[0])).toBe(true);
    expect(reaches(ctx.file, ctx.destination)).toBe(true);
    expect(engine.streamChannelCount).toBeNull();
  });
  it('disconnects an earlier stream when replacing it and rejects a silent track list', async () => {
    const engine = new AudioEngine();
    await engine.unlock();
    engine.attachStream(stream());
    engine.attachStream(stream());
    expect(Context.current.streams[0].connections.size).toBe(0);
    expect(Context.current.streams[1].connections.size).toBe(1);
    expect(() => engine.attachStream({ getAudioTracks: () => [] } as unknown as MediaStream)).toThrow('탭 오디오 공유');
  });
});
