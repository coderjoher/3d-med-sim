/** Auth, users, cohorts, courses, enrolments, orgs (R-07, T3-01). */
import bcrypt from 'bcryptjs';
import type { FastifyInstance } from 'fastify';
import type { Cohort, Course, CreateUserRequest, LoginRequest, Org, Role, User } from '@medsim/core';
import { j, isUniqueViolation } from '../db/pool.js';
import { badRequest, forbidden, hasRole, HttpError, me, notFound, nowIso, signToken, toUser, uid, type UserRow } from '../http.js';
import { ensureOrgModels } from '../repo.js';
import type { AppCtx } from '../app.js';

const ROLES: Role[] = ['student', 'author', 'reviewer', 'proctor', 'admin', 'superadmin'];

function checkRoles(roles: unknown, actor: User): Role[] {
  if (!Array.isArray(roles) || roles.length === 0 || roles.some((r) => !ROLES.includes(r as Role)))
    throw badRequest(`roles must be a non-empty array of ${ROLES.join(', ')}`);
  if (roles.includes('superadmin') && !actor.roles.includes('superadmin')) throw forbidden('Only a superadmin can grant superadmin');
  return roles as Role[];
}

export async function createUser(ctx: AppCtx, orgId: string, body: CreateUserRequest & { handedness?: 'left' | 'right' }, rounds = 10): Promise<User> {
  const { db } = ctx;
  if (!body.username || !body.password) throw badRequest('username and password are required');
  if (body.cohort_id) {
    const c = await db.one(`SELECT id FROM cohorts WHERE org_id = $1 AND id = $2`, [orgId, body.cohort_id]);
    if (!c) throw badRequest('Unknown cohort_id');
  }
  const id = uid();
  try {
    await db.exec(
      `INSERT INTO users (id, org_id, username, password_hash, display_name, roles, lang, cohort_id, handedness, created_at)
       VALUES ($1, $2, $3, $4, $5, $6::jsonb, $7, $8, $9, $10)`,
      [id, orgId, body.username, await bcrypt.hash(body.password, rounds), body.display_name || body.username, j(body.roles),
        body.lang ?? null, body.cohort_id ?? null, body.handedness ?? null, nowIso()],
    );
  } catch (e) {
    if (isUniqueViolation(e)) throw new HttpError(409, `Username "${body.username}" already exists`);
    throw e;
  }
  return toUser((await db.one<UserRow>(`SELECT * FROM users WHERE id = $1`, [id]))!);
}

export async function createOrg(ctx: AppCtx, id: string, name: string): Promise<Org> {
  if (!/^[a-z0-9][a-z0-9_-]{0,62}$/.test(id)) throw badRequest('org id must be lowercase letters, digits, _ or -');
  const exists = await ctx.db.one(`SELECT id FROM orgs WHERE id = $1`, [id]);
  if (exists) throw new HttpError(409, `Organisation "${id}" already exists`);
  await ctx.db.exec(`INSERT INTO orgs (id, name, created_at) VALUES ($1, $2, $3)`, [id, name, nowIso()]);
  await ensureOrgModels(ctx.db, id);
  return { id, name };
}

export async function adminRoutes(app: FastifyInstance, ctx: AppCtx) {
  const { db, auth } = ctx;

  app.post<{ Body: LoginRequest }>('/api/auth/login', async (req) => {
    const { username, password, org_id } = req.body ?? ({} as LoginRequest);
    if (!username || !password) throw badRequest('username and password are required');
    const rows = org_id
      ? await db.many<UserRow>(`SELECT * FROM users WHERE username = $1 AND org_id = $2`, [username, org_id])
      : await db.many<UserRow>(`SELECT * FROM users WHERE username = $1`, [username]);
    if (rows.length > 1) throw badRequest('Username exists in several organisations; pass org_id');
    const row = rows[0];
    if (!row || !row.active || !(await bcrypt.compare(password, row.password_hash))) throw new HttpError(401, 'Invalid username or password');
    const user = toUser(row);
    return { token: signToken(user, ctx.jwtSecret), user };
  });

  app.get('/api/me', { preHandler: auth() }, async (req) => me(req));

  // --- users -------------------------------------------------------------
  app.get<{ Querystring: { role?: Role; cohort_id?: string } }>('/api/users', { preHandler: auth('admin', 'proctor') }, async (req) => {
    const u = me(req);
    const rows = await db.many<UserRow>(`SELECT * FROM users WHERE org_id = $1 ORDER BY username`, [u.org_id]);
    return rows
      .filter((r) => !req.query.role || r.roles.includes(req.query.role))
      .filter((r) => !req.query.cohort_id || r.cohort_id === req.query.cohort_id)
      .map(toUser);
  });

  app.post<{ Body: CreateUserRequest & { org_id?: string; handedness?: 'left' | 'right' } }>(
    '/api/users',
    { preHandler: auth('admin') },
    async (req, reply) => {
      const actor = me(req);
      const body = req.body ?? ({} as CreateUserRequest);
      let orgId = actor.org_id;
      if (body.org_id && body.org_id !== actor.org_id) {
        if (!actor.roles.includes('superadmin')) throw notFound('Organisation not found');
        if (!(await db.one(`SELECT id FROM orgs WHERE id = $1`, [body.org_id]))) throw notFound('Organisation not found');
        orgId = body.org_id;
      }
      checkRoles(body.roles, actor);
      reply.code(201);
      return createUser(ctx, orgId, body);
    },
  );

  app.patch<{ Params: { id: string }; Body: Partial<CreateUserRequest> & { handedness?: 'left' | 'right'; active?: boolean } }>(
    '/api/users/:id',
    { preHandler: auth() },
    async (req) => {
      const actor = me(req);
      const isAdmin = hasRole(actor, 'admin');
      if (!isAdmin && req.params.id !== actor.id) throw forbidden('Requires role: admin');
      const row = await db.one<UserRow>(`SELECT * FROM users WHERE org_id = $1 AND id = $2`, [actor.org_id, req.params.id]);
      if (!row) throw notFound('User not found');
      const b = req.body ?? {};
      const adminOnly = ['roles', 'cohort_id', 'active', 'username'] as const;
      if (!isAdmin && adminOnly.some((k) => k in b)) throw forbidden('Only an admin can change roles, cohort or status');
      const sets: string[] = [];
      const params: unknown[] = [];
      const set = (col: string, val: unknown, cast = '') => {
        params.push(val);
        sets.push(`${col} = $${params.length}${cast}`);
      };
      if (b.display_name !== undefined) set('display_name', b.display_name);
      if (b.lang !== undefined) set('lang', b.lang);
      if (b.handedness !== undefined) set('handedness', b.handedness);
      if (b.password) set('password_hash', await bcrypt.hash(b.password, 10));
      if (b.roles !== undefined) set('roles', j(checkRoles(b.roles, actor)), '::jsonb');
      if (b.active !== undefined) set('active', !!b.active);
      if (b.cohort_id !== undefined) {
        if (b.cohort_id && !(await db.one(`SELECT id FROM cohorts WHERE org_id = $1 AND id = $2`, [actor.org_id, b.cohort_id])))
          throw badRequest('Unknown cohort_id');
        set('cohort_id', b.cohort_id || null);
      }
      if (sets.length) {
        params.push(actor.org_id, row.id);
        await db.exec(`UPDATE users SET ${sets.join(', ')} WHERE org_id = $${params.length - 1} AND id = $${params.length}`, params);
      }
      return toUser((await db.one<UserRow>(`SELECT * FROM users WHERE id = $1`, [row.id]))!);
    },
  );

  // --- cohorts -----------------------------------------------------------
  app.get('/api/cohorts', { preHandler: auth() }, async (req) => {
    const rows = await db.many<Cohort>(`SELECT * FROM cohorts WHERE org_id = $1 ORDER BY year DESC, name`, [me(req).org_id]);
    return rows.map((r) => ({ ...r, year: Number(r.year) }));
  });

  app.post<{ Body: { name: string; year: number } }>('/api/cohorts', { preHandler: auth('admin') }, async (req, reply) => {
    const { name, year } = req.body ?? ({} as { name: string; year: number });
    if (!name || !Number.isInteger(Number(year))) throw badRequest('name and integer year are required');
    const c: Cohort = { id: uid(), org_id: me(req).org_id, name, year: Number(year) };
    await db.exec(`INSERT INTO cohorts (id, org_id, name, year) VALUES ($1, $2, $3, $4)`, [c.id, c.org_id, c.name, c.year]);
    reply.code(201);
    return c;
  });

  // --- courses -----------------------------------------------------------
  app.get('/api/courses', { preHandler: auth() }, async (req) =>
    db.many<Course>(`SELECT id, org_id, code, name FROM courses WHERE org_id = $1 ORDER BY code`, [me(req).org_id]),
  );

  app.post<{ Body: { code: string; name: string } }>('/api/courses', { preHandler: auth('admin') }, async (req, reply) => {
    const { code, name } = req.body ?? ({} as { code: string; name: string });
    if (!code || !name) throw badRequest('code and name are required');
    const c: Course = { id: uid(), org_id: me(req).org_id, code, name };
    try {
      await db.exec(`INSERT INTO courses (id, org_id, code, name) VALUES ($1, $2, $3, $4)`, [c.id, c.org_id, c.code, c.name]);
    } catch (e) {
      if (isUniqueViolation(e)) throw new HttpError(409, `Course code "${code}" already exists`);
      throw e;
    }
    reply.code(201);
    return c;
  });

  app.post<{ Params: { id: string }; Body: { cohort_id: string } }>('/api/courses/:id/enrol', { preHandler: auth('admin') }, async (req) => {
    const org = me(req).org_id;
    const course = await db.one(`SELECT id FROM courses WHERE org_id = $1 AND id = $2`, [org, req.params.id]);
    if (!course) throw notFound('Course not found');
    const cohortId = req.body?.cohort_id;
    if (!cohortId || !(await db.one(`SELECT id FROM cohorts WHERE org_id = $1 AND id = $2`, [org, cohortId]))) throw badRequest('Unknown cohort_id');
    const exists = await db.one(`SELECT course_id FROM enrolments WHERE course_id = $1 AND cohort_id = $2`, [req.params.id, cohortId]);
    if (!exists) await db.exec(`INSERT INTO enrolments (org_id, course_id, cohort_id) VALUES ($1, $2, $3)`, [org, req.params.id, cohortId]);
    return { course_id: req.params.id, cohort_id: cohortId };
  });

  app.get<{ Params: { id: string } }>('/api/courses/:id/enrolments', { preHandler: auth() }, async (req) => {
    const org = me(req).org_id;
    const course = await db.one(`SELECT id FROM courses WHERE org_id = $1 AND id = $2`, [org, req.params.id]);
    if (!course) throw notFound('Course not found');
    return db.many<{ course_id: string; cohort_id: string }>(`SELECT course_id, cohort_id FROM enrolments WHERE org_id = $1 AND course_id = $2`, [org, req.params.id]);
  });

  // --- orgs (superadmin) -------------------------------------------------
  app.get('/api/orgs', { preHandler: auth('superadmin') }, async () => db.many<Org>(`SELECT id, name FROM orgs ORDER BY id`));

  app.post<{ Body: { id?: string; name: string; admin?: { username: string; password: string; display_name?: string } } }>(
    '/api/orgs',
    { preHandler: auth('superadmin') },
    async (req, reply) => {
      const b = req.body ?? ({} as { name: string });
      if (!b.name) throw badRequest('name is required');
      const id = b.id ?? b.name.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '').slice(0, 40);
      const org = await createOrg(ctx, id, b.name);
      let admin: User | undefined;
      if (b.admin) admin = await createUser(ctx, id, { ...b.admin, display_name: b.admin.display_name ?? b.admin.username, roles: ['admin'] });
      reply.code(201);
      return admin ? { ...org, admin } : org;
    },
  );
}
