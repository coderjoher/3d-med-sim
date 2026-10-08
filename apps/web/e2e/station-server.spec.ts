import { expect, test, type APIRequestContext, type Page } from '@playwright/test';
import { clickStructure, confirmAnswer, waitViewer } from './helpers';

const API = 'http://localhost:3000/api';

async function token(request: APIRequestContext, username: string, password: string) {
  const r = await request.post(`${API}/auth/login`, { data: { username, password } });
  expect(r.ok()).toBeTruthy();
  return (await r.json()).token as string;
}

/** Proctor creates and starts a session for cohort A with the given cases. */
async function startSession(request: APIRequestContext, caseIds: string[], timeLimit?: number) {
  const t = await token(request, 'proctor1', 'proctor123');
  const headers = { Authorization: `Bearer ${t}` };
  const cohorts = await (await request.get(`${API}/cohorts`, { headers })).json();
  const cohort = cohorts.find((c: { name: string }) => c.name.includes('Cohort A'));
  const s = await request.post(`${API}/sessions`, { headers, data: { name: `e2e ${Date.now()}`, cohort_id: cohort.id, case_ids: caseIds, time_limit_min: timeLimit } });
  expect(s.status()).toBe(201);
  const session = await s.json();
  expect((await request.post(`${API}/sessions/${session.id}/start`, { headers })).ok()).toBeTruthy();
  return { session, headers };
}

async function stationSignIn(page: Page, user: string, station: string) {
  await page.goto(`/station?input=mouse&kiosk=0&hb=1000&station=${station}`);
  await page.getByTestId('username').fill(user);
  await page.getByTestId('password').fill('student123');
  await page.getByTestId('signin-submit').click();
  await page.getByTestId('cal-skip').click();
  await page.getByTestId('skip-practice').click();
  await expect(page.getByTestId('case-list')).toBeVisible();
}

async function startCase(page: Page, sessionId: string, caseId: string) {
  const card = page.locator(`[data-testid="case-${caseId}"][data-session="${sessionId}"]`);
  await expect(card).toBeVisible();
  await card.getByTestId(`start-${caseId}`).click();
  await waitViewer(page);
}

test('[T1-10] station keeps working when the server drops; the queued attempt syncs after reconnect', async ({ page, request }) => {
  const { session } = await startSession(request, ['CARD-010']);
  await stationSignIn(page, 'student1', `E2E-SYNC-${Date.now()}`);
  await startCase(page, session.id, 'CARD-010');
  await clickStructure(page, 'TA:right_ventricle');
  await confirmAnswer(page);

  // the lab server becomes unreachable
  await page.route('**/api/**', (route) => route.abort('connectionrefused'));
  await page.getByTestId('submit-case').click();
  await page.getByTestId('submit-yes').click();
  await expect(page.getByTestId('summary-note')).toContainText('it will be sent when the connection returns');
  const queued = await page.evaluate(() => JSON.parse(localStorage.getItem('medsim.station.queue') ?? '[]'));
  expect(queued).toHaveLength(1);
  const clientId = queued[0].client_attempt_id;
  await expect(page.getByTestId('sync-status')).toHaveAttribute('data-pending', '1');
  await expect(page.getByTestId('sync-status')).toContainText('Offline');

  // connection returns -> queue flushes via POST /api/attempts/sync
  const synced = page.waitForResponse((r) => r.url().includes('/api/attempts/sync') && r.status() === 200, { timeout: 30_000 });
  await page.unroute('**/api/**');
  const body = await (await synced).json();
  expect(body.synced).toContain(clientId);
  await expect(page.getByTestId('sync-status')).toHaveAttribute('data-pending', '0', { timeout: 15_000 });
  await expect(page.getByTestId('sync-status')).toContainText('All results synced');

  // idempotent: syncing the same attempt again does not create a duplicate
  const stTok = await token(request, 'student1', 'student123');
  const again = await request.post(`${API}/attempts/sync`, { headers: { Authorization: `Bearer ${stTok}` }, data: { items: [queued[0]] } });
  expect((await again.json()).synced).toContain(clientId);
  const pTok = await token(request, 'proctor1', 'proctor123');
  const attempts = await (await request.get(`${API}/attempts?case_id=CARD-010`, { headers: { Authorization: `Bearer ${pTok}` } })).json();
  const mine = attempts.filter((a: { session_id?: string }) => a.session_id === session.id);
  expect(mine).toHaveLength(1);
  expect(mine[0].score).toBeGreaterThan(0);
});

test('[T0-19] time limit counts down and auto-submits; next/previous navigation works', async ({ page, request }) => {
  const { session } = await startSession(request, ['CARD-010'], 0.25); // 15 s
  await stationSignIn(page, 'student2', `E2E-TIMER-${Date.now()}`);
  await startCase(page, session.id, 'CARD-010');
  await expect(page.getByTestId('timer')).toHaveText(/00:1\d/);
  await expect(page.getByTestId('prev')).toBeDisabled();
  await page.getByTestId('next').click();
  await expect(page.getByTestId('question')).toContainText('Question 2 of');
  await page.getByTestId('prev').click();
  await expect(page.getByTestId('question')).toContainText('Question 1 of');
  await clickStructure(page, 'TA:right_ventricle');
  await confirmAnswer(page);
  await expect(page.getByTestId('timed-out')).toBeVisible({ timeout: 30_000 });
  await expect(page.getByTestId('timed-out')).toContainText('Time is up');
  await expect(page.getByTestId('score')).toBeVisible(); // CARD-010 feedback: full
});

test('[T1-09] proctor locks / unlocks a station and switches its input remotely (heartbeat commands)', async ({ page, request }) => {
  const { headers } = await startSession(request, ['CARD-010']);
  const station = `E2E-LOCK-${Date.now()}`;
  await stationSignIn(page, 'student3', station);
  await expect.poll(async () => (await request.get(`${API}/stations`, { headers })).json().then((l: Array<{ station_id: string }>) => l.some((s) => s.station_id === station)), { timeout: 15_000 }).toBe(true);
  await request.post(`${API}/stations/${station}/command`, { headers, data: { type: 'lock' } });
  await expect(page.getByTestId('lock-overlay')).toBeVisible({ timeout: 10_000 });
  await request.post(`${API}/stations/${station}/command`, { headers, data: { type: 'unlock' } });
  await expect(page.getByTestId('lock-overlay')).toHaveCount(0, { timeout: 10_000 });
  await request.post(`${API}/stations/${station}/command`, { headers, data: { type: 'set-input', mode: 'fallback' } });
  await expect(page.getByTestId('input-notice')).toContainText('The proctor switched this station', { timeout: 10_000 });
});
