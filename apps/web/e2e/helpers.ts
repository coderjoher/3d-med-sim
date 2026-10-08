import { expect, type Page } from '@playwright/test';

/** Wait until the viewer registered under `key` (default: primary) has built its scene. */
export async function waitViewer(page: Page, key?: string) {
  await page.waitForFunction((k) => {
    const d = (window as any).__medsim;
    const v = k ? d?.viewers?.[k] : d?.viewer;
    return !!v?.ready;
  }, key ?? null, { timeout: 60_000 });
}

export async function viewerCall<T>(page: Page, fn: string, args: unknown[] = [], key?: string): Promise<T> {
  return page.evaluate(({ fn, args, key }) => {
    const d = (window as any).__medsim;
    const v = key ? d.viewers[key] : d.viewer;
    return v[fn](...args);
  }, { fn, args, key });
}

/** Click a structure on the 3D model deterministically (screen point that actually picks it). */
export async function clickStructure(page: Page, id: string, key?: string) {
  await waitViewer(page, key);
  let pos: { x: number; y: number } | null = null;
  await expect.poll(async () => {
    pos = await viewerCall<{ x: number; y: number } | null>(page, 'structureScreenPos', [id], key);
    return pos !== null;
  }, { timeout: 15_000 }).toBe(true);
  await page.mouse.click(pos!.x, pos!.y);
}

/** Local (Phase 0, no backend) station sign-in. */
export async function localSignIn(page: Page, opts: { student?: string; query?: string } = {}) {
  await page.goto(`/station?mode=local&input=mouse&kiosk=0${opts.query ?? ''}`);
  await page.getByTestId('student-id').fill(opts.student ?? 'S1001');
  await page.getByTestId('signin-submit').click();
}

/** Calibrate by clicking the four corner targets (mouse). */
export async function calibrateWithMouse(page: Page) {
  for (let i = 0; i < 4; i++) await page.getByTestId(`cal-target-${i}`).click();
}

/** Stage + confirm an answer through the confirmation dialog (I-04). */
export async function confirmAnswer(page: Page) {
  await page.getByTestId('confirm-answer').click();
  await expect(page.getByTestId('confirm-dialog')).toBeVisible();
  await page.getByTestId('confirm-yes').click();
  await expect(page.getByTestId('recorded')).toBeVisible();
}

export async function goToLocalCases(page: Page) {
  await localSignIn(page);
  await page.getByTestId('cal-skip').click();
  await page.getByTestId('skip-practice').click();
  await expect(page.getByTestId('case-list')).toBeVisible();
}
