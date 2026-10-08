/**
 * Main-thread side of hand tracking: owns the camera stream, ships frames to the
 * vision worker (one in flight at a time), feeds returned landmarks into the core
 * GestureRecognizer and publishes semantic events on the InputBus (I-01, I-02, I-07).
 */
import { GestureRecognizer, pinchDistance, type Calibration, type InputBus, type Landmark, type TrackingFrame } from '@medsim/core';
import type { FromWorker, ToWorker } from './visionProtocol';

export type TrackingStatus = 'off' | 'starting' | 'tracking' | 'no-hand' | 'unavailable' | 'error';

export interface HandTrackerCallbacks {
  onStatus(s: TrackingStatus, detail?: string): void;
  /** Raw (calibrated) cursor from the primary hand index tip, 0..1 screen coords, plus capture timestamp. */
  onCursor?(p: { x: number; y: number; captureT: number; pinching: boolean } | null): void;
  onFace?(landmarks: Landmark[] | null): void;
  /** Camera-normalised index-tip position (for calibration). */
  onRawIndex?(p: { x: number; y: number } | null, pinch: boolean): void;
}

export interface HandTrackerOptions {
  bus: InputBus;
  calibration?: Calibration;
  primaryHand?: 'left' | 'right';
  face?: boolean;
  baseUrl?: string;
  /** For tests: inject a worker factory. */
  createWorker?: () => Worker;
  /** No camera / worker: landmarks are injected (window.__medsim.injectLandmarks) — demos and e2e tests. */
  simulate?: boolean;
}

export class HandTracker {
  private stream: MediaStream | null = null;
  private video: HTMLVideoElement | null = null;
  private worker: Worker | null = null;
  private inFlight = false;
  private frameId = 0;
  private running = false;
  private recognizer: GestureRecognizer;
  private status: TrackingStatus = 'off';
  private rafHandle = 0;
  private lastHands = 0;

  constructor(private opts: HandTrackerOptions, private cb: HandTrackerCallbacks) {
    this.recognizer = new GestureRecognizer({ primaryHand: opts.primaryHand ?? 'right', calibration: opts.calibration, smoothing: true });
  }

  private setStatus(s: TrackingStatus, detail?: string) {
    if (s === this.status && !detail) return;
    this.status = s;
    this.cb.onStatus(s, detail);
  }

  getStatus() { return this.status; }

  setCalibration(c: Calibration) { this.recognizer.setCalibration(c); }
  setPrimaryHand(h: 'left' | 'right') { this.recognizer.setPrimaryHand(h); }
  setFace(on: boolean) { this.post({ type: 'config', face: on }); }

  /** Starts camera + worker. Resolves false (status 'unavailable') when no camera can be opened. */
  async start(): Promise<boolean> {
    if (this.running) return true;
    this.setStatus('starting');
    if (this.opts.simulate) {
      this.running = true;
      this.setStatus('no-hand');
      return true;
    }
    if (!navigator.mediaDevices?.getUserMedia) {
      this.setStatus('unavailable', 'no-media-devices');
      return false;
    }
    try {
      this.stream = await navigator.mediaDevices.getUserMedia({ video: { width: { ideal: 1280 }, height: { ideal: 720 }, frameRate: { ideal: 60 }, facingMode: 'user' }, audio: false });
    } catch (e) {
      this.setStatus('unavailable', e instanceof Error ? e.name : 'camera-error');
      return false;
    }
    const video = document.createElement('video');
    video.muted = true;
    video.playsInline = true;
    video.srcObject = this.stream;
    this.video = video;
    try { await video.play(); } catch { /* autoplay is allowed for muted video */ }
    try {
      this.worker = this.opts.createWorker?.() ?? new Worker(new URL('./vision.worker.ts', import.meta.url), { type: 'module' });
    } catch (e) {
      this.setStatus('error', e instanceof Error ? e.message : 'worker');
      this.stopCamera();
      return false;
    }
    this.worker.onmessage = (ev: MessageEvent<FromWorker>) => this.onWorker(ev.data);
    this.worker.onerror = (ev) => this.setStatus('error', ev.message);
    this.post({ type: 'init', baseUrl: this.opts.baseUrl ?? '/mediapipe', hands: true, face: !!this.opts.face, numHands: 2, inputMirrored: false });
    this.running = true;
    return true;
  }

  private post(m: ToWorker, transfer: Transferable[] = []) {
    this.worker?.postMessage(m, transfer);
  }

  /** Handle a worker message (public for landmark injection in simulate mode). */
  onWorker(m: FromWorker) {
    if (m.type === 'ready') {
      this.setStatus('no-hand');
      this.pump();
      return;
    }
    if (m.type === 'error') {
      this.inFlight = false;
      this.setStatus('error', m.message);
      return;
    }
    this.inFlight = false;
    const frame: TrackingFrame = { t: m.t, hands: m.hands };
    const events = this.recognizer.process(frame);
    for (const e of events) this.opts.bus.emit(e);
    const point = [...events].reverse().find((e) => e.type === 'point' || e.type === 'select');
    if (m.hands.length) {
      this.lastHands = m.t;
      this.setStatus('tracking');
      const primary = m.hands.find((h) => h.handedness.toLowerCase() === (this.opts.primaryHand ?? 'right')) ?? m.hands[0];
      const tip = primary.landmarks[8];
      const pinch = pinchDistance(primary) < 0.35;
      this.cb.onRawIndex?.({ x: tip.x, y: tip.y }, pinch);
      if (point && (point.type === 'point' || point.type === 'select')) this.cb.onCursor?.({ x: point.x, y: point.y, captureT: m.t, pinching: pinch });
    } else {
      if (m.t - this.lastHands > 500) this.setStatus('no-hand');
      this.cb.onRawIndex?.(null, false);
    }
    this.cb.onFace?.(m.face);
  }

  /** Capture the next video frame and send it to the worker (backpressure: one in flight). */
  private pump = () => {
    if (!this.running) return;
    const video = this.video;
    const schedule = () => {
      if (!this.running) return;
      const v = this.video as HTMLVideoElement & { requestVideoFrameCallback?: (cb: () => void) => number };
      if (v?.requestVideoFrameCallback) v.requestVideoFrameCallback(() => this.pump());
      else this.rafHandle = requestAnimationFrame(() => this.pump());
    };
    if (!video || this.inFlight || video.readyState < 2) { schedule(); return; }
    const t = performance.now();
    this.inFlight = true;
    const send = (frame: ImageBitmap | VideoFrame) => {
      if (!this.running) { frame.close(); return; }
      this.post({ type: 'frame', id: ++this.frameId, t, frame }, [frame as unknown as Transferable]);
    };
    try {
      if (typeof VideoFrame !== 'undefined') {
        send(new VideoFrame(video, { timestamp: Math.round(t * 1000) }));
      } else {
        createImageBitmap(video).then(send, () => { this.inFlight = false; });
      }
    } catch {
      this.inFlight = false;
    }
    schedule();
  };

  private stopCamera() {
    this.stream?.getTracks().forEach((tr) => tr.stop());
    this.stream = null;
    if (this.video) { this.video.srcObject = null; this.video = null; }
  }

  stop() {
    this.running = false;
    cancelAnimationFrame(this.rafHandle);
    this.post({ type: 'close' });
    this.worker?.terminate();
    this.worker = null;
    this.inFlight = false;
    this.stopCamera();
    try { this.recognizer.reset(); } catch { /* ignore */ }
    this.setStatus('off');
  }
}
