import type { HeadPose, Landmark } from './types.js';
/** Estimate head pose from MediaPipe face landmarks (uses eye-centre midpoint and inter-ocular distance; 468/478 topology). Mirror=true for selfie camera. */
export function headPoseFromFace(landmarks: Landmark[], opts?: { mirror?: boolean; baselineIod?: number }): HeadPose { throw new Error("not implemented"); }
/** Camera offset for head-tracked parallax (I-06): returns orbit-angle deltas (radians) and radius scale. strength 0 => no effect. */
export function parallaxOffset(pose: HeadPose, strength?: number): { dAlpha: number; dBeta: number; radiusScale: number } { throw new Error("not implemented"); }
