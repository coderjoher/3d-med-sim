import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { parseCsv } from '@medsim/core';
import { BACKENDS, cid, makeHarness, type Harness } from './helpers.js';
import { card010Answers, logFor } from './fixtures.js';

/** Six students attempt CARD-010 with decreasing accuracy; students 1-3 cohort A (2026), 4-6 cohort B (2025). */
const PLAN: Array<Record<string, string | string[]>> = [
  {},
  { q4: ['TA:aorta'] },
  { q1: ['TA:left_ventricle'] },
  { q1: ['TA:left_ventricle'], q3: 'a' },
  { q1: ['TA:left_ventricle'], q2: ['TA:aorta'], q3: 'a' },
  { q1: ['TA:right_atrium'], q2: ['TA:aorta'], q3: 'c', q4: ['TA:aorta'] },
];

describe.each(BACKENDS)('reports ($name)', (backend) => {
  let h: Harness;
  let proctor: string, admin: string, student: string;
  let course: string;
  beforeAll(async () => {
    h = await makeHarness(backend);
    [proctor, admin, student] = await Promise.all(['proctor1', 'admin', 'student1'].map((u) => h.token(u)));
    course = h.seed.courses.ANAT2!.id;
    for (let i = 0; i < 6; i++) {
      const tok = await h.token(`student${i + 1}`);
      const st = await h.json('POST', '/api/attempts/start', tok, { client_attempt_id: cid(), case_id: 'CARD-010' });
      const log = logFor('CARD-010');
      if (i >= 4) log.events.splice(1, 0, { t: log.started_at + 10, type: 'input-mode', data: { mode: 'mouse', source: 'mouse' } });
      await h.json('POST', `/api/attempts/${st.attempt_id}/submit`, tok, { client_attempt_id: '', answers: card010Answers(PLAN[i]), log });
    }
  });
  afterAll(async () => {
    await h?.close();
  });

  it('[T1-11] per-student results per case and per course', async () => {
    const rows = await h.json('GET', `/api/reports/students?course_id=${course}`, proctor);
    expect(rows.length).toBe(6);
    const s1 = rows.find((r: { student_name: string }) => r.student_name === 'Student 1');
    expect(s1.cohort_id).toBe(h.seed.cohorts.A.id);
    const c10 = s1.cases.find((c: { case_id: string }) => c.case_id === 'CARD-010');
    expect(c10).toEqual({ case_id: 'CARD-010', best_percent: 100, attempts: 1 });
    expect(s1.cases.map((c: { case_id: string }) => c.case_id).sort()).toEqual(['CARD-010', 'CARD-011', 'CARD-012']);
    expect(s1.course_percent).toBeCloseTo(100 / 3, 1);
    const per = await h.json('GET', `/api/attempts?case_id=CARD-010`, proctor);
    expect(per).toHaveLength(6);
    expect(per[0]).toHaveProperty('student_name');
    expect((await h.json('GET', '/api/attempts', student)).every((a: { student_id: string }) => a.student_id === h.seed.users.student1!.id)).toBe(true);
    expect((await h.req('GET', '/api/reports/students', student)).statusCode).toBe(403);
  });

  it('[T1-12] per-question analytics: correct rate, average time, most common wrong selection', async () => {
    const qa = await h.json('GET', '/api/reports/questions?case_id=CARD-010', proctor);
    const q1 = qa.find((q: { question_id: string }) => q.question_id === 'q1');
    expect(q1.attempts).toBe(6);
    expect(q1.correct_rate).toBeCloseTo(2 / 6, 3);
    expect(q1.common_wrong[0]).toEqual({ response: 'TA:left_ventricle', count: 3 });
    expect(q1.avg_time_ms).toBe(8000);
  });

  it('[T1-13] export results to CSV and PDF', async () => {
    const csv = await h.req('GET', `/api/reports/export.csv?course_id=${course}`, proctor);
    expect(csv.statusCode).toBe(200);
    expect(csv.headers['content-type']).toMatch(/text\/csv/);
    const rows = parseCsv(csv.body).filter((r) => r.length > 1);
    expect(rows[0]).toEqual(expect.arrayContaining(['student', 'case_id', 'score', 'percent']));
    expect(rows.length).toBe(7);
    const pdf = await h.req('GET', `/api/reports/export.pdf?course_id=${course}`, proctor);
    expect(pdf.statusCode).toBe(200);
    expect(pdf.headers['content-type']).toBe('application/pdf');
    expect(pdf.rawPayload.subarray(0, 4).toString()).toBe('%PDF');
  });

  it('[T2-02] structure heatmap: cohort misidentification counts per structure', async () => {
    const heat = await h.json('GET', '/api/reports/heatmap?case_id=CARD-010', proctor);
    const rv = heat.find((s: { structure_id: string }) => s.structure_id === 'TA:right_ventricle');
    expect(rv.missed).toBe(4);
    const lv = heat.find((s: { structure_id: string }) => s.structure_id === 'TA:left_ventricle');
    expect(lv.wrongly_selected).toBe(3);
    expect((await h.json('GET', `/api/reports/heatmap?course_id=${course}`, proctor)).length).toBeGreaterThan(0);
    expect((await h.req('GET', '/api/reports/heatmap', proctor)).statusCode).toBe(400);
  });

  it('[T2-03] cohort comparison across groups and years', async () => {
    const byCohort = await h.json('GET', `/api/reports/cohorts?course_id=${course}&by=cohort`, proctor);
    const a = byCohort.find((g: { group: string }) => g.group === 'Cohort A 2026');
    const b = byCohort.find((g: { group: string }) => g.group === 'Cohort B 2025');
    expect(a.n).toBe(3);
    expect(b.n).toBe(3);
    expect(a.mean_percent).toBeGreaterThan(b.mean_percent);
    const byYear = await h.json('GET', `/api/reports/cohorts?course_id=${course}&by=year`, proctor);
    expect(byYear.map((g: { group: string }) => g.group).sort()).toEqual(['2025', '2026']);
  });

  it('[T2-04] item analysis: difficulty and upper/lower 27% discrimination', async () => {
    const items = await h.json('GET', '/api/reports/items?case_id=CARD-010', proctor);
    const q1 = items.find((i: { question_id: string }) => i.question_id === 'q1');
    expect(q1.n).toBe(6);
    expect(q1.difficulty).toBeCloseTo(2 / 6, 3);
    expect(q1.discrimination).toBeGreaterThan(0);
  });

  it('[T2-10] SUS questionnaire is collected and scored', async () => {
    expect((await h.req('POST', '/api/sus', student, { answers: [1, 2, 3], lang: 'en' })).statusCode).toBe(400);
    expect(await h.json('POST', '/api/sus', student, { answers: [5, 1, 5, 1, 5, 1, 5, 1, 5, 1], lang: 'ar' })).toEqual({ score: 100 });
    expect(await h.json('POST', '/api/sus', await h.token('student2'), { answers: [3, 3, 3, 3, 3, 3, 3, 3, 3, 3], lang: 'en' })).toEqual({ score: 50 });
    expect(await h.json('GET', '/api/sus/summary', proctor)).toEqual({ n: 2, mean: 75 });
  });

  it('[T3-03] success-metric dashboard: completion without help, fallback usage, time-to-publish, score-exam correlation', async () => {
    const ids = [1, 2, 3, 4, 5, 6].map((i) => h.seed.users[`student${i}`]!.id);
    expect((await h.req('POST', '/api/exam-scores', proctor, { rows: [] })).statusCode).toBe(403);
    await h.json('POST', '/api/exam-scores', admin, { rows: ids.map((id, i) => ({ student_id: id, course_id: course, percent: 95 - i * 10 })) });
    const m = await h.json('GET', `/api/reports/metrics?course_id=${course}`, proctor);
    expect(m).toMatchObject({ completion_without_help_rate: 1, active_authors: 1, sessions: 0 });
    expect(m.fallback_usage_rate).toBeCloseTo(2 / 6, 3);
    expect(m.avg_time_to_publish_hours).toBeGreaterThanOrEqual(0);
    expect(m.sus_mean).toBe(75);
    expect(m.score_exam_correlation).toBeGreaterThan(0.8);
    for (const k of ['completion_without_help_rate', 'fallback_usage_rate', 'avg_time_to_publish_hours', 'active_authors', 'sessions', 'sus_mean', 'score_exam_correlation'])
      expect(m).toHaveProperty(k);
    // proctor help during an attempt lowers completion-without-help
    const tok = await h.token('student3');
    const st = await h.json('POST', '/api/attempts/start', tok, { client_attempt_id: cid(), case_id: 'CARD-012', station_id: 'LAB-9' });
    await h.json('POST', '/api/stations/LAB-9/heartbeat', tok, { status: 'in_progress', attempt_id: st.attempt_id });
    await h.json('POST', '/api/stations/LAB-9/command', proctor, { type: 'set-input', mode: 'fallback' });
    await h.json('POST', `/api/attempts/${st.attempt_id}/submit`, tok, { client_attempt_id: '', answers: [], log: logFor('CARD-012') });
    const m2 = await h.json('GET', `/api/reports/metrics?course_id=${course}`, proctor);
    expect(m2.completion_without_help_rate).toBeCloseTo(6 / 7, 3);
  });
});
