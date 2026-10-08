/**
 * Portal end-to-end (browser) — T1-22 portal half: author → review → publish → proctor session → reports.
 * Requires the API with SEED_DEMO=1 on :3000 and vite on :5173 (see playwright.config.ts).
 * The student-attempt step at a station is covered by the station e2e specs.
 */
import { expect, test, type Page } from '@playwright/test';

async function login(page: Page, username: string, password: string) {
  await page.goto('/portal/login');
  await page.getByTestId('login-username').fill(username);
  await page.getByTestId('login-password').fill(password);
  await page.getByTestId('login-submit').click();
  await expect(page.getByTestId('portal-nav')).toBeVisible();
}

async function logout(page: Page) {
  await page.getByTestId('logout').click();
  await expect(page.getByTestId('login-submit')).toBeVisible();
}

test('[T1-22] portal: author creates + submits a case, reviewer approves, proctor runs a session, admin opens reports', async ({ page }) => {
  const caseId = `e2e_case_${Date.now().toString(36)}`;
  const sessionName = `E2E Lab ${Date.now().toString(36)}`;

  await test.step('author1 creates a case via the web form and submits it for review', async () => {
    await login(page, 'author1', 'author123');
    await page.getByTestId('nav-cases').click();
    await page.getByTestId('new-case').click();
    await page.getByTestId('case-id').fill(caseId);
    await expect(page.getByTestId('case-course')).not.toHaveValue('');
    await page.getByTestId('case-stem-en').fill('A 45-year-old presents with exertional dyspnoea.');
    await page.getByTestId('case-stem-ar').fill('مريض عمره 45 عاماً يعاني من ضيق التنفس عند الجهد.');
    await page.getByTestId('case-time').fill('10');
    await page.getByTestId('q0-prompt-en').fill('Which chamber pumps blood into the aorta?');
    await page.getByTestId('q0-prompt-ar').fill('أي حجرة تضخ الدم إلى الشريان الأبهر؟');
    await page.getByTestId('q0-opt-0-en').fill('Left ventricle');
    await page.getByTestId('q0-opt-1-en').fill('Right atrium');
    await page.getByTestId('q0-correct-0').check();
    await page.getByTestId('save-case').click();
    await expect(page).toHaveURL(new RegExp(`/portal/cases/${caseId}/edit`));
    await expect(page.getByTestId('status-badge')).toHaveText('Draft');
    await page.getByTestId('submit-review').click();
    await expect(page.getByTestId('status-badge')).toHaveText('In review');
    await logout(page);
  });

  await test.step('reviewer1 previews and approves the case', async () => {
    await login(page, 'reviewer1', 'reviewer123');
    await page.getByTestId('nav-review').click();
    await page.getByTestId(`review-open-${caseId}`).click();
    await expect(page.getByTestId('case-summary')).toContainText('Which chamber pumps blood');
    await page.getByTestId('review-comment-input').fill('Anatomically accurate.');
    await page.getByTestId('approve').click();
    await expect(page.getByTestId('status-badge')).toHaveText('Published');
    await logout(page);
  });

  await test.step('proctor1 creates a session including the case and starts it', async () => {
    await login(page, 'proctor1', 'proctor123');
    await page.getByTestId('nav-sessions').click();
    await page.getByTestId('session-name').fill(sessionName);
    await expect(page.getByTestId('session-cohort')).not.toHaveValue('');
    await page.getByTestId(`session-case-${caseId}`).check();
    await page.getByTestId('session-time').fill('15');
    await page.getByTestId('create-session').click();
    const row = page.getByRole('row', { name: new RegExp(sessionName) });
    await expect(row).toBeVisible();
    await row.getByRole('link').click();
    await expect(page.getByTestId('session-status')).toHaveText('Scheduled');
    await page.getByTestId('start-session').click();
    await expect(page.getByTestId('session-status')).toHaveText('Running');
    await expect(page.getByTestId('station-grid')).toBeAttached();
    await logout(page);
  });

  await test.step('admin opens reports', async () => {
    await login(page, 'admin', 'admin123');
    await page.getByTestId('nav-reports').click();
    await expect(page.getByRole('heading', { name: 'Reports' })).toBeVisible();
    await expect(page.getByTestId('report-course')).not.toHaveValue('');
    await expect(page.getByRole('tab', { name: 'Results' })).toBeVisible();
    await page.getByRole('tab', { name: 'Success metrics' }).click();
    await expect(page.getByTestId('metrics')).toBeVisible();
  });
});

test('[T1-16] portal: Arabic interface renders right-to-left', async ({ page }) => {
  await page.goto('/portal/login');
  await page.getByTestId('lang-select').selectOption('ar');
  await expect(page.locator('html')).toHaveAttribute('dir', 'rtl');
  await expect(page.getByTestId('login-submit')).toHaveText('تسجيل الدخول');
  await page.getByTestId('lang-select').selectOption('en');
});
