import type { CameraView } from '@medsim/core';
import { ModelViewer } from './ModelViewer';
export function ComparisonView(props: { modelId: string; variant: string; view?: CameraView }) {
  return (
    <div className="comparison-view" data-testid="comparison-view">
      <ModelViewer modelId={props.modelId} variant="normal" view={props.view} />
      <ModelViewer modelId={props.modelId} variant={props.variant} view={props.view} />
    </div>
  );
}
