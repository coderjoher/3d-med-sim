/**
 * Procedural placeholder anatomy (PRD §11: licensed glTF models replace these later
 * through the same ModelDef registry). Pure data — no Babylon imports — so the
 * layout can be unit-tested without WebGL.
 *
 * Coordinate frame (Babylon, left-handed, y up): the patient faces -z (anterior),
 * patient's left = +x. An anterior camera (alpha = -PI/2) therefore shows the
 * left ventricle on the viewer's right, as in a textbook anterior view.
 */

export type Vec3 = [number, number, number];
export type Rgb = [number, number, number];

export type ShapeSpec =
  | { kind: 'ellipsoid'; center: Vec3; radii: Vec3; rotation?: Vec3 }
  | { kind: 'ring'; center: Vec3; diameter: number; thickness: number; rotation?: Vec3 }
  | { kind: 'tube'; path: Vec3[]; radius: number }
  | { kind: 'box'; center: Vec3; size: Vec3; rotation?: Vec3 };

export interface StructureLook {
  color: Rgb;
  alpha?: number;
  roughness?: number;
}

export interface StructureBuild {
  shapes: ShapeSpec[];
  look: StructureLook;
}

const C = {
  myo: [0.58, 0.14, 0.13] as Rgb,
  atrium: [0.68, 0.24, 0.22] as Rgb,
  valve: [0.93, 0.86, 0.72] as Rgb,
  artery: [0.8, 0.16, 0.14] as Rgb,
  vein: [0.24, 0.3, 0.66] as Rgb,
  pulmArtery: [0.42, 0.36, 0.72] as Rgb,
  pericardium: [0.92, 0.84, 0.72] as Rgb,
  coronary: [0.86, 0.22, 0.1] as Rgb,
  conduction: [0.95, 0.75, 0.2] as Rgb,
  cortex: [0.56, 0.2, 0.17] as Rgb,
  medulla: [0.44, 0.13, 0.2] as Rgb,
  pelvis: [0.93, 0.86, 0.6] as Rgb,
  fat: [0.96, 0.88, 0.55] as Rgb,
  adrenal: [0.85, 0.6, 0.25] as Rgb,
  generic: [0.7, 0.45, 0.4] as Rgb,
};

/** Normalise a structure id for matching: "TA:Left_Ventricle" -> "left ventricle". */
export function normId(id: string): string {
  return id.replace(/^TA:/i, '').replace(/[_\-.]+/g, ' ').toLowerCase().trim();
}

const has = (n: string, ...words: string[]) => words.every((w) => n.includes(w));

// --------------------------------------------------------------------------------------------
// Heart
// --------------------------------------------------------------------------------------------

function heartSpec(n: string): StructureBuild | null {
  if (has(n, 'pericard')) return { shapes: [{ kind: 'ellipsoid', center: [0, 0.1, 0.05], radii: [1.25, 1.45, 1.1] }], look: { color: C.pericardium, alpha: 0.22, roughness: 0.4 } };
  if (has(n, 'septum') && has(n, 'atri')) return { shapes: [{ kind: 'box', center: [-0.18, 0.4, 0.2], size: [0.04, 0.45, 0.4], rotation: [0, 0.3, 0] }], look: { color: C.atrium } };
  if (has(n, 'septum')) return { shapes: [{ kind: 'box', center: [0.0, -0.25, -0.05], size: [0.08, 0.95, 0.55], rotation: [0, 0.35, 0.35] }], look: { color: C.myo } };
  if (has(n, 'left', 'auric') || has(n, 'left', 'atrial', 'append')) return { shapes: [{ kind: 'ellipsoid', center: [0.45, 0.55, -0.05], radii: [0.18, 0.1, 0.14], rotation: [0, 0, -0.4] }], look: { color: C.atrium } };
  if (has(n, 'right', 'auric') || has(n, 'right', 'atrial', 'append')) return { shapes: [{ kind: 'ellipsoid', center: [-0.5, 0.7, -0.3], radii: [0.2, 0.1, 0.14], rotation: [0, 0, 0.4] }], look: { color: C.atrium } };
  if (has(n, 'left', 'ventric')) return { shapes: [{ kind: 'ellipsoid', center: [0.3, -0.35, 0.1], radii: [0.52, 0.82, 0.55], rotation: [0, 0, 0.42] }], look: { color: C.myo } };
  if (has(n, 'right', 'ventric')) return { shapes: [{ kind: 'ellipsoid', center: [-0.25, -0.25, -0.28], radii: [0.5, 0.66, 0.36], rotation: [0, 0.2, 0.3] }], look: { color: [0.62, 0.17, 0.16] } };
  if (has(n, 'left', 'atri')) return { shapes: [{ kind: 'ellipsoid', center: [0.15, 0.47, 0.42], radii: [0.42, 0.32, 0.36] }], look: { color: C.atrium } };
  if (has(n, 'right', 'atri')) return { shapes: [{ kind: 'ellipsoid', center: [-0.55, 0.32, 0.0], radii: [0.38, 0.45, 0.4] }], look: { color: C.atrium } };
  if (has(n, 'mitral') || has(n, 'bicuspid')) return { shapes: [{ kind: 'ring', center: [0.2, 0.16, 0.28], diameter: 0.42, thickness: 0.07, rotation: [0.25, 0, 0.35] }], look: { color: C.valve, roughness: 0.7 } };
  if (has(n, 'tricuspid')) return { shapes: [{ kind: 'ring', center: [-0.38, 0.06, -0.08], diameter: 0.46, thickness: 0.07, rotation: [0.2, 0, -0.3] }], look: { color: C.valve, roughness: 0.7 } };
  if (has(n, 'aortic', 'valve')) return { shapes: [{ kind: 'ring', center: [0.0, 0.36, 0.05], diameter: 0.32, thickness: 0.06, rotation: [0.3, 0, 0] }], look: { color: C.valve, roughness: 0.7 } };
  if (has(n, 'pulmonary', 'valve') || has(n, 'pulmonic')) return { shapes: [{ kind: 'ring', center: [-0.12, 0.5, -0.36], diameter: 0.3, thickness: 0.06, rotation: [-0.3, 0, 0] }], look: { color: C.valve, roughness: 0.7 } };
  if (has(n, 'papillary')) return { shapes: [
    { kind: 'ellipsoid', center: [0.3, -0.45, -0.05], radii: [0.07, 0.2, 0.07], rotation: [0, 0, 0.4] },
    { kind: 'ellipsoid', center: [0.45, -0.4, 0.3], radii: [0.07, 0.2, 0.07], rotation: [0, 0, 0.4] },
  ], look: { color: C.myo } };
  if (has(n, 'chordae')) return { shapes: [
    { kind: 'tube', path: [[0.2, 0.12, 0.25], [0.3, -0.3, -0.05]], radius: 0.012 },
    { kind: 'tube', path: [[0.25, 0.12, 0.32], [0.45, -0.25, 0.3]], radius: 0.012 },
  ], look: { color: C.valve } };
  if (has(n, 'pulmonary', 'vein')) return { shapes: [
    { kind: 'tube', path: [[0.0, 0.55, 0.65], [-0.15, 0.62, 0.95]], radius: 0.065 },
    { kind: 'tube', path: [[0.05, 0.38, 0.68], [-0.12, 0.3, 0.98]], radius: 0.065 },
    { kind: 'tube', path: [[0.35, 0.55, 0.62], [0.6, 0.62, 0.9]], radius: 0.065 },
    { kind: 'tube', path: [[0.35, 0.38, 0.64], [0.6, 0.3, 0.92]], radius: 0.065 },
  ], look: { color: [0.75, 0.2, 0.22] } };
  if (has(n, 'pulmonary') && (has(n, 'trunk') || has(n, 'artery') || has(n, 'arteries'))) return { shapes: [
    { kind: 'tube', path: [[-0.12, 0.5, -0.36], [-0.1, 0.8, -0.32], [0.0, 1.05, -0.1], [0.15, 1.1, 0.15]], radius: 0.14 },
  ], look: { color: C.pulmArtery } };
  if (has(n, 'coronary', 'sinus')) return { shapes: [{ kind: 'tube', path: [[0.55, 0.05, 0.5], [0.1, 0.0, 0.62], [-0.35, 0.02, 0.38]], radius: 0.05 }], look: { color: C.vein } };
  if (has(n, 'circumflex')) return { shapes: [{ kind: 'tube', path: [[0.12, 0.38, -0.12], [0.5, 0.25, -0.05], [0.78, 0.08, 0.2], [0.7, -0.05, 0.55]], radius: 0.028 }], look: { color: C.coronary } };
  if (has(n, 'anterior', 'interventric') || has(n, 'anterior', 'descending') || n === 'lad' || has(n, ' lad')) return { shapes: [{ kind: 'tube', path: [[0.12, 0.3, -0.35], [0.12, 0.0, -0.58], [0.25, -0.5, -0.5], [0.5, -1.05, -0.25]], radius: 0.028 }], look: { color: C.coronary } };
  if (has(n, 'posterior', 'interventric') || has(n, 'posterior', 'descending')) return { shapes: [{ kind: 'tube', path: [[-0.2, -0.05, 0.6], [0.05, -0.5, 0.65], [0.35, -0.95, 0.45]], radius: 0.026 }], look: { color: C.coronary } };
  if (has(n, 'left', 'coronary')) return { shapes: [{ kind: 'tube', path: [[0.05, 0.4, -0.05], [0.12, 0.38, -0.2], [0.12, 0.32, -0.35]], radius: 0.035 }], look: { color: C.coronary } };
  if (has(n, 'right', 'coronary')) return { shapes: [{ kind: 'tube', path: [[-0.08, 0.4, -0.12], [-0.4, 0.15, -0.42], [-0.72, -0.1, -0.15], [-0.55, -0.2, 0.4], [-0.2, -0.05, 0.6]], radius: 0.032 }], look: { color: C.coronary } };
  if (has(n, 'aortic', 'arch') || has(n, 'arch')) return { shapes: [{ kind: 'tube', path: [[0.0, 1.15, 0.05], [0.15, 1.38, 0.2], [0.42, 1.38, 0.42], [0.55, 1.15, 0.58]], radius: 0.15 }], look: { color: C.artery } };
  if (has(n, 'descending', 'aorta')) return { shapes: [{ kind: 'tube', path: [[0.55, 1.15, 0.58], [0.58, 0.4, 0.75], [0.55, -0.6, 0.75]], radius: 0.13 }], look: { color: C.artery } };
  if (has(n, 'aorta')) return { shapes: [
    { kind: 'tube', path: [[0.0, 0.36, 0.05], [-0.05, 0.75, 0.0], [0.0, 1.15, 0.05], [0.15, 1.38, 0.2], [0.42, 1.38, 0.42], [0.55, 1.15, 0.58], [0.58, 0.4, 0.75], [0.55, -0.5, 0.75]], radius: 0.15 },
  ], look: { color: C.artery } };
  if (has(n, 'superior', 'vena')) return { shapes: [{ kind: 'tube', path: [[-0.6, 0.65, 0.0], [-0.6, 1.45, 0.05]], radius: 0.13 }], look: { color: C.vein } };
  if (has(n, 'inferior', 'vena')) return { shapes: [{ kind: 'tube', path: [[-0.55, 0.0, 0.1], [-0.52, -0.9, 0.2]], radius: 0.14 }], look: { color: C.vein } };
  if (has(n, 'brachiocephalic') || has(n, 'subclavian') || has(n, 'carotid')) return { shapes: [{ kind: 'tube', path: [[0.25, 1.4, 0.3], [0.25, 1.8, 0.3]], radius: 0.06 }], look: { color: C.artery } };
  if (has(n, 'sinoatrial') || has(n, 'sa node')) return { shapes: [{ kind: 'ellipsoid', center: [-0.62, 0.7, -0.1], radii: [0.06, 0.06, 0.06] }], look: { color: C.conduction } };
  if (has(n, 'atrioventricular') || has(n, 'av node')) return { shapes: [{ kind: 'ellipsoid', center: [-0.22, 0.12, 0.1], radii: [0.06, 0.06, 0.06] }], look: { color: C.conduction } };
  if (has(n, 'apex')) return { shapes: [{ kind: 'ellipsoid', center: [0.62, -1.02, 0.05], radii: [0.14, 0.12, 0.14] }], look: { color: C.myo } };
  if (has(n, 'myocard')) return { shapes: [{ kind: 'ellipsoid', center: [0.1, -0.3, -0.05], radii: [0.85, 0.95, 0.75], rotation: [0, 0, 0.35] }], look: { color: C.myo, alpha: 0.35 } };
  return null;
}

// --------------------------------------------------------------------------------------------
// Kidney (second course, T2-09)
// --------------------------------------------------------------------------------------------

function kidneySpec(n: string): StructureBuild | null {
  if (has(n, 'capsule') || has(n, 'perirenal') || has(n, 'fascia')) return { shapes: [{ kind: 'ellipsoid', center: [0, 0, 0], radii: [0.68, 1.12, 0.48] }], look: { color: C.fat, alpha: 0.2 } };
  if (has(n, 'cortex')) return { shapes: [{ kind: 'ellipsoid', center: [0, 0, 0], radii: [0.62, 1.05, 0.42] }], look: { color: C.cortex } };
  if (has(n, 'pyramid')) return { shapes: [
    { kind: 'ellipsoid', center: [0.02, 0.62, 0], radii: [0.2, 0.13, 0.2], rotation: [0, 0, 0.6] },
    { kind: 'ellipsoid', center: [-0.18, 0.3, 0], radii: [0.21, 0.13, 0.21], rotation: [0, 0, 0.3] },
    { kind: 'ellipsoid', center: [-0.24, -0.05, 0], radii: [0.21, 0.12, 0.21] },
    { kind: 'ellipsoid', center: [-0.18, -0.4, 0], radii: [0.21, 0.13, 0.21], rotation: [0, 0, -0.3] },
    { kind: 'ellipsoid', center: [0.02, -0.7, 0], radii: [0.2, 0.13, 0.2], rotation: [0, 0, -0.6] },
  ], look: { color: C.medulla } };
  if (has(n, 'medulla')) return { shapes: [{ kind: 'ellipsoid', center: [-0.05, 0, 0], radii: [0.45, 0.88, 0.33] }], look: { color: [0.5, 0.18, 0.22], alpha: 0.35 } };
  if (has(n, 'papilla')) return { shapes: [
    { kind: 'ellipsoid', center: [0.13, 0.5, 0], radii: [0.05, 0.05, 0.05] },
    { kind: 'ellipsoid', center: [0.02, 0.24, 0], radii: [0.05, 0.05, 0.05] },
    { kind: 'ellipsoid', center: [-0.03, -0.05, 0], radii: [0.05, 0.05, 0.05] },
    { kind: 'ellipsoid', center: [0.02, -0.34, 0], radii: [0.05, 0.05, 0.05] },
    { kind: 'ellipsoid', center: [0.13, -0.58, 0], radii: [0.05, 0.05, 0.05] },
  ], look: { color: [0.75, 0.4, 0.4] } };
  if (has(n, 'column')) return { shapes: [
    { kind: 'box', center: [-0.32, 0.48, 0], size: [0.22, 0.06, 0.3], rotation: [0, 0, 0.45] },
    { kind: 'box', center: [-0.4, 0.13, 0], size: [0.22, 0.06, 0.3], rotation: [0, 0, 0.15] },
    { kind: 'box', center: [-0.4, -0.23, 0], size: [0.22, 0.06, 0.3], rotation: [0, 0, -0.15] },
    { kind: 'box', center: [-0.32, -0.57, 0], size: [0.22, 0.06, 0.3], rotation: [0, 0, -0.45] },
  ], look: { color: [0.6, 0.24, 0.2] } };
  if (has(n, 'minor') && (has(n, 'calyx') || has(n, 'calyces'))) return { shapes: [
    { kind: 'tube', path: [[0.13, 0.5, 0], [0.22, 0.35, 0]], radius: 0.045 },
    { kind: 'tube', path: [[0.02, 0.24, 0], [0.16, 0.18, 0]], radius: 0.045 },
    { kind: 'tube', path: [[-0.03, -0.05, 0], [0.14, -0.05, 0]], radius: 0.045 },
    { kind: 'tube', path: [[0.02, -0.34, 0], [0.16, -0.28, 0]], radius: 0.045 },
    { kind: 'tube', path: [[0.13, -0.58, 0], [0.22, -0.42, 0]], radius: 0.045 },
  ], look: { color: C.pelvis } };
  if (has(n, 'calyx') || has(n, 'calyces')) return { shapes: [
    { kind: 'tube', path: [[0.3, -0.02, 0], [0.22, 0.35, 0]], radius: 0.06 },
    { kind: 'tube', path: [[0.3, -0.02, 0], [0.15, -0.05, 0]], radius: 0.06 },
    { kind: 'tube', path: [[0.3, -0.02, 0], [0.22, -0.42, 0]], radius: 0.06 },
  ], look: { color: [0.9, 0.82, 0.56] } };
  if (has(n, 'pelvis')) return { shapes: [{ kind: 'ellipsoid', center: [0.32, -0.05, 0], radii: [0.2, 0.26, 0.14], rotation: [0, 0, -0.3] }], look: { color: C.pelvis } };
  if (has(n, 'ureter')) return { shapes: [{ kind: 'tube', path: [[0.42, -0.25, 0], [0.55, -0.8, 0.05], [0.5, -1.7, 0.1]], radius: 0.06 }], look: { color: [0.9, 0.78, 0.55] } };
  if (has(n, 'renal', 'artery') || has(n, 'arter')) return { shapes: [{ kind: 'tube', path: [[0.3, 0.15, -0.05], [0.8, 0.2, -0.08], [1.4, 0.25, -0.1]], radius: 0.065 }], look: { color: C.artery } };
  if (has(n, 'renal', 'vein') || has(n, 'vein')) return { shapes: [{ kind: 'tube', path: [[0.3, 0.0, 0.08], [0.8, -0.02, 0.12], [1.4, 0.0, 0.15]], radius: 0.08 }], look: { color: C.vein } };
  if (has(n, 'adrenal') || has(n, 'suprarenal')) return { shapes: [{ kind: 'ellipsoid', center: [-0.05, 1.18, 0], radii: [0.32, 0.16, 0.15], rotation: [0, 0, 0.25] }], look: { color: C.adrenal } };
  if (has(n, 'hilum') || has(n, 'sinus')) return { shapes: [{ kind: 'ellipsoid', center: [0.45, 0, 0], radii: [0.12, 0.3, 0.2] }], look: { color: C.fat } };
  return null;
}

/** Fallback for structure ids the procedural library does not know: small spheres on a ring. */
function genericSpec(index: number, total: number): StructureBuild {
  const a = (index / Math.max(1, total)) * Math.PI * 2;
  return { shapes: [{ kind: 'ellipsoid', center: [Math.cos(a) * 1.1, Math.sin(a) * 1.1, 0], radii: [0.16, 0.16, 0.16] }], look: { color: C.generic } };
}

export function buildSpecFor(organ: string, structureId: string, index: number, total: number): StructureBuild {
  const n = normId(structureId);
  const spec = organ.toLowerCase().includes('kidney') || organ.toLowerCase().includes('renal')
    ? kidneySpec(n) ?? heartSpec(n)
    : heartSpec(n) ?? kidneySpec(n);
  return spec ?? genericSpec(index, total);
}

// --------------------------------------------------------------------------------------------
// Pathology variants (V-06)
// --------------------------------------------------------------------------------------------

export interface VariantMod {
  /** Multiply shape radii / tube radius. */
  scale?: number;
  /** Per-axis scale of the whole structure. */
  scaleXYZ?: Vec3;
  /** For rings: multiply diameter (narrowing) and thickness (thickening). */
  ringDiameter?: number;
  ringThickness?: number;
  color?: Rgb;
  /** Extra child meshes (picked as the parent structure). */
  extras?: Array<{ name: string; shape: ShapeSpec; color: Rgb; alpha?: number }>;
}

/**
 * Geometry/material modifications for a pathological variant.
 * Known variants get hand-tuned changes; any other pathological variant tints and
 * slightly enlarges its `affects` structures so it is always visibly different.
 */
export function variantMods(variantId: string, organ: string, structureIds: string[], affects: string[] = [], pathological = variantId !== 'normal'): Map<string, VariantMod> {
  const mods = new Map<string, VariantMod>();
  if (!pathological || variantId === 'normal') return mods;
  const v = variantId.toLowerCase();
  const find = (...words: string[]) => structureIds.find((id) => has(normId(id), ...words));
  const lvId = find('left', 'ventric');

  if (v.includes('mitral') && v.includes('stenosis')) {
    const mv = find('mitral') ?? find('bicuspid');
    if (mv) mods.set(mv, { ringDiameter: 0.62, ringThickness: 2.3, color: [0.82, 0.78, 0.62] });
    const la = find('left', 'atri');
    if (la && !has(normId(la), 'auric')) mods.set(la, { scale: 1.32, color: [0.72, 0.28, 0.26] });
    const pv = find('pulmonary', 'vein');
    if (pv) mods.set(pv, { scale: 1.25 });
  } else if (v.includes('infarct') || v === 'mi' || v.startsWith('mi_') || v.includes('stemi')) {
    if (lvId) mods.set(lvId, {
      extras: [
        { name: 'infarct_lad_territory', shape: { kind: 'ellipsoid', center: [0.32, -0.45, -0.38], radii: [0.34, 0.42, 0.14], rotation: [0, 0, 0.42] }, color: [0.86, 0.78, 0.74] },
        { name: 'infarct_core', shape: { kind: 'ellipsoid', center: [0.3, -0.5, -0.45], radii: [0.18, 0.24, 0.08], rotation: [0, 0, 0.42] }, color: [0.3, 0.12, 0.14] },
      ],
    });
    const lad = find('anterior', 'interventric') ?? find('anterior', 'descending');
    if (lad) mods.set(lad, { color: [0.35, 0.18, 0.2], scale: 0.7 });
  } else if (v.includes('hydro')) {
    const pelvis = find('pelvis');
    if (pelvis) mods.set(pelvis, { scale: 1.9, color: [0.96, 0.93, 0.72] });
    for (const id of structureIds.filter((x) => /calyx|calyces/.test(normId(x)))) mods.set(id, { scale: 1.8, color: [0.96, 0.93, 0.72] });
    const papilla = find('papilla');
    if (papilla) mods.set(papilla, { scale: 0.6 });
    const medulla = find('medulla') ?? find('pyramid');
    if (medulla) mods.set(medulla, { scale: 0.7 });
  } else if (v.includes('stone') || v.includes('calcul') || v.includes('lithiasis')) {
    const pelvis = find('pelvis') ?? find('ureter');
    if (pelvis) mods.set(pelvis, { extras: [{ name: 'calculus', shape: { kind: 'ellipsoid', center: [0.34, -0.1, -0.12], radii: [0.09, 0.07, 0.08] }, color: [0.95, 0.95, 0.88] }] });
  } else if (v.includes('cyst') || v.includes('polycystic')) {
    const cortex = find('cortex') ?? structureIds[0];
    if (cortex) mods.set(cortex, {
      scaleXYZ: v.includes('polycystic') ? [1.35, 1.25, 1.3] : undefined,
      extras: Array.from({ length: v.includes('polycystic') ? 9 : 2 }, (_, i) => {
        const a = (i / 9) * Math.PI * 2;
        return { name: `cyst_${i}`, shape: { kind: 'ellipsoid' as const, center: [Math.cos(a) * 0.45, Math.sin(a) * 0.85, -0.3] as Vec3, radii: [0.17, 0.17, 0.15] as Vec3 }, color: [0.86, 0.88, 0.7] as Rgb, alpha: 0.85 };
      }),
    });
  } else if (v.includes('tumou') || v.includes('tumor') || v.includes('carcinoma') || v.includes('mass') || v.includes('rcc')) {
    const cortex = find('cortex') ?? structureIds[0];
    if (cortex) mods.set(cortex, { extras: [{ name: 'mass', shape: { kind: 'ellipsoid', center: [-0.35, 0.55, -0.2], radii: [0.36, 0.34, 0.32] }, color: [0.9, 0.75, 0.45] }] });
  }
  // Generic fallback so every pathological variant visibly differs.
  for (const id of affects) {
    if (!mods.has(id) && structureIds.includes(id)) mods.set(id, { scale: 1.15, color: [0.85, 0.7, 0.6] });
  }
  if (mods.size === 0 && structureIds.length) {
    mods.set(structureIds[0], { scale: 1.15, color: [0.85, 0.7, 0.6] });
  }
  void organ;
  return mods;
}

// --------------------------------------------------------------------------------------------
// Camera presets (V-02)
// --------------------------------------------------------------------------------------------

export const DEFAULT_RADIUS = 5.2;

export function presetAngles(preset: string): { alpha: number; beta: number } {
  switch (preset) {
    case 'posterior': return { alpha: Math.PI / 2, beta: Math.PI / 2 };
    case 'left': return { alpha: 0, beta: Math.PI / 2 };
    case 'right': return { alpha: Math.PI, beta: Math.PI / 2 };
    case 'superior': return { alpha: -Math.PI / 2, beta: 0.05 };
    case 'inferior': return { alpha: -Math.PI / 2, beta: Math.PI - 0.05 };
    case 'anterior':
    default: return { alpha: -Math.PI / 2, beta: Math.PI / 2 };
  }
}

/** Ventricles / atria pulse in antiphase (V-08). Returns scale factor for a structure at time t (ms). */
export function cardiacScale(structureId: string, tMs: number, bpm = 72): number {
  const n = normId(structureId);
  const period = 60000 / bpm;
  const phase = (tMs % period) / period; // 0..1
  // systole ~ first 35% of the cycle
  const systole = phase < 0.35 ? Math.sin((phase / 0.35) * Math.PI) : 0;
  const atrialKick = phase > 0.8 ? Math.sin(((phase - 0.8) / 0.2) * Math.PI) : 0;
  if (has(n, 'ventric') || has(n, 'septum') || has(n, 'papillary') || has(n, 'apex') || has(n, 'myocard')) return 1 - 0.09 * systole;
  if (has(n, 'atri') || has(n, 'auric')) return 1 + 0.06 * systole - 0.08 * atrialKick;
  if (has(n, 'aort') || has(n, 'pulmonary', 'trunk')) return 1 + 0.05 * systole;
  return 1;
}
