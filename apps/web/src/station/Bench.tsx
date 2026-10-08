/**
 * Performance harness (§13 / §15 exit criteria, T0-26): loads the heaviest model,
 * measures fps over N seconds and hand-to-cursor latency (video-frame capture ->
 * cursor painted), and shows / downloads a JSON report. Sign-off needs the
 * reference lab PC; this page is the tooling.
 *
 *   /station/bench?seconds=10&model=heart_v1&variant=mitral_stenosis&autorun=1
 */
import { useEffect, useMemo, useRef, useState } from 'react';
import { MODELS } from '@medsim/core';
import { usePrefs } from '../shared/prefs';
import { ModelViewer } from '../viewer/ModelViewer';
import { debugRoot } from '../viewer/debug';
import { resolveModel } from '../viewer/models';
import { StationInputProvider, useStationInput } from './StationInput';
import { HandCursor, TrackingIndicator } from './HandOverlay';
import { downloadJson } from './stationData';
import './strings';
import './station.css';

export interface BenchReport {
  kind: 'medsim-bench';
  version: 1;
  at: string;
  user_agent: string;
  engine: string;
  model: string;
  variant: string;
  structures: number;
  resolution: { css: [number, number]; device_pixel_ratio: number; render: [number, number] };
  seconds: number;
  fps: { mean: number; median: number; p5: number; min: number; samples: number };
  frame_ms: { median: number; p95: number };
  latency_ms: { median: number | null; p95: number | null; samples: number };
  targets: { fps_1080p: number; latency_median_ms: number };
  pass: { fps: boolean | null; latency: boolean | null };
}

const pct = (arr: number[], p: number) => {
  if (!arr.length) return NaN;
  const s = [...arr].sort((a, b) => a - b);
  return s[Math.min(s.length - 1, Math.max(0, Math.floor((p / 100) * (s.length - 1))))];
};
const r1 = (n: number) => Math.round(n * 10) / 10;

function heaviestModel(): string {
  const list = MODELS ?? [];
  if (!list.length) return 'heart_v1';
  return [...list].sort((a, b) => b.structures.length - a.structures.length)[0].id;
}

export function Bench() {
  const q = useMemo(() => new URLSearchParams(window.location.search), []);
  const initialMode = q.get('input') === 'gesture' ? 'gesture' : 'fallback';
  return (
    <StationInputProvider initialMode={initialMode}>
      <BenchInner q={q} />
    </StationInputProvider>
  );
}

function BenchInner({ q }: { q: URLSearchParams }) {
  const { s } = usePrefs();
  const input = useStationInput()!;
  const modelId = q.get('model') ?? heaviestModel();
  const model = resolveModel(modelId);
  const variant = q.get('variant') ?? model?.variants.find((v) => v.pathological)?.id ?? 'normal';
  const [seconds, setSeconds] = useState(Number(q.get('seconds')) || 10);
  const [ready, setReady] = useState(false);
  const [running, setRunning] = useState(false);
  const [report, setReport] = useState<BenchReport | null>(null);
  const [animate, setAnimate] = useState(true);
  const autorun = q.get('autorun') === '1';
  const started = useRef(false);

  const run = async () => {
    setRunning(true);
    setReport(null);
    const lat0 = (debugRoot().latency ?? []).length;
    const frames: number[] = [];
    let last = performance.now();
    const end = last + seconds * 1000;
    // continuous camera motion so every frame does real work
    const spin = setInterval(() => input.bus.emit({ type: 'rotate', dx: 0.004, dy: 0, source: 'keyboard' }), 16);
    await new Promise<void>((resolve) => {
      const step = (t: number) => {
        frames.push(t - last);
        last = t;
        if (t < end) requestAnimationFrame(step); else resolve();
      };
      requestAnimationFrame(step);
    });
    clearInterval(spin);
    const ft = frames.slice(1).filter((x) => x > 0);
    const fps = ft.map((x) => 1000 / x);
    const lat = (debugRoot().latency ?? []).slice(lat0);
    const canvas = document.querySelector('.model-viewer-canvas') as HTMLCanvasElement | null;
    const total = ft.reduce((a, b) => a + b, 0);
    const meanFps = ft.length ? (ft.length / total) * 1000 : 0;
    const medLat = lat.length ? pct(lat, 50) : null;
    const rep: BenchReport = {
      kind: 'medsim-bench', version: 1, at: new Date().toISOString(), user_agent: navigator.userAgent,
      engine: String(debugRoot().engine ?? 'unknown'), model: modelId, variant, structures: model?.structures.length ?? 0,
      resolution: { css: [window.innerWidth, window.innerHeight], device_pixel_ratio: window.devicePixelRatio, render: [canvas?.width ?? 0, canvas?.height ?? 0] },
      seconds,
      fps: { mean: r1(meanFps), median: r1(pct(fps, 50) || 0), p5: r1(pct(fps, 5) || 0), min: r1(fps.length ? Math.min(...fps) : 0), samples: fps.length },
      frame_ms: { median: r1(pct(ft, 50) || 0), p95: r1(pct(ft, 95) || 0) },
      latency_ms: { median: medLat === null ? null : r1(medLat), p95: lat.length ? r1(pct(lat, 95)) : null, samples: lat.length },
      targets: { fps_1080p: 60, latency_median_ms: 100 },
      pass: { fps: ft.length ? meanFps >= 60 : null, latency: medLat === null ? null : medLat < 100 },
    };
    (debugRoot() as Record<string, unknown>).benchReport = rep;
    setReport(rep);
    setRunning(false);
  };

  useEffect(() => {
    if (autorun && ready && !started.current) { started.current = true; void run(); }
  }, [autorun, ready]); // eslint-disable-line react-hooks/exhaustive-deps

  return (
    <div className="station-root" data-testid="bench">
      <header className="station-topbar">
        <strong>{s('bench.title')}</strong>
        <span className="small">{modelId} / {variant}</span>
        <span className="spacer" />
        <TrackingIndicator />
        <button onClick={() => void input.setMode(input.mode === 'gesture' ? 'fallback' : 'gesture')}>{input.mode === 'gesture' ? s('switch_to_mouse') : s('switch_to_gestures')}</button>
      </header>
      <main className="station-main" style={{ display: 'grid', gridTemplateColumns: 'minmax(0,3fr) minmax(16rem,1fr)', gap: '0.75rem' }}>
        <div style={{ minHeight: '70vh', display: 'flex' }}>
          <ModelViewer modelId={modelId} variant={variant} animate={animate} labelsVisible={false} inputBus={input.bus} onReady={() => setReady(true)} testId="bench-viewer" />
        </div>
        <aside className="card">
          <label>Seconds <input type="number" min={1} max={120} value={seconds} onChange={(e) => setSeconds(Number(e.target.value) || 10)} data-testid="bench-seconds" /></label>
          <label style={{ display: 'block', margin: '0.5rem 0' }}><input type="checkbox" checked={animate} onChange={(e) => setAnimate(e.target.checked)} /> {s('animation')}</label>
          <p className="muted small">Hand-to-cursor latency is sampled while gesture input is on and a hand is tracked.</p>
          <button className="primary" disabled={!ready || running} onClick={() => void run()} data-testid="bench-run">{running ? s('bench.running') : s('bench.run')}</button>
          {report && (
            <div data-testid="bench-report" data-fps={report.fps.mean}>
              <h3>Report</h3>
              <ul>
                <li>Engine: <strong data-testid="bench-engine">{report.engine}</strong></li>
                <li>FPS mean: <strong data-testid="bench-fps">{report.fps.mean}</strong> (median {report.fps.median}, p5 {report.fps.p5})</li>
                <li>Frame time median / p95: {report.frame_ms.median} / {report.frame_ms.p95} ms</li>
                <li>Latency median: <strong data-testid="bench-latency">{report.latency_ms.median ?? 'n/a'}</strong> ms ({report.latency_ms.samples} samples)</li>
                <li>Render: {report.resolution.render.join('×')} @ DPR {report.resolution.device_pixel_ratio}</li>
              </ul>
              <button onClick={() => downloadJson(`medsim-bench-${report.at.replace(/[:.]/g, '-')}.json`, report)} data-testid="bench-download">{s('bench.download')}</button>
            </div>
          )}
        </aside>
      </main>
      <HandCursor />
    </div>
  );
}
