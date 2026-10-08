import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { BACKENDS, cid, makeHarness, type Harness } from './helpers.js';

describe.each(BACKENDS)('course packages ($name)', (backend) => {
  let h: Harness;
  beforeAll(async () => {
    h = await makeHarness(backend);
  });
  afterAll(async () => {
    await h?.close();
  });

  it('[T3-02] course package exports (models, cases, questions) and imports into another tenant as drafts', async () => {
    const author = await h.token('author1');
    const course = h.seed.courses.RENAL!.id;
    const pkg = await h.json('GET', `/api/courses/${course}/package`, author);
    expect(pkg).toMatchObject({ format: 'medsim-course-package', version: 1, course: { code: 'RENAL', name: 'Renal System' } });
    expect(pkg.cases.map((c: { case_id: string }) => c.case_id).sort()).toEqual(['REN-001', 'REN-002']);
    expect(pkg.cases[0].questions[0].answer).toBeDefined();
    expect(pkg.models.map((m: { id: string }) => m.id)).toEqual(['kidney_v1']);
    expect((await h.req('GET', `/api/courses/${course}/package`, await h.token('student1'))).statusCode).toBe(403);

    const sa = await h.token('superadmin');
    await h.json('POST', '/api/orgs', sa, { id: 'tenant-b', name: 'Tenant B', admin: { username: 'badmin', password: 'bpw123' } }, 201);
    const badmin = await h.token('badmin', 'bpw123');
    await h.json('POST', '/api/users', badmin, { username: 'brev', password: 'brev123', display_name: 'B Reviewer', roles: ['reviewer'] }, 201);
    await h.json('POST', '/api/users', badmin, { username: 'bstu', password: 'bstu123', display_name: 'B Student', roles: ['student'] }, 201);
    const res = await h.json('POST', '/api/packages/import', badmin, pkg, 201);
    expect(res.course).toMatchObject({ code: 'RENAL', name: 'Renal System', org_id: 'tenant-b' });
    expect(res.cases).toBe(2);
    const cases = await h.json('GET', '/api/cases', badmin);
    expect(cases.map((c: { id: string; status: string; version: number; org_id: string }) => [c.id, c.status, c.version, c.org_id]).sort()).toEqual([
      ['REN-001', 'draft', 1, 'tenant-b'],
      ['REN-002', 'draft', 1, 'tenant-b'],
    ]);
    // imported cases need the receiving org's own review before stations see them
    const bstu = await h.token('bstu', 'bstu123');
    expect(await h.json('GET', '/api/cases', bstu)).toEqual([]);
    const brev = await h.token('brev', 'brev123');
    await h.json('POST', '/api/cases/REN-001/submit', badmin);
    await h.json('POST', '/api/cases/REN-001/approve', brev, {});
    expect((await h.json('GET', '/api/cases', bstu)).map((c: { id: string }) => c.id)).toEqual(['REN-001']);
    const st = await h.json('POST', '/api/attempts/start', bstu, { client_attempt_id: cid(), case_id: 'REN-001' });
    expect(st.case.case_id).toBe('REN-001');
    // the source org is unaffected
    expect((await h.json('GET', '/api/cases/REN-001', author)).org_id).toBe('demo');
    // re-import is reported per case rather than duplicating
    const again = await h.json('POST', '/api/packages/import', badmin, pkg, 201);
    expect(again.cases).toBe(0);
    expect(again.errors).toHaveLength(2);
    expect((await h.req('POST', '/api/packages/import', badmin, { format: 'nope' })).statusCode).toBe(400);
  });
});
