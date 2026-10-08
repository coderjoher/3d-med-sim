import { useEffect, useMemo } from 'react';
import { InputBus, t, type CameraView, type Lang } from '@medsim/core';
import { ModelViewer } from './ModelViewer';
import { resolveModel } from './models';

/**
 * V-09: normal vs pathological side by side. Both viewers share one semantic input
 * bus, so every rotate / zoom / pan / reset (mouse, touch, keyboard or gesture on
 * either pane) moves both cameras identically — the views stay in sync.
 */
export function ComparisonView(props: { modelId: string; variant: string; view?: CameraView; inputBus?: InputBus; lang?: Lang; hiddenLayers?: string[] }) {
  const local = useMemo(() => new InputBus(), []);
  const bus = local;
  // forward external (gesture/keyboard) camera events into the shared comparison bus
  useEffect(() => {
    if (!props.inputBus) return;
    return props.inputBus.on((e) => { if (e.type !== 'select' && e.type !== 'point') local.emit(e); });
  }, [props.inputBus, local]);
  const model = resolveModel(props.modelId);
  const normal = model?.variants.find((v) => !v.pathological)?.id ?? 'normal';
  const path = model?.variants.find((v) => v.id === props.variant);
  const lang: Lang = props.lang ?? (typeof document !== 'undefined' && document.documentElement.lang === 'ar' ? 'ar' : 'en');
  const cap = (en: string, ar: string) => (lang === 'ar' ? ar : en);
  return (
    <div className="comparison-view" data-testid="comparison-view">
      <div className="comparison-pane">
        <div className="comparison-caption">{cap('Normal', 'طبيعي')}</div>
        <ModelViewer modelId={props.modelId} variant={normal} view={props.view} inputBus={bus} primary={false} testId="compare-normal" hiddenLayers={props.hiddenLayers} />
      </div>
      <div className="comparison-pane">
        <div className="comparison-caption">{path ? t(path.name, lang) : props.variant}</div>
        <ModelViewer modelId={props.modelId} variant={props.variant} view={props.view} inputBus={bus} primary={false} testId="compare-pathological" hiddenLayers={props.hiddenLayers} />
      </div>
    </div>
  );
}
