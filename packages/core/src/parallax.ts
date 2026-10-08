import type { HeadPose, Landmark } from './types.js';

const clamp = (v: number, lo: number, hi: number) => (v < lo ? lo : v > hi ? hi : v);

/** Default inter-ocular distance (normalised image units) at the calibrated viewing distance. */
export const DEFAULT_BASELINE_IOD = 0.12;

/**
 * Estimate head pose from MediaPipe face landmarks (uses eye-centre midpoint and inter-ocular distance; 468/478 topology).
 * Uses iris centres 468/473 when present (478-point refine mode), otherwise outer eye corners 33/263.
 * Mirror=true for selfie camera.
 */
export function headPoseFromFace(landmarks: Landmark[], opts: { mirror?: boolean; baselineIod?: number } = {}): HeadPose {
  const mirror = opts.mirror ?? true;
  const baseline = opts.baselineIod ?? DEFAULT_BASELINE_IOD;
  let a: Landmark | undefined;
  let b: Landmark | undefined;
  if (landmarks.length >= 474 && landmarks[468] && landmarks[473]) {
    a = landmarks[468];
    b = landmarks[473];
  } else if (landmarks.length > 263) {
    a = landmarks[33];
    b = landmarks[263];
  }
  if (!a || !b) return { x: 0, y: 0, z: 1 };
  const mx = (a.x + b.x) / 2;
  const my = (a.y + b.y) / 2;
  const iod = Math.hypot(a.x - b.x, a.y - b.y);
  let x = (mx - 0.5) * 2;
  if (mirror) x = -x;
  const y = (0.5 - my) * 2;
  const z = iod > 1e-6 ? baseline / iod : 1;
  return { x: clamp(x, -1, 1) + 0, y: clamp(y, -1, 1) + 0, z: clamp(z, 0.25, 4) };
}

/**
 * Camera offset for head-tracked parallax (I-06): returns orbit-angle deltas (radians) and radius scale.
 * strength 0 => no effect. Head moves right => camera orbits right (alpha +); head up => look from above (beta −);
 * head further away => radius grows.
 */
export function parallaxOffset(pose: HeadPose, strength = 0.3): { dAlpha: number; dBeta: number; radiusScale: number } {
  const s = Math.max(0, strength);
  const dAlpha = clamp(pose.x, -1, 1) * s + 0;
  const dBeta = -clamp(pose.y, -1, 1) * s + 0;
  const radiusScale = clamp(1 + (pose.z - 1) * s, 0.5, 2);
  return { dAlpha, dBeta, radiusScale };
}
