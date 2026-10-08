import { describe, expect, it } from 'vitest';
import { GestureRecognizer, isOpenPalm, OneEuroFilter, pinchDistance } from '../src/gestures.js';
import type { Calibration, SemanticEvent } from '../src/types.js';
import { frame, hand } from './hands.js';

const IDENTITY: Calibration = { minX: 0, maxX: 1, minY: 0, maxY: 1, mirror: false };
const of = (evs: SemanticEvent[], type: SemanticEvent['type']) => evs.filter((e) => e.type === type);

describe('gesture recognizer', () => {
  it('[T0-07] pinch distance and open palm are detected from landmarks', () => {
    expect(pinchDistance(hand(0.5, 0.5, { pinch: true }))).toBeLessThan(0.2);
    expect(pinchDistance(hand(0.5, 0.5))).toBeGreaterThan(0.8);
    expect(isOpenPalm(hand(0.5, 0.5, { open: true }))).toBe(true);
    expect(isOpenPalm(hand(0.5, 0.5))).toBe(false);
  });

  it('[T0-07] index movement emits point at the calibrated index tip', () => {
    const g = new GestureRecognizer({ calibration: IDENTITY });
    const e1 = g.process(frame(0, hand(0.3, 0.4)));
    const e2 = g.process(frame(33, hand(0.35, 0.45)));
    expect(e1).toEqual([{ type: 'point', x: 0.3, y: 0.4, source: 'gesture' }]);
    expect(of(e2, 'point')[0]).toMatchObject({ x: 0.35, y: 0.45 });
    // mirrored default calibration maps camera x to flipped screen x
    const m = new GestureRecognizer();
    const p = of(m.process(frame(0, hand(0.2, 0.2))), 'point')[0] as { x: number; y: number };
    expect(p.x).toBeCloseTo(1);
    expect(p.y).toBeCloseTo(0);
  });

  it('[T0-07] pinch and release without movement emits one select at the pinch point', () => {
    const g = new GestureRecognizer({ calibration: IDENTITY });
    const all: SemanticEvent[] = [];
    all.push(...g.process(frame(0, hand(0.5, 0.5))));
    all.push(...g.process(frame(33, hand(0.5, 0.5, { pinch: true }))));
    all.push(...g.process(frame(66, hand(0.505, 0.5, { pinch: true }))));
    expect(of(all, 'select')).toHaveLength(0);
    all.push(...g.process(frame(100, hand(0.505, 0.5))));
    const sel = of(all, 'select');
    expect(sel).toEqual([{ type: 'select', x: 0.5, y: 0.5, source: 'gesture' }]);
    expect(of(all, 'rotate')).toHaveLength(0);
  });

  it('[T0-08] pinch-and-drag emits rotate deltas and no select', () => {
    const g = new GestureRecognizer({ calibration: IDENTITY, dragThreshold: 0.03 });
    const all: SemanticEvent[] = [];
    all.push(...g.process(frame(0, hand(0.5, 0.5, { pinch: true }))));
    for (let i = 1; i <= 5; i++) all.push(...g.process(frame(i * 33, hand(0.5 + i * 0.02, 0.5 - i * 0.01, { pinch: true }))));
    all.push(...g.process(frame(200, hand(0.6, 0.45))));
    const rot = of(all, 'rotate') as Array<{ dx: number; dy: number }>;
    expect(rot.length).toBeGreaterThan(0);
    expect(rot.reduce((s, r) => s + r.dx, 0)).toBeCloseTo(0.1);
    expect(rot.reduce((s, r) => s + r.dy, 0)).toBeCloseTo(-0.05);
    expect(of(all, 'select')).toHaveLength(0);
  });

  it('[T0-08] two-hand pinch apart zooms in, together zooms out, and never selects', () => {
    const g = new GestureRecognizer({ calibration: IDENTITY });
    const all: SemanticEvent[] = [];
    const two = (t: number, d: number) =>
      g.process(frame(t, hand(0.5 - d / 2, 0.5, { pinch: true, handedness: 'Left' }), hand(0.5 + d / 2, 0.5, { pinch: true, handedness: 'Right' })));
    all.push(...two(0, 0.2));
    const zin = two(33, 0.3);
    expect(of(zin, 'zoom')).toHaveLength(1);
    expect((zin[0] as { factor: number }).factor).toBeCloseTo(1.5);
    const zout = two(66, 0.15);
    expect((of(zout, 'zoom')[0] as { factor: number }).factor).toBeCloseTo(0.5);
    all.push(...zin, ...zout);
    all.push(...g.process(frame(100, hand(0.6, 0.5))));
    expect(of(all, 'select')).toHaveLength(0);
    expect(of(all, 'rotate')).toHaveLength(0);
  });

  it('[T0-09] open palm held >= 1.5 s emits exactly one reset, not before; re-arms after closing', () => {
    const g = new GestureRecognizer({ calibration: IDENTITY });
    const resets: number[] = [];
    for (let t = 0; t <= 3000; t += 100) if (of(g.process(frame(t, hand(0.5, 0.5, { open: true }))), 'reset').length) resets.push(t);
    expect(resets).toEqual([1500]);
    g.process(frame(3100, hand(0.5, 0.5)));
    for (let t = 3200; t <= 4600; t += 100) if (of(g.process(frame(t, hand(0.5, 0.5, { open: true }))), 'reset').length) resets.push(t);
    expect(resets).toEqual([1500]);
    if (of(g.process(frame(4700, hand(0.5, 0.5, { open: true }))), 'reset').length) resets.push(4700);
    expect(resets).toEqual([1500, 4700]);
  });

  it('[T0-09] palm interrupted before 1.5 s does not reset', () => {
    const g = new GestureRecognizer({ calibration: IDENTITY });
    const evs: SemanticEvent[] = [];
    for (let t = 0; t <= 1400; t += 100) evs.push(...g.process(frame(t, hand(0.5, 0.5, { open: true }))));
    evs.push(...g.process(frame(1450, hand(0.5, 0.5))));
    for (let t = 1500; t <= 2800; t += 100) evs.push(...g.process(frame(t, hand(0.5, 0.5, { open: true }))));
    expect(of(evs, 'reset')).toHaveLength(0);
  });

  it('[T0-16] hand-lost after handLostMs without hands, hand-found when back; no select from a vanished pinch', () => {
    const g = new GestureRecognizer({ calibration: IDENTITY, handLostMs: 500 });
    g.process(frame(0, hand(0.5, 0.5, { pinch: true })));
    expect(g.process(frame(100))).toEqual([]);
    expect(g.process(frame(499))).toEqual([]);
    expect(g.process(frame(600))).toEqual([{ type: 'hand-lost', source: 'gesture' }]);
    expect(g.process(frame(700))).toEqual([]);
    const back = g.process(frame(800, hand(0.4, 0.4)));
    expect(back[0]).toEqual({ type: 'hand-found', source: 'gesture' });
    expect(of(back, 'select')).toHaveLength(0);
  });

  it('[T1-17] primaryHand chooses which hand drives the cursor', () => {
    const left = hand(0.2, 0.3, { handedness: 'Left' });
    const right = hand(0.7, 0.6, { handedness: 'Right' });
    const gl = new GestureRecognizer({ calibration: IDENTITY, primaryHand: 'left' });
    expect(of(gl.process(frame(0, left, right)), 'point')[0]).toMatchObject({ x: 0.2, y: 0.3 });
    const gr = new GestureRecognizer({ calibration: IDENTITY });
    expect(of(gr.process(frame(0, left, right)), 'point')[0]).toMatchObject({ x: 0.7, y: 0.6 });
    gr.setPrimaryHand('left');
    expect(of(gr.process(frame(33, left, right)), 'point')[0]).toMatchObject({ x: 0.2, y: 0.3 });
    // left-handed: a pinch with the non-primary right hand does not select
    const evs = [
      ...gl.process(frame(33, left, hand(0.7, 0.6, { handedness: 'Right', pinch: true }))),
      ...gl.process(frame(66, left, right)),
    ];
    expect(of(evs, 'select')).toHaveLength(0);
    const evs2 = [...gl.process(frame(100, hand(0.2, 0.3, { handedness: 'Left', pinch: true }), right)), ...gl.process(frame(133, left, right))];
    expect(of(evs2, 'select')).toEqual([{ type: 'select', x: 0.2, y: 0.3, source: 'gesture' }]);
  });

  it('[T0-07] smoothing (one-euro) reduces jitter and is deterministic', () => {
    const f = new OneEuroFilter(1, 0);
    const out = [0, 1, 0, 1, 0, 1].map((v, i) => f.filter(v, i * 33));
    expect(out[0]).toBe(0);
    for (const v of out.slice(1)) expect(Math.abs(v - 0.5)).toBeLessThan(0.5);
    f.reset();
    expect(f.filter(5, 1000)).toBe(5);
    const g1 = new GestureRecognizer({ smoothing: true });
    const g2 = new GestureRecognizer({ smoothing: true });
    const frames = [0, 33, 66].map((t, i) => frame(t, hand(0.3 + i * 0.05, 0.4)));
    expect(frames.map((f) => g1.process(f))).toEqual(frames.map((f) => g2.process(f)));
  });
});
