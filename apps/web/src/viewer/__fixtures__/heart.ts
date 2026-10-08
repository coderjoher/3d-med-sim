import type { ModelDef } from '@medsim/core';
/** Test fixture mirroring the shape of core's heart_v1 (used until/unless core MODELS is available). */
export const HEART_FIXTURE: ModelDef = {
  id: 'heart_v1', organ: 'heart', name: 'Heart', version: 1,
  layers: [
    { id: 'pericardium', name: 'Pericardium' },
    { id: 'myocardium', name: 'Myocardium' },
    { id: 'valves', name: 'Valves' },
    { id: 'vessels', name: 'Great vessels' },
    { id: 'coronary', name: 'Coronary' },
  ],
  structures: [
    { id: 'TA:pericardium', name: 'Pericardium', layer: 'pericardium' },
    { id: 'TA:left_ventricle', name: 'Left ventricle', layer: 'myocardium' },
    { id: 'TA:right_ventricle', name: 'Right ventricle', layer: 'myocardium' },
    { id: 'TA:left_atrium', name: 'Left atrium', layer: 'myocardium' },
    { id: 'TA:right_atrium', name: 'Right atrium', layer: 'myocardium' },
    { id: 'TA:mitral_valve', name: { en: 'Mitral valve', ar: 'الصمام التاجي' }, layer: 'valves' },
    { id: 'TA:tricuspid_valve', name: 'Tricuspid valve', layer: 'valves' },
    { id: 'TA:aortic_valve', name: 'Aortic valve', layer: 'valves' },
    { id: 'TA:aorta', name: 'Aorta', layer: 'vessels' },
    { id: 'TA:pulmonary_trunk', name: 'Pulmonary trunk', layer: 'vessels' },
    { id: 'TA:anterior_interventricular_artery', name: 'LAD', layer: 'coronary' },
    { id: 'TA:mystery_structure', name: 'Unknown', layer: 'vessels' },
  ],
  variants: [
    { id: 'normal', name: 'Normal', pathological: false },
    { id: 'mitral_stenosis', name: 'Mitral stenosis', pathological: true, affects: ['TA:mitral_valve', 'TA:left_atrium'] },
    { id: 'myocardial_infarction', name: 'MI', pathological: true, affects: ['TA:left_ventricle'] },
  ],
  animations: ['cardiac_cycle'],
};
