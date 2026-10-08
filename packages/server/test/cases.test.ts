import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { buildTemplateWorkbook } from '@medsim/core/spreadsheet';
import { BACKENDS, cid, hasKeyDeep, makeHarness, type Harness } from './helpers.js';
import { ans, sampleCase } from './fixtures.js';

describe.each(BACKENDS)('case authoring workflow ($name)', (backend) => {
  let h: Harness;
  let author: string, author2: string, reviewer: string, student: string, admin: string;
  let course: string;
  beforeAll(async () => {
    h = await makeHarness(backend);
    [author, author2, reviewer, student, admin] = await Promise.all(['author1', 'author2', 'reviewer1', 'student1', 'admin'].map((u) => h.token(u)));
    course = h.seed.courses.ANAT2!.id;
  });
  afterAll(async () => {
    await h?.close();
  });

  it('[T1-03] author creates a case via the API (model, variant, preset view, questions, keys) as draft v1', async () => {
    const id = cid('MS');
    const rec = await h.json('POST', '/api/cases', author, { course_id: course, data: sampleCase(id) }, 201);
    expect(rec).toMatchObject({ id, version: 1, status: 'draft', course_id: course, author_id: h.seed.users.author1!.id, org_id: 'demo' });
    expect(rec.data.variant).toBe('mitral_stenosis');
    expect(rec.data.initial_view.camera).toBe('anterior');
    expect(rec.data.questions[0].answer).toEqual(['TA:mitral_valve']);
    expect(rec.model_version).toBeGreaterThanOrEqual(1);
    // duplicates and invalid data are rejected with details
    expect((await h.req('POST', '/api/cases', author, { course_id: course, data: sampleCase(id) })).statusCode).toBe(409);
    const bad = await h.req('POST', '/api/cases', author, {
      course_id: course,
      data: sampleCase(cid('BAD'), { variant: 'nope', questions: [{ id: 'q1', type: 'identify', prompt: 'x', answer: ['TA:not_a_structure'], points: 1 }] }),
    });
    expect(bad.statusCode).toBe(400);
    expect(bad.json().details.join('\n')).toMatch(/variant/);
    expect(bad.json().details.join('\n')).toMatch(/TA:not_a_structure/);
    expect((await h.req('POST', '/api/cases', author, { course_id: course, data: { case_id: 'x' } })).statusCode).toBe(400);
    expect((await h.req('POST', '/api/cases', author, { course_id: 'nope', data: sampleCase(cid('X')) })).statusCode).toBe(400);
    // drafts are listed for authors, invisible to students
    expect((await h.json('GET', `/api/cases?status=draft`, author)).some((c: { id: string }) => c.id === id)).toBe(true);
    expect((await h.json('GET', '/api/cases', student)).some((c: { id: string }) => c.id === id)).toBe(false);
    expect((await h.req('GET', `/api/cases/${id}`, student)).statusCode).toBe(404);
    // PUT on a draft updates it in place
    const upd = await h.json('PUT', `/api/cases/${id}`, author, { data: sampleCase(id, { topic: 'Updated topic' }) });
    expect(upd).toMatchObject({ version: 1, status: 'draft' });
    expect(upd.data.topic).toBe('Updated topic');
  });

  it('[T1-04] preview returns the case as a student sees it (labels off, no keys)', async () => {
    const id = cid('PV');
    await h.json('POST', '/api/cases', author, { course_id: course, data: sampleCase(id, { labels_visible: true }) }, 201);
    const pv = await h.json('GET', `/api/cases/${id}/preview`, author);
    expect(pv.labels_visible).toBe(false);
    expect(hasKeyDeep(pv, 'answer')).toBe(false);
    expect(hasKeyDeep(pv, 'feedback')).toBe(false);
    expect(pv.questions).toHaveLength(2);
    expect((await h.req('GET', `/api/cases/${id}/preview`, student)).statusCode).toBe(403);
  });

  it('[T1-05] workflow draft -> in_review -> published; reviewer must differ from author; reject returns to draft', async () => {
    const id = cid('WF');
    await h.json('POST', '/api/cases', author, { course_id: course, data: sampleCase(id) }, 201);
    // cannot approve a draft
    expect((await h.req('POST', `/api/cases/${id}/approve`, reviewer, {})).statusCode).toBe(409);
    expect((await h.json('POST', `/api/cases/${id}/submit`, author)).status).toBe('in_review');
    expect((await h.req('POST', `/api/cases/${id}/submit`, author)).statusCode).toBe(409);
    // reject requires a comment and returns to draft
    expect((await h.req('POST', `/api/cases/${id}/reject`, reviewer, {})).statusCode).toBe(400);
    const rej = await h.json('POST', `/api/cases/${id}/reject`, reviewer, { comment: 'Fix the distractors' });
    expect(rej).toMatchObject({ status: 'draft', review_comment: 'Fix the distractors', version: 1 });
    await h.json('POST', `/api/cases/${id}/submit`, author);
    // a user holding author+reviewer (admin) cannot approve their own case
    const own = cid('OWN');
    await h.json('POST', '/api/cases', admin, { course_id: course, data: sampleCase(own) }, 201);
    await h.json('POST', `/api/cases/${own}/submit`, admin);
    const self = await h.req('POST', `/api/cases/${own}/approve`, admin, {});
    expect(self.statusCode).toBe(403);
    expect(self.json().error).toMatch(/different/);
    // authors (without reviewer role) cannot approve at all
    expect((await h.req('POST', `/api/cases/${id}/approve`, author2, {})).statusCode).toBe(403);
    const pub = await h.json('POST', `/api/cases/${id}/approve`, reviewer, { comment: 'Looks good' });
    expect(pub).toMatchObject({ status: 'published', version: 1, reviewer_id: h.seed.users.reviewer1!.id });
    expect(pub.data.meta).toMatchObject({ author: 'author1', reviewer: 'reviewer1', version: 1, status: 'published' });
  });

  it('[T1-06] editing a published case creates a new version; the published version stays served; old attempts stay linked', async () => {
    const id = cid('VER');
    await h.json('POST', '/api/cases', author, { course_id: course, data: sampleCase(id) }, 201);
    await h.json('POST', `/api/cases/${id}/submit`, author);
    await h.json('POST', `/api/cases/${id}/approve`, reviewer, {});
    // student attempt on v1
    const s1 = await h.json('POST', '/api/attempts/start', student, { client_attempt_id: cid(), case_id: id });
    expect(s1.case_version).toBe(1);
    await h.json('POST', `/api/attempts/${s1.attempt_id}/submit`, student, { client_attempt_id: '', answers: [ans('q1', ['TA:mitral_valve']), ans('q2', 'b')], log: { attempt_id: 'x', case_id: id, started_at: Date.now(), events: [] } });
    // edit published -> new draft v2
    const v2 = await h.json('PUT', `/api/cases/${id}`, author2, { data: sampleCase(id, { topic: 'v2 topic' }) });
    expect(v2).toMatchObject({ version: 2, status: 'draft', author_id: h.seed.users.author2!.id });
    // stations still get v1 until v2 is approved
    const s2 = await h.json('POST', '/api/attempts/start', student, { client_attempt_id: cid(), case_id: id });
    expect(s2.case_version).toBe(1);
    expect(s2.case.topic).not.toBe('v2 topic');
    const listed = (await h.json('GET', '/api/cases', student)).find((c: { id: string }) => c.id === id);
    expect(listed).toMatchObject({ version: 1, status: 'published' });
    // v1 is immutable
    const versions = await h.json('GET', `/api/cases/${id}/versions`, author);
    expect(versions.map((v: { version: number; status: string }) => [v.version, v.status])).toEqual([[1, 'published'], [2, 'draft']]);
    expect(versions[0].data.topic).toBe('Mitral stenosis');
    // editing an in-review version also creates a new version
    await h.json('POST', `/api/cases/${id}/submit`, author2);
    const v3 = await h.json('PUT', `/api/cases/${id}`, author2, { data: sampleCase(id, { topic: 'v3 topic' }) });
    expect(v3.version).toBe(3);
    await h.json('POST', `/api/cases/${id}/submit`, author2);
    // author1 (original author) is not the author of v3, but the reviewer must still differ from the v3 author
    expect((await h.req('POST', `/api/cases/${id}/approve`, author2, {})).statusCode).toBe(403);
    await h.json('POST', `/api/cases/${id}/approve`, reviewer, {});
    const after = await h.json('GET', `/api/cases/${id}/versions`, author);
    expect(after.map((v: { status: string }) => v.status)).toEqual(['archived', 'archived', 'published']);
    const s3 = await h.json('POST', '/api/attempts/start', student, { client_attempt_id: cid(), case_id: id });
    expect(s3.case_version).toBe(3);
    // the first attempt still references v1
    const attempts = await h.json('GET', `/api/attempts?case_id=${id}`, admin);
    expect(attempts).toHaveLength(1);
    expect(attempts[0].case_version).toBe(1);
    const v1 = await h.json('GET', `/api/cases/${id}?version=1`, author);
    expect(v1.data.topic).toBe('Mitral stenosis');
  });

  it('[T1-19] a newly published case appears in the station-visible list with no code change', async () => {
    const id = cid('NEW');
    const before = await h.json('GET', '/api/cases', student);
    expect(before.some((c: { id: string }) => c.id === id)).toBe(false);
    await h.json('POST', '/api/cases', author, { course_id: course, data: sampleCase(id) }, 201);
    await h.json('POST', `/api/cases/${id}/submit`, author);
    expect((await h.json('GET', '/api/cases', student)).some((c: { id: string }) => c.id === id)).toBe(false);
    await h.json('POST', `/api/cases/${id}/approve`, reviewer, {});
    const after = await h.json('GET', '/api/cases', student);
    const rec = after.find((c: { id: string }) => c.id === id);
    expect(rec).toMatchObject({ status: 'published', version: 1 });
    expect(hasKeyDeep(after, 'answer')).toBe(false);
    const started = await h.json('POST', '/api/attempts/start', student, { client_attempt_id: cid(), case_id: id });
    expect(started.case.case_id).toBe(id);
  });

  it('[T1-20] model version and academic sign-off are recorded; attempts reference the model version', async () => {
    const models = await h.json('GET', '/api/models', student);
    const heart = models.find((m: { id: string }) => m.id === 'heart_v1');
    expect(heart.version).toBeGreaterThanOrEqual(1);
    expect((await h.req('POST', '/api/models/heart_v1/sign-off', author, { notes: 'x' })).statusCode).toBe(403);
    const signed = await h.json('POST', '/api/models/heart_v1/sign-off', reviewer, { notes: 'Checked against TA2' });
    expect(signed.sign_off).toMatchObject({ reviewer: 'Prof. Reviewer One', notes: 'Checked against TA2' });
    expect(Date.parse(signed.sign_off.date)).not.toBeNaN();
    expect((await h.json('GET', '/api/models', author)).find((m: { id: string }) => m.id === 'heart_v1').sign_off.notes).toBe('Checked against TA2');
    const st = await h.json('POST', '/api/attempts/start', student, { client_attempt_id: cid(), case_id: 'CARD-010' });
    expect(st.model_version).toBe(heart.version);
    // a new model version is recorded and later attempts reference it
    const { sign_off: _s, version: _v, ...def } = heart;
    const v2 = await h.json('POST', '/api/models', admin, { model: def }, 201);
    expect(v2.version).toBe(heart.version + 1);
    expect(v2.sign_off).toBeUndefined();
    const st2 = await h.json('POST', '/api/attempts/start', student, { client_attempt_id: cid(), case_id: 'CARD-010' });
    expect(st2.model_version).toBe(heart.version + 1);
    await h.json('POST', `/api/attempts/${st.attempt_id}/submit`, student, { client_attempt_id: '', answers: [], log: { attempt_id: 'x', case_id: 'CARD-010', started_at: 0, events: [] } });
    const detail = await h.json('GET', `/api/attempts/${st.attempt_id}`, admin);
    expect(detail).toMatchObject({ model_id: 'heart_v1', model_version: heart.version, case_version: 1 });
  });

  it('[T0-22] server import: spreadsheet workbook upload converts to draft cases; row errors reported', async () => {
    const wb = await buildTemplateWorkbook();
    const boundary = '----medsimtest';
    const parts = [
      `--${boundary}\r\nContent-Disposition: form-data; name="course_id"\r\n\r\n${course}\r\n`,
      `--${boundary}\r\nContent-Disposition: form-data; name="file"; filename="cases.xlsx"\r\nContent-Type: application/vnd.openxmlformats-officedocument.spreadsheetml.sheet\r\n\r\n`,
    ];
    const payload = Buffer.concat([Buffer.from(parts.join('')), Buffer.from(wb), Buffer.from(`\r\n--${boundary}--\r\n`)]);
    const r = await h.app.inject({
      method: 'POST', url: '/api/cases/import', payload,
      headers: { authorization: `Bearer ${author}`, 'content-type': `multipart/form-data; boundary=${boundary}` },
    });
    expect([200, 201]).toContain(r.statusCode);
    const body = r.json();
    console.log("IMPORT", JSON.stringify(body).slice(0, 600));
    expect(Array.isArray(body.created)).toBe(true);
    expect(Array.isArray(body.errors)).toBe(true);
    expect(body.created.length + body.errors.length).toBeGreaterThan(0);
    for (const c of body.created) expect(c).toMatchObject({ status: 'draft', version: 1, course_id: course });
    // CSV pair upload, with one bad row reported
    const casesCsv = 'case_id,course,topic,model,variant,stem_en,stem_ar,camera,hidden_layers,labels_visible,time_limit_min,allowed_layers,feedback_level\n' +
      `CSV-${Date.now()},ANAT2,t,heart_v1,normal,Stem,,anterior,,no,5,,score\n`;
    const qCsv = 'case_id,question_id,type,prompt_en,prompt_ar,options,answer,points\n' +
      `CSV-${Date.now()},q1,identify,Pick the aorta,,,TA:aorta,1\nCSV-${Date.now()},q2,mcq,Pick,,a=One|b=Two,z,1\n`;
    const p2 = Buffer.from(
      `--${boundary}\r\nContent-Disposition: form-data; name="course_id"\r\n\r\n${course}\r\n` +
      `--${boundary}\r\nContent-Disposition: form-data; name="cases"; filename="cases.csv"\r\nContent-Type: text/csv\r\n\r\n${casesCsv}\r\n` +
      `--${boundary}\r\nContent-Disposition: form-data; name="questions"; filename="questions.csv"\r\nContent-Type: text/csv\r\n\r\n${qCsv}\r\n--${boundary}--\r\n`,
    );
    const r2 = await h.app.inject({ method: 'POST', url: '/api/cases/import', payload: p2, headers: { authorization: `Bearer ${author}`, 'content-type': `multipart/form-data; boundary=${boundary}` } });
    expect([200, 201]).toContain(r2.statusCode);
    console.log("IMPORT2", r2.body.slice(0, 600));
    expect(r2.json().errors.length).toBeGreaterThan(0);
    // students cannot import
    const r3 = await h.app.inject({ method: 'POST', url: '/api/cases/import', payload, headers: { authorization: `Bearer ${student}`, 'content-type': `multipart/form-data; boundary=${boundary}` } });
    expect(r3.statusCode).toBe(403);
  });
});
