import type { Calibration, HandFrame, SemanticEvent, TrackingFrame } from './types.js';
export interface GestureOptions {
  primaryHand?: 'left' | 'right';   // I-08
  pinchOn?: number;                 // normalised thumb-index distance to enter pinch (hysteresis)
  pinchOff?: number;                // ... to leave pinch
  dragThreshold?: number;           // cursor movement (screen units) before a pinch becomes a drag/rotate
  resetHoldMs?: number;             // open palm hold for reset (default 1500)
  handLostMs?: number;              // no hands for this long => hand-lost (default 500)
  calibration?: Calibration;
  smoothing?: boolean;              // one-euro filter on the cursor
}
/** Thumb-tip to index-tip distance normalised by hand size (wrist→middle MCP). */
export function pinchDistance(hand: HandFrame): number { throw new Error("not implemented"); }
/** All four fingers extended. */
export function isOpenPalm(hand: HandFrame): boolean { throw new Error("not implemented"); }
/**
 * Converts landmark frames into semantic events (I-02, PRD gesture table):
 * index movement -> point; pinch+release without drag -> select; pinch+drag -> rotate;
 * two-hand pinch distance change -> zoom; open palm held >= resetHoldMs -> reset (once per hold);
 * hand-lost / hand-found transitions (I-07).
 */
export class GestureRecognizer {
  constructor(opts?: GestureOptions) { throw new Error("not implemented"); }
  process(frame: TrackingFrame): SemanticEvent[] { throw new Error("not implemented"); }
  setCalibration(c: Calibration): void { throw new Error("not implemented"); }
  setPrimaryHand(h: 'left' | 'right'): void { throw new Error("not implemented"); }
  reset(): void { throw new Error("not implemented"); }
}
/** One-euro filter for jitter reduction. */
export class OneEuroFilter {
  constructor(minCutoff?: number, beta?: number, dCutoff?: number) { throw new Error("not implemented"); }
  filter(value: number, tMs: number): number { throw new Error("not implemented"); }
  reset(): void { throw new Error("not implemented"); }
}
