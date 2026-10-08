import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';
import { BACKENDS, cid, makeHarness, type Harness } from './helpers.js';

describe.each(BACKENDS)('sessions & stations ($name)', (backend) => {
  let h: Harness;
  let proctor: string, s1: string, s4: string;
  beforeAll(async () => {
    h = await makeHarness(backend);
    [proctor, s1, s4] = await Promise.all(['proctor1', 'student1', 'student4'].map((u) => h.token(u)));
  });
  afterAll(async () => {
    await h?.close();
  });

  it('[T1-08] proctor creates a session (cohort + case set), starts/stops it, and sees live station status', async () => {
    const cohort = h.seed.cohorts.A.id;
    expect((await h.req('POST', '/api/sessions', proctor, { name: 'x', cohort_id: cohort, case_ids: ['NOPE'] })).statusCode).toBe(400);
    const s = await h.json('POST', '/api/sessions', proctor, { name: 'Thorax quiz', cohort_id: cohort, case_ids: ['CARD-010', 'CARD-012'], time_limit_min: 20 }, 201);
    expect(s).toMatchObject({ name: 'Thorax quiz', status: 'scheduled', cohort_id: cohort, case_ids: ['CARD-010', 'CARD-012'], time_limit_min: 20, created_by: h.seed.users.proctor1!.id });
    expect(await h.json('GET', '/api/sessions/active', s1)).toEqual([]);
    const started = await h.json('POST', `/api/sessions/${s.id}/start`, proctor);
    expect(started.status).toBe('running');
    expect(Date.parse(started.started_at)).not.toBeNaN();
    // students of the session's cohort see it; other cohorts do not
    expect((await h.json('GET', '/api/sessions/active', s1)).map((x: { id: string }) => x.id)).toEqual([s.id]);
    expect(await h.json('GET', '/api/sessions/active', s4)).toEqual([]);
    // station heartbeats + attempt start attach the station
    const st = 'LAB-01';
    const hb = await h.json('POST', `/api/stations/${st}/heartbeat`, s1, { status: 'calibrating', camera_ok: true, input_mode: 'gesture', locked: false, session_id: s.id });
    expect(hb.commands).toEqual([]);
    expect(typeof hb.server_time).toBe('number');
    const a = await h.json('POST', '/api/attempts/start', s1, { client_attempt_id: cid(), case_id: 'CARD-010', session_id: s.id, station_id: st });
    await h.json('POST', `/api/stations/${st}/heartbeat`, s1, { status: 'in_progress', student_id: h.seed.users.student1!.id, case_id: 'CARD-010', attempt_id: a.attempt_id });
    const stations = await h.json('GET', `/api/sessions/${s.id}/stations`, proctor);
    const mine = stations.find((x: { station_id: string }) => x.station_id === st);
    expect(mine).toMatchObject({ status: 'in_progress', camera_ok: true, case_id: 'CARD-010', attempt_id: a.attempt_id });
    // stations not seen for 15 s report 'offline'
    const now = Date.now();
    const spy = vi.spyOn(Date, 'now').mockReturnValue(now + 16_000);
    try {
      const later = await h.json('GET', `/api/sessions/${s.id}/stations`, proctor);
      expect(later.find((x: { station_id: string }) => x.station_id === st).status).toBe('offline');
    } finally {
      spy.mockRestore();
    }
    expect((await h.json('GET', '/api/sessions', proctor)).some((x: { id: string }) => x.id === s.id)).toBe(true);
    const stopped = await h.json('POST', `/api/sessions/${s.id}/stop`, proctor);
    expect(stopped.status).toBe('stopped');
    expect(stopped.stopped_at).toBeTruthy();
    // stopping queues end-session to the session's stations
    const hb2 = await h.json('POST', `/api/stations/${st}/heartbeat`, s1, { status: 'submitted' });
    expect(hb2.commands).toEqual([{ type: 'end-session' }]);
    expect((await h.req('POST', `/api/sessions/${s.id}/start`, proctor)).statusCode).toBe(409);
    expect((await h.req('POST', `/api/sessions/${s.id}/start`, s1)).statusCode).toBe(403);
  });

  it('[T1-09] proctor switches a station to fallback input and locks it remotely; commands are delivered once', async () => {
    const st = 'LAB-02';
    await h.json('POST', `/api/stations/${st}/heartbeat`, s4, { status: 'idle', camera_ok: false, input_mode: 'gesture', locked: false });
    expect((await h.req('POST', `/api/stations/${st}/command`, s4, { type: 'lock' })).statusCode).toBe(403);
    expect((await h.req('POST', `/api/stations/${st}/command`, proctor, { type: 'explode' })).statusCode).toBe(400);
    expect(await h.json('POST', `/api/stations/${st}/command`, proctor, { type: 'set-input', mode: 'fallback' })).toEqual({ queued: true });
    await h.json('POST', `/api/stations/${st}/command`, proctor, { type: 'lock' });
    const view = (await h.json('GET', '/api/stations', proctor)).find((x: { station_id: string }) => x.station_id === st);
    expect(view).toMatchObject({ locked: true, input_mode: 'fallback' });
    const hb = await h.json('POST', `/api/stations/${st}/heartbeat`, s4, {});
    expect(hb.commands).toEqual([{ type: 'set-input', mode: 'fallback' }, { type: 'lock' }]);
    expect((await h.json('POST', `/api/stations/${st}/heartbeat`, s4, { locked: true, input_mode: 'fallback' })).commands).toEqual([]);
    await h.json('POST', `/api/stations/${st}/command`, proctor, { type: 'unlock' });
    expect((await h.json('POST', `/api/stations/${st}/heartbeat`, s4, {})).commands).toEqual([{ type: 'unlock' }]);
  });
});
