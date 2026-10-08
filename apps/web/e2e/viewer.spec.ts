import { expect, test, type Page } from '@playwright/test';
import { clickStructure, viewerCall, waitViewer } from './helpers';

type Cam = { alpha: number; beta: number; radius: number; target: [number, number, number] };
const cam = (page: Page, key?: string) => viewerCall<Cam>(page, 'getCamera', [], key);

async function explore(page: Page, q = '') {
  await page.goto(`/station/explore?model=heart_v1${q}`);
  await waitViewer(page);
  const box = (await page.locator('.model-viewer-canvas').first().boundingBox())!;
  return box;
}

test('[T0-01] viewer renders on WebGPU or WebGL2 and reports fps', async ({ page }) => {
  await explore(page);
  const info = await page.evaluate(() => ({ engine: (window as any).__medsim.engine }));
  expect(['webgpu', 'webgl2']).toContain(info.engine);
  await expect.poll(() => page.evaluate(() => (window as any).__medsim.fps ?? 0)).toBeGreaterThan(0);
  const visible = await viewerCall<string[]>(page, 'getVisibleStructures');
  expect(visible).toContain('TA:mitral_valve');
});

test('[T0-02] rotate / zoom / pan change the camera; reset returns to the preset view', async ({ page }) => {
  const box = await explore(page);
  const home = await cam(page);
  const cx = box.x + box.width / 2, cy = box.y + box.height / 2;
  // left-drag rotates
  await page.mouse.move(cx, cy);
  await page.mouse.down();
  await page.mouse.move(cx + 150, cy + 40, { steps: 6 });
  await page.mouse.up();
  const rotated = await cam(page);
  expect(Math.abs(rotated.alpha - home.alpha)).toBeGreaterThan(0.1);
  expect(Math.abs(rotated.beta - home.beta)).toBeGreaterThan(0.01);
  // wheel zooms
  await page.mouse.move(cx, cy);
  await page.mouse.wheel(0, -400);
  await expect.poll(async () => (await cam(page)).radius).toBeLessThan(rotated.radius);
  // right-drag pans
  await page.mouse.move(cx, cy);
  await page.mouse.down({ button: 'right' });
  await page.mouse.move(cx + 120, cy, { steps: 5 });
  await page.mouse.up({ button: 'right' });
  expect(Math.hypot(...(await cam(page)).target)).toBeGreaterThan(0.05);
  // reset
  await page.getByTestId('reset-view').click();
  await expect.poll(async () => {
    const c = await cam(page);
    return Math.abs(c.alpha - home.alpha) + Math.abs(c.beta - home.beta) + Math.abs(c.radius - home.radius) + Math.hypot(...c.target);
  }).toBeLessThan(0.01);
});

test('[T0-02] camera presets move the camera (posterior)', async ({ page }) => {
  await explore(page);
  const home = await cam(page);
  await page.getByTestId('view-preset').selectOption('posterior');
  await expect.poll(async () => Math.abs((await cam(page)).alpha - home.alpha)).toBeGreaterThan(3);
});

test('[T0-14] keyboard produces the same camera events (arrows rotate, +/- zoom, R resets)', async ({ page }) => {
  await explore(page);
  const home = await cam(page);
  await page.locator('body').click({ position: { x: 5, y: 300 } });
  await page.keyboard.press('ArrowRight');
  await page.keyboard.press('ArrowRight');
  expect(Math.abs((await cam(page)).alpha - home.alpha)).toBeGreaterThan(0.1);
  await page.keyboard.press('+');
  expect((await cam(page)).radius).toBeLessThan(home.radius);
  await page.keyboard.press('r');
  await expect.poll(async () => Math.abs((await cam(page)).alpha - home.alpha)).toBeLessThan(0.01);
});

test('[T0-03] hiding / showing a layer toggles all its structures', async ({ page }) => {
  await explore(page);
  const all = await viewerCall<string[]>(page, 'getVisibleStructures');
  await page.getByTestId('layer-valves').uncheck();
  await expect.poll(() => viewerCall<string[]>(page, 'getVisibleStructures')).not.toContain('TA:mitral_valve');
  const now = await viewerCall<string[]>(page, 'getVisibleStructures');
  for (const v of ['TA:mitral_valve', 'TA:tricuspid_valve', 'TA:aortic_valve', 'TA:pulmonary_valve']) expect(now).not.toContain(v);
  expect(now.length).toBe(all.length - 4);
  await page.getByTestId('layer-valves').check();
  await expect.poll(async () => (await viewerCall<string[]>(page, 'getVisibleStructures')).length).toBe(all.length);
});

test('[T0-04] select highlights, isolate hides all others, un-isolate restores', async ({ page }) => {
  await explore(page);
  const all = await viewerCall<string[]>(page, 'getVisibleStructures');
  await clickStructure(page, 'TA:aorta');
  await expect.poll(() => viewerCall<string[]>(page, 'getSelected')).toEqual(['TA:aorta']);
  await expect(page.getByTestId('selected-name')).toContainText('Aorta');
  await page.getByTestId('isolate').click();
  await expect.poll(() => viewerCall<string[]>(page, 'getVisibleStructures')).toEqual(['TA:aorta']);
  await page.getByTestId('unisolate').click();
  await expect.poll(async () => (await viewerCall<string[]>(page, 'getVisibleStructures')).length).toBe(all.length);
});

test('[T0-05] labels toggle in the viewer (exploration)', async ({ page }) => {
  await explore(page);
  await expect(page.locator('.viewer-label')).toHaveCount(0);
  await page.getByTestId('labels-toggle').click();
  await expect(page.locator('.viewer-label').first()).toBeVisible();
  expect(await viewerCall<boolean>(page, 'getLabelsVisible')).toBe(true);
  await page.getByTestId('labels-toggle').click();
  await expect(page.locator('.viewer-label')).toHaveCount(0);
});

test('[T0-06] mitral_stenosis variant changes the model geometry/material', async ({ page }) => {
  await explore(page, '&variant=normal');
  const normal = await viewerCall<{ size: number[]; color: number[] }>(page, 'structureInfo', ['TA:mitral_valve']);
  const laN = await viewerCall<{ size: number[] }>(page, 'structureInfo', ['TA:left_atrium']);
  await page.getByTestId('explore-variant').selectOption('mitral_stenosis');
  await expect.poll(() => page.evaluate(() => (window as any).__medsim.viewer?.variant)).toBe('mitral_stenosis');
  await waitViewer(page);
  const ms = await viewerCall<{ size: number[]; color: number[] }>(page, 'structureInfo', ['TA:mitral_valve']);
  const laS = await viewerCall<{ size: number[] }>(page, 'structureInfo', ['TA:left_atrium']);
  expect(ms.size[0]).toBeLessThan(normal.size[0]);
  expect(ms.color).not.toEqual(normal.color);
  expect(laS.size[0]).toBeGreaterThan(laN.size[0]);
});

test('[T2-05] clipping plane / cross-section on any axis', async ({ page }) => {
  const box = await explore(page);
  for (const axis of ['x', 'y', 'z'] as const) {
    await page.getByTestId('clip-axis').selectOption(axis);
    await expect.poll(() => viewerCall<{ axis: string } | null>(page, 'getClipping')).toMatchObject({ axis });
  }
  // a section through x = 0 removes the left half (+x) of the heart from picking
  await page.getByTestId('clip-axis').selectOption('x');
  await page.getByTestId('clip-offset').fill('-0.2');
  await expect.poll(() => viewerCall<{ offset: number } | null>(page, 'getClipping')).toMatchObject({ offset: -0.2 });
  const right = await viewerCall<string | null>(page, 'pickAt', [box.x + box.width * 0.62, box.y + box.height * 0.6]);
  expect(right === null || !/left_ventricle/.test(right)).toBe(true);
  await page.getByTestId('clip-axis').selectOption('off');
  await expect.poll(() => viewerCall(page, 'getClipping')).toBeNull();
});

test('[T2-06] cardiac-cycle animation plays and pauses', async ({ page }) => {
  await explore(page);
  await page.getByTestId('animate-toggle').click();
  await expect.poll(() => viewerCall<boolean>(page, 'isAnimating')).toBe(true);
  const samples = new Set<number>();
  for (let i = 0; i < 12; i++) {
    samples.add(Math.round((await viewerCall<number>(page, 'animationScale', ['TA:left_ventricle'])) * 1000));
    await page.waitForTimeout(70);
  }
  expect(samples.size).toBeGreaterThan(1);
  await page.getByTestId('animate-toggle').click();
  await expect.poll(() => viewerCall<boolean>(page, 'isAnimating')).toBe(false);
  expect(await viewerCall<number>(page, 'animationScale', ['TA:left_ventricle'])).toBeCloseTo(1, 5);
});

test('[T2-07] side-by-side normal vs pathological comparison with synced cameras', async ({ page }) => {
  await page.goto('/station/explore?model=heart_v1&variant=mitral_stenosis');
  await waitViewer(page);
  await page.getByTestId('compare-toggle').click();
  await waitViewer(page, 'compare-normal');
  await waitViewer(page, 'compare-pathological');
  await expect(page.getByTestId('comparison-view')).toContainText('Normal');
  await expect(page.getByTestId('comparison-view')).toContainText('Mitral stenosis');
  const n = await viewerCall<{ size: number[] }>(page, 'structureInfo', ['TA:mitral_valve'], 'compare-normal');
  const p = await viewerCall<{ size: number[] }>(page, 'structureInfo', ['TA:mitral_valve'], 'compare-pathological');
  expect(p.size[0]).toBeLessThan(n.size[0]);
  // drag on the left pane rotates both
  const box = (await page.getByTestId('compare-normal').boundingBox())!;
  await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2);
  await page.mouse.down();
  await page.mouse.move(box.x + box.width / 2 + 120, box.y + box.height / 2, { steps: 5 });
  await page.mouse.up();
  const a = await cam(page, 'compare-normal');
  const b = await cam(page, 'compare-pathological');
  expect(Math.abs(a.alpha - (-Math.PI / 2))).toBeGreaterThan(0.1);
  expect(b.alpha).toBeCloseTo(a.alpha, 5);
  expect(b.beta).toBeCloseTo(a.beta, 5);
});

test('[T3-04] display-output abstraction: side-by-side stereo mode toggle', async ({ page }) => {
  await explore(page);
  expect((await viewerCall<{ viewports: unknown[] }>(page, 'getStereo')).viewports).toHaveLength(1);
  await page.getByTestId('stereo-toggle').check();
  await expect.poll(() => viewerCall<{ enabled: boolean }>(page, 'getStereo')).toMatchObject({ enabled: true });
  const st = await viewerCall<{ viewports: number[][] }>(page, 'getStereo');
  expect(st.viewports).toEqual([[0, 0, 0.5, 1], [0.5, 0, 0.5, 1]]);
  // both eyes render: a structure is pickable in each half
  const box = (await page.locator('.model-viewer-canvas').boundingBox())!;
  const hits = await page.evaluate(({ box }) => {
    const v = (window as any).__medsim.viewer;
    const find = (x0: number) => {
      for (let x = x0; x < x0 + box.width / 2; x += 20) for (let y = box.y + 20; y < box.y + box.height; y += 20) if (v.pickAt(x, y)) return true;
      return false;
    };
    return [find(box.x), find(box.x + box.width / 2)];
  }, { box });
  expect(hits).toEqual([true, true]);
  await page.getByTestId('stereo-toggle').uncheck();
  await expect.poll(async () => (await viewerCall<{ viewports: unknown[] }>(page, 'getStereo')).viewports.length).toBe(1);
});
