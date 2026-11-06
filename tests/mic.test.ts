import { afterEach, describe, expect, it, vi } from 'vitest';
import { MIC_MESSAGES, micErrorMessage, requestMicrophone } from '../src/audio/mic';

const named = (name: string) => Object.assign(new Error('browser text'), { name });

afterEach(() => vi.unstubAllGlobals());

describe('micErrorMessage', () => {
  it.each([
    ['NotAllowedError', MIC_MESSAGES.denied],
    ['SecurityError', MIC_MESSAGES.denied],
    ['NotFoundError', MIC_MESSAGES.notFound],
    ['NotReadableError', MIC_MESSAGES.busy],
    ['SomethingElse', MIC_MESSAGES.failed],
  ])('explains %s', (name, message) => {
    expect(micErrorMessage(named(name))).toBe(message);
  });

  it('keeps a message this app already wrote', () => {
    expect(micErrorMessage(new Error(MIC_MESSAGES.unsupported))).toBe(MIC_MESSAGES.unsupported);
  });

  it('copes with something that is not an error', () => {
    expect(micErrorMessage('nope')).toBe(MIC_MESSAGES.failed);
  });
});

describe('requestMicrophone', () => {
  it('explains when the browser offers no microphone API', async () => {
    vi.stubGlobal('navigator', {});
    await expect(requestMicrophone()).rejects.toThrow(MIC_MESSAGES.unsupported);
  });

  it('turns off call processing, which would remove the music', async () => {
    const getUserMedia = vi.fn(async () => ({}) as MediaStream);
    vi.stubGlobal('navigator', { mediaDevices: { getUserMedia } });
    await requestMicrophone();
    expect(getUserMedia).toHaveBeenCalledWith({
      audio: { echoCancellation: false, noiseSuppression: false, autoGainControl: false },
      video: false,
    });
  });
});
