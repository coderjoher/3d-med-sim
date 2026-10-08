/**
 * Station input manager (PRD §7 "one input language", I-01..I-08):
 * one semantic InputBus fed by hand gestures (worker + core GestureRecognizer),
 * mouse/touch (inside the viewer) and keyboard. Fallback input is always
 * available; gesture mode can be switched by the student or remotely by the proctor.
 */
import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import {
  DEFAULT_CALIBRATION, InputBus, headPoseFromFace, keyToSemantic, parallaxOffset,
  type Calibration, type Landmark, type SemanticEvent,
} from '@medsim/core';
import { HandTracker, type TrackingStatus } from './handTracking';
import type { VisionLandmarks } from './visionProtocol';
import { debugRoot } from '../viewer/debug';

export type InputMode = 'gesture' | 'fallback';

export interface ParallaxOffsetValue { dAlpha: number; dBeta: number; radiusScale: number }

export interface StationInputCtx {
  bus: InputBus;
  mode: InputMode;
  setMode(m: InputMode, by?: 'student' | 'proctor' | 'system'): Promise<void>;
  status: TrackingStatus;
  cameraOk: boolean;
  handLost: boolean;
  cursor: { x: number; y: number; pinching: boolean } | null;
  /** UI string key for a transient notice (camera unavailable, proctor switch...). */
  notice: { key: string; vars?: Record<string, string> } | null;
  dismissNotice(): void;
  calibration: Calibration;
  setCalibration(c: Calibration): void;
  /** Subscribe to raw (camera-normalised) index-tip positions for calibration. */
  onRawIndex(fn: (p: { x: number; y: number } | null, pinch: boolean) => void): () => void;
  parallaxOn: boolean;
  setParallaxOn(v: boolean): void;
  parallax: ParallaxOffsetValue | null;
  stereo: boolean;
  setStereo(v: boolean): void;
  primaryHand: 'left' | 'right';
}

const Ctx = createContext<StationInputCtx | null>(null);

/** Optional access (CasePlayer also runs outside the station, e.g. author preview). */
export function useStationInput(): StationInputCtx | null {
  return useContext(Ctx);
}

const INTERACTIVE = 'button, [role="button"], a, input, select, textarea, label, summary, [data-gesture-target]';

export function StationInputProvider({ children, initialMode = 'gesture', primaryHand = 'right' }: { children: ReactNode; initialMode?: InputMode; primaryHand?: 'left' | 'right' }) {
  const bus = useMemo(() => new InputBus(), []);
  const [mode, setModeState] = useState<InputMode>(initialMode);
  const [status, setStatus] = useState<TrackingStatus>('off');
  const [handLost, setHandLost] = useState(false);
  const [cursor, setCursor] = useState<StationInputCtx['cursor']>(null);
  const [notice, setNotice] = useState<StationInputCtx['notice']>(null);
  const [calibration, setCalibrationState] = useState<Calibration>(DEFAULT_CALIBRATION);
  const [parallaxOn, setParallaxOn] = useState(false);
  const [parallax, setParallax] = useState<ParallaxOffsetValue | null>(null);
  const [stereo, setStereo] = useState(false);
  const trackerRef = useRef<HandTracker | null>(null);
  const rawListeners = useRef(new Set<(p: { x: number; y: number } | null, pinch: boolean) => void>());
  const latency = useRef<number[]>([]);
  const parallaxOnRef = useRef(parallaxOn);
  parallaxOnRef.current = parallaxOn;
  const lastFace = useRef(0);

  const ensureTracker = useCallback(() => {
    if (trackerRef.current) return trackerRef.current;
    const tr = new HandTracker({ bus, calibration, primaryHand, face: parallaxOnRef.current }, {
      onStatus: (s) => setStatus(s),
      onCursor: (p) => {
        if (!p) { setCursor(null); return; }
        setCursor({ x: p.x, y: p.y, pinching: p.pinching });
        // hand-to-cursor latency: frame capture -> cursor painted (§13, T0-26)
        requestAnimationFrame(() => {
          const arr = latency.current;
          arr.push(performance.now() - p.captureT);
          if (arr.length > 600) arr.shift();
          debugRoot().latency = arr;
        });
      },
      onRawIndex: (p, pinch) => rawListeners.current.forEach((fn) => fn(p, pinch)),
      onFace: (lm: Landmark[] | null) => {
        if (!parallaxOnRef.current || !lm) return;
        const now = performance.now();
        if (now - lastFace.current < 33) return;
        lastFace.current = now;
        setParallax(parallaxOffset(headPoseFromFace(lm, { mirror: true }), 0.25));
      },
    });
    trackerRef.current = tr;
    // Test / diagnostics hook: feed landmark messages exactly as the worker would.
    debugRoot().injectLandmarks = (m: Omit<VisionLandmarks, 'type' | 'id' | 'procMs'> & Partial<VisionLandmarks>) => {
      (tr as unknown as { onWorker(m: VisionLandmarks): void }).onWorker({ id: 0, procMs: 0, ...m, face: m.face ?? null, type: 'landmarks' });
    };
    return tr;
  }, [bus, calibration, primaryHand]);

  const setMode = useCallback(async (m: InputMode, by: 'student' | 'proctor' | 'system' = 'student') => {
    if (m === 'fallback') {
      trackerRef.current?.stop();
      setModeState('fallback');
      setHandLost(false);
      setCursor(null);
      if (by === 'proctor') setNotice({ key: 'input.switched_by_proctor', vars: { mode: 'input.fallback' } });
      return;
    }
    setModeState('gesture');
    if (by === 'proctor') setNotice({ key: 'input.switched_by_proctor', vars: { mode: 'input.gesture' } });
    const ok = await ensureTracker().start();
    if (!ok) {
      // Camera unavailable -> automatic fallback with a notice (I-05)
      setModeState('fallback');
      setNotice({ key: 'camera_unavailable' });
    }
  }, [ensureTracker]);

  // start in the initial mode
  useEffect(() => {
    if (initialMode === 'gesture') void setMode('gesture', 'system');
    return () => { trackerRef.current?.stop(); trackerRef.current = null; };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // tracking failure (e.g. models missing) -> fallback notice; mouse keeps working throughout
  useEffect(() => {
    if (status === 'error' && mode === 'gesture') setNotice({ key: 'input.error' });
  }, [status, mode]);

  useEffect(() => { trackerRef.current?.setFace(parallaxOn); if (!parallaxOn) setParallax(null); }, [parallaxOn]);
  useEffect(() => { trackerRef.current?.setPrimaryHand(primaryHand); }, [primaryHand]);

  const setCalibration = useCallback((c: Calibration) => {
    setCalibrationState(c);
    trackerRef.current?.setCalibration(c);
  }, []);

  // hand-lost / found, gesture clicks on on-screen controls, hover feedback
  useEffect(() => {
    let hoverEl: Element | null = null;
    return bus.on((e: SemanticEvent) => {
      if (e.type === 'hand-lost') setHandLost(true);
      else if (e.type === 'hand-found') setHandLost(false);
      else if (e.source === 'gesture' && (e.type === 'point' || e.type === 'select')) {
        const x = e.x * window.innerWidth;
        const y = e.y * window.innerHeight;
        setCursor((c) => ({ x: e.x, y: e.y, pinching: c?.pinching ?? false }));
        const el = document.elementFromPoint(x, y);
        const target = el?.closest(INTERACTIVE) ?? null;
        if (hoverEl !== target) {
          hoverEl?.classList.remove('hand-hover');
          target?.classList.add('hand-hover');
          hoverEl = target;
        }
        // "Pinch on on-screen controls" (PRD gesture table) -> click
        if (e.type === 'select' && target && !el?.closest('.model-viewer')) {
          (target as HTMLElement).focus?.();
          (target as HTMLElement).click();
        }
      }
    });
  }, [bus]);

  // keyboard fallback (always on)
  useEffect(() => {
    const onKey = (ev: KeyboardEvent) => {
      const t = ev.target as HTMLElement | null;
      if (t && (t.closest('input, textarea, select, [contenteditable="true"]'))) return;
      if (ev.ctrlKey || ev.altKey || ev.metaKey) return;
      const e = keyToSemantic(ev.key, ev.shiftKey);
      if (!e) return;
      // keep focused buttons/links usable with the keyboard
      if (t && t.closest('button, a, [role="button"]') && (ev.key === ' ' || ev.key === 'Enter')) return;
      ev.preventDefault();
      bus.emit(e);
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [bus]);

  const onRawIndex = useCallback((fn: (p: { x: number; y: number } | null, pinch: boolean) => void) => {
    rawListeners.current.add(fn);
    return () => { rawListeners.current.delete(fn); };
  }, []);

  const value: StationInputCtx = {
    bus, mode, setMode, status,
    cameraOk: status === 'tracking' || status === 'no-hand',
    handLost: mode === 'gesture' && handLost,
    cursor: mode === 'gesture' ? cursor : null,
    notice, dismissNotice: () => setNotice(null),
    calibration, setCalibration, onRawIndex,
    parallaxOn, setParallaxOn, parallax: parallaxOn ? parallax : null,
    stereo, setStereo, primaryHand,
  };
  return <Ctx.Provider value={value}>{children}</Ctx.Provider>;
}
