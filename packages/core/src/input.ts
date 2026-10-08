import type { SemanticEvent } from './types.js';
export type SemanticListener = (e: SemanticEvent) => void;
/** Input abstraction bus: every device emits the same semantic events (PRD §7). */
export class InputBus {
  on(fn: SemanticListener): () => void { throw new Error("not implemented"); }
  emit(e: SemanticEvent): void { throw new Error("not implemented"); }
}
/** Map a wheel delta to a zoom factor (>1 zoom in for negative deltaY). */
export function wheelToZoom(deltaY: number): number { throw new Error("not implemented"); }
/** Keyboard fallback: arrows rotate, +/- zoom, R/Home reset, WASD pan. Returns null for other keys. */
export function keyToSemantic(key: string, shift?: boolean): SemanticEvent | null { throw new Error("not implemented"); }
