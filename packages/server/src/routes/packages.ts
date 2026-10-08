/**
 * Course packages (Phase 3, G4, T3-02).
 * Export: course code/name, the models referenced (current registry versions)
 * and the currently published version of every case in the course.
 * Import: into the caller's org. The course is matched by code (created if
 * absent); missing models are added to the org registry; every case is
 * imported as a *draft* v1 authored by the importing user, so the receiving
 * organisation's own reviewers must approve it before stations see it.
 * Cases whose case_id already exists in the org are skipped (reported in `errors`).
 */
import type { FastifyInstance } from 'fastify';
import type { CaseData, Course, CoursePackage, ModelDef } from '@medsim/core';
import { badRequest, HttpError, me, notFound, uid } from '../http.js';
import { getCaseVersion, getModel, insertCase, insertModelVersion, listCaseHeads, validateForOrg } from '../repo.js';
import type { AppCtx } from '../app.js';

export async function packageRoutes(app: FastifyInstance, ctx: AppCtx) {
  const { db, auth } = ctx;

  app.get<{ Params: { id: string } }>('/api/courses/:id/package', { preHandler: auth('author', 'reviewer') }, async (req): Promise<CoursePackage> => {
    const org = me(req).org_id;
    const course = await db.one<Course>(`SELECT id, org_id, code, name FROM courses WHERE org_id = $1 AND id = $2`, [org, req.params.id]);
    if (!course) throw notFound('Course not found');
    const cases: CaseData[] = [];
    for (const h of await listCaseHeads(db, org, course.id)) {
      if (h.published_version == null) continue;
      cases.push((await getCaseVersion(db, org, h.id, h.published_version)).data);
    }
    const models: ModelDef[] = [];
    for (const id of [...new Set(cases.map((c) => c.model))]) {
      const m = await getModel(db, org, id);
      if (m) models.push(m);
    }
    return { format: 'medsim-course-package', version: 1, course: { code: course.code, name: course.name }, models, cases, exported_at: new Date().toISOString() };
  });

  app.post<{ Body: CoursePackage }>('/api/packages/import', { preHandler: auth('admin') }, async (req, reply) => {
    const u = me(req);
    const org = u.org_id;
    const pkg = req.body;
    if (!pkg || pkg.format !== 'medsim-course-package' || pkg.version !== 1 || !pkg.course?.code || !Array.isArray(pkg.cases))
      throw badRequest('Not a medsim-course-package v1');
    let course = await db.one<Course>(`SELECT id, org_id, code, name FROM courses WHERE org_id = $1 AND code = $2`, [org, pkg.course.code]);
    if (!course) {
      course = { id: uid(), org_id: org, code: pkg.course.code, name: pkg.course.name || pkg.course.code };
      await db.exec(`INSERT INTO courses (id, org_id, code, name) VALUES ($1, $2, $3, $4)`, [course.id, org, course.code, course.name]);
    }
    for (const m of pkg.models ?? []) {
      if (!m?.id || (await getModel(db, org, m.id))) continue;
      const { sign_off: _s, ...rest } = m; // sign-off is per organisation
      await insertModelVersion(db, org, rest as ModelDef, m.version ?? 1);
    }
    let imported = 0;
    const errors: Array<{ case_id: string; error: string; details?: unknown }> = [];
    for (const c of pkg.cases) {
      try {
        const { reviewer: _r, status: _st, version: _v, ...meta } = c.meta ?? {};
        const v = await validateForOrg(db, org, { ...c, meta });
        await insertCase(db, org, { course_id: course.id, data: v.data, model: v.model, author_id: u.id });
        imported++;
      } catch (e) {
        errors.push({ case_id: c?.case_id, error: (e as Error).message, details: (e as HttpError).details });
      }
    }
    reply.code(201);
    return { course, cases: imported, errors };
  });
}
