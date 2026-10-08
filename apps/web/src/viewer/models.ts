import { MODELS, getModel, type ModelDef, type StructureDef } from '@medsim/core';

/** Look up a model in the core registry (tolerates core content still being stubbed). */
export function resolveModel(id: string): ModelDef | undefined {
  try {
    const m = getModel(id);
    if (m) return m;
  } catch { /* fall through */ }
  return (MODELS ?? []).find((m) => m.id === id);
}

export function structureName(model: ModelDef | undefined, id: string): StructureDef['name'] {
  return model?.structures.find((s) => s.id === id)?.name ?? id.replace(/^TA:/, '').replace(/_/g, ' ');
}
