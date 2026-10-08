import { useState } from 'react';
import type { CameraView, ModelDef } from '@medsim/core';
import { usePrefs } from '../../shared/prefs';
import { ComparisonView } from '../../viewer/ComparisonView';
import { CAMERA_PRESETS } from '../author/caseForm';
import { useApi } from '../hooks';
import { ErrorBox, Loading } from '../ui';

/** Side-by-side normal vs pathological comparison (V-09) for authors and reviewers. */
export function ComparePage() {
  const { s, tx } = usePrefs();
  const models = useApi<ModelDef[]>('/models');
  const [modelSel, setModelSel] = useState('');
  const [variantSel, setVariantSel] = useState('');
  const [camera, setCamera] = useState<CameraView['camera']>('anterior');
  const model = models.data?.find((m) => m.id === modelSel) ?? models.data?.[0];
  const variants = (model?.variants ?? []).filter((v) => v.pathological);
  const variant = variants.find((v) => v.id === variantSel)?.id ?? variants[0]?.id ?? model?.variants[0]?.id;
  return (
    <div>
      <h1>{s('compare')}</h1>
      <ErrorBox error={models.error} />
      <Loading when={models.loading}>
        <div className="row portal-section">
          <label>{s('model')}{' '}
            <select data-testid="compare-model" value={model?.id ?? ''} onChange={(e) => { setModelSel(e.target.value); setVariantSel(''); }}>
              {(models.data ?? []).map((m) => <option key={m.id} value={m.id}>{tx(m.name)}</option>)}
            </select>
          </label>
          <label>{s('pathological')}{' '}
            <select data-testid="compare-variant" value={variant ?? ''} onChange={(e) => setVariantSel(e.target.value)}>
              {variants.map((v) => <option key={v.id} value={v.id}>{tx(v.name)}</option>)}
            </select>
          </label>
          <label>{s('p.camera_preset')}{' '}
            <select value={camera} onChange={(e) => setCamera(e.target.value as CameraView['camera'])}>
              {CAMERA_PRESETS.filter((c) => c !== 'custom').map((c) => <option key={c} value={c}>{s(`p.camera.${c}`)}</option>)}
            </select>
          </label>
        </div>
        {model && variant && <ComparisonView modelId={model.id} variant={variant} view={{ camera }} />}
        {model && !variants.length && <p className="muted">{s('p.no_pathology')}</p>}
      </Loading>
    </div>
  );
}
