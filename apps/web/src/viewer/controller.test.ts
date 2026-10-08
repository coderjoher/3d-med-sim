// @vitest-environment node
import { afterEach, describe, expect, it } from 'vitest';
import { NullEngine } from '@babylonjs/core';
import type { ModelDef } from '@medsim/core';
import { ViewerController } from './controller';
import { HEART_FIXTURE } from './__fixtures__/heart';
import { presetAngles } from './anatomy';

// Use core's real heart model if it is available, otherwise the fixture.
async function heartModel(): Promise<ModelDef> {
  try {
    const core = await import('@medsim/core');
    const m = core.MODELS?.find?.((x: ModelDef) => x.id === 'heart_v1');
    if (m) return m;
  } catch { /* core content not ready */ }
  return HEART_FIXTURE;
}

let ctrls: ViewerController[] = [];
async function make(variant = 'normal', model?: ModelDef) {
  const engine = new NullEngine();
  const c = new ViewerController(engine, { model: model ?? (await heartModel()), variant });
  await c.ready;
  ctrls.push(c);
  return c;
}
afterEach(() => { ctrls.forEach((c) => { c.dispose(); c.engine.dispose(); }); ctrls = []; });

describe('ViewerController (NullEngine)', () => {
  it('[T0-01] builds one tagged mesh group per model structure', async () => {
    const model = await heartModel();
    const c = await make('normal', model);
    expect(c.structureIds().sort()).toEqual(model.structures.map((s) => s.id).sort());
    for (const m of c.scene.meshes) {
      if (!m.metadata?.structureId) continue;
      const st = model.structures.find((s) => s.id === m.metadata.structureId)!;
      expect(m.metadata.layer).toBe(st.layer);
    }
  });

  it('[T0-02] rotate / zoom / pan change the camera and reset returns to the preset', async () => {
    const c = await make();
    c.setView({ camera: 'anterior' }, 0);
    const home = c.getCamera();
    c.applyEvent({ type: 'rotate', dx: 0.1, dy: 0.05, source: 'mouse' });
    expect(c.getCamera().alpha).not.toBeCloseTo(home.alpha!, 3);
    expect(c.getCamera().beta).not.toBeCloseTo(home.beta!, 3);
    c.applyEvent({ type: 'zoom', factor: 1.5, source: 'mouse' });
    expect(c.getCamera().radius!).toBeLessThan(home.radius!);
    c.applyEvent({ type: 'pan', dx: 0.1, dy: 0, source: 'mouse' });
    expect(c.getCamera().target[0]).not.toBe(0);
    c.applyEvent({ type: 'reset', source: 'keyboard' });
    const r = c.getCamera();
    expect(r.alpha).toBeCloseTo(home.alpha!, 5);
    expect(r.beta).toBeCloseTo(home.beta!, 5);
    expect(r.radius).toBeCloseTo(home.radius!, 5);
    expect(r.target).toEqual([0, 0, 0]);
  });

  it('[T0-02] camera presets map to distinct orbit angles', () => {
    const presets = ['anterior', 'posterior', 'left', 'right', 'superior', 'inferior'].map((p) => presetAngles(p));
    const keys = new Set(presets.map((p) => `${p.alpha.toFixed(2)}:${p.beta.toFixed(2)}`));
    expect(keys.size).toBe(6);
  });

  it('[T0-03] hiding a layer hides all its structures; showing restores them', async () => {
    const model = await heartModel();
    const c = await make('normal', model);
    const layer = model.structures[1].layer;
    const inLayer = model.structures.filter((s) => s.layer === layer).map((s) => s.id);
    c.setHiddenLayers([layer]);
    const vis = c.getVisibleStructures();
    for (const id of inLayer) expect(vis).not.toContain(id);
    expect(vis.length).toBe(model.structures.length - inLayer.length);
    c.setHiddenLayers([]);
    expect(c.getVisibleStructures().length).toBe(model.structures.length);
  });

  it('[T0-04] select highlights; isolate hides all others; un-isolate restores', async () => {
    const model = await heartModel();
    const c = await make('normal', model);
    const id = model.structures.find((s) => /mitral/.test(s.id))!.id;
    c.setSelected([id]);
    expect(c.getSelected()).toEqual([id]);
    const mesh = c.scene.meshes.find((m) => m.metadata?.structureId === id)!;
    const em = (mesh.material as unknown as { emissiveColor: { r: number; g: number; b: number } }).emissiveColor;
    expect(em.r + em.g + em.b).toBeGreaterThan(0);
    c.setIsolate(id);
    expect(c.getVisibleStructures()).toEqual([id]);
    c.setIsolate(null);
    expect(c.getVisibleStructures().length).toBe(model.structures.length);
  });

  it('[T0-06] mitral_stenosis variant changes valve geometry and enlarges the left atrium', async () => {
    const model = await heartModel();
    const mv = model.structures.find((s) => /mitral/.test(s.id))!.id;
    const la = model.structures.find((s) => /left_atri(um)?$/.test(s.id))!.id;
    const normal = await make('normal', model);
    const ms = await make('mitral_stenosis', model);
    const n = normal.structureInfo(mv)!;
    const p = ms.structureInfo(mv)!;
    expect(p.size[0]).toBeLessThan(n.size[0]); // narrowed orifice ring
    expect(p.color).not.toEqual(n.color); // thickened / calcified material
    expect(ms.structureInfo(la)!.size[0]).toBeGreaterThan(normal.structureInfo(la)!.size[0]);
  });

  it('[T0-06] myocardial_infarction variant adds an LAD-territory patch to the LV', async () => {
    const model = await heartModel();
    if (!model.variants.some((v) => v.id === 'myocardial_infarction')) return;
    const lv = model.structures.find((s) => /left_ventricle/.test(s.id))!.id;
    const normal = await make('normal', model);
    const mi = await make('myocardial_infarction', model);
    expect(mi.structureInfo(lv)!.meshes).toBeGreaterThan(normal.structureInfo(lv)!.meshes);
  });

  it('[T2-05] clipping plane on each axis', async () => {
    const c = await make();
    c.setClipping({ axis: 'x', offset: 0 });
    expect(c.scene.clipPlane).toBeTruthy();
    c.setClipping({ axis: 'y', offset: 0.3 });
    expect(c.scene.clipPlane).toBeNull();
    expect(c.scene.clipPlane2).toBeTruthy();
    c.setClipping({ axis: 'z', offset: -0.3 });
    expect(c.scene.clipPlane3).toBeTruthy();
    c.setClipping(null);
    expect(c.scene.clipPlane3).toBeNull();
  });

  it('[T2-06] cardiac cycle animation plays and pauses (rest scale restored)', async () => {
    const model = await heartModel();
    const c = await make('normal', model);
    const lv = model.structures.find((s) => /left_ventricle/.test(s.id))!.id;
    c.setAnimate(true);
    expect(c.isAnimating()).toBe(true);
    const scales = new Set<number>();
    const t0 = performance.now();
    while (performance.now() - t0 < 400) { c.scene.render(); scales.add(Math.round(c.animationScale(lv) * 1000)); await new Promise((r) => setTimeout(r, 20)); }
    expect(scales.size).toBeGreaterThan(1);
    c.setAnimate(false);
    expect(c.animationScale(lv)).toBeCloseTo(1, 5);
  });

  it('[T3-04] stereo output splits the frame into two side-by-side viewports', async () => {
    const c = await make();
    c.setStereo(true);
    const s = c.getStereo();
    expect(s.enabled).toBe(true);
    expect(s.viewports.length).toBe(2);
    expect(s.viewports[0][2]).toBeCloseTo(0.5);
    expect(s.viewports[1][0]).toBeCloseTo(0.5);
    c.setStereo(false);
    expect(c.getStereo().viewports.length).toBe(1);
  });
});
