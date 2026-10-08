import type { Calibration } from './types.js';

export const DEFAULT_CALIBRATION: Calibration = { minX: 0.2, maxX: 0.8, minY: 0.2, maxY: 0.8, mirror: true };

const clamp01 = (v: number) => (v < 0 ? 0 : v > 1 ? 1 : v);

/**
 * Build calibration from index-tip samples captured while the student reaches to screen corners/targets (I-03).
 * Adds a small margin; rejects degenerate (<0.1 span) input by returning DEFAULT_CALIBRATION.
 *
 * `margin` is a fraction of the measured span by which the box is shrunk on every side, so the
 * screen edges are reachable without the full stretch used during calibration (default 0.05).
 */
export function computeCalibration(samples: Array<{ x: number; y: number }>, mirror = true, margin = 0.05): Calibration {
  const pts = samples.filter((p) => Number.isFinite(p.x) && Number.isFinite(p.y));
  if (pts.length < 2) return { ...DEFAULT_CALIBRATION, mirror };
  let minX = Infinity, maxX = -Infinity, minY = Infinity, maxY = -Infinity;
  for (const p of pts) {
    minX = Math.min(minX, p.x); maxX = Math.max(maxX, p.x);
    minY = Math.min(minY, p.y); maxY = Math.max(maxY, p.y);
  }
  const sx = maxX - minX;
  const sy = maxY - minY;
  if (sx < 0.1 || sy < 0.1) return { ...DEFAULT_CALIBRATION, mirror };
  const m = Math.max(0, Math.min(margin, 0.25));
  return {
    minX: clamp01(minX + sx * m),
    maxX: clamp01(maxX - sx * m),
    minY: clamp01(minY + sy * m),
    maxY: clamp01(maxY - sy * m),
    mirror,
  };
}

/** Map a camera-normalised point to screen-normalised 0..1 (clamped), applying mirroring. */
export function applyCalibration(c: Calibration, p: { x: number; y: number }): { x: number; y: number } {
  const sx = c.maxX - c.minX || 1;
  const sy = c.maxY - c.minY || 1;
  let x = (p.x - c.minX) / sx;
  const y = (p.y - c.minY) / sy;
  if (c.mirror) x = 1 - x;
  return { x: clamp01(x), y: clamp01(y) };
}
