import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { Mesh, MeshBasicMaterial, Scene } from 'three';
import { emptyFeatures, type ElementKey } from '../src/audio/features';
import { OrbitVisual } from '../src/visuals/orbit';

const captured = vi.hoisted(() => ({ scene: null as Scene | null }));
vi.mock('three', async (original) => ({
  ...await original<typeof import('three')>(),
  WebGLRenderer: class {
    setClearColor() {}
    setPixelRatio() {}
    setSize() {}
    render(scene: Scene) { captured.scene = scene; }
    dispose() {}
    forceContextLoss() {}
  },
}));
beforeEach(() => {
  vi.stubGlobal('document', { createElement: () => ({}) });
  vi.stubGlobal('window', { devicePixelRatio: 1 });
});
afterEach(() => vi.unstubAllGlobals());

function setup(bpm = 120) {
  const visual = new OrbitVisual();
  const f = emptyFeatures();
  Object.assign(f, { active: true, dt: 1 / 60, bpm, beatConfidence: 0.9 });
  const advance = (frames = 60) => { for (let i = 0; i < frames; i++) visual.frame(f); };
  advance(120);
  const object = (name: string) => captured.scene!.getObjectByName(name)!;
  const sizes = () => ['element-drums', 'bass-core', 'element-vocal', 'element-melody'].map((name) => object(name).scale.x);
  return { visual, f, advance, object, sizes };
}

describe('orbit musical mapping', () => {
  it('focuses the chosen element without changing musical sizes or rotation', () => {
    const state = (focused: boolean) => {
      const { visual, f, advance, object, sizes } = setup();
      Object.assign(f, { drums: 0.8, bass: 0.7, vocal: 0.6, melody: 0.5 });
      if (focused) visual.focus.set('vocal');
      advance(120);
      const color = (name: string) => ((object(name) as Mesh).material as MeshBasicMaterial).color.r;
      const result = { sizes: sizes(), rotation: object('orbit-vocal').rotation.toArray(),
        drums: color('element-drums'), vocal: color('element-vocal') };
      visual.dispose();
      return result;
    };
    const all = state(false), focused = state(true);
    expect(focused.sizes).toEqual(all.sizes);
    expect(focused.rotation).toEqual(all.rotation);
    expect(focused.vocal).toBe(all.vocal);
    expect(focused.drums).toBeLessThan(all.drums * 0.2);
  });

  it.each(['drums', 'bass', 'vocal', 'melody'] as ElementKey[])('%s changes only its assigned shape size', (key) => {
    const { visual, f, advance, sizes } = setup();
    const before = sizes();
    f[key] = 0.9;
    advance(30);
    const after = sizes();
    const index = ['drums', 'bass', 'vocal', 'melody'].indexOf(key);
    for (let i = 0; i < after.length; i++) {
      if (i === index) expect(after[i]).toBeGreaterThan(before[i] * 1.8);
      else expect(after[i]).toBeCloseTo(before[i], 6);
    }
    expect(captured.scene!.getObjectByName('element-bass')!.visible).toBe(false);
    visual.dispose();
  });

  it('rotates the orbit planes about twice as fast at 180 BPM as at 90 BPM', () => {
    const turn = (bpm: number) => {
      const { visual, advance, object } = setup(bpm);
      const before = object('orbit-drums').rotation.x;
      advance();
      const result = object('orbit-drums').rotation.x - before;
      visual.dispose();
      return result;
    };
    expect(turn(180) / turn(90)).toBeCloseTo(2, 2);
  });

  it('does not let loudness, pitch, or drum transients change orbit rotation at a fixed BPM', () => {
    const turn = (loud: boolean) => {
      const { visual, f, advance, object } = setup();
      if (loud) Object.assign(f, { drums: 1, bass: 1, vocal: 1, melody: 1, kick: 1, attack: 1, energy: 1, vocalPitch: 0.9, melodyPitch: 0.9 });
      advance();
      const result = object('orbit-vocal').rotation.toArray();
      visual.dispose();
      return result;
    };
    expect(turn(true)).toEqual(turn(false));
  });

  it('does not make the bass sphere pulse from drum hits or overall energy', () => {
    const { visual, f, advance, object } = setup();
    Object.assign(f, { drums: 1, attack: 1, kick: 1, energy: 1 });
    advance(30);
    expect(object('bass-core').scale.x).toBe(1);
    visual.dispose();
  });
});
