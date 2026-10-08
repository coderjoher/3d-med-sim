import { describe, it, expect, vi, afterEach } from 'vitest';
import { act, cleanup, fireEvent, screen, waitFor } from '@testing-library/react';
import type { CaseRecord, LabSession, StationState } from '@medsim/core';
import { renderPortal, user } from '../testUtils';

vi.mock('../../viewer/ModelViewer', async () => ({ ModelViewer: (await import('../testMocks')).MockModelViewer }));
vi.mock('../../viewer/ComparisonView', async () => ({ ComparisonView: (await import('../testMocks')).MockComparisonView }));
vi.mock('../../station/CasePlayer', async () => ({ CasePlayer: (await import('../testMocks')).MockCasePlayer }));

afterEach(() => { cleanup(); vi.unstubAllGlobals(); vi.useRealTimers(); });

const PROCTOR = user(['proctor'], 'proctor1');
const COHORTS = [{ id: 'co1', org_id: 'demo', name: 'Class of 2028', year: 2026 }];
const PUB: Partial<CaseRecord>[] = [
  { id: 'heart_01', status: 'published', version: 2, course_id: 'c1', data: { course: 'ANAT2' } as CaseRecord['data'] },
  { id: 'kidney_01', status: 'published', version: 1, course_id: 'c2', data: { course: 'RENAL' } as CaseRecord['data'] },
];
const SESSION: LabSession = { id: 's1', org_id: 'demo', name: 'Lab A', cohort_id: 'co1', case_ids: ['heart_01'], status: 'scheduled', created_by: 'proctor1', time_limit_min: 20 };

describe('proctor console', () => {
  it('[T1-08] proctor creates a session with name, cohort, case set and time limit', async () => {
    const r = renderPortal('/portal/sessions', {
      as: PROCTOR,
      routes: [
        { path: '/api/sessions', reply: [] },
        { path: '/api/cohorts', reply: COHORTS },
        { path: '/api/cases', reply: PUB },
        { method: 'POST', path: '/api/sessions', reply: ({ body }) => ({ ...SESSION, ...(body as object) }) },
      ],
    });
    fireEvent.change(await screen.findByTestId('session-name'), { target: { value: 'Lab A' } });
    fireEvent.click(await screen.findByTestId('session-case-heart_01'));
    fireEvent.click(screen.getByTestId('session-case-kidney_01'));
    fireEvent.change(screen.getByTestId('session-time'), { target: { value: '20' } });
    await waitFor(() => expect((screen.getByTestId('session-cohort') as HTMLSelectElement).value).toBe('co1'));
    fireEvent.click(screen.getByTestId('create-session'));
    await waitFor(() => expect(r.api.find('POST', '/api/sessions')).toHaveLength(1));
    expect(r.api.find('POST', '/api/sessions')[0].body).toEqual({ name: 'Lab A', cohort_id: 'co1', case_ids: ['heart_01', 'kidney_01'], time_limit_min: 20 });
    expect(r.api.find('GET', '/api/cases?status=published')).toHaveLength(1);
  });

  it('[T1-08] console starts/stops the session and polls live station status every 3 s, highlighting offline stations', async () => {
    vi.useFakeTimers({ toFake: ['setInterval', 'clearInterval', 'Date'] });
    const now = new Date('2026-10-08T10:00:00Z').getTime();
    vi.setSystemTime(now);
    let poll = 0;
    const stations = (): StationState[] => {
      poll++;
      return [
        { station_id: 'ST1', status: 'in_progress', camera_ok: true, input_mode: 'gesture', locked: false, student_id: 'student1', case_id: 'heart_01', last_seen: now - 1000 },
        { station_id: 'ST2', status: 'idle', camera_ok: false, input_mode: 'fallback', locked: true, last_seen: now - 60_000 },
        { station_id: 'ST3', status: poll > 1 ? 'submitted' : 'calibrating', camera_ok: true, input_mode: 'gesture', locked: false, last_seen: now },
      ];
    };
    const r = renderPortal('/portal/sessions/s1', {
      as: PROCTOR,
      routes: [
        { path: '/api/sessions/s1', reply: SESSION },
        { path: '/api/users', reply: [{ id: 'student1', org_id: 'demo', username: 'student1', display_name: 'Layla Hassan', roles: ['student'] }] },
        { path: '/api/sessions/s1/stations', reply: stations },
        { method: 'POST', path: '/api/sessions/s1/start', reply: { ...SESSION, status: 'running', started_at: '2026-10-08T10:00:00Z' } },
        { method: 'POST', path: '/api/sessions/s1/stop', reply: { ...SESSION, status: 'stopped' } },
      ],
    });
    expect(await screen.findByTestId('station-ST1')).toHaveAttribute('data-offline', 'false');
    expect(screen.getByTestId('station-ST2')).toHaveAttribute('data-offline', 'true');
    expect(screen.getByTestId('station-ST2').className).toMatch(/offline/);
    expect(screen.getByTestId('station-ST1').textContent).toMatch(/Layla Hassan/);
    expect(screen.getByTestId('station-ST1').textContent).toMatch(/heart_01/);
    expect(screen.getByTestId('station-ST1').textContent).toMatch(/Hand gestures/);
    expect(screen.getByTestId('station-ST2').textContent).toMatch(/Not available/);
    expect(screen.getByTestId('station-status-ST3').textContent).toBe('Calibrating');
    const before = r.api.find('GET', '/api/sessions/s1/stations').length;
    await act(async () => { vi.advanceTimersByTime(3000); });
    await waitFor(() => expect(r.api.find('GET', '/api/sessions/s1/stations').length).toBe(before + 1));
    await waitFor(() => expect(screen.getByTestId('station-status-ST3').textContent).toBe('Submitted'));

    fireEvent.click(screen.getByTestId('start-session'));
    await waitFor(() => expect(screen.getByTestId('session-status').textContent).toBe('Running'));
    fireEvent.click(screen.getByTestId('stop-session'));
    await waitFor(() => expect(screen.getByTestId('session-status').textContent).toBe('Stopped'));
    expect(r.api.find('POST', '/api/sessions/s1/start')).toHaveLength(1);
    expect(r.api.find('POST', '/api/sessions/s1/stop')).toHaveLength(1);
  });

  it('[T1-09] proctor switches a station to fallback / back to gesture, locks / unlocks and ends a station session', async () => {
    const r = renderPortal('/portal/sessions/s1', {
      as: PROCTOR,
      routes: [
        { path: '/api/sessions/s1', reply: { ...SESSION, status: 'running' } },
        { path: '/api/users', reply: [] },
        { path: '/api/sessions/s1/stations', reply: () => [
          { station_id: 'ST1', status: 'in_progress', camera_ok: false, input_mode: 'gesture', locked: false, last_seen: Date.now() },
          { station_id: 'ST2', status: 'in_progress', camera_ok: true, input_mode: 'fallback', locked: true, last_seen: Date.now() },
        ] },
        { method: 'POST', path: /\/api\/stations\/ST\d\/command/, reply: { queued: true } },
      ],
    });
    fireEvent.click(await screen.findByTestId('fallback-ST1'));
    fireEvent.click(screen.getByTestId('lock-ST1'));
    fireEvent.click(screen.getByTestId('gesture-ST2'));
    fireEvent.click(screen.getByTestId('unlock-ST2'));
    fireEvent.click(screen.getByTestId('end-ST1'));
    await waitFor(() => expect(r.api.find('POST', /\/api\/stations\//)).toHaveLength(5));
    const cmds = r.api.find('POST', /\/api\/stations\//).map((c) => [c.path, c.body]);
    expect(cmds).toEqual([
      ['/api/stations/ST1/command', { type: 'set-input', mode: 'fallback' }],
      ['/api/stations/ST1/command', { type: 'lock' }],
      ['/api/stations/ST2/command', { type: 'set-input', mode: 'gesture' }],
      ['/api/stations/ST2/command', { type: 'unlock' }],
      ['/api/stations/ST1/command', { type: 'end-session' }],
    ]);
  });
});
