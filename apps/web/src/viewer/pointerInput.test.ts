import { describe, expect, it } from 'vitest';
import { GestureRecognizer, InputBus, keyToSemantic, type HandFrame, type SemanticEvent } from '@medsim/core';
import { PointerTranslator } from './pointerInput';

const vp = () => ({ width: 1000, height: 500 });
const types = (evs: SemanticEvent[]) => evs.map((e) => e.type);

function handAt(x: number, y: number, pinch: boolean): HandFrame {
  // minimal MediaPipe-topology hand: wrist below, fingers up, thumb near index when pinching
  const lm = Array.from({ length: 21 }, () => ({ x, y: y + 0.15, z: 0 }));
  lm[0] = { x, y: y + 0.2, z: 0 }; // wrist
  lm[9] = { x, y: y + 0.08, z: 0 }; // middle MCP
  for (const [tip, pip] of [[8, 6], [12, 10], [16, 14], [20, 18]]) { lm[pip] = { x, y: y + 0.06, z: 0 }; lm[tip] = { x, y: y + 0.1, z: 0 }; }
  lm[8] = { x, y, z: 0 };
  lm[4] = pinch ? { x: x + 0.005, y, z: 0 } : { x: x + 0.1, y: y + 0.05, z: 0 };
  return { landmarks: lm, handedness: 'Right' };
}

describe('mouse / touch / keyboard -> semantic events', () => {
  it('[T0-14] mouse drag -> rotate, right-drag -> pan, click -> select (normalised coords)', () => {
    const t = new PointerTranslator(vp);
    expect(t.handle({ kind: 'down', id: 1, x: 100, y: 100, button: 0, pointerType: 'mouse' })).toEqual([]);
    const r = t.handle({ kind: 'move', id: 1, x: 200, y: 150, button: 0, pointerType: 'mouse' });
    expect(r).toEqual([{ type: 'rotate', dx: 0.1, dy: 0.1, source: 'mouse' }]);
    expect(t.handle({ kind: 'up', id: 1, x: 200, y: 150, button: 0, pointerType: 'mouse' })).toEqual([]);

    t.handle({ kind: 'down', id: 1, x: 100, y: 100, button: 2, pointerType: 'mouse' });
    expect(types(t.handle({ kind: 'move', id: 1, x: 150, y: 100, button: 2, pointerType: 'mouse' }))).toEqual(['pan']);
    t.handle({ kind: 'up', id: 1, x: 150, y: 100, button: 2, pointerType: 'mouse' });

    t.handle({ kind: 'down', id: 1, x: 500, y: 250, button: 0, pointerType: 'mouse' });
    expect(t.handle({ kind: 'up', id: 1, x: 501, y: 250, button: 0, pointerType: 'mouse' })).toEqual([{ type: 'select', x: 0.501, y: 0.5, source: 'mouse' }]);
  });

  it('[T0-14] touch: tap -> select, one-finger drag -> rotate, pinch -> zoom', () => {
    const t = new PointerTranslator(vp);
    t.handle({ kind: 'down', id: 1, x: 300, y: 200, pointerType: 'touch', button: 0 });
    expect(t.handle({ kind: 'up', id: 1, x: 300, y: 200, pointerType: 'touch', button: 0 })[0]).toMatchObject({ type: 'select', source: 'touch' });
    t.handle({ kind: 'down', id: 1, x: 300, y: 200, pointerType: 'touch', button: 0 });
    expect(types(t.handle({ kind: 'move', id: 1, x: 340, y: 200, pointerType: 'touch', button: 0 }))).toEqual(['rotate']);
    t.handle({ kind: 'up', id: 1, x: 340, y: 200, pointerType: 'touch', button: 0 });
    t.handle({ kind: 'down', id: 1, x: 400, y: 200, pointerType: 'touch', button: 0 });
    t.handle({ kind: 'down', id: 2, x: 600, y: 200, pointerType: 'touch', button: 0 });
    const z = t.handle({ kind: 'move', id: 2, x: 700, y: 200, pointerType: 'touch', button: 0 });
    expect(z[0]).toMatchObject({ type: 'zoom', source: 'touch' });
    expect((z[0] as { factor: number }).factor).toBeCloseTo(1.5);
    // releasing a pinch is not a tap/select
    expect(types(t.handle({ kind: 'up', id: 2, x: 700, y: 200, pointerType: 'touch', button: 0 }))).toEqual([]);
    expect(types(t.handle({ kind: 'up', id: 1, x: 400, y: 200, pointerType: 'touch', button: 0 }))).toEqual([]);
  });

  it('[T0-14] mouse, keyboard and gestures produce the same semantic event vocabulary on one bus', () => {
    const bus = new InputBus();
    const seen: SemanticEvent[] = [];
    bus.on((e) => seen.push(e));
    // gesture: pinch + release without movement = select; pinch + drag = rotate
    const g = new GestureRecognizer({ smoothing: false });
    let tms = 0;
    const feed = (x: number, y: number, p: boolean) => g.process({ t: (tms += 33), hands: [handAt(x, y, p)] }).forEach((e) => bus.emit(e));
    feed(0.5, 0.5, false); feed(0.5, 0.5, true); feed(0.5, 0.5, false);
    feed(0.5, 0.5, true); feed(0.42, 0.5, true); feed(0.35, 0.5, true); feed(0.35, 0.5, false);
    // mouse
    const t = new PointerTranslator(vp);
    [...t.handle({ kind: 'down', id: 1, x: 10, y: 10, button: 0 }), ...t.handle({ kind: 'up', id: 1, x: 10, y: 10, button: 0 }),
      ...t.handle({ kind: 'down', id: 1, x: 10, y: 10, button: 0 }), ...t.handle({ kind: 'move', id: 1, x: 60, y: 10, button: 0 })].forEach((e) => bus.emit(e));
    // keyboard
    bus.emit(keyToSemantic('ArrowLeft')!);
    bus.emit(keyToSemantic('r')!);
    const bySource = (src: string) => new Set(seen.filter((e) => 'source' in e && e.source === src).map((e) => e.type));
    for (const ty of ['select', 'rotate']) {
      expect(bySource('gesture').has(ty as never)).toBe(true);
      expect(bySource('mouse').has(ty as never)).toBe(true);
    }
    expect(bySource('keyboard')).toEqual(new Set(['rotate', 'reset']));
    // identical event shapes regardless of device
    const shape = (e: SemanticEvent) => Object.keys(e).sort().join(',');
    const rot = seen.filter((e) => e.type === 'rotate');
    expect(new Set(rot.map(shape)).size).toBe(1);
  });
});
