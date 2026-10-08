import type { Calibration } from './types.js';
export const DEFAULT_CALIBRATION: Calibration = { minX: 0.2, maxX: 0.8, minY: 0.2, maxY: 0.8, mirror: true };
/** Build calibration from index-tip samples captured while the student reaches to screen corners/targets (I-03). Adds a small margin; rejects degenerate (<0.1 span) input by returning DEFAULT_CALIBRATION. */
export function computeCalibration(samples: Array<{ x: number; y: number }>, mirror?: boolean, margin?: number): Calibration { throw new Error("not implemented"); }
/** Map a camera-normalised point to screen-normalised 0..1 (clamped), applying mirroring. */
export function applyCalibration(c: Calibration, p: { x: number; y: number }): { x: number; y: number } { throw new Error("not implemented"); }
