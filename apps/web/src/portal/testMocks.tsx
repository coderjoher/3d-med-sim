/** Stand-ins for WebGL components (jsdom has no WebGL). Used via vi.mock in portal tests. */
import type { CameraView } from '@medsim/core';
import type { ModelViewerProps } from '../viewer/ModelViewer';
import type { CasePlayerProps } from '../station/CasePlayer';

export const CAPTURED_VIEW: CameraView = { camera: 'custom', alpha: 1.2, beta: 0.8, radius: 12 };

export function MockModelViewer(p: ModelViewerProps) {
  const id = p.testId ?? 'model-viewer';
  return (
    <div data-testid={id} data-model={p.modelId} data-variant={p.variant} data-selected={(p.selectedIds ?? []).join(',')} data-hidden={(p.hiddenLayers ?? []).join(',')} data-camera={p.view?.camera ?? ''}>
      <button type="button" data-testid={`${id}-pick-lv`} onClick={() => p.onSelect?.('TA:left_ventricle')}>pick LV</button>
      <button type="button" data-testid={`${id}-pick-mv`} onClick={() => p.onSelect?.('TA:mitral_valve')}>pick MV</button>
      <button type="button" data-testid={`${id}-pick-none`} onClick={() => p.onSelect?.(null)}>pick nothing</button>
      <button type="button" data-testid={`${id}-rotate`} onClick={() => p.onViewChange?.(CAPTURED_VIEW)}>rotate</button>
    </div>
  );
}

export function MockCasePlayer(p: CasePlayerProps) {
  const leaked = p.playerCase.questions.some((q) => 'answer' in q || 'feedback' in q);
  return (
    <div data-testid="case-player" data-mode={p.mode} data-case={p.playerCase.case_id} data-labels={String(!!p.playerCase.labels_visible)} data-keys-leaked={String(leaked)}>
      {p.playerCase.questions.length} questions
    </div>
  );
}

export function MockComparisonView(p: { modelId: string; variant: string; view?: CameraView }) {
  return <div data-testid="comparison-view" data-model={p.modelId} data-variant={p.variant} data-camera={p.view?.camera ?? ''} />;
}
