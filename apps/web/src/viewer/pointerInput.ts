/**
 * Mouse / touch -> semantic events (PRD §7 "one input language", I-05).
 * Pure logic (no DOM) so T0-14 can verify mouse/touch produce the same semantic
 * events as the gesture recognizer.
 *
 *  - left drag (mouse) / one-finger drag (touch)      -> rotate
 *  - right / middle / shift+drag, two-finger drag     -> pan
 *  - wheel, two-finger pinch                          -> zoom
 *  - click / tap without drag                         -> select
 *  - hover                                            -> point
 */
import type { InputSource, SemanticEvent } from '@medsim/core';

export interface PointerSample {
  kind: 'down' | 'move' | 'up' | 'cancel';
  id: number;
  x: number; // client px
  y: number;
  button?: number; // 0 left, 1 middle, 2 right
  shift?: boolean;
  pointerType?: string; // 'mouse' | 'touch' | 'pen'
}

const DRAG_PX = 5;

export class PointerTranslator {
  private pointers = new Map<number, { x: number; y: number; sx: number; sy: number; button: number; shift: boolean; dragged: boolean }>();
  private pinchDist = 0;
  private pinchMid: { x: number; y: number } | null = null;
  private multi = false;

  constructor(private viewport: () => { width: number; height: number } = () => ({ width: window.innerWidth, height: window.innerHeight })) {}

  handle(s: PointerSample): SemanticEvent[] {
    const source: InputSource = s.pointerType === 'touch' ? 'touch' : 'mouse';
    const { width, height } = this.viewport();
    const out: SemanticEvent[] = [];
    if (s.kind === 'down') {
      this.pointers.set(s.id, { x: s.x, y: s.y, sx: s.x, sy: s.y, button: s.button ?? 0, shift: !!s.shift, dragged: false });
      if (this.pointers.size === 2) {
        this.multi = true;
        const [a, b] = [...this.pointers.values()];
        this.pinchDist = Math.hypot(a.x - b.x, a.y - b.y);
        this.pinchMid = { x: (a.x + b.x) / 2, y: (a.y + b.y) / 2 };
      }
      return out;
    }
    if (s.kind === 'move') {
      const p = this.pointers.get(s.id);
      if (!p) {
        if (source === 'mouse') out.push({ type: 'point', x: s.x / width, y: s.y / height, source });
        return out;
      }
      if (this.pointers.size >= 2) {
        p.x = s.x; p.y = s.y;
        const [a, b] = [...this.pointers.values()];
        const d = Math.hypot(a.x - b.x, a.y - b.y);
        const mid = { x: (a.x + b.x) / 2, y: (a.y + b.y) / 2 };
        if (this.pinchDist > 0 && d > 0 && Math.abs(d - this.pinchDist) > 1) {
          out.push({ type: 'zoom', factor: d / this.pinchDist, source });
          this.pinchDist = d;
        }
        if (this.pinchMid) {
          const dx = (mid.x - this.pinchMid.x) / width;
          const dy = (mid.y - this.pinchMid.y) / height;
          if (dx || dy) out.push({ type: 'pan', dx, dy, source });
        }
        this.pinchMid = mid;
        for (const q of this.pointers.values()) q.dragged = true;
        return out;
      }
      const dx = (s.x - p.x) / width;
      const dy = (s.y - p.y) / height;
      if (!p.dragged && Math.hypot(s.x - p.sx, s.y - p.sy) < DRAG_PX) return out;
      p.dragged = true;
      p.x = s.x; p.y = s.y;
      if (dx || dy) {
        const pan = p.button === 1 || p.button === 2 || p.shift;
        out.push({ type: pan ? 'pan' : 'rotate', dx, dy, source });
      }
      return out;
    }
    // up / cancel
    const p = this.pointers.get(s.id);
    this.pointers.delete(s.id);
    if (this.pointers.size < 2) { this.pinchDist = 0; this.pinchMid = null; }
    if (s.kind === 'up' && p && !p.dragged && !this.multi && p.button === 0) {
      out.push({ type: 'select', x: s.x / width, y: s.y / height, source });
    }
    if (this.pointers.size === 0) this.multi = false;
    return out;
  }
}
