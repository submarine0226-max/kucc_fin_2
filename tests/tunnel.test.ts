import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { LineSegments, Scene } from 'three';
import { emptyFeatures } from '../src/audio/features';
import { TunnelVisual } from '../src/visuals/tunnel';

const captured = vi.hoisted(() => ({ scene: null as Scene | null }));
vi.mock('three', async (original) => {
  const three = await original<typeof import('three')>();
  return {
    ...three,
    WebGLRenderer: class {
      setClearColor() {}
      setPixelRatio() {}
      setSize() {}
      render(scene: Scene) { captured.scene = scene; }
      dispose() {}
      forceContextLoss() {}
    },
  };
});

beforeEach(() => {
  vi.stubGlobal('document', { createElement: () => ({}) });
  vi.stubGlobal('window', { devicePixelRatio: 1 });
});
afterEach(() => vi.unstubAllGlobals());

function setup() {
  const visual = new TunnelVisual();
  const f = emptyFeatures();
  f.active = true;
  f.dt = 1 / 60;
  const advance = (frames = 60) => { for (let i = 0; i < frames; i++) visual.frame(f); };
  advance();
  const object = (name: string) => captured.scene!.getObjectByName(name)!;
  return { visual, f, advance, object };
}

describe('neon tunnel element separation', () => {
  it('keeps the aircraft visible and the same apparent size with and without vocals', () => {
    const { visual, f, advance, object } = setup();
    const voice = object('vocal');
    const quietSize = voice.scale.x / -voice.position.z;
    f.vocal = 0.8;
    advance();
    expect(voice.position.z).toBeLessThan(-8);
    expect(Math.abs(voice.position.x)).toBeLessThan(3.5);
    expect(voice.scale.x).toBeGreaterThan(1);
    expect(voice.scale.x / -voice.position.z).toBeCloseTo(quietSize, 8);
    f.vocal = 0;
    f.vocalPitch = 0.95;
    advance(180);
    expect(voice.scale.x / -voice.position.z).toBeCloseTo(quietSize, 8);
    expect(object('vocal-plane').parent).toBe(voice);
    visual.dispose();
  });

  it('moves the surrounding vocal waves faster at high pitch', () => {
    const measure = (pitch: number) => {
      const { visual, f, advance, object } = setup();
      f.vocal = 0.9;
      f.vocalPitch = pitch;
      advance();
      const positions = (object('vocal-vibration') as LineSegments).geometry.getAttribute('position');
      let previous = positions.getX(0);
      let travel = 0;
      for (let i = 0; i < 120; i++) {
        advance(1);
        travel += Math.abs(positions.getX(0) - previous);
        previous = positions.getX(0);
      }
      visual.dispose();
      return travel;
    };
    expect(measure(0.85)).toBeGreaterThan(measure(0.15) * 2);
  });

  it('gives drum hits a large gate expansion without expanding bass-only gates', () => {
    const { visual, f, advance, object } = setup();
    const red = object('drum-gate'), blue = object('bass-gate');
    const redSize = red.scale.x, blueSize = blue.scale.x;
    f.drums = 0.9;
    f.kick = 0.9;
    advance(1);
    expect(red.scale.x).toBeGreaterThan(redSize * 1.4);
    expect(blue.scale.x).toBeCloseTo(blueSize, 4);
    visual.dispose();
  });

  it('makes bass expand the wall without changing the aircraft apparent size', () => {
    const { visual, f, advance, object } = setup();
    const before = object('bass-gate').scale.x;
    const aircraftSize = object('vocal').scale.x / -object('vocal').position.z;
    f.bass = 0.9;
    advance(20);
    expect(object('bass-gate').scale.x).toBeGreaterThan(before * 1.2);
    expect(object('vocal').scale.x / -object('vocal').position.z).toBeCloseTo(aircraftSize, 8);
    expect(captured.scene!.getObjectByName('melody-marker')).toBeUndefined();
    visual.dispose();
  });

  it('keeps melody in the tunnel geometry rather than a separate triangle path', () => {
    const { visual, f, advance, object } = setup();
    f.melody = 0.9;
    f.melodyPitch = 0.15;
    advance();
    const gate = object('melody-gate');
    const lowSlope = gate.position.y / -gate.position.z;
    const lowTwist = gate.rotation.z;
    f.melodyPitch = 0.85;
    advance();
    expect(gate.position.y / -gate.position.z - lowSlope).toBeGreaterThan(0.06);
    expect(gate.rotation.z - lowTwist).toBeGreaterThan(0.2);
    expect(captured.scene!.getObjectByName('melody-marker')).toBeUndefined();
    expect(captured.scene!.getObjectByName('melody-path')).toBeUndefined();
    visual.dispose();
  });

  it('flies the vocal aircraft through the interior with depth motion and banking', () => {
    const { visual, f, advance, object } = setup();
    f.vocal = 0.9;
    advance();
    const voice = object('vocal');
    const initial = voice.position.clone();
    const bank = object('vocal-plane').rotation.z;
    advance(120);
    expect(voice.position.distanceTo(initial)).toBeGreaterThan(0.5);
    expect(Math.abs(voice.position.z - initial.z)).toBeGreaterThan(0.1);
    expect(Math.abs(object('vocal-plane').rotation.z - bank)).toBeGreaterThan(0.05);
    expect(voice.position.z).toBeLessThan(-8);
    visual.dispose();
  });

  it('changes only surrounding waves when vocal loudness and pitch change', () => {
    const flight = (vocal: number, pitch: number) => {
      const { visual, f, advance, object } = setup();
      f.vocal = vocal;
      f.vocalPitch = pitch;
      advance(90);
      const voice = object('vocal');
      const plane = object('vocal-plane');
      const positions = (object('vocal-vibration') as LineSegments).geometry.getAttribute('position');
      const state = { position: voice.position.toArray(), scale: voice.scale.toArray(),
        rotation: plane.rotation.toArray(), wave: positions.getX(0) };
      visual.dispose();
      return state;
    };
    const quiet = flight(0, 0.15), loud = flight(0.9, 0.85);
    expect(loud.position).toEqual(quiet.position);
    expect(loud.scale).toEqual(quiet.scale);
    expect(loud.rotation).toEqual(quiet.rotation);
    expect(Math.abs(loud.wave - quiet.wave)).toBeGreaterThan(0.01);
  });
});
