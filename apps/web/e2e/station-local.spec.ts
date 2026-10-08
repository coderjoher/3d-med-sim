import { expect, test } from '@playwright/test';
import { calibrateWithMouse, clickStructure, confirmAnswer, localSignIn, waitViewer } from './helpers';

test('[T0-25] full local flow with mouse only: calibrate → practice → case → answer w/ confirm → submit → summary', async ({ page }) => {
  await localSignIn(page, { student: 'S2001' });
  await expect(page.getByTestId('calibration')).toBeVisible();
  await calibrateWithMouse(page);

  // practice (non-graded)
  await page.getByTestId('start-practice').click();
  await expect(page.getByTestId('practice-badge')).toBeVisible();
  await waitViewer(page);
  await clickStructure(page, 'TA:left_ventricle');
  await expect(page.getByTestId('identify-selection')).toContainText('Left ventricle');
  await confirmAnswer(page);
  await page.getByTestId('next').click();
  await page.getByTestId('option-b').click();
  await confirmAnswer(page);
  await page.getByTestId('submit-case').click();
  await page.getByTestId('submit-yes').click();
  await expect(page.getByTestId('score')).toContainText('2 / 2');
  await page.getByTestId('summary-exit').click();

  // assessment case
  await expect(page.getByTestId('case-list')).toBeVisible();
  await page.getByTestId('start-CARD-010').click();
  await waitViewer(page);
  await expect(page.getByTestId('timer')).toBeVisible();
  await clickStructure(page, 'TA:right_ventricle');
  await expect(page.getByTestId('identify-selection')).toContainText('Right ventricle');
  await confirmAnswer(page);
  await page.getByTestId('next').click();
  await clickStructure(page, 'TA:superior_vena_cava');
  await confirmAnswer(page);
  await page.getByTestId('submit-case').click();
  await expect(page.getByTestId('unanswered-warning')).toBeVisible();
  await page.getByTestId('submit-yes').click();
  await expect(page.getByTestId('case-summary')).toBeVisible();
  await expect(page.getByTestId('score')).toBeVisible();
  await expect(page.getByTestId('summary-q1')).toHaveClass(/correct/);

  // local log persisted + downloadable
  const stored = await page.evaluate(() => JSON.parse(localStorage.getItem('medsim.local.attempts') ?? '[]'));
  expect(stored).toHaveLength(1);
  expect(stored[0].student_id).toBe('S2001');
  expect(stored[0].case_id).toBe('CARD-010');
  await page.getByTestId('summary-exit').click();
  const download = page.waitForEvent('download');
  await page.getByTestId('download-logs').click();
  expect((await download).suggestedFilename()).toMatch(/medsim-local-.*\.json/);
});
