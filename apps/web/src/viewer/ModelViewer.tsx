import type { CameraView } from '@medsim/core';
export interface ModelViewerProps {
  modelId: string; variant: string;
  view?: CameraView;
  labelsVisible?: boolean;
  hiddenLayers?: string[];
  selectedIds?: string[];
  isolateId?: string | null;
  onSelect?(structureId: string | null): void;
  onViewChange?(view: CameraView): void;
  clipping?: { axis: 'x' | 'y' | 'z'; offset: number } | null;
  animate?: boolean;
  stereo?: boolean;
  className?: string; testId?: string;
}
export function ModelViewer(props: ModelViewerProps) {
  return <div className={props.className} data-testid={props.testId ?? 'model-viewer'} />;
}
