import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { BACKENDS, cid, makeHarness, type Harness } from './helpers.js';
import { sampleCase } from './fixtures.js';

describe.each(BACKENDS)('auth & admin ($name)', (backend) => {
  let h: Harness;
  beforeAll(async () => {
    h = await makeHarness(backend);
  });
  afterAll(async () => {
    await h?.close();
  });

  it('[T1-01] login issues a token; bad credentials and missing token are rejected', async () => {
    const r = await h.req('POST', '/api/auth/login', undefined, { username: 'author1', password: 'author123' });
    expect(r.statusCode).toBe(200);
    const body = r.json();
    expect(typeof body.token).toBe('string');
    expect(body.user).toMatchObject({ username: 'author1', org_id: 'demo', roles: ['author'] });
    expect(body.user.password_hash).toBeUndefined();
    expect((await h.req('POST', '/api/auth/login', undefined, { username: 'author1', password: 'wrong' })).statusCode).toBe(401);
    expect((await h.req('GET', '/api/me')).statusCode).toBe(401);
    expect((await h.req('GET', '/api/me', 'garbage')).statusCode).toBe(401);
    const meRes = await h.json('GET', '/api/me', body.token);
    expect(meRes.username).toBe('author1');
  });

  it('[T1-01] roles are enforced on every protected route', async () => {
    const student = await h.token('student1');
    const author = await h.token('author1');
    const proctor = await h.token('proctor1');
    const course = h.seed.courses.ANAT2!.id;
    // student cannot author, review, proctor, administer or read reports
    const forbiddenForStudent: Array<[string, string, unknown?]> = [
      ['POST', '/api/cases', { course_id: course, data: sampleCase(cid('X')) }],
      ['POST', '/api/cases/CARD-010/approve', {}],
      ['POST', '/api/sessions', { name: 's', cohort_id: h.seed.cohorts.A.id, case_ids: [] }],
      ['GET', '/api/users'],
      ['POST', '/api/users', { username: 'x', password: 'y', display_name: 'x', roles: ['student'] }],
      ['GET', '/api/reports/students'],
      ['GET', '/api/reports/export.csv'],
      ['GET', '/api/grading/pending'],
      ['GET', '/api/orgs'],
      ['POST', '/api/stations/S1/command', { type: 'lock' }],
    ];
    for (const [m, u, b] of forbiddenForStudent) expect((await h.req(m, u, student, b)).statusCode, `${m} ${u}`).toBe(403);
    // author cannot approve, proctor, or administer
    expect((await h.req('POST', '/api/cases/CARD-010/approve', author, {})).statusCode).toBe(403);
    expect((await h.req('POST', '/api/sessions', author, { name: 's', cohort_id: h.seed.cohorts.A.id, case_ids: [] })).statusCode).toBe(403);
    expect((await h.req('POST', '/api/cohorts', author, { name: 'c', year: 2026 })).statusCode).toBe(403);
    // proctor cannot author or start graded attempts
    expect((await h.req('POST', '/api/cases', proctor, { course_id: course, data: sampleCase(cid('X')) })).statusCode).toBe(403);
    expect((await h.req('POST', '/api/attempts/start', proctor, { client_attempt_id: cid(), case_id: 'CARD-010' })).statusCode).toBe(403);
    // admin implies the non-super roles, but not superadmin
    const admin = await h.token('admin');
    expect((await h.req('GET', '/api/reports/students', admin)).statusCode).toBe(200);
    expect((await h.req('GET', '/api/orgs', admin)).statusCode).toBe(403);
    expect((await h.req('GET', '/api/orgs', await h.token('superadmin'))).statusCode).toBe(200);
  });

  it('[T1-02] admin manages users, cohorts, courses and enrolments', async () => {
    const admin = await h.token('admin');
    const cohort = await h.json('POST', '/api/cohorts', admin, { name: 'Cohort C 2027', year: 2027 }, 201);
    expect(cohort).toMatchObject({ name: 'Cohort C 2027', year: 2027, org_id: 'demo' });
    const course = await h.json('POST', '/api/courses', admin, { code: 'NEURO', name: 'Neuroanatomy' }, 201);
    expect((await h.req('POST', '/api/courses', admin, { code: 'NEURO', name: 'dup' })).statusCode).toBe(409);
    await h.json('POST', `/api/courses/${course.id}/enrol`, admin, { cohort_id: cohort.id });
    const enr = await h.json('GET', `/api/courses/${course.id}/enrolments`, admin);
    expect(enr).toEqual([{ course_id: course.id, cohort_id: cohort.id }]);
    const user = await h.json('POST', '/api/users', admin, {
      username: 'newstudent', password: 'pw12345', display_name: 'New Student', roles: ['student'], cohort_id: cohort.id, lang: 'ar',
    }, 201);
    expect(user).toMatchObject({ username: 'newstudent', roles: ['student'], cohort_id: cohort.id, lang: 'ar' });
    expect((await h.req('POST', '/api/users', admin, { username: 'newstudent', password: 'x', display_name: 'x', roles: ['student'] })).statusCode).toBe(409);
    const tok = await h.token('newstudent', 'pw12345');
    // users may change their own language / handedness, not their roles
    expect((await h.json('PATCH', `/api/users/${user.id}`, tok, { handedness: 'left' })).handedness).toBe('left');
    expect((await h.req('PATCH', `/api/users/${user.id}`, tok, { roles: ['admin'] })).statusCode).toBe(403);
    const patched = await h.json('PATCH', `/api/users/${user.id}`, admin, { roles: ['student', 'author'], display_name: 'Renamed' });
    expect(patched).toMatchObject({ roles: ['student', 'author'], display_name: 'Renamed' });
    // only superadmin can grant superadmin
    expect((await h.req('PATCH', `/api/users/${user.id}`, admin, { roles: ['superadmin'] })).statusCode).toBe(403);
    const users = await h.json('GET', '/api/users?role=student', admin);
    expect(users.some((u: { username: string }) => u.username === 'student1')).toBe(true);
    expect(users.every((u: { roles: string[] }) => u.roles.includes('student'))).toBe(true);
    const cohorts = await h.json('GET', '/api/cohorts', admin);
    expect(cohorts.map((c: { name: string }) => c.name)).toEqual(expect.arrayContaining(['Cohort A 2026', 'Cohort B 2025', 'Cohort C 2027']));
    const courses = await h.json('GET', '/api/courses', admin);
    expect(courses.map((c: { code: string }) => c.code)).toEqual(expect.arrayContaining(['ANAT2', 'RENAL', 'NEURO']));
  });

  it('[T3-01] organisations are isolated: no cross-tenant reads or writes', async () => {
    const sa = await h.token('superadmin');
    const org = await h.json('POST', '/api/orgs', sa, { id: 'other-u', name: 'Other University', admin: { username: 'oadmin', password: 'opw123' } }, 201);
    expect(org).toMatchObject({ id: 'other-u', name: 'Other University' });
    expect((await h.json('GET', '/api/orgs', sa)).map((o: { id: string }) => o.id)).toEqual(expect.arrayContaining(['demo', 'other-u']));
    const oadmin = await h.token('oadmin', 'opw123');
    // other org sees none of demo's data
    expect(await h.json('GET', '/api/cases', oadmin)).toEqual([]);
    expect(await h.json('GET', '/api/courses', oadmin)).toEqual([]);
    expect((await h.json('GET', '/api/users', oadmin)).map((u: { username: string }) => u.username)).toEqual(['oadmin']);
    expect(await h.json('GET', '/api/attempts', oadmin)).toEqual([]);
    expect(await h.json('GET', '/api/sessions', oadmin)).toEqual([]);
    // the new org has its own model registry
    expect((await h.json('GET', '/api/models', oadmin)).length).toBeGreaterThan(0);
    // direct access to demo resources 404s
    const demoCourse = h.seed.courses.ANAT2!.id;
    const demoUser = h.seed.users.student1!.id;
    expect((await h.req('GET', '/api/cases/CARD-010', oadmin)).statusCode).toBe(404);
    expect((await h.req('GET', '/api/cases/CARD-010/versions', oadmin)).statusCode).toBe(404);
    expect((await h.req('POST', '/api/cases/CARD-010/submit', oadmin)).statusCode).toBe(404);
    expect((await h.req('PUT', '/api/cases/CARD-010', oadmin, { data: sampleCase('CARD-010') })).statusCode).toBe(404);
    expect((await h.req('PATCH', `/api/users/${demoUser}`, oadmin, { display_name: 'hacked' })).statusCode).toBe(404);
    expect((await h.req('POST', `/api/courses/${demoCourse}/enrol`, oadmin, { cohort_id: h.seed.cohorts.A.id })).statusCode).toBe(404);
    expect((await h.req('GET', `/api/courses/${demoCourse}/package`, oadmin)).statusCode).toBe(404);
    expect((await h.req('GET', `/api/reports/students?course_id=${demoCourse}`, oadmin)).statusCode).toBe(404);
    expect((await h.req('POST', '/api/attempts/start', oadmin, { client_attempt_id: cid(), case_id: 'CARD-010' })).statusCode).toBe(404);
    expect((await h.req('POST', '/api/cases', oadmin, { course_id: demoCourse, data: sampleCase(cid('X')) })).statusCode).toBe(400);
    // a demo attempt id is invisible from the other org
    const st = await h.token('student1');
    const started = await h.json('POST', '/api/attempts/start', st, { client_attempt_id: cid(), case_id: 'CARD-010' });
    expect((await h.req('GET', `/api/attempts/${started.attempt_id}`, oadmin)).statusCode).toBe(404);
    expect((await h.req('POST', `/api/grading/${started.attempt_id}/q1`, oadmin, { points: 1 })).statusCode).toBe(404);
    // a non-superadmin cannot create users in another org
    expect((await h.req('POST', '/api/users', oadmin, { org_id: 'demo', username: 'x1', password: 'x', display_name: 'x', roles: ['admin'] })).statusCode).toBe(404);
    // same username may exist in two orgs; login then needs org_id
    await h.json('POST', '/api/users', oadmin, { username: 'student1', password: 'other123', display_name: 'Other S1', roles: ['student'] }, 201);
    expect((await h.req('POST', '/api/auth/login', undefined, { username: 'student1', password: 'student123' })).statusCode).toBe(400);
    const r = await h.json('POST', '/api/auth/login', undefined, { username: 'student1', password: 'other123', org_id: 'other-u' });
    expect(r.user.org_id).toBe('other-u');
  });
});
