import type { HandFrame, Landmark, TrackingFrame } from '../src/types.js';

/** Synthetic MediaPipe hand (21 landmarks) with the index tip at (ix, iy). Hand size (wrist→middle MCP) = 0.1. */
export function hand(ix: number, iy: number, o: { pinch?: boolean; open?: boolean; handedness?: 'Left' | 'Right' } = {}): HandFrame {
  const lm: Landmark[] = Array.from({ length: 21 }, () => ({ x: ix, y: iy + 0.1, z: 0 }));
  const p = (x: number, y: number): Landmark => ({ x, y, z: 0 });
  lm[0] = p(ix, iy + 0.2); // wrist
  lm[9] = p(ix, iy + 0.1); // middle MCP
  lm[5] = p(ix, iy + 0.1); lm[13] = p(ix + 0.02, iy + 0.1); lm[17] = p(ix + 0.04, iy + 0.1);
  // index: always extended (it drives the cursor)
  lm[6] = p(ix, iy + 0.06); lm[7] = p(ix, iy + 0.03); lm[8] = p(ix, iy);
  const others: Array<[number, number, number]> = [[10, 12, 0.02], [14, 16, 0.04], [18, 20, 0.06]];
  for (const [pip, tip, dx] of others) {
    lm[pip] = p(ix + dx, iy + 0.06);
    lm[tip] = o.open ? p(ix + dx, iy) : p(ix + dx, iy + 0.12);
    lm[pip + 1] = o.open ? p(ix + dx, iy + 0.03) : p(ix + dx, iy + 0.1);
  }
  // thumb
  lm[1] = p(ix - 0.03, iy + 0.17); lm[2] = p(ix - 0.05, iy + 0.13); lm[3] = p(ix - 0.06, iy + 0.1);
  lm[4] = o.pinch ? p(ix + 0.005, iy + 0.005) : p(ix - 0.08, iy + 0.08);
  return { landmarks: lm, handedness: o.handedness ?? 'Right' };
}

export const frame = (t: number, ...hands: HandFrame[]): TrackingFrame => ({ t, hands });
