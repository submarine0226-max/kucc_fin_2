import html from '../index.html?raw';
import { describe, expect, it } from 'vitest';
import { renderSample, tutorialSpec } from '../src/audio/samples';
import { TUTORIAL_STEPS, tutorialCopy } from '../src/tutorial';

const legend = () => '설명';
const drumsIndex = TUTORIAL_STEPS.findIndex((s) => s.element === 'drums');

describe('tutorial steps', () => {
  it('covers each instrument once, in order', () => {
    const instruments = TUTORIAL_STEPS.filter((s) => s.element).map((s) => s.element);
    expect(instruments).toEqual(['drums', 'bass', 'vocal', 'melody']);
  });

  it('points only at controls that exist in the page', () => {
    for (const step of TUTORIAL_STEPS) {
      for (const target of step.targets ?? []) {
        const name = target.slice(1);
        const found = target.startsWith('#') ? html.includes(`id="${name}"`) : new RegExp(`class="[^"]*${name}`).test(html);
        expect(found, target).toBe(true);
      }
    }
  });

  it('gives every step something to say', () => {
    TUTORIAL_STEPS.forEach((_, i) => {
      const copy = tutorialCopy(i, true, legend);
      expect(copy.title).not.toBe('');
      expect(copy.body).not.toBe('');
    });
  });
});

describe('tutorial copy', () => {
  it('only claims the sound was separated in solo mode', () => {
    expect(tutorialCopy(drumsIndex, true, legend).body).toContain('소리만');
    expect(tutorialCopy(drumsIndex, false, legend).body).toContain('소리는 그대로');
  });

  it('cannot go back from the first step and finishes on the last', () => {
    expect(tutorialCopy(0, true, legend).canGoBack).toBe(false);
    expect(tutorialCopy(0, true, legend).nextLabel).toBe('다음');
    const last = tutorialCopy(TUTORIAL_STEPS.length - 1, true, legend);
    expect(last.canGoBack).toBe(true);
    expect(last.nextLabel).toBe('마치기');
  });
});

describe('solo rendering', () => {
  const spec = tutorialSpec();
  const rms = (a: Float32Array) => Math.sqrt(a.reduce((sum, x) => sum + x * x, 0) / a.length);
  const stereoDifference = (left: Float32Array, right: Float32Array) => {
    let sum = 0;
    for (let i = 0; i < left.length; i++) sum += (left[i] - right[i]) ** 2;
    return Math.sqrt(sum / left.length);
  };

  it.each(['drums', 'bass', 'vocal', 'melody'] as const)('makes sound for %s alone', (key) => {
    expect(rms(renderSample(spec, key).left)).toBeGreaterThan(0.005);
  });

  it('has every instrument playing, so no solo is silent at any point', () => {
    expect(spec.sections).toHaveLength(1);
    expect(spec.sections[0].on).toEqual(['drums', 'bass', 'vocal', 'melody']);
  });

  it('really removes the others: only the wide melody has a stereo difference', () => {
    expect(stereoDifference(renderSample(spec, 'melody').left, renderSample(spec, 'melody').right)).toBeGreaterThan(0.01);
    expect(stereoDifference(renderSample(spec, 'bass').left, renderSample(spec, 'bass').right)).toBeLessThan(0.0001);
  });

  it('renders the full mix when no instrument is singled out', () => {
    const all = rms(renderSample(spec, null).left);
    expect(all).toBeGreaterThan(rms(renderSample(spec, 'melody').left));
  });
});
