import { describe, expect, it } from 'vitest';
import { Analyzer, type SpectrumFrame } from '../src/audio/analyzer';
import { BAND_COUNT, emptyFeatures, idleFeatures } from '../src/audio/features';
import { FlashGuard, MAX_FLASHES_PER_SECOND } from '../src/audio/flash';
import { flashTimes, maxFlashesPerSecond } from '../src/audio/flashMeter';
import { MOOD_HOLD_SECONDS, MoodLabel, classifyMood, modeScore, moodAxes } from '../src/audio/mood';
import { MESSAGES, checkUrl, isYouTubeUrl, parseYouTubeId, titleFromName, titleFromUrl } from '../src/audio/source';
import { SAMPLES, elementsAt, sampleDuration } from '../src/audio/samples';

const DT = 1 / 60;

describe('FlashGuard', () => {
  /** Counts how often brightness jumps upward, driven by a kick every frame. */
  const risesPerSecond = (reduce: boolean) => {
    const g = new FlashGuard();
    g.reduce = reduce;
    let rises = 0;
    let prev = 0;
    for (let i = 0; i < 600; i++) {
      const v = g.update(1, DT);
      if (v - prev > 0.05) rises++;
      prev = v;
    }
    return rises / 10;
  };

  it('never exceeds the WCAG limit, however fast the drums are', () => {
    expect(risesPerSecond(false)).toBeLessThanOrEqual(MAX_FLASHES_PER_SECOND);
  });

  it('removes sudden jumps entirely in reduced mode', () => {
    expect(risesPerSecond(true)).toBe(0);
    const g = new FlashGuard();
    g.reduce = true;
    let top = 0;
    for (let i = 0; i < 300; i++) top = Math.max(top, g.update(1, DT));
    expect(top).toBeLessThan(0.2);
  });

  it('holds the limit at a low frame rate too', () => {
    const g = new FlashGuard();
    let rises = 0;
    let prev = 0;
    for (let i = 0; i < 200; i++) {
      const v = g.update(1, 0.05);
      if (v - prev > 0.05) rises++;
      prev = v;
    }
    expect(rises / 10).toBeLessThanOrEqual(MAX_FLASHES_PER_SECOND);
  });
});

describe('flash meter', () => {
  const wave = (hz: number, amp: number, seconds = 3) => {
    const lum: number[] = [];
    const times: number[] = [];
    for (let i = 0; i < seconds * 60; i++) {
      const t = i / 60;
      lum.push(0.1 + (Math.sin(t * hz * Math.PI * 2) > 0 ? amp : 0));
      times.push(t);
    }
    return maxFlashesPerSecond(flashTimes(lum, times));
  };
  it('counts a 6 Hz strobe as unsafe', () => expect(wave(6, 0.5)).toBeGreaterThan(3));
  it('counts a 2 Hz pulse as safe', () => expect(wave(2, 0.5)).toBeLessThanOrEqual(3));
  it('ignores changes too small to be a flash', () => expect(wave(10, 0.05)).toBe(0));
});

describe('mood', () => {
  const major = [1, 0, 0.6, 0, 0.8, 0.5, 0, 0.9, 0, 0.5, 0, 0.3];
  const minor = [1, 0, 0.5, 0.85, 0, 0.5, 0, 0.8, 0.55, 0, 0.45, 0];

  it('tells major from minor', () => {
    expect(modeScore(major)).toBeGreaterThan(0);
    expect(modeScore(minor)).toBeLessThan(0);
  });

  it('finds the mode in any key', () => {
    const rotate = (c: number[], n: number) => c.map((_, i) => c[(i + 12 - n) % 12]);
    for (let k = 0; k < 12; k++) {
      expect(modeScore(rotate(major, k))).toBeGreaterThan(0);
      expect(modeScore(rotate(minor, k))).toBeLessThan(0);
    }
  });

  it('places four typical songs in four different quadrants', () => {
    const song = (loudnessDb: number, onsetRate: number, centroidHz: number, mode: number) => {
      const { valence, arousal } = moodAxes({ loudnessDb, onsetRate, centroidHz, mode, activity: onsetRate > 3 ? 120 : 80 });
      return classifyMood(valence, arousal, 'calm');
    };
    expect(song(-16, 6, 2400, 0.15)).toBe('joyful');
    expect(song(-34, 0.8, 900, 0.15)).toBe('calm');
    expect(song(-34, 0.6, 600, -0.15)).toBe('sad');
    expect(song(-14, 7, 1800, -0.15)).toBe('intense');
  });

  it('reads a quiet piece with no clear key as calm, not sad', () => {
    expect(classifyMood(0.48, 0.3, 'sad')).toBe('sad');
    expect(classifyMood(0.52, 0.3, 'sad')).toBe('calm');
    expect(classifyMood(0.52, 0.7, 'intense')).toBe('intense');
  });

  describe('MoodLabel', () => {
    const DT = 0.1;
    const happyLoud = [0.9, 0.9] as const;
    const sadQuiet = [0.1, 0.1] as const;
    const run = (label: MoodLabel, axes: readonly [number, number], seconds: number) => {
      for (let t = 0; t < seconds; t += DT) label.update(axes[0], axes[1], DT, false);
      return label.current;
    };

    it('takes the first reading at once while warming up', () => {
      const label = new MoodLabel();
      expect(label.update(...happyLoud, DT, true)).toBe('joyful');
    });

    it('ignores a passage shorter than the hold time', () => {
      const label = new MoodLabel('joyful');
      expect(run(label, sadQuiet, MOOD_HOLD_SECONDS - 1)).toBe('joyful');
      expect(run(label, happyLoud, 1)).toBe('joyful');
      expect(run(label, sadQuiet, MOOD_HOLD_SECONDS - 1)).toBe('joyful');
    });

    it('changes once the new reading has held', () => {
      const label = new MoodLabel('joyful');
      expect(run(label, sadQuiet, MOOD_HOLD_SECONDS + 0.5)).toBe('sad');
    });

    it('goes back to its starting state on reset', () => {
      const label = new MoodLabel('joyful');
      label.reset();
      expect(label.current).toBe('calm');
    });
  });

  it('does not flip the label right at a boundary', () => {
    expect(classifyMood(0.48, 0.48, 'calm')).toBe('calm');
    expect(classifyMood(0.48, 0.52, 'sad')).toBe('sad');
    expect(classifyMood(0.52, 0.52, 'intense')).toBe('intense');
  });
});

describe('Analyzer', () => {
  const SHORT = 1024;
  const LONG = 2048;
  const SR = 44100;
  const binHzShort = SR / 2 / SHORT;
  const binHzLong = SR / 2 / LONG;

  const silent = (): SpectrumFrame => ({
    midShort: new Float32Array(SHORT).fill(-140),
    sideShort: new Float32Array(SHORT).fill(-140),
    midLong: new Float32Array(LONG).fill(-140),
  });

  const addTone = (fr: SpectrumFrame, hz: number, db: number, side = -140) => {
    const put = (arr: Float32Array, bin: number, value: number) => {
      arr[bin] = Math.max(arr[bin], value);
      arr[bin - 1] = Math.max(arr[bin - 1], value - 8);
      arr[bin + 1] = Math.max(arr[bin + 1], value - 8);
    };
    put(fr.midShort, Math.round(hz / binHzShort), db);
    put(fr.midLong, Math.round(hz / binHzLong), db);
    if (side > -140) put(fr.sideShort, Math.round(hz / binHzShort), side);
  };

  const addKick = (fr: SpectrumFrame, db: number) => {
    for (let hz = 40; hz < 160; hz += binHzShort) {
      const bin = Math.round(hz / binHzShort);
      fr.midShort[bin] = Math.max(fr.midShort[bin], db);
    }
    for (let hz = 40; hz < 160; hz += binHzLong) {
      const bin = Math.round(hz / binHzLong);
      fr.midLong[bin] = Math.max(fr.midLong[bin], db);
    }
  };

  const make = () => new Analyzer({ sampleRate: SR, shortBins: SHORT, longBins: LONG });

  it('stays silent and inactive on silence', () => {
    const a = make();
    for (let i = 0; i < 120; i++) {
      const f = a.process(silent(), DT);
      expect(f.active).toBe(false);
      expect(f.kick).toBe(0);
    }
    expect(a.features.bass).toBe(0);
  });

  it('detects evenly spaced low hits as kicks', () => {
    const a = make();
    let kicks = 0;
    for (let i = 0; i < 300; i++) {
      const fr = silent();
      addTone(fr, 2000, -60);
      if (i % 30 < 3) addKick(fr, -20);
      if (a.process(fr, DT).kick > 0) kicks++;
    }
    expect(kicks).toBeGreaterThanOrEqual(7);
    expect(kicks).toBeLessThanOrEqual(11);
  });

  it('does not hear drums in a steady bass note', () => {
    const a = make();
    let kicks = 0;
    for (let i = 0; i < 300; i++) {
      const fr = silent();
      addTone(fr, 70, -22);
      if (a.process(fr, DT).kick > 0) kicks++;
    }
    expect(kicks).toBeLessThanOrEqual(1);
    expect(a.features.bass).toBeGreaterThan(0.4);
  });

  it('treats a wide-panned tone as melody, not vocal', () => {
    const a = make();
    for (let i = 0; i < 180; i++) {
      const fr = silent();
      addTone(fr, 880, -28, -28);
      addTone(fr, 1760, -40, -40);
      a.process(fr, DT);
    }
    expect(a.features.melody).toBeGreaterThan(0.3);
    expect(a.features.vocal).toBeLessThan(0.1);
  });

  it('treats a centred tone that wavers in pitch as vocal', () => {
    const a = make();
    for (let i = 0; i < 240; i++) {
      const fr = silent();
      const hz = 440 * Math.pow(2, (Math.sin(i * 0.6) * 0.4) / 12);
      addTone(fr, hz, -26);
      addTone(fr, hz * 2, -34);
      a.process(fr, DT);
    }
    expect(a.features.vocal).toBeGreaterThan(0.3);
  });

  it('forgets the previous song on reset', () => {
    const a = make();
    for (let i = 0; i < 120; i++) {
      const fr = silent();
      addTone(fr, 70, -20);
      a.process(fr, DT);
    }
    a.reset();
    expect(a.features.moodConfidence).toBe(0);
    const f = a.process(silent(), DT);
    expect(f.bass).toBeLessThan(0.1);
  });
});

describe('checkUrl', () => {
  it('accepts a direct file link', () => {
    expect(checkUrl(' https://a.com/song.mp3 ')).toEqual({ ok: true, url: 'https://a.com/song.mp3' });
  });
  it.each(['https://open.spotify.com/track/x', 'https://m.soundcloud.com/a/b'])(
    'explains why %s cannot work',
    (url) => {
      expect(checkUrl(url)).toEqual({ ok: false, message: MESSAGES.streaming });
    },
  );
  it('accepts a valid YouTube URL for routing to tab capture', () => {
    const url = 'https://www.youtube.com/watch?v=cpEeqACsF_Q';
    expect(checkUrl(url)).toEqual({ ok: true, url });
  });
  it.each(['https://www.youtube.com/watch?v=x', 'https://youtu.be/x', 'https://www.youtube.com/playlist?list=PL123'])(
    'gives a dedicated YouTube link error for %s', (url) => {
      expect(checkUrl(url)).toEqual({ ok: false, message: MESSAGES.youtubeInvalid });
    },
  );
  it('does not confuse a lookalike host with a streaming service', () => {
    expect(checkUrl('https://notyoutube.com/a.mp3').ok).toBe(true);
  });
  it.each(['song.mp3', 'javascript:alert(1)', 'file:///c:/a.mp3', 'ftp://a.com/a.mp3'])('rejects %s', (url) => {
    expect(checkUrl(url)).toEqual({ ok: false, message: MESSAGES.invalid });
  });
  it('asks for input when empty', () => {
    expect(checkUrl('   ')).toEqual({ ok: false, message: MESSAGES.empty });
  });
});

describe('YouTube video URL parsing', () => {
  it.each([
    'https://www.youtube.com/watch?si=dD9CyXX9D5D_IIHt&v=cpEeqACsF_Q&feature=youtu.be',
    'https://youtube.com/watch?v=cpEeqACsF_Q&t=20',
    'https://youtu.be/cpEeqACsF_Q?si=test',
    'https://www.youtube.com/shorts/cpEeqACsF_Q',
    'https://www.youtube.com/embed/cpEeqACsF_Q',
    'https://www.youtube.com/live/cpEeqACsF_Q',
    'https://m.youtube.com/watch?v=cpEeqACsF_Q',
    'https://music.youtube.com/watch?list=PL123&v=cpEeqACsF_Q',
    '  https://www.youtube.com/watch?v=cpEeqACsF_Q  ',
  ])('parses %s', (url) => {
    expect(parseYouTubeId(url)).toBe('cpEeqACsF_Q');
    expect(isYouTubeUrl(url)).toBe(true);
  });
  it.each([
    'https://notyoutube.com/watch?v=cpEeqACsF_Q',
    'https://youtube.com.evil.test/watch?v=cpEeqACsF_Q',
    'https://youtu.be.evil.test/cpEeqACsF_Q',
    'https://www.youtube.com@evil.test/watch?v=cpEeqACsF_Q',
    'https://www.youtube.com/playlist?list=PL123',
    'https://www.youtube.com/watch?list=PL123',
    'https://youtu.be/too-short',
    'https://youtube.com/watch?v=cpEeqACsF_Qx',
    'https://youtube.com/watch?v=cpEeqACsF_!',
    'https://youtube.com/embed/cpEeqACsF_Q/extra',
    'ftp://youtube.com/watch?v=cpEeqACsF_Q',
    'not a URL',
  ])('rejects %s', (url) => expect(parseYouTubeId(url)).toBeNull());
});

describe('titles', () => {
  it('cleans up a file name', () => expect(titleFromName('my_song.final.mp3')).toBe('my song.final'));
  it('decodes a link', () => expect(titleFromUrl('https://a.com/x/%EB%B4%84.mp3')).toBe('봄'));
  it('has a fallback for a bare domain', () => expect(titleFromUrl('https://a.com/')).toBe('링크로 연 음악'));
});

describe('samples', () => {
  it('covers all four moods', () => {
    expect(new Set(SAMPLES.map((s) => s.mood)).size).toBe(4);
  });
  it('reports the scheduled elements and nothing past the end', () => {
    const s = SAMPLES[0];
    expect(elementsAt(s, 0)).toEqual(['drums', 'bass']);
    expect(elementsAt(s, sampleDuration(s) + 1)).toEqual([]);
  });
});

describe('idleFeatures', () => {
  it('produces a usable signal without any audio', () => {
    const f = emptyFeatures();
    let kicks = 0;
    for (let i = 0; i < 600; i++) {
      idleFeatures(f, DT);
      if (f.kick > 0) kicks++;
    }
    expect(kicks).toBeGreaterThan(0);
    expect(f.spectrum.length).toBe(BAND_COUNT);
  });
});
