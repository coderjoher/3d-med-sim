/// <reference lib="webworker" />
/**
 * On-device hand + face tracking (I-01, I-06). Runs MediaPipe Tasks Vision inside
 * a Web Worker; receives camera frames (transferred ImageBitmap / VideoFrame),
 * returns ONLY landmark coordinates. Frames never leave the station and are
 * closed right after inference (PRD §7 privacy, T0-10).
 */
import { createVisionHandler, type ToWorker, type VisionInit } from './visionProtocol';

type Vision = typeof import('@mediapipe/tasks-vision');
let visionP: Promise<{ v: Vision; fileset: Awaited<ReturnType<Vision['FilesetResolver']['forVisionTasks']>> }> | null = null;

function loadVision(init: VisionInit) {
  visionP ??= (async () => {
    const v = await import('@mediapipe/tasks-vision');
    // useModule=true loads the ES-module wasm loader (module workers have no importScripts)
    const fileset = await v.FilesetResolver.forVisionTasks(`${init.baseUrl}/wasm`, true);
    return { v, fileset };
  })();
  return visionP;
}

const handler = createVisionHandler({
  async createHand(init) {
    const { v, fileset } = await loadVision(init);
    const mk = (delegate: 'GPU' | 'CPU') => v.HandLandmarker.createFromOptions(fileset, {
      baseOptions: { modelAssetPath: `${init.baseUrl}/hand_landmarker.task`, delegate },
      runningMode: 'VIDEO',
      numHands: init.numHands ?? 2,
      minHandDetectionConfidence: 0.5,
      minHandPresenceConfidence: 0.5,
      minTrackingConfidence: 0.5,
    });
    try { return await mk(init.delegate ?? 'GPU'); } catch { return mk('CPU'); }
  },
  async createFace(init) {
    const { v, fileset } = await loadVision(init);
    const mk = (delegate: 'GPU' | 'CPU') => v.FaceLandmarker.createFromOptions(fileset, {
      baseOptions: { modelAssetPath: `${init.baseUrl}/face_landmarker.task`, delegate },
      runningMode: 'VIDEO',
      numFaces: 1,
      outputFaceBlendshapes: false,
      outputFacialTransformationMatrixes: false,
    });
    try { return await mk(init.delegate ?? 'GPU'); } catch { return mk('CPU'); }
  },
  post(msg) {
    // Landmark data only; no transfer list (nothing binary ever leaves the worker).
    (self as unknown as DedicatedWorkerGlobalScope).postMessage(msg);
  },
});

let queue = Promise.resolve();
self.onmessage = (ev: MessageEvent<ToWorker>) => {
  const msg = ev.data;
  queue = queue.then(() => handler(msg)).catch(() => undefined);
};
