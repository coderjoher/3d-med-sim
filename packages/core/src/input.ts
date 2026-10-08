import type { SemanticEvent } from './types.js';

export type SemanticListener = (e: SemanticEvent) => void;

/** Input abstraction bus: every device emits the same semantic events (PRD §7). */
export class InputBus {
  private listeners = new Set<SemanticListener>();

  on(fn: SemanticListener): () => void {
    this.listeners.add(fn);
    return () => {
      this.listeners.delete(fn);
    };
  }

  emit(e: SemanticEvent): void {
    for (const fn of [...this.listeners]) fn(e);
  }
}

/** Map a wheel delta to a zoom factor (>1 zoom in for negative deltaY). */
export function wheelToZoom(deltaY: number): number {
  if (!Number.isFinite(deltaY) || deltaY === 0) return 1;
  const d = Math.max(-500, Math.min(500, deltaY));
  return Math.exp(-d * 0.001);
}

/** Rotation / pan step per key press in normalised screen units (same units as gesture rotate deltas). */
export const KEY_STEP = 0.05;
export const KEY_ZOOM = 1.1;

/** Keyboard fallback: arrows rotate, +/- zoom, R/Home reset, WASD pan. Returns null for other keys. Shift+arrows pan. */
export function keyToSemantic(key: string, shift = false): SemanticEvent | null {
  const s = KEY_STEP;
  const arrow: Record<string, [number, number]> = {
    ArrowLeft: [-s, 0], ArrowRight: [s, 0], ArrowUp: [0, -s], ArrowDown: [0, s],
  };
  if (key in arrow) {
    const [dx, dy] = arrow[key];
    return shift ? { type: 'pan', dx, dy, source: 'keyboard' } : { type: 'rotate', dx, dy, source: 'keyboard' };
  }
  const k = key.length === 1 ? key.toLowerCase() : key;
  const wasd: Record<string, [number, number]> = { a: [-s, 0], d: [s, 0], w: [0, -s], s: [0, s] };
  if (k in wasd) {
    const [dx, dy] = wasd[k];
    return { type: 'pan', dx, dy, source: 'keyboard' };
  }
  if (k === '+' || k === '=' || k === 'Add') return { type: 'zoom', factor: KEY_ZOOM, source: 'keyboard' };
  if (k === '-' || k === '_' || k === 'Subtract') return { type: 'zoom', factor: 1 / KEY_ZOOM, source: 'keyboard' };
  if (k === 'r' || k === 'Home') return { type: 'reset', source: 'keyboard' };
  return null;
}
