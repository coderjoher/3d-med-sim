/** Proctor sessions and live station monitoring / remote commands (R-08, I-05). */
import type { FastifyInstance } from 'fastify';
import type { HeartbeatResponse, LabSession, StationCommand, StationState } from '@medsim/core';
import { j, type Db } from '../db/pool.js';
import { badRequest, hasAnyRole, HttpError, me, notFound, nowIso, uid } from '../http.js';
import type { AppCtx } from '../app.js';

/** A station not heard from for this long reports status 'offline'. */
export const STATION_OFFLINE_MS = 15_000;

interface SessionRow {
  id: string; org_id: string; name: string; cohort_id: string; case_ids: string[]; status: LabSession['status'];
  started_at: string | null; stopped_at: string | null; time_limit_min: number | null; created_by: string;
}

interface StationRow { org_id: string; id: string; session_id: string | null; state: StationState; commands: StationCommand[]; last_seen: number }

function toSession(r: SessionRow): LabSession {
  const s: LabSession = { id: r.id, org_id: r.org_id, name: r.name, cohort_id: r.cohort_id, case_ids: r.case_ids, status: r.status, created_by: r.created_by };
  if (r.started_at) s.started_at = r.started_at;
  if (r.stopped_at) s.stopped_at = r.stopped_at;
  if (r.time_limit_min != null) s.time_limit_min = Number(r.time_limit_min);
  return s;
}

export function stationView(r: StationRow, now = Date.now()): StationState {
  const last = Number(r.last_seen);
  const st: StationState = { ...r.state, station_id: r.id, last_seen: last };
  if (now - last > STATION_OFFLINE_MS) st.status = 'offline';
  return st;
}

const DEFAULT_STATE = (id: string): StationState => ({ station_id: id, status: 'idle', camera_ok: false, input_mode: 'gesture', locked: false, last_seen: 0 });

async function getSession(db: Db, org: string, id: string): Promise<SessionRow> {
  const s = await db.one<SessionRow>(`SELECT * FROM sessions WHERE org_id = $1 AND id = $2`, [org, id]);
  if (!s) throw notFound('Session not found');
  return s;
}

/** Queue a command for a station (creating its row if it was never seen). Mirrors lock/input into the stored state. */
export async function queueCommand(db: Db, org: string, stationId: string, cmd: StationCommand): Promise<void> {
  const row = await db.one<StationRow>(`SELECT * FROM stations WHERE org_id = $1 AND id = $2`, [org, stationId]);
  const state = row?.state ?? DEFAULT_STATE(stationId);
  if (cmd.type === 'lock') state.locked = true;
  if (cmd.type === 'unlock') state.locked = false;
  if (cmd.type === 'set-input') state.input_mode = cmd.mode;
  if (row) {
    await db.exec(`UPDATE stations SET commands = $1::jsonb, state = $2::jsonb WHERE org_id = $3 AND id = $4`, [j([...row.commands, cmd]), j(state), org, stationId]);
  } else {
    await db.exec(`INSERT INTO stations (org_id, id, session_id, state, commands, last_seen) VALUES ($1, $2, NULL, $3::jsonb, $4::jsonb, 0)`, [org, stationId, j(state), j([cmd])]);
  }
  // A proctor intervening during an attempt counts as "needed help" (§17 success metrics).
  if (state.attempt_id && (cmd.type === 'set-input' || cmd.type === 'unlock'))
    await db.exec(`UPDATE attempts SET needed_help = true WHERE org_id = $1 AND id = $2`, [org, state.attempt_id]);
}

export async function attachStationToSession(db: Db, org: string, stationId: string, sessionId: string | null | undefined): Promise<void> {
  if (!sessionId) return;
  const row = await db.one<StationRow>(`SELECT id FROM stations WHERE org_id = $1 AND id = $2`, [org, stationId]);
  if (row) await db.exec(`UPDATE stations SET session_id = $1 WHERE org_id = $2 AND id = $3`, [sessionId, org, stationId]);
  else
    await db.exec(`INSERT INTO stations (org_id, id, session_id, state, commands, last_seen) VALUES ($1, $2, $3, $4::jsonb, '[]'::jsonb, $5)`, [
      org, stationId, sessionId, j(DEFAULT_STATE(stationId)), Date.now(),
    ]);
}

export async function sessionRoutes(app: FastifyInstance, ctx: AppCtx) {
  const { db, auth } = ctx;

  app.post<{ Body: { name: string; cohort_id: string; case_ids: string[]; time_limit_min?: number } }>(
    '/api/sessions',
    { preHandler: auth('proctor') },
    async (req, reply) => {
      const u = me(req);
      const b = req.body ?? ({} as { name: string; cohort_id: string; case_ids: string[] });
      if (!b.name || !b.cohort_id || !Array.isArray(b.case_ids)) throw badRequest('name, cohort_id and case_ids are required');
      if (!(await db.one(`SELECT id FROM cohorts WHERE org_id = $1 AND id = $2`, [u.org_id, b.cohort_id]))) throw badRequest('Unknown cohort_id');
      for (const cid of b.case_ids) {
        const c = await db.one<{ published_version: number | null }>(`SELECT published_version FROM cases WHERE org_id = $1 AND id = $2`, [u.org_id, cid]);
        if (!c) throw badRequest(`Unknown case "${cid}"`);
        if (c.published_version == null) throw badRequest(`Case "${cid}" is not published`);
      }
      const id = uid();
      await db.exec(
        `INSERT INTO sessions (id, org_id, name, cohort_id, case_ids, status, time_limit_min, created_by, created_at)
         VALUES ($1, $2, $3, $4, $5::jsonb, 'scheduled', $6, $7, $8)`,
        [id, u.org_id, b.name, b.cohort_id, j(b.case_ids), b.time_limit_min ?? null, u.id, nowIso()],
      );
      reply.code(201);
      return toSession(await getSession(db, u.org_id, id));
    },
  );

  app.get('/api/sessions', { preHandler: auth('proctor') }, async (req) =>
    (await db.many<SessionRow>(`SELECT * FROM sessions WHERE org_id = $1 ORDER BY created_at DESC`, [me(req).org_id])).map(toSession),
  );

  /** Running sessions; a student only sees sessions for their own cohort. */
  app.get('/api/sessions/active', { preHandler: auth() }, async (req) => {
    const u = me(req);
    const rows = await db.many<SessionRow>(`SELECT * FROM sessions WHERE org_id = $1 AND status = 'running' ORDER BY created_at DESC`, [u.org_id]);
    const staff = hasAnyRole(u, ['proctor', 'author', 'reviewer']);
    return rows.filter((r) => staff || !u.cohort_id || r.cohort_id === u.cohort_id).map(toSession);
  });

  app.get<{ Params: { id: string } }>('/api/sessions/:id', { preHandler: auth() }, async (req) => toSession(await getSession(db, me(req).org_id, req.params.id)));

  app.post<{ Params: { id: string } }>('/api/sessions/:id/start', { preHandler: auth('proctor') }, async (req) => {
    const org = me(req).org_id;
    const s = await getSession(db, org, req.params.id);
    if (s.status === 'stopped') throw new HttpError(409, 'Session already stopped');
    if (s.status !== 'running')
      await db.exec(`UPDATE sessions SET status = 'running', started_at = $1 WHERE org_id = $2 AND id = $3`, [nowIso(), org, s.id]);
    return toSession(await getSession(db, org, s.id));
  });

  app.post<{ Params: { id: string } }>('/api/sessions/:id/stop', { preHandler: auth('proctor') }, async (req) => {
    const org = me(req).org_id;
    const s = await getSession(db, org, req.params.id);
    if (s.status !== 'stopped') {
      await db.exec(`UPDATE sessions SET status = 'stopped', stopped_at = $1 WHERE org_id = $2 AND id = $3`, [nowIso(), org, s.id]);
      const stations = await db.many<StationRow>(`SELECT * FROM stations WHERE org_id = $1 AND session_id = $2`, [org, s.id]);
      for (const st of stations) await queueCommand(db, org, st.id, { type: 'end-session' });
    }
    return toSession(await getSession(db, org, s.id));
  });

  /** Stations attached to this session plus unassigned stations of the org (the lab). */
  app.get<{ Params: { id: string } }>('/api/sessions/:id/stations', { preHandler: auth('proctor') }, async (req) => {
    const org = me(req).org_id;
    const s = await getSession(db, org, req.params.id);
    const rows = await db.many<StationRow>(`SELECT * FROM stations WHERE org_id = $1 ORDER BY id`, [org]);
    const now = Date.now();
    return rows.filter((r) => r.session_id === s.id || r.session_id == null).map((r) => stationView(r, now));
  });

  /** All stations of the org (extra route). */
  app.get('/api/stations', { preHandler: auth('proctor') }, async (req) => {
    const now = Date.now();
    return (await db.many<StationRow>(`SELECT * FROM stations WHERE org_id = $1 ORDER BY id`, [me(req).org_id])).map((r) => stationView(r, now));
  });

  app.post<{ Params: { id: string }; Body: StationCommand }>('/api/stations/:id/command', { preHandler: auth('proctor') }, async (req) => {
    const cmd = req.body;
    const valid =
      cmd && (cmd.type === 'lock' || cmd.type === 'unlock' || cmd.type === 'end-session' ||
        (cmd.type === 'set-input' && (cmd.mode === 'gesture' || cmd.mode === 'fallback')));
    if (!valid) throw badRequest('Invalid station command');
    const clean: StationCommand = cmd.type === 'set-input' ? { type: 'set-input', mode: cmd.mode } : ({ type: cmd.type } as StationCommand);
    await queueCommand(db, me(req).org_id, req.params.id, clean);
    return { queued: true };
  });

  app.post<{ Params: { id: string }; Body: Partial<StationState> & { session_id?: string } }>(
    '/api/stations/:id/heartbeat',
    { preHandler: auth() },
    async (req): Promise<HeartbeatResponse> => {
      const org = me(req).org_id;
      const id = req.params.id;
      const now = Date.now();
      const b = req.body ?? {};
      const row = await db.one<StationRow>(`SELECT * FROM stations WHERE org_id = $1 AND id = $2`, [org, id]);
      const prev = row?.state ?? DEFAULT_STATE(id);
      const { session_id, ...patch } = b;
      const state: StationState = { ...prev, ...patch, station_id: id, last_seen: now };
      if (state.status === 'offline') state.status = 'idle';
      const commands = row?.commands ?? [];
      const sessionId = session_id !== undefined ? session_id || null : (row?.session_id ?? null);
      if (row)
        await db.exec(`UPDATE stations SET state = $1::jsonb, commands = '[]'::jsonb, last_seen = $2, session_id = $3 WHERE org_id = $4 AND id = $5`, [
          j(state), now, sessionId, org, id,
        ]);
      else
        await db.exec(`INSERT INTO stations (org_id, id, session_id, state, commands, last_seen) VALUES ($1, $2, $3, $4::jsonb, '[]'::jsonb, $5)`, [
          org, id, sessionId, j(state), now,
        ]);
      return { commands, server_time: now };
    },
  );
}
