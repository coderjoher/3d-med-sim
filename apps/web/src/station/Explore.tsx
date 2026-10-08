/**
 * Free exploration of a model and its variants (study / demo mode, never graded):
 * layers, labels, isolate, cross-sections (V-07), cardiac-cycle animation (V-08),
 * normal-vs-pathological comparison (V-09) and stereo output (T3-04).
 *
 *   /station/explore?model=heart_v1&variant=mitral_stenosis
 */
import { useMemo, useState } from 'react';
import { MODELS, type CameraView } from '@medsim/core';
import { usePrefs } from '../shared/prefs';
import { ModelViewer } from '../viewer/ModelViewer';
import { ComparisonView } from '../viewer/ComparisonView';
import { resolveModel } from '../viewer/models';
import { StationInputProvider, useStationInput } from './StationInput';
import { AccessibilityBar } from './AccessibilityBar';
import { HandCursor, HandLostWarning, InputNotice } from './HandOverlay';
import './strings';
import './station.css';

export function Explore() {
  const q = useMemo(() => new URLSearchParams(window.location.search), []);
  const { handedness } = usePrefs();
  return (
    <StationInputProvider initialMode={q.get('input') === 'gesture' ? 'gesture' : 'fallback'} primaryHand={handedness}>
      <ExploreInner q={q} />
    </StationInputProvider>
  );
}

const PRESETS: CameraView['camera'][] = ['anterior', 'posterior', 'left', 'right', 'superior', 'inferior'];

function ExploreInner({ q }: { q: URLSearchParams }) {
  const { s, tx, lang } = usePrefs();
  const input = useStationInput()!;
  const [modelId, setModelId] = useState(q.get('model') ?? 'heart_v1');
  const model = resolveModel(modelId);
  const [variant, setVariant] = useState(q.get('variant') ?? 'normal');
  const [hidden, setHidden] = useState<string[]>([]);
  const [labels, setLabels] = useState(q.get('labels') === '1');
  const [selected, setSelected] = useState<string | null>(null);
  const [isolate, setIsolate] = useState<string | null>(null);
  const [clipAxis, setClipAxis] = useState<'off' | 'x' | 'y' | 'z'>('off');
  const [clipOffset, setClipOffset] = useState(0);
  const [animate, setAnimate] = useState(false);
  const [compare, setCompare] = useState(q.get('compare') === '1');
  const [view, setView] = useState<CameraView>({ camera: 'anterior' });
  const vdef = model?.variants.find((v) => v.id === variant);
  return (
    <div className="station-root" data-testid="explore">
      <header className="station-topbar">
        <strong>{s('app.title')}</strong>
        <span className="spacer" />
        <AccessibilityBar />
      </header>
      <main className="station-main">
        <div className="viewer-toolbar" style={{ marginBottom: '0.5rem' }}>
          <label>{s('model')}{' '}
            <select value={modelId} onChange={(e) => { setModelId(e.target.value); setVariant('normal'); setHidden([]); setSelected(null); setIsolate(null); }} data-testid="explore-model">
              {MODELS.map((m) => <option key={m.id} value={m.id}>{tx(m.name)}</option>)}
            </select>
          </label>
          <label>{s('variant')}{' '}
            <select value={variant} onChange={(e) => setVariant(e.target.value)} data-testid="explore-variant">
              {model?.variants.map((v) => <option key={v.id} value={v.id}>{tx(v.name)}</option>)}
            </select>
          </label>
          <select aria-label={s('player.view_preset')} value={view.camera} onChange={(e) => setView({ camera: e.target.value as CameraView['camera'] })} data-testid="view-preset">
            {PRESETS.map((p) => <option key={p} value={p}>{s(`view.${p}`)}</option>)}
          </select>
          <button onClick={() => input.bus.emit({ type: 'reset', source: 'mouse' })} data-testid="reset-view">{s('reset_view')}</button>
          <button onClick={() => setLabels((v) => !v)} aria-pressed={labels} data-testid="labels-toggle">{labels ? s('labels.hide') : s('labels.show')}</button>
          {isolate ? <button onClick={() => setIsolate(null)} data-testid="unisolate">{s('unisolate')}</button>
            : <button disabled={!selected} onClick={() => setIsolate(selected)} data-testid="isolate">{s('isolate')}</button>}
          <label>{s('cross_section')}{' '}
            <select value={clipAxis} onChange={(e) => setClipAxis(e.target.value as typeof clipAxis)} data-testid="clip-axis">
              <option value="off">{s('player.clip_off')}</option>
              <option value="x">{s('axis.x')}</option><option value="y">{s('axis.y')}</option><option value="z">{s('axis.z')}</option>
            </select>
          </label>
          {clipAxis !== 'off' && <input type="range" min={-1} max={1} step={0.05} value={clipOffset} onChange={(e) => setClipOffset(Number(e.target.value))} aria-label={s('player.clip_offset')} data-testid="clip-offset" />}
          {!!model?.animations?.length && <button onClick={() => setAnimate((a) => !a)} aria-pressed={animate} data-testid="animate-toggle">{s('animation')}: {animate ? s('pause') : s('play')}</button>}
          {vdef?.pathological && <button onClick={() => setCompare((c) => !c)} aria-pressed={compare} data-testid="compare-toggle">{s('compare')}</button>}
          <span data-testid="selected-name">{selected ? s('selected', { name: tx(model?.structures.find((x) => x.id === selected)?.name ?? selected) }) : s('nothing_selected')}</span>
        </div>
        <fieldset className="layer-panel" style={{ marginBottom: '0.5rem' }}>
          <legend>{s('layers')}</legend>
          {model?.layers.map((l) => (
            <label key={l.id} className="layer-toggle">
              <input type="checkbox" checked={!hidden.includes(l.id)} onChange={() => setHidden((h) => (h.includes(l.id) ? h.filter((x) => x !== l.id) : [...h, l.id]))} data-testid={`layer-${l.id}`} />
              {tx(l.name)}
            </label>
          ))}
        </fieldset>
        <div style={{ flex: 1, minHeight: 320, display: 'flex' }}>
          {compare && vdef?.pathological ? (
            <ComparisonView modelId={modelId} variant={variant} view={view} inputBus={input.bus} lang={lang} hiddenLayers={hidden} />
          ) : (
            <ModelViewer
              key={modelId}
              modelId={modelId} variant={variant} view={view} labelsVisible={labels} hiddenLayers={hidden}
              selectedIds={selected ? [selected] : []} isolateId={isolate} onSelect={setSelected}
              clipping={clipAxis === 'off' ? null : { axis: clipAxis, offset: clipOffset }} animate={animate}
              stereo={input.stereo} parallax={input.parallax} inputBus={input.bus} lang={lang} testId="explore-viewer"
            />
          )}
        </div>
      </main>
      <HandCursor />
      <HandLostWarning />
      <InputNotice />
    </div>
  );
}
