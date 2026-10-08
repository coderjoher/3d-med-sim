import { describe, expect, it } from 'vitest';
import { InteractionLogger, summarizeLog } from '../src/log.js';
import { formatClock, remainingMs } from '../src/timer.js';
import { applyCalibration, computeCalibration, DEFAULT_CALIBRATION } from '../src/calibration.js';
import { headPoseFromFace, parallaxOffset } from '../src/parallax.js';
import { checkProctorPin, isBlockedKey } from '../src/kiosk.js';
import { OfflineQueue, type KeyValueStorage } from '../src/queue.js';
import { InputBus, keyToSemantic, wheelToZoom } from '../src/input.js';
import { GestureRecognizer } from '../src/gestures.js';
import type { Landmark, SemanticEvent } from '../src/types.js';
import { frame, hand } from './hands.js';

class MemStorage implements KeyValueStorage {
  m = new Map<string, string>();
  getItem(k: string) { return this.m.get(k) ?? null; }
  setItem(k: string, v: string) { this.m.set(k, v); }
  removeItem(k: string) { this.m.delete(k); }
}

function clock(start = 1000) {
  let t = start;
  return { now: () => t, set: (v: number) => { t = v; } };
}

describe('interaction log', () => {
  it('[T0-13] logger distinguishes staged, cancelled and confirmed answers; only confirmations carry the answer', () => {
    const c = clock(0);
    const log = new InteractionLogger({ attempt_id: 'a1', case_id: 'CARD-012' }, c.now);
    log.record('question-open', { question_id: 'q1' });
    c.set(500); log.record('answer-staged', { question_id: 'q1', structure_id: 'TA:aortic_valve' });
    c.set(800); log.record('answer-cancelled', { question_id: 'q1' });
    c.set(1500); log.record('answer-staged', { question_id: 'q1', structure_id: 'TA:mitral_valve' });
    c.set(2000); log.record('answer-confirmed', { question_id: 'q1', data: { value: ['TA:mitral_valve'] } });
    const j = log.toJSON();
    expect(j.events.map((e) => e.type)).toEqual(['question-open', 'answer-staged', 'answer-cancelled', 'answer-staged', 'answer-confirmed']);
    const confirmed = j.events.filter((e) => e.type === 'answer-confirmed');
    expect(confirmed).toHaveLength(1);
    expect(confirmed[0]).toMatchObject({ t: 2000, question_id: 'q1', data: { value: ['TA:mitral_valve'] } });
    expect(j.started_at).toBe(0);
    // toJSON is a snapshot
    j.events.push({ t: 1, type: 'submit' });
    expect(log.toJSON().events).toHaveLength(5);
  });

  it('[T0-21] summarizeLog: time per question, structures viewed, input modes, hand-lost count', () => {
    const c = clock(10_000);
    const log = new InteractionLogger({ attempt_id: 'a1', case_id: 'X', student_id: 's1' }, c.now);
    log.record('case-open');
    log.record('question-open', { question_id: 'q1' });
    c.set(11_000); log.record('structure-view', { structure_id: 'TA:aorta' });
    c.set(12_000); log.record('structure-select', { structure_id: 'TA:mitral_valve' });
    c.set(13_000); log.record('question-close', { question_id: 'q1' });
    log.record('question-open', { question_id: 'q2' });
    c.set(14_000); log.record('input-mode', { data: { mode: 'mouse' } });
    log.record('hand-lost');
    c.set(15_000); log.record('structure-view', { structure_id: 'TA:aorta' });
    c.set(16_000); log.record('question-close', { question_id: 'q2' });
    log.record('question-open', { question_id: 'q1' });
    c.set(17_000); log.record('input-mode', { data: { mode: 'gesture' } });
    log.record('hand-lost');
    c.set(18_000); log.record('submit');
    c.set(18_500); log.end();
    const s = summarizeLog(log.toJSON());
    expect(s.time_per_question_ms).toEqual({ q1: 5000, q2: 3000 });
    expect(s.structures_viewed).toEqual(['TA:aorta', 'TA:mitral_valve']);
    expect(s.input_modes).toEqual(['mouse', 'gesture']);
    expect(s.hand_lost_count).toBe(2);
    expect(s.total_ms).toBe(8500);
    expect(JSON.parse(JSON.stringify(log)).ended_at).toBe(18_500); // serialisable for local save
  });
});

describe('timer', () => {
  it('[T0-19] time limit counts down, never negative, Infinity without a limit', () => {
    expect(remainingMs(0, 10, 0)).toBe(600_000);
    expect(remainingMs(0, 10, 61_000)).toBe(539_000);
    expect(remainingMs(0, 10, 700_000)).toBe(0);
    expect(remainingMs(0, undefined, 5)).toBe(Infinity);
    expect(formatClock(600_000)).toBe('10:00');
    expect(formatClock(539_000)).toBe('08:59');
    expect(formatClock(500)).toBe('00:01');
    expect(formatClock(0)).toBe('00:00');
    expect(formatClock(3_725_000)).toBe('1:02:05');
    expect(formatClock(Infinity)).toBe('--:--');
  });
});

describe('calibration', () => {
  it('[T0-11] calibration maps the reach box to the full screen', () => {
    const samples = [{ x: 0.3, y: 0.25 }, { x: 0.7, y: 0.25 }, { x: 0.7, y: 0.65 }, { x: 0.3, y: 0.65 }];
    const c = computeCalibration(samples, false, 0);
    expect(c).toEqual({ minX: 0.3, maxX: 0.7, minY: 0.25, maxY: 0.65, mirror: false });
    expect(applyCalibration(c, { x: 0.3, y: 0.25 })).toEqual({ x: 0, y: 0 });
    const br = applyCalibration(c, { x: 0.7, y: 0.65 });
    expect(br.x).toBeCloseTo(1); expect(br.y).toBeCloseTo(1);
    expect(applyCalibration(c, { x: 0.5, y: 0.45 }).x).toBeCloseTo(0.5);
    expect(applyCalibration(c, { x: 0.9, y: 0.1 })).toEqual({ x: 1, y: 0 }); // clamped
    const m = computeCalibration(samples); // mirrored, with margin
    expect(m.mirror).toBe(true);
    expect(m.minX).toBeGreaterThan(0.3);
    expect(applyCalibration(m, { x: 0.3, y: 0.3 }).x).toBe(1);
    expect(computeCalibration([{ x: 0.5, y: 0.5 }, { x: 0.52, y: 0.6 }])).toEqual(DEFAULT_CALIBRATION);
    expect(computeCalibration([])).toEqual(DEFAULT_CALIBRATION);
    // the recognizer uses the calibration for the cursor
    const g = new GestureRecognizer({ calibration: c });
    expect(g.process(frame(0, hand(0.7, 0.65)))[0]).toMatchObject({ type: 'point' });
    g.setCalibration(m);
  });
});

describe('parallax', () => {
  const face = (cx: number, cy: number, iod: number, iris = false): Landmark[] => {
    const lm: Landmark[] = Array.from({ length: iris ? 478 : 468 }, () => ({ x: 0, y: 0, z: 0 }));
    const a = { x: cx - iod / 2, y: cy, z: 0 }, b = { x: cx + iod / 2, y: cy, z: 0 };
    lm[33] = a; lm[263] = b;
    if (iris) { lm[468] = { ...a }; lm[473] = { ...b }; }
    return lm;
  };

  it('[T0-15] head position maps to an off-axis camera shift; strength 0 disables it', () => {
    const centre = headPoseFromFace(face(0.5, 0.5, 0.12));
    expect(centre.x).toBeCloseTo(0); expect(centre.y).toBeCloseTo(0); expect(centre.z).toBeCloseTo(1);
    // camera image: head at image x 0.3 => mirrored => user moved right (+x)
    const right = headPoseFromFace(face(0.3, 0.5, 0.12));
    expect(right.x).toBeCloseTo(0.4);
    expect(headPoseFromFace(face(0.3, 0.5, 0.12), { mirror: false }).x).toBeCloseTo(-0.4);
    const up = headPoseFromFace(face(0.5, 0.25, 0.12, true));
    expect(up.y).toBeCloseTo(0.5);
    expect(headPoseFromFace(face(0.5, 0.5, 0.06)).z).toBeCloseTo(2); // further away
    const o = parallaxOffset(right, 0.5);
    expect(o.dAlpha).toBeCloseTo(0.2);
    expect(parallaxOffset(up, 0.5).dBeta).toBeCloseTo(-0.25);
    expect(parallaxOffset({ x: 0, y: 0, z: 2 }, 0.5).radiusScale).toBeCloseTo(1.5);
    expect(parallaxOffset(right, 0)).toEqual({ dAlpha: 0, dBeta: 0, radiusScale: 1 });
    expect(headPoseFromFace([])).toEqual({ x: 0, y: 0, z: 1 });
  });
});

describe('kiosk', () => {
  it('[T0-24] blocks exit shortcuts and requires the proctor PIN', () => {
    const blocked = [
      { key: 'F4', altKey: true }, { key: 'w', ctrlKey: true }, { key: 'T', ctrlKey: true }, { key: 'n', ctrlKey: true },
      { key: 'r', ctrlKey: true }, { key: 'l', ctrlKey: true }, { key: 'F5' }, { key: 'F11' }, { key: 'F12' },
      { key: 'I', ctrlKey: true, shiftKey: true }, { key: 'J', ctrlKey: true, shiftKey: true }, { key: 'C', ctrlKey: true, shiftKey: true },
      { key: 'Meta' }, { key: 'a', metaKey: true }, { key: 'Tab', altKey: true }, { key: 'Escape' }, { key: 'BrowserBack' },
      { key: 'ArrowLeft', altKey: true }, { key: 'ContextMenu' },
    ];
    for (const k of blocked) expect(isBlockedKey(k), JSON.stringify(k)).toBe(true);
    const allowed = [{ key: 'a' }, { key: 'ArrowLeft' }, { key: 'Enter' }, { key: 'Backspace' }, { key: ' ' }, { key: '+' }, { key: 'c', ctrlKey: true }, { key: 'v', ctrlKey: true }, { key: 'Tab' }];
    for (const k of allowed) expect(isBlockedKey(k), JSON.stringify(k)).toBe(false);
    expect(checkProctorPin('4821', '4821')).toBe(true);
    expect(checkProctorPin('4820', '4821')).toBe(false);
    expect(checkProctorPin('48210', '4821')).toBe(false);
    expect(checkProctorPin('', '4821')).toBe(false);
    expect(checkProctorPin('', '')).toBe(false);
  });
});

describe('offline queue', () => {
  it('[T1-10] de-duplicates by id, flush stops at the first failure, and persists across instances', async () => {
    const st = new MemStorage();
    const q = new OfflineQueue<{ client_attempt_id: string; n: number }>(st);
    q.enqueue({ client_attempt_id: 'a', n: 1 });
    q.enqueue({ client_attempt_id: 'b', n: 1 });
    q.enqueue({ client_attempt_id: 'a', n: 2 });
    q.enqueue({ client_attempt_id: 'c', n: 1 });
    expect(q.size()).toBe(3);
    expect(q.items().map((i) => [i.client_attempt_id, i.n])).toEqual([['a', 2], ['b', 1], ['c', 1]]);
    const sent: string[] = [];
    const r = await q.flush(async (i) => {
      if (i.client_attempt_id === 'b') throw new Error('offline');
      sent.push(i.client_attempt_id);
    });
    expect(r).toEqual({ sent: 1, remaining: 2 });
    expect(sent).toEqual(['a']);
    const q2 = new OfflineQueue<{ client_attempt_id: string; n: number }>(st);
    expect(q2.items().map((i) => i.client_attempt_id)).toEqual(['b', 'c']);
    expect(await q2.flush(async () => {})).toEqual({ sent: 2, remaining: 0 });
    expect(new OfflineQueue(st).size()).toBe(0);
    st.setItem('medsim.offline-queue', '{corrupt');
    expect(new OfflineQueue(st).size()).toBe(0);
  });
});

describe('input abstraction', () => {
  it('[T0-14] keyboard and wheel produce the same semantic event types as gestures', () => {
    const g = new GestureRecognizer({ calibration: { minX: 0, maxX: 1, minY: 0, maxY: 1, mirror: false } });
    const gestureTypes = new Set<string>();
    const evs: SemanticEvent[] = [
      ...g.process(frame(0, hand(0.5, 0.5, { pinch: true }))),
      ...g.process(frame(33, hand(0.6, 0.5, { pinch: true }))),
      ...g.process(frame(66, hand(0.4, 0.5, { pinch: true, handedness: 'Left' }), hand(0.6, 0.5, { pinch: true }))),
      ...g.process(frame(99, hand(0.3, 0.5, { pinch: true, handedness: 'Left' }), hand(0.7, 0.5, { pinch: true }))),
    ];
    for (let t = 200; t <= 1800; t += 100) evs.push(...g.process(frame(t, hand(0.5, 0.5, { open: true }))));
    evs.forEach((e) => gestureTypes.add(e.type));
    for (const t of ['rotate', 'zoom', 'reset', 'point']) expect(gestureTypes.has(t)).toBe(true);

    expect(keyToSemantic('ArrowRight')).toEqual({ type: 'rotate', dx: 0.05, dy: 0, source: 'keyboard' });
    expect(keyToSemantic('ArrowUp')).toMatchObject({ type: 'rotate', dy: -0.05 });
    expect(keyToSemantic('ArrowLeft', true)).toMatchObject({ type: 'pan', dx: -0.05 });
    expect(keyToSemantic('w')).toMatchObject({ type: 'pan', dy: -0.05 });
    expect(keyToSemantic('D')).toMatchObject({ type: 'pan', dx: 0.05 });
    expect(keyToSemantic('+')).toMatchObject({ type: 'zoom' });
    expect((keyToSemantic('+') as { factor: number }).factor).toBeGreaterThan(1);
    expect((keyToSemantic('-') as { factor: number }).factor).toBeLessThan(1);
    expect(keyToSemantic('r')).toEqual({ type: 'reset', source: 'keyboard' });
    expect(keyToSemantic('Home')).toEqual({ type: 'reset', source: 'keyboard' });
    expect(keyToSemantic('x')).toBeNull();
    for (const k of ['ArrowRight', '+', 'r']) expect(gestureTypes.has(keyToSemantic(k)!.type)).toBe(true);

    expect(wheelToZoom(-100)).toBeGreaterThan(1);
    expect(wheelToZoom(100)).toBeLessThan(1);
    expect(wheelToZoom(0)).toBe(1);
    expect(wheelToZoom(-100) * wheelToZoom(100)).toBeCloseTo(1);

    const bus = new InputBus();
    const got: SemanticEvent[] = [];
    const off = bus.on((e) => got.push(e));
    bus.emit({ type: 'zoom', factor: wheelToZoom(-100), source: 'mouse' });
    bus.emit(evs[0]);
    off();
    bus.emit({ type: 'reset', source: 'touch' });
    expect(got.map((e) => [e.type, e.source])).toEqual([['zoom', 'mouse'], [evs[0].type, 'gesture']]);
  });
});
