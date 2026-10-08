import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { PRACTICE_CASE } from '@medsim/core';
import { BACKENDS, cid, hasKeyDeep, makeHarness, type Harness } from './helpers.js';
import { ans, card010Answers, logFor } from './fixtures.js';

describe.each(BACKENDS)('attempts ($name)', (backend) => {
  let h: Harness;
  let s1: string, s2: string, admin: string, reviewer: string;
  beforeAll(async () => {
    h = await makeHarness(backend);
    [s1, s2, admin, reviewer] = await Promise.all(['student1', 'student2', 'admin', 'reviewer1'].map((u) => h.token(u)));
  });
  afterAll(async () => {
    await h?.close();
  });

  it('[T1-07] answer keys are never sent to stations before submit; scoring is server-side', async () => {
    for (const caseId of h.seed.cases) {
      const r = await h.req('POST', '/api/attempts/start', s1, { client_attempt_id: cid(), case_id: caseId, station_id: 'ST-07' });
      expect(r.statusCode).toBe(200);
      expect(r.body).not.toMatch(/"answer"/);
      expect(r.body).not.toMatch(/"feedback"/);
      expect(r.body).not.toMatch(/correct_answer/);
      expect(hasKeyDeep(r.json(), 'answer')).toBe(false);
      expect(r.json().case.labels_visible).toBe(false);
    }
    // the station-visible case list and case detail carry no keys either
    const list = await h.req('GET', '/api/cases', s1);
    expect(list.body).not.toMatch(/"answer"/);
    expect((await h.req('GET', '/api/cases/CARD-010', s1)).body).not.toMatch(/"answer"/);
    // the client cannot inject a score: the server computes it from the stored key
    const st = await h.json('POST', '/api/attempts/start', s1, { client_attempt_id: cid(), case_id: 'CARD-010' });
    const sub = await h.json('POST', `/api/attempts/${st.attempt_id}/submit`, s1, {
      client_attempt_id: '', answers: card010Answers({ q1: ['TA:left_ventricle'] }), log: logFor('CARD-010'), score: 999, result: { score: 999 },
    });
    expect(sub.result.score).toBe(3);
    expect(sub.result.max_score).toBe(5);
    // another student cannot submit someone else's attempt
    const other = await h.json('POST', '/api/attempts/start', s1, { client_attempt_id: cid(), case_id: 'CARD-012' });
    expect((await h.req('POST', `/api/attempts/${other.attempt_id}/submit`, s2, { answers: [], log: logFor('CARD-012') })).statusCode).toBe(403);
  });

  it('[T1-15] feedback level none / score / full is respected after submit', async () => {
    // CARD-010 = full, CARD-012 = score, CARD-011 = none
    const full = await h.json('POST', '/api/attempts/start', s1, { client_attempt_id: cid(), case_id: 'CARD-010' });
    const rf = await h.json('POST', `/api/attempts/${full.attempt_id}/submit`, s1, { client_attempt_id: '', answers: card010Answers(), log: logFor('CARD-010') });
    expect(rf.feedback_level).toBe('full');
    expect(rf.result).toMatchObject({ score: 5, max_score: 5, percent: 100 });
    expect(rf.result.questions[0].correct_answer).toEqual(['TA:right_ventricle']);
    expect(rf.result.questions[0].feedback).toBeTruthy();

    const sc = await h.json('POST', '/api/attempts/start', s1, { client_attempt_id: cid(), case_id: 'CARD-012' });
    const rs = await h.json('POST', `/api/attempts/${sc.attempt_id}/submit`, s1, { client_attempt_id: '', answers: [ans('q1', ['TA:mitral_valve'])], log: logFor('CARD-012') });
    expect(rs.feedback_level).toBe('score');
    expect(typeof rs.result.score).toBe('number');
    expect(rs.result.questions).toBeUndefined();
    expect(JSON.stringify(rs)).not.toMatch(/correct_answer|feedback"/);

    const no = await h.json('POST', '/api/attempts/start', s1, { client_attempt_id: cid(), case_id: 'CARD-011' });
    const rn = await h.json('POST', `/api/attempts/${no.attempt_id}/submit`, s1, { client_attempt_id: '', answers: [ans('q1', ['TA:left_anterior_descending'])], log: logFor('CARD-011') });
    expect(rn.feedback_level).toBe('none');
    expect(rn.result.score).toBeUndefined();
    expect(JSON.stringify(rn.result)).toBe('{}');
    // the full result is stored server-side and visible to staff, not to the student
    const staffView = await h.json('GET', `/api/attempts/${no.attempt_id}`, admin);
    expect(staffView.result.score).toBeGreaterThan(0);
    expect(staffView.result.questions[0].correct_answer).toBeDefined();
    const studentView = await h.json('GET', `/api/attempts/${no.attempt_id}`, s1);
    expect(studentView.score).toBeUndefined();
    expect(JSON.stringify(studentView.result)).toBe('{}');
    const mine = await h.json('GET', '/api/attempts?case_id=CARD-011', s1);
    expect(mine[0].score).toBeUndefined();
    // submit is idempotent: re-submitting returns the stored result, not a re-score
    const again = await h.json('POST', `/api/attempts/${full.attempt_id}/submit`, s1, { client_attempt_id: '', answers: [], log: logFor('CARD-010') });
    expect(again.result.score).toBe(5);
  });

  it('[T1-10] queued offline submissions sync idempotently (same client_attempt_id twice -> one attempt)', async () => {
    const before = (await h.json('GET', '/api/attempts', admin)).length;
    const item = {
      client_attempt_id: cid('offline'), case_id: 'CARD-010', case_version: 1, station_id: 'ST-10', started_at: Date.now() - 100_000,
      answers: card010Answers({ q3: 'a' }), log: logFor('CARD-010'),
    };
    const r1 = await h.json('POST', '/api/attempts/sync', s2, { items: [item] });
    expect(r1.synced).toEqual([item.client_attempt_id]);
    const r2 = await h.json('POST', '/api/attempts/sync', s2, { items: [item, item] });
    expect(r2.synced).toEqual([item.client_attempt_id, item.client_attempt_id]);
    const all = await h.json('GET', '/api/attempts', admin);
    expect(all.length).toBe(before + 1);
    const mine = await h.json('GET', '/api/attempts', s2);
    const a = mine.find((x: { case_id: string }) => x.case_id === 'CARD-010');
    expect(a).toMatchObject({ score: 4, max_score: 5, case_version: 1 });
    // an attempt started online and finished offline syncs onto the same attempt
    const cidStart = cid('mixed');
    const st = await h.json('POST', '/api/attempts/start', s2, { client_attempt_id: cidStart, case_id: 'CARD-012' });
    const r3 = await h.json('POST', '/api/attempts/sync', s2, {
      items: [{ client_attempt_id: cidStart, case_id: 'CARD-012', case_version: 1, started_at: st.started_at, answers: [ans('q1', ['TA:mitral_valve'])], log: logFor('CARD-012') }],
    });
    expect(r3.synced).toEqual([cidStart]);
    const detail = await h.json('GET', `/api/attempts/${st.attempt_id}`, admin);
    expect(detail.status).toBe('submitted');
    expect((await h.json('GET', '/api/attempts', admin)).length).toBe(before + 2);
    // start is idempotent too
    const st2 = await h.json('POST', '/api/attempts/start', s2, { client_attempt_id: cidStart, case_id: 'CARD-012' });
    expect(st2.attempt_id).toBe(st.attempt_id);
    // invalid items are reported, not fatal
    const r4 = await h.json('POST', '/api/attempts/sync', s2, { items: [{ client_attempt_id: cid(), case_id: 'NOPE', case_version: 1, answers: [], log: logFor('NOPE'), started_at: 0 }] });
    expect(r4.synced).toEqual([]);
    expect(r4.failed).toHaveLength(1);
  });

  it('[T0-12] practice attempts use the non-graded sample and are never stored as graded attempts', async () => {
    const before = (await h.json('GET', '/api/attempts', admin)).length;
    const st = await h.json('POST', '/api/attempts/start', s1, { client_attempt_id: cid(), case_id: PRACTICE_CASE.case_id });
    expect(st.case.practice).toBe(true);
    expect(hasKeyDeep(st.case, 'answer')).toBe(false);
    const sub = await h.json('POST', `/api/attempts/${st.attempt_id}/submit`, s1, { client_attempt_id: '', answers: [], log: logFor(PRACTICE_CASE.case_id) });
    expect(sub.result).toBeDefined();
    const synced = await h.json('POST', '/api/attempts/sync', s1, {
      items: [{ client_attempt_id: cid(), case_id: PRACTICE_CASE.case_id, case_version: 1, answers: [], log: logFor(PRACTICE_CASE.case_id), started_at: 0 }],
    });
    expect(synced.synced).toHaveLength(1);
    expect((await h.json('GET', '/api/attempts', admin)).length).toBe(before);
  });

  it('[T2-08] free-text answers are stored ungraded; manual grading updates the score', async () => {
    const st = await h.json('POST', '/api/attempts/start', s1, { client_attempt_id: cid(), case_id: 'REN-002' });
    const sub = await h.json('POST', `/api/attempts/${st.attempt_id}/submit`, s1, {
      client_attempt_id: '', answers: [ans('q1', ['TA:renal_pelvis']), ans('q2', 'a'), ans('q3', 'Back-pressure causes atrophy.')], log: logFor('REN-002'),
    });
    expect(sub.result).toMatchObject({ score: 2, max_score: 5, pending_manual: 1 });
    const pending = await h.json('GET', '/api/grading/pending', reviewer);
    const item = pending.find((p: { attempt_id: string }) => p.attempt_id === st.attempt_id);
    expect(item).toMatchObject({ question_id: 'q3', response: 'Back-pressure causes atrophy.', student_id: h.seed.users.student1!.id });
    expect(item.prompt).toBeTruthy();
    expect((await h.req('GET', '/api/grading/pending', s1)).statusCode).toBe(403);
    // invalid grades -> 400
    expect((await h.req('POST', `/api/grading/${st.attempt_id}/q3`, reviewer, { points: 10 })).statusCode).toBe(400);
    expect((await h.req('POST', `/api/grading/${st.attempt_id}/q1`, reviewer, { points: 1 })).statusCode).toBe(400);
    const graded = await h.json('POST', `/api/grading/${st.attempt_id}/q3`, reviewer, { points: 2 });
    expect(graded).toMatchObject({ id: st.attempt_id, score: 4, max_score: 5, percent: 80, pending_manual: 0 });
    const after = await h.json('GET', '/api/grading/pending', reviewer);
    expect(after.some((p: { attempt_id: string }) => p.attempt_id === st.attempt_id)).toBe(false);
  });

  it('[T0-22] case template workbook is downloadable', async () => {
    const r = await h.req('GET', '/api/templates/case-template.xlsx');
    expect(r.statusCode).toBe(200);
    expect(r.headers['content-type']).toMatch(/spreadsheetml/);
    expect(r.rawPayload.subarray(0, 2).toString()).toBe('PK');
  });
});
