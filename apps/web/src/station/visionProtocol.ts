/**
 * Message protocol between the station main thread and the vision Web Worker
 * (PRD §7 privacy / I-01 / T0-10).
 *
 * Privacy by design: camera frames are transferred INTO the worker, processed
 * on-device by MediaPipe and closed immediately. The worker only ever posts back
 * plain landmark numbers — never frames, pixels, masks, buffers or blobs.
 */
import type { HandFrame, Landmark } from '@medsim/core';

export interface VisionInit {
  type: 'init';
  /** Base URL of the locally served MediaPipe assets (offline lab). */
  baseUrl: string;
  hands: boolean;
  face: boolean;
  numHands?: number;
  delegate?: 'GPU' | 'CPU';
  /** Whether the frames sent are already mirrored (selfie). Webcam frames are not. */
  inputMirrored?: boolean;
}
export interface VisionFrame {
  type: 'frame';
  id: number;
  /** performance.now() at frame capture on the main thread (for hand-to-cursor latency). */
  t: number;
  frame: ImageBitmap | VideoFrame;
}
export interface VisionConfig { type: 'config'; face?: boolean; hands?: boolean }
export interface VisionClose { type: 'close' }
export type ToWorker = VisionInit | VisionFrame | VisionConfig | VisionClose;

export interface VisionReady { type: 'ready'; hands: boolean; face: boolean }
export interface VisionError { type: 'error'; message: string }
export interface VisionLandmarks {
  type: 'landmarks';
  id: number;
  t: number;
  /** Worker processing time (ms). */
  procMs: number;
  hands: HandFrame[];
  /** Face mesh landmarks (468/478 points) for head-tracked parallax, if enabled. */
  face: Landmark[] | null;
}
export type FromWorker = VisionReady | VisionError | VisionLandmarks;

// ---------------------------------------------------------------- sanitising

const num = (v: unknown) => (typeof v === 'number' && Number.isFinite(v) ? v : 0);

function cleanLandmarks(list: unknown): Landmark[] {
  if (!Array.isArray(list)) return [];
  return list.map((p) => {
    const o = (p ?? {}) as Record<string, unknown>;
    return { x: num(o.x), y: num(o.y), z: num(o.z) };
  });
}

interface RawHandResult { landmarks?: unknown[]; handedness?: Array<Array<{ categoryName?: string }>>; handednesses?: Array<Array<{ categoryName?: string }>> }
interface RawFaceResult { faceLandmarks?: unknown[] }

/**
 * Build the only message the worker is allowed to post: copies landmark
 * coordinates into fresh plain objects and drops everything else MediaPipe
 * returns (world landmarks, masks, images, blendshapes...).
 */
export function toLandmarkMessage(id: number, t: number, procMs: number, hand: RawHandResult | null | undefined, face: RawFaceResult | null | undefined, inputMirrored = false): VisionLandmarks {
  const hands: HandFrame[] = [];
  const lms = hand?.landmarks ?? [];
  const hd = hand?.handedness ?? hand?.handednesses ?? [];
  lms.forEach((l, i) => {
    let label = hd[i]?.[0]?.categoryName === 'Left' ? 'Left' : 'Right';
    // MediaPipe labels assume a mirrored (selfie) image; un-mirrored webcam frames swap them.
    if (!inputMirrored) label = label === 'Left' ? 'Right' : 'Left';
    hands.push({ landmarks: cleanLandmarks(l), handedness: label as 'Left' | 'Right' });
  });
  const f = face?.faceLandmarks?.[0];
  return { type: 'landmarks', id: num(id), t: num(t), procMs: num(procMs), hands, face: f ? cleanLandmarks(f) : null };
}

/**
 * True if `msg` contains only JSON-like data (plain objects, arrays, numbers,
 * strings, booleans, null). Rejects ImageBitmap, VideoFrame, ImageData,
 * ArrayBuffer / typed arrays, Blob, OffscreenCanvas etc. Used by the worker as a
 * last guard before postMessage and by T0-10.
 */
export function isLandmarkOnly(msg: unknown, depth = 0): boolean {
  if (depth > 6) return false;
  if (msg === null) return true;
  const t = typeof msg;
  if (t === 'number' || t === 'string' || t === 'boolean') return true;
  if (t !== 'object') return false;
  if (Array.isArray(msg)) return msg.every((v) => isLandmarkOnly(v, depth + 1));
  const proto = Object.getPrototypeOf(msg);
  if (proto !== Object.prototype && proto !== null) return false;
  return Object.values(msg as Record<string, unknown>).every((v) => isLandmarkOnly(v, depth + 1));
}

// ---------------------------------------------------------------- worker logic (testable)

export interface HandLandmarkerLike { detectForVideo(frame: ImageBitmap | VideoFrame, ts: number): RawHandResult; close?(): void }
export interface FaceLandmarkerLike { detectForVideo(frame: ImageBitmap | VideoFrame, ts: number): RawFaceResult; close?(): void }

export interface VisionDeps {
  createHand(init: VisionInit): Promise<HandLandmarkerLike>;
  createFace(init: VisionInit): Promise<FaceLandmarkerLike>;
  post(msg: FromWorker): void;
  now?: () => number;
}

/** Worker message handler. Frames are always closed; only sanitised landmarks are posted. */
export function createVisionHandler(deps: VisionDeps) {
  let hand: HandLandmarkerLike | null = null;
  let face: FaceLandmarkerLike | null = null;
  let init: VisionInit | null = null;
  let faceOn = false;
  let handsOn = true;
  let lastTs = -1;
  const now = deps.now ?? (() => performance.now());
  const safePost = (m: FromWorker) => {
    if (!isLandmarkOnly(m)) throw new Error('vision worker refused to post non-landmark data');
    deps.post(m);
  };

  return async function onMessage(msg: ToWorker): Promise<void> {
    switch (msg.type) {
      case 'init': {
        init = msg;
        handsOn = msg.hands;
        faceOn = msg.face;
        try {
          if (msg.hands) hand = await deps.createHand(msg);
          if (msg.face) face = await deps.createFace(msg).catch(() => null);
          safePost({ type: 'ready', hands: !!hand, face: !!face });
        } catch (e) {
          safePost({ type: 'error', message: e instanceof Error ? e.message : String(e) });
        }
        return;
      }
      case 'config': {
        if (typeof msg.face === 'boolean') {
          faceOn = msg.face;
          if (faceOn && !face && init) face = await deps.createFace(init).catch(() => null);
        }
        if (typeof msg.hands === 'boolean') handsOn = msg.hands;
        return;
      }
      case 'frame': {
        const frame = msg.frame;
        try {
          const t0 = now();
          // MediaPipe requires strictly increasing timestamps
          const ts = Math.max(lastTs + 1, Math.round(msg.t));
          lastTs = ts;
          const h = hand && handsOn ? hand.detectForVideo(frame, ts) : null;
          const f = face && faceOn ? face.detectForVideo(frame, ts) : null;
          safePost(toLandmarkMessage(msg.id, msg.t, now() - t0, h, f, init?.inputMirrored));
        } catch (e) {
          safePost({ type: 'error', message: e instanceof Error ? e.message : String(e) });
        } finally {
          try { (frame as { close?: () => void }).close?.(); } catch { /* already closed */ }
        }
        return;
      }
      case 'close': {
        hand?.close?.();
        face?.close?.();
        hand = null; face = null;
        return;
      }
    }
  };
}
