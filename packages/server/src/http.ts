import type { FastifyReply, FastifyRequest } from 'fastify';
import jwt from 'jsonwebtoken';
import type { Role, User } from '@medsim/core';
import type { Db } from './db/pool.js';

export class HttpError extends Error {
  constructor(public status: number, message: string, public details?: unknown) {
    super(message);
  }
}

export const badRequest = (msg: string, details?: unknown) => new HttpError(400, msg, details);
export const notFound = (what = 'Not found') => new HttpError(404, what);
export const forbidden = (msg = 'Forbidden') => new HttpError(403, msg);

export interface UserRow {
  id: string;
  org_id: string;
  username: string;
  password_hash: string;
  display_name: string;
  roles: Role[];
  lang: 'en' | 'ar' | null;
  cohort_id: string | null;
  handedness: 'left' | 'right' | null;
  active: boolean;
}

export function toUser(r: UserRow): User {
  const u: User = { id: r.id, org_id: r.org_id, username: r.username, display_name: r.display_name, roles: r.roles };
  if (r.lang) u.lang = r.lang;
  if (r.cohort_id) u.cohort_id = r.cohort_id;
  if (r.handedness) u.handedness = r.handedness;
  return u;
}

/**
 * Role check. admin implies every non-super role within its org; superadmin
 * implies everything.
 */
export function hasRole(user: Pick<User, 'roles'>, role: Role): boolean {
  if (user.roles.includes('superadmin')) return true;
  if (user.roles.includes(role)) return true;
  return role !== 'superadmin' && user.roles.includes('admin');
}

export function hasAnyRole(user: Pick<User, 'roles'>, roles: Role[]): boolean {
  return roles.some((r) => hasRole(user, r));
}

declare module 'fastify' {
  interface FastifyRequest {
    user?: User;
  }
}

export interface TokenPayload {
  sub: string;
  org: string;
}

export function signToken(user: User, secret: string): string {
  return jwt.sign({ sub: user.id, org: user.org_id } satisfies TokenPayload, secret, { expiresIn: '12h' });
}

/** Builds role-guard preHandlers bound to the db and secret. */
export function makeGuards(db: Db, secret: string) {
  async function authenticate(req: FastifyRequest): Promise<User> {
    if (req.user) return req.user;
    const h = req.headers.authorization;
    if (!h || !h.startsWith('Bearer ')) throw new HttpError(401, 'Missing bearer token');
    let payload: TokenPayload;
    try {
      payload = jwt.verify(h.slice(7), secret) as TokenPayload;
    } catch {
      throw new HttpError(401, 'Invalid or expired token');
    }
    const row = await db.one<UserRow>(`SELECT * FROM users WHERE id = $1 AND org_id = $2`, [payload.sub, payload.org]);
    if (!row || !row.active) throw new HttpError(401, 'Unknown user');
    req.user = toUser(row);
    return req.user;
  }

  /** preHandler: any authenticated user, or one holding at least one of `roles`. */
  function auth(...roles: Role[]) {
    return async (req: FastifyRequest, _reply: FastifyReply) => {
      const user = await authenticate(req);
      if (roles.length && !hasAnyRole(user, roles)) throw forbidden(`Requires role: ${roles.join(' or ')}`);
    };
  }

  return { auth, authenticate };
}

export const nowIso = () => new Date().toISOString();
export const uid = () => crypto.randomUUID();

/** The authenticated user (only valid after an auth preHandler). */
export function me(req: FastifyRequest): User {
  if (!req.user) throw new HttpError(401, 'Not authenticated');
  return req.user;
}
