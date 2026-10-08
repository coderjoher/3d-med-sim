import { useEffect, useRef, useState } from 'react';
import { InputBus, type CameraView, type ModelDef, type SemanticEvent } from '@medsim/core';
import type { ViewerController, ParallaxOffset } from './controller';
import { PointerTranslator } from './pointerInput';
import { debugRoot, registerViewer, unregisterViewer, type ViewerTestApi } from './debug';
import { resolveModel } from './models';
import './viewer.css';

export interface ModelViewerProps {
  modelId: string; variant: string;
  view?: CameraView;                 // preset or custom; changing it animates/moves camera
  labelsVisible?: boolean;
  hiddenLayers?: string[];
  selectedIds?: string[];            // highlighted structures
  isolateId?: string | null;
  onSelect?(structureId: string | null): void;   // click/pinch picking
  onViewChange?(view: CameraView): void;         // current camera as {camera:'custom',alpha,beta,radius}
  clipping?: { axis: 'x' | 'y' | 'z'; offset: number } | null;  // V-07
  animate?: boolean;                 // V-08 cardiac cycle
  stereo?: boolean;                  // T3-04 side-by-side stereo output mode
  className?: string; testId?: string;
  // ---- optional extensions
  /** Shared semantic input bus (gestures, keyboard). The viewer also publishes its own mouse/touch events to it. */
  inputBus?: InputBus;
  /** Hovered structure (mouse hover / hand pointer) — used for "structures viewed" logging. */
  onHover?(structureId: string | null): void;
  /** Head-tracked parallax offset (I-06). */
  parallax?: ParallaxOffset | null;
  /** Label language. Defaults to the document language. */
  lang?: 'en' | 'ar';
  /** Override the registry model (e.g. an unsaved model in authoring). */
  model?: ModelDef;
  /** Register as window.__medsim.viewer (default true). */
  primary?: boolean;
  /** Called once the model is built. */
  onReady?(): void;
}

type Status = 'loading' | 'ready' | 'unsupported' | 'error';

function isJsdom() {
  return typeof navigator !== 'undefined' && /jsdom/i.test(navigator.userAgent);
}

let viewerSeq = 0;

export function ModelViewer(props: ModelViewerProps) {
  const containerRef = useRef<HTMLDivElement>(null);
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const labelRef = useRef<HTMLDivElement>(null);
  const ctrlRef = useRef<ViewerController | null>(null);
  const propsRef = useRef(props);
  propsRef.current = props;
  const [status, setStatus] = useState<Status>(isJsdom() ? 'unsupported' : 'loading');
  const [error, setError] = useState<string>('');
  const internalBus = useRef<InputBus | null>(null);
  const bus = props.inputBus ?? (internalBus.current ??= new InputBus());
  const model = props.model ?? resolveModel(props.modelId);
  const key = props.testId ?? `viewer-${props.modelId}`;

  // ---------------------------------------------------------------- engine + scene lifecycle
  useEffect(() => {
    if (isJsdom()) { debugRoot().engine = 'unsupported'; return; }
    const canvas = canvasRef.current;
    if (!canvas) return;
    if (!model) { setStatus('error'); setError(`Unknown model "${props.modelId}"`); return; }
    let cancelled = false;
    let cleanup: (() => void) | undefined;
    setStatus('loading');
    (async () => {
      try {
        const mod = await import('./controller');
        if (cancelled) return;
        const { engine, kind } = await mod.createEngine(canvas);
        if (cancelled) { engine.dispose(); return; }
        const ctrl = new mod.ViewerController(engine, {
          model,
          variant: props.variant,
          onSelect: (id) => propsRef.current.onSelect?.(id),
          onHover: (id) => propsRef.current.onHover?.(id),
          onViewChange: (v) => propsRef.current.onViewChange?.(v),
        });
        await ctrl.ready;
        if (cancelled) { ctrl.dispose(); engine.dispose(); return; }
        ctrlRef.current = ctrl;
        const p = propsRef.current;
        ctrl.setView(p.view ?? { camera: 'anterior' }, 0);
        ctrl.setHiddenLayers(p.hiddenLayers);
        ctrl.setIsolate(p.isolateId);
        ctrl.setSelected(p.selectedIds);
        ctrl.setLabelHost(labelRef.current);
        ctrl.setLabelLang(p.lang ?? (document.documentElement.lang === 'ar' ? 'ar' : 'en'));
        ctrl.setLabelsVisible(!!p.labelsVisible);
        ctrl.setClipping(p.clipping);
        ctrl.setAnimate(!!p.animate);
        ctrl.setStereo(!!p.stereo);
        ctrl.setParallax(p.parallax ?? null);
        engine.runRenderLoop(() => ctrl.scene.render());
        const onResize = () => engine.resize();
        const ro = typeof ResizeObserver !== 'undefined' ? new ResizeObserver(onResize) : null;
        ro?.observe(canvas);
        window.addEventListener('resize', onResize);
        const root = debugRoot();
        root.engine = kind;
        const primary = p.primary !== false;
        const fpsTimer = setInterval(() => { if (primary) root.fps = Math.round(engine.getFps() * 10) / 10; }, 500);
        // colour-blind palette switch (NFR accessibility) re-reads CSS vars
        const mo = new MutationObserver(() => ctrl.refreshPalette());
        mo.observe(document.documentElement, { attributes: true, attributeFilter: ['data-palette'] });
        const rect = () => canvas.getBoundingClientRect();
        const api: ViewerTestApi = {
          ready: true,
          modelId: model.id,
          variant: props.variant,
          getCamera: () => ctrl.getCamera(),
          getVisibleStructures: () => ctrl.getVisibleStructures(),
          getSelected: () => ctrl.getSelected(),
          getIsolated: () => ctrl.getIsolated(),
          getLabelsVisible: () => ctrl.getLabelsVisible(),
          getClipping: () => ctrl.getClipping(),
          isAnimating: () => ctrl.isAnimating(),
          animationScale: (id) => ctrl.animationScale(id),
          getStereo: () => ctrl.getStereo(),
          structureInfo: (id) => ctrl.structureInfo(id),
          pickAt: (x, y) => { const r = rect(); return ctrl.pickAt(x - r.left, y - r.top, r); },
          structureScreenPos: (id) => {
            ctrl.scene.render();
            const r = rect();
            const p2 = ctrl.structureScreenPos(id, r);
            return p2 ? { x: p2.x + r.left, y: p2.y + r.top } : null;
          },
        };
        registerViewer(key, api, primary);
        setStatus('ready');
        p.onReady?.();
        cleanup = () => {
          clearInterval(fpsTimer);
          mo.disconnect();
          ro?.disconnect();
          window.removeEventListener('resize', onResize);
          unregisterViewer(key, api);
          engine.stopRenderLoop();
          ctrl.dispose();
          engine.dispose();
          ctrlRef.current = null;
        };
      } catch (e) {
        if (cancelled) return;
        console.error('[viewer] failed to start', e);
        debugRoot().engine = 'unsupported';
        setStatus('unsupported');
        setError(e instanceof Error ? e.message : String(e));
      }
    })();
    return () => { cancelled = true; cleanup?.(); };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [props.modelId, props.variant, model?.asset_url]);

  // ---------------------------------------------------------------- prop sync
  const viewKey = JSON.stringify(props.view ?? null);
  useEffect(() => { if (props.view) ctrlRef.current?.setView(props.view); }, [viewKey, status]); // eslint-disable-line react-hooks/exhaustive-deps
  const hiddenKey = (props.hiddenLayers ?? []).join('|');
  useEffect(() => { ctrlRef.current?.setHiddenLayers(props.hiddenLayers); }, [hiddenKey, status]); // eslint-disable-line react-hooks/exhaustive-deps
  const selKey = (props.selectedIds ?? []).join('|');
  useEffect(() => { ctrlRef.current?.setSelected(props.selectedIds); }, [selKey, status]); // eslint-disable-line react-hooks/exhaustive-deps
  useEffect(() => { ctrlRef.current?.setIsolate(props.isolateId); }, [props.isolateId, status]);
  useEffect(() => { ctrlRef.current?.setLabelsVisible(!!props.labelsVisible); }, [props.labelsVisible, status]);
  useEffect(() => { if (props.lang) ctrlRef.current?.setLabelLang(props.lang); }, [props.lang, status]);
  const clipKey = JSON.stringify(props.clipping ?? null);
  useEffect(() => { ctrlRef.current?.setClipping(props.clipping); }, [clipKey, status]); // eslint-disable-line react-hooks/exhaustive-deps
  useEffect(() => { ctrlRef.current?.setAnimate(!!props.animate); }, [props.animate, status]);
  useEffect(() => { ctrlRef.current?.setStereo(!!props.stereo); }, [props.stereo, status]);
  const parKey = JSON.stringify(props.parallax ?? null);
  useEffect(() => { ctrlRef.current?.setParallax(props.parallax ?? null); }, [parKey, status]); // eslint-disable-line react-hooks/exhaustive-deps

  // ---------------------------------------------------------------- semantic input
  useEffect(() => {
    const off = bus.on((e: SemanticEvent) => {
      const ctrl = ctrlRef.current;
      const canvas = canvasRef.current;
      if (!ctrl || !canvas) return;
      if (e.type === 'select' || e.type === 'point') {
        const r = canvas.getBoundingClientRect();
        const cx = e.x * window.innerWidth;
        const cy = e.y * window.innerHeight;
        if (cx < r.left || cx > r.right || cy < r.top || cy > r.bottom) return;
        if (e.source === 'gesture') {
          // a pinch over an on-screen control is a UI click, not a model pick
          const el = document.elementFromPoint(cx, cy);
          if (el && !containerRef.current?.contains(el)) return;
        }
        ctrl.applyEvent(e, r);
        return;
      }
      ctrl.applyEvent(e);
    });
    return off;
  }, [bus]);

  // mouse / touch -> semantic events
  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas || status !== 'ready') return;
    const tr = new PointerTranslator();
    const emit = (evs: SemanticEvent[]) => evs.forEach((e) => bus.emit(e));
    const sample = (kind: 'down' | 'move' | 'up' | 'cancel') => (ev: PointerEvent) => {
      if (kind === 'down') { try { canvas.setPointerCapture(ev.pointerId); } catch { /* ignore */ } }
      emit(tr.handle({ kind, id: ev.pointerId, x: ev.clientX, y: ev.clientY, button: ev.button, shift: ev.shiftKey, pointerType: ev.pointerType }));
    };
    const down = sample('down'), move = sample('move'), up = sample('up'), cancel = sample('cancel');
    let lastWheel = 0;
    const wheel = (ev: WheelEvent) => {
      ev.preventDefault();
      const now = performance.now();
      if (now - lastWheel < 16) return;
      lastWheel = now;
      const factor = Math.pow(1.0015, -ev.deltaY);
      bus.emit({ type: 'zoom', factor: Math.min(1.5, Math.max(0.67, factor)), source: 'mouse' });
    };
    const ctx = (ev: Event) => ev.preventDefault();
    canvas.addEventListener('pointerdown', down);
    canvas.addEventListener('pointermove', move);
    canvas.addEventListener('pointerup', up);
    canvas.addEventListener('pointercancel', cancel);
    canvas.addEventListener('wheel', wheel, { passive: false });
    canvas.addEventListener('contextmenu', ctx);
    return () => {
      canvas.removeEventListener('pointerdown', down);
      canvas.removeEventListener('pointermove', move);
      canvas.removeEventListener('pointerup', up);
      canvas.removeEventListener('pointercancel', cancel);
      canvas.removeEventListener('wheel', wheel);
      canvas.removeEventListener('contextmenu', ctx);
    };
  }, [bus, status]);

  return (
    <div
      ref={containerRef}
      className={`model-viewer ${props.className ?? ''}`}
      data-testid={props.testId ?? 'model-viewer'}
      data-state={status}
      data-model={props.modelId}
      data-variant={props.variant}
      data-labels={props.labelsVisible ? 'on' : 'off'}
      data-selected={(props.selectedIds ?? []).join(' ')}
      data-hidden-layers={(props.hiddenLayers ?? []).join(' ')}
      data-isolate={props.isolateId ?? ''}
      data-stereo={props.stereo ? 'on' : 'off'}
    >
      <canvas ref={canvasRef} className="model-viewer-canvas" touch-action="none" aria-label="3D model" />
      <div ref={labelRef} className="model-viewer-labels" aria-hidden="true" />
      {status === 'loading' && <div className="model-viewer-msg">Loading model…</div>}
      {status === 'unsupported' && <div className="model-viewer-msg">3D view unavailable{error ? `: ${error}` : ''}</div>}
      {status === 'error' && <div className="model-viewer-msg error">{error}</div>}
    </div>
  );
}
