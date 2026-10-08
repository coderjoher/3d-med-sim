import { expect, test, type Page } from '@playwright/test';
import { clickStructure, confirmAnswer, goToLocalCases, localSignIn, viewerCall, waitViewer } from './helpers';

/** Feed landmark frames exactly as the vision worker would (simulate mode: ?vision=inject). */
async function inject(page: Page, hands: Array<{ x: number; y: number; handedness: 'Left' | 'Right'; pinch?: boolean }>) {
  await page.evaluate((hs) => {
    const mk = (x: number, y: number, pinch: boolean) => {
      const lm = Array.from({ length: 21 }, () => ({ x, y: y + 0.15, z: 0 }));
      lm[0] = { x, y: y + 0.2, z: 0 }; lm[9] = { x, y: y + 0.08, z: 0 };
      for (const [tip, pip] of [[8, 6], [12, 10], [16, 14], [20, 18]]) { lm[pip] = { x, y: y + 0.06, z: 0 }; lm[tip] = { x, y: y + 0.1, z: 0 }; }
      lm[8] = { x, y, z: 0 };
      lm[4] = pinch ? { x: x + 0.005, y, z: 0 } : { x: x + 0.1, y: y + 0.05, z: 0 };
      return lm;
    };
    (window as any).__medsim.injectLandmarks({ t: performance.now(), hands: hs.map((h) => ({ landmarks: mk(h.x, h.y, !!h.pinch), handedness: h.handedness })) });
  }, hands);
}

test('[T0-12] practice mode uses the non-graded sample and records no graded attempt', async ({ page }) => {
  const apiCalls: string[] = [];
  page.on('request', (r) => { if (r.url().includes('/api/')) apiCalls.push(r.url()); });
  await localSignIn(page);
  await page.getByTestId('cal-skip').click();
  await page.getByTestId('start-practice').click();
  await expect(page.getByTestId('practice-badge')).toHaveText(/not graded/);
  await expect(page.getByTestId('stem')).toContainText('Practice round');
  await page.getByTestId('qnav-2').click();
  await page.getByTestId('option-b').click();
  await confirmAnswer(page);
  await page.getByTestId('submit-case').click();
  await page.getByTestId('submit-yes').click();
  await expect(page.getByTestId('case-summary')).toContainText('Practice finished');
  // can repeat
  await page.getByTestId('practice-again').click();
  await expect(page.getByTestId('practice-badge')).toBeVisible();
  const stored = await page.evaluate(() => localStorage.getItem('medsim.local.attempts'));
  expect(stored).toBeNull();
  expect(apiCalls.filter((u) => u.includes('/attempts'))).toEqual([]);
});

test('[T0-13] no answer is recorded without an explicit confirmation step', async ({ page }) => {
  await goToLocalCases(page);
  await page.getByTestId('start-CARD-010').click();
  await waitViewer(page);
  await clickStructure(page, 'TA:right_ventricle');
  await expect(page.getByTestId('identify-selection')).toContainText('Right ventricle');
  await expect(page.getByTestId('recorded')).toHaveCount(0);
  await page.getByTestId('confirm-answer').click();
  await page.getByTestId('confirm-no').click();
  await expect(page.getByTestId('recorded')).toHaveCount(0);
  await expect(page.getByTestId('qnav-1')).not.toHaveClass(/answered/);
  await page.getByTestId('confirm-answer').click();
  await expect(page.getByTestId('confirm-value')).toHaveText('Right ventricle');
  await page.getByTestId('confirm-yes').click();
  await expect(page.getByTestId('qnav-1')).toHaveClass(/answered/);
});

test('[T0-16] hand cursor, tracking-status indicator and "hand lost" warning render', async ({ page }) => {
  await page.goto('/station/explore?model=heart_v1&input=gesture&vision=inject');
  await waitViewer(page);
  await expect(page.getByTestId('tracking-status')).toHaveAttribute('data-status', 'no-hand');
  for (let i = 0; i < 4; i++) { await inject(page, [{ x: 0.5, y: 0.5, handedness: 'Right' }]); await page.waitForTimeout(30); }
  await expect(page.getByTestId('tracking-status')).toHaveAttribute('data-status', 'tracking');
  await expect(page.getByTestId('hand-cursor')).toBeVisible();
  await expect(page.getByTestId('hand-lost')).toHaveCount(0);
  // no hands for > 500 ms -> hand lost
  for (let i = 0; i < 12; i++) { await page.evaluate(() => (window as any).__medsim.injectLandmarks({ t: performance.now(), hands: [] })); await page.waitForTimeout(80); }
  await expect(page.getByTestId('hand-lost')).toBeVisible();
  await expect(page.getByTestId('hand-lost')).toContainText('Hand lost');
  await inject(page, [{ x: 0.5, y: 0.5, handedness: 'Right' }]);
  await expect(page.getByTestId('hand-lost')).toHaveCount(0);
});

test('[T0-14] pinch gesture selects a structure on the model and fallback is switchable at any time', async ({ page }) => {
  await page.goto('/station/explore?model=heart_v1&input=gesture&vision=inject');
  await waitViewer(page);
  const pos = (await viewerCall<{ x: number; y: number }>(page, 'structureScreenPos', ['TA:aorta']))!;
  const vw = await page.evaluate(() => [innerWidth, innerHeight]);
  // default calibration box 0.2..0.8, mirrored: screen x = 1 - (raw - 0.2)/0.6
  const raw = { x: 0.2 + (1 - pos.x / vw[0]) * 0.6, y: 0.2 + (pos.y / vw[1]) * 0.6 };
  for (let i = 0; i < 6; i++) { await inject(page, [{ ...raw, handedness: 'Right' }]); await page.waitForTimeout(30); }
  await inject(page, [{ ...raw, handedness: 'Right', pinch: true }]);
  await page.waitForTimeout(30);
  await inject(page, [{ ...raw, handedness: 'Right', pinch: true }]);
  await page.waitForTimeout(30);
  await inject(page, [{ ...raw, handedness: 'Right' }]);
  await expect.poll(() => viewerCall<string[]>(page, 'getSelected')).toEqual(['TA:aorta']);
  // switch to mouse at any time
  await page.getByTestId('input-toggle').click();
  await expect(page.getByTestId('tracking-status')).toHaveAttribute('data-status', 'fallback');
  await expect(page.getByTestId('hand-cursor')).toHaveCount(0);
  await clickStructure(page, 'TA:pulmonary_trunk');
  await expect.poll(() => viewerCall<string[]>(page, 'getSelected')).toEqual(['TA:pulmonary_trunk']);
});

test('[T0-20] score-only feedback shown on the summary screen after submit (CARD-012)', async ({ page }) => {
  await goToLocalCases(page);
  await page.getByTestId('start-CARD-012').click();
  await waitViewer(page);
  // peel layers to reach the valve (V-03)
  await page.getByTestId('layer-myocardium').uncheck();
  await page.getByTestId('layer-chambers').uncheck();
  await clickStructure(page, 'TA:mitral_valve');
  await confirmAnswer(page);
  await page.getByTestId('next').click();
  await page.getByTestId('option-b').click();
  await confirmAnswer(page);
  await page.getByTestId('submit-case').click();
  await page.getByTestId('submit-yes').click();
  await expect(page.getByTestId('score')).toHaveText(/Your score: (\d+) \/ \1 \(100%\)/);
  await expect(page.getByTestId('case-summary')).not.toContainText('Correct answer');
});

test('[T0-21] interaction log records answers, time per question, structures viewed; saved locally', async ({ page }) => {
  await goToLocalCases(page);
  await page.getByTestId('start-CARD-010').click();
  await waitViewer(page);
  const pos = (await viewerCall<{ x: number; y: number }>(page, 'structureScreenPos', ['TA:aorta']))!;
  await page.mouse.move(pos.x, pos.y, { steps: 3 });
  await page.waitForTimeout(500);
  await clickStructure(page, 'TA:right_ventricle');
  await confirmAnswer(page);
  await page.getByTestId('layer-coronary').uncheck();
  await page.getByTestId('next').click();
  await page.waitForTimeout(200);
  await page.getByTestId('submit-case').click();
  await page.getByTestId('submit-yes').click();
  await expect(page.getByTestId('case-summary')).toBeVisible();
  const [a] = await page.evaluate(() => JSON.parse(localStorage.getItem('medsim.local.attempts')!));
  expect(a.answers).toEqual([expect.objectContaining({ question_id: 'q1', value: ['TA:right_ventricle'] })]);
  const types = a.log.events.map((e: { type: string }) => e.type);
  for (const t of ['case-open', 'question-open', 'question-close', 'structure-view', 'structure-select', 'answer-confirmed', 'layer-toggle', 'input-mode', 'submit']) expect(types).toContain(t);
  const viewed = a.log.events.filter((e: { type: string }) => e.type === 'structure-view').map((e: { structure_id: string }) => e.structure_id);
  expect(viewed).toContain('TA:aorta');
  const opens = a.log.events.filter((e: { type: string }) => e.type === 'question-open').map((e: { question_id: string }) => e.question_id);
  expect(opens.slice(0, 2)).toEqual(['q1', 'q2']);
  expect(a.result.max_score).toBeGreaterThan(0);
});

test('[T0-24] kiosk lockdown blocks exit shortcuts and context menu; exit needs the proctor PIN', async ({ page }) => {
  await page.goto('/station?mode=local&input=mouse');
  await expect(page.locator('html')).toHaveAttribute('data-kiosk', 'locked');
  const blocked = () => page.evaluate(() => (window as any).__medsim.kiosk.blocked as number);
  const b0 = await blocked();
  await page.keyboard.press('Control+w');
  await page.keyboard.press('F5');
  await page.keyboard.press('Alt+F4');
  await page.mouse.click(400, 600, { button: 'right' });
  expect(await blocked()).toBeGreaterThanOrEqual(b0 + 4);
  expect(page.url()).toContain('/station');
  await page.getByTestId('kiosk-exit').click();
  await page.getByTestId('pin-input').fill('1111');
  await page.getByTestId('pin-submit').click();
  await expect(page.getByTestId('pin-error')).toBeVisible();
  await expect(page.locator('html')).toHaveAttribute('data-kiosk', 'locked');
  await page.getByTestId('pin-input').fill('2468');
  await page.getByTestId('pin-submit').click();
  await expect(page.getByTestId('kiosk-off')).toBeVisible();
  await expect(page.locator('html')).not.toHaveAttribute('data-kiosk', 'locked');
});

test('[T1-16] Arabic interface renders right-to-left in the station', async ({ page }) => {
  await goToLocalCases(page);
  await page.getByTestId('lang-select').selectOption('ar');
  await expect(page.locator('html')).toHaveAttribute('dir', 'rtl');
  await expect(page.locator('html')).toHaveAttribute('lang', 'ar');
  await expect(page.getByTestId('case-list')).toContainText('اختر حالة');
  await page.getByTestId('start-CARD-010').click();
  await waitViewer(page);
  await expect(page.getByTestId('submit-case')).toHaveText('إرسال الحالة');
  const dir = await page.getByTestId('case-player').evaluate((el) => getComputedStyle(el).direction);
  expect(dir).toBe('rtl');
  // bilingual case content (A-07)
  await expect(page.getByTestId('labels-disabled')).toHaveText('التسميات معطلة أثناء التقييم');
  await page.getByTestId('lang-select').selectOption('en');
  await expect(page.locator('html')).toHaveAttribute('dir', 'ltr');
});

test('[T1-17] left- or right-handed primary hand drives the cursor', async ({ page }) => {
  await page.goto('/station/explore?model=heart_v1&input=gesture&vision=inject');
  await waitViewer(page);
  const cursorX = async () => (await page.getByTestId('hand-cursor').boundingBox())!.x;
  // left hand appears at raw x 0.35 (screen right after mirroring), right hand at raw 0.65 (screen left)
  const both = () => inject(page, [{ x: 0.35, y: 0.5, handedness: 'Left' }, { x: 0.65, y: 0.5, handedness: 'Right' }]);
  for (let i = 0; i < 8; i++) { await both(); await page.waitForTimeout(30); }
  expect(await cursorX()).toBeLessThan(800);
  await page.getByTestId('hand-select').selectOption('left');
  for (let i = 0; i < 12; i++) { await both(); await page.waitForTimeout(30); }
  await expect.poll(cursorX).toBeGreaterThan(800);
  expect(await page.evaluate(() => JSON.parse(localStorage.getItem('medsim.prefs')!).handedness)).toBe('left');
});

test('[T1-18] adjustable text size and colour-blind-safe highlight palette', async ({ page }) => {
  await goToLocalCases(page);
  const fontSize = () => page.evaluate(() => parseFloat(getComputedStyle(document.documentElement).fontSize));
  const f0 = await fontSize();
  await page.getByTestId('text-larger').click();
  await page.getByTestId('text-larger').click();
  expect(await fontSize()).toBeGreaterThan(f0 * 1.2);
  await page.getByTestId('text-smaller').click();
  expect(await fontSize()).toBeLessThan(f0 * 1.3);
  const hl = () => page.evaluate(() => getComputedStyle(document.documentElement).getPropertyValue('--hl-select').trim());
  const before = await hl();
  await page.getByTestId('cb-palette').check();
  await expect(page.locator('html')).toHaveAttribute('data-palette', 'cb');
  expect(await hl()).toBe('#e69f00');
  expect(await hl()).not.toBe(before);
});

test('[T0-26] performance harness reports fps and hand-to-cursor latency', async ({ page }) => {
  await page.goto('/station/bench?seconds=2&input=gesture&vision=inject');
  await waitViewer(page);
  // drive the hand pipeline during the run to collect latency samples
  await page.getByTestId('bench-run').click();
  for (let i = 0; i < 20; i++) { await inject(page, [{ x: 0.4 + i * 0.005, y: 0.5, handedness: 'Right' }]); await page.waitForTimeout(50); }
  await expect(page.getByTestId('bench-report')).toBeVisible({ timeout: 30_000 });
  const rep = await page.evaluate(() => (window as any).__medsim.benchReport);
  expect(rep.kind).toBe('medsim-bench');
  expect(rep.fps.mean).toBeGreaterThan(0);
  expect(rep.fps.samples).toBeGreaterThan(0);
  expect(['webgpu', 'webgl2']).toContain(rep.engine);
  expect(rep.latency_ms.samples).toBeGreaterThan(0);
  expect(rep.latency_ms.median).toBeGreaterThanOrEqual(0);
  const download = page.waitForEvent('download');
  await page.getByTestId('bench-download').click();
  expect((await download).suggestedFilename()).toMatch(/medsim-bench-.*\.json/);
});
