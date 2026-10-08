import { useState } from 'react';
import type { CaseRecord, CohortStats, Course, ItemAnalysis, ModelDef, QuestionAnalytics, StructureHeat, StudentCourseResult, SuccessMetrics } from '@medsim/core';
import { api, download } from '../../shared/api';
import { usePrefs } from '../../shared/prefs';
import { useAuth } from '../../shared/auth';
import { ModelViewer } from '../../viewer/ModelViewer';
import { errorText, num, pct, rate, secs, useApi } from '../hooks';
import { Empty, ErrorBox, Loading, Tabs } from '../ui';
import { BarChart } from './BarChart';

type Tab = 'results' | 'questions' | 'heatmap' | 'cohorts' | 'items' | 'metrics';

/** Reports (R-01..R-06) and success metrics (§17). */
export function ReportsPage() {
  const { s } = usePrefs();
  const courses = useApi<Course[]>('/courses');
  const [courseSel, setCourseSel] = useState('');
  const courseId = courseSel || courses.data?.[0]?.id || '';
  const course = courses.data?.find((c) => c.id === courseId);
  const cases = useApi<CaseRecord[]>(courseId ? `/cases?course_id=${encodeURIComponent(courseId)}` : null);
  const [caseSel, setCaseSel] = useState('');
  const caseList = (cases.data ?? []).filter((c) => c.course_id === courseId || !c.course_id);
  const caseId = caseList.some((c) => c.id === caseSel) ? caseSel : caseList[0]?.id ?? '';
  const caseRec = caseList.find((c) => c.id === caseId);
  const [tab, setTab] = useState<Tab>('results');
  const [exportError, setExportError] = useState<string | null>(null);

  const exportFile = async (kind: 'csv' | 'pdf') => {
    setExportError(null);
    try {
      await download(`/reports/export.${kind}?course_id=${encodeURIComponent(courseId)}`, `medsim-results-${course?.code ?? courseId}.${kind}`);
    } catch (e) { setExportError(errorText(e)); }
  };

  const tabs: Array<{ key: Tab; label: string }> = [
    { key: 'results', label: s('results') },
    { key: 'questions', label: s('p.question_analytics') },
    { key: 'heatmap', label: s('heatmap') },
    { key: 'cohorts', label: s('cohort_comparison') },
    { key: 'items', label: s('item_analysis') },
    { key: 'metrics', label: s('p.success_metrics') },
  ];
  const needsCase = tab === 'questions' || tab === 'items' || tab === 'heatmap';

  return (
    <div>
      <h1>{s('reports')}</h1>
      <ErrorBox error={courses.error} />
      <div className="row portal-section">
        <label>{s('course')}{' '}
          <select data-testid="report-course" value={courseId} onChange={(e) => setCourseSel(e.target.value)}>
            {(courses.data ?? []).map((c) => <option key={c.id} value={c.id}>{c.code} — {c.name}</option>)}
          </select>
        </label>
        {needsCase && (
          <label>{s('case')}{' '}
            <select data-testid="report-case" value={tab === 'heatmap' ? (caseList.some((c) => c.id === caseSel) ? caseSel : '') : caseId} onChange={(e) => setCaseSel(e.target.value)}>
              {tab === 'heatmap' && <option value="">{s('p.whole_course')}</option>}
              {caseList.map((c) => <option key={c.id} value={c.id}>{c.id}</option>)}
            </select>
          </label>
        )}
        <button type="button" data-testid="export-csv" disabled={!courseId} onClick={() => void exportFile('csv')}>{s('export_csv')}</button>
        <button type="button" data-testid="export-pdf" disabled={!courseId} onClick={() => void exportFile('pdf')}>{s('export_pdf')}</button>
      </div>
      <ErrorBox error={exportError} />
      <Tabs<Tab> tabs={tabs} value={tab} onChange={setTab} label={s('reports')} />
      <div className="portal-tabpanel" role="tabpanel">
        {courseId && tab === 'results' && <StudentResults courseId={courseId} cases={caseList} />}
        {tab === 'questions' && caseRec && <QuestionReport caseRec={caseRec} />}
        {tab === 'heatmap' && courseId && <HeatmapReport courseId={courseId} caseRec={caseList.find((c) => c.id === caseSel)} />}
        {tab === 'cohorts' && courseId && <CohortReport courseId={courseId} />}
        {tab === 'items' && caseRec && <ItemReport caseRec={caseRec} />}
        {tab === 'metrics' && courseId && <MetricsDashboard courseId={courseId} />}
        {needsCase && tab !== 'heatmap' && !caseRec && <Empty show />}
      </div>
    </div>
  );
}

/** R-01: per-student results per case and per course. */
export function StudentResults({ courseId, cases }: { courseId: string; cases: CaseRecord[] }) {
  const { s } = usePrefs();
  const res = useApi<StudentCourseResult[]>(`/reports/students?course_id=${encodeURIComponent(courseId)}`);
  const rows = res.data ?? [];
  const caseIds = Array.from(new Set([...cases.map((c) => c.id), ...rows.flatMap((r) => r.cases.map((c) => c.case_id))]));
  return (
    <section>
      <ErrorBox error={res.error} />
      <Loading when={res.loading}>
        <Empty show={rows.length === 0} />
        {rows.length > 0 && (
          <div className="portal-scroll">
            <table data-testid="student-results">
              <thead><tr><th>{s('student')}</th><th>{s('p.cohort')}</th>{caseIds.map((c) => <th key={c}>{c}</th>)}<th>{s('p.course_percent')}</th></tr></thead>
              <tbody>
                {rows.map((r) => (
                  <tr key={r.student_id}>
                    <td>{r.student_name}</td>
                    <td>{r.cohort_id ?? '—'}</td>
                    {caseIds.map((cid) => {
                      const c = r.cases.find((x) => x.case_id === cid);
                      return <td key={cid}>{c ? `${pct(c.best_percent)} (${c.attempts})` : '—'}</td>;
                    })}
                    <td><strong>{pct(r.course_percent)}</strong></td>
                  </tr>
                ))}
              </tbody>
            </table>
            <p className="muted">{s('p.best_attempts_note')}</p>
          </div>
        )}
      </Loading>
    </section>
  );
}

/** R-02: per-question correct rate, average time, most common wrong answers. */
export function QuestionReport({ caseRec }: { caseRec: CaseRecord }) {
  const { s, tx } = usePrefs();
  const res = useApi<QuestionAnalytics[]>(`/reports/questions?case_id=${encodeURIComponent(caseRec.id)}`);
  const prompt = (qid: string) => tx(caseRec.data.questions.find((q) => q.id === qid)?.prompt);
  const rows = res.data ?? [];
  return (
    <section>
      <ErrorBox error={res.error} />
      <Loading when={res.loading}>
        <Empty show={rows.length === 0} />
        {rows.length > 0 && (
          <table data-testid="question-analytics">
            <thead><tr><th>{s('question')}</th><th>{s('attempts')}</th><th>{s('correct_rate')}</th><th>{s('avg_time')}</th><th>{s('common_wrong')}</th></tr></thead>
            <tbody>
              {rows.map((q) => (
                <tr key={q.question_id}>
                  <td><code>{q.question_id}</code> {prompt(q.question_id)}</td>
                  <td>{q.attempts}</td>
                  <td><Meter value={q.correct_rate} /> {rate(q.correct_rate)}</td>
                  <td>{secs(q.avg_time_ms)}</td>
                  <td>{q.common_wrong.length ? q.common_wrong.slice(0, 3).map((w) => `${w.response} (${w.count})`).join(', ') : '—'}</td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </Loading>
    </section>
  );
}

function Meter({ value }: { value: number }) {
  return <span className="portal-meter" aria-hidden><span style={{ width: `${Math.round(Math.max(0, Math.min(1, value)) * 100)}%` }} /></span>;
}

/** Colour ramp for heat: 0 → pale, 1 → strong (colour-blind-safe orange). */
export function heatColour(t: number): string {
  const x = Math.max(0, Math.min(1, t));
  const l = 92 - x * 50;
  return `hsl(28 90% ${l}%)`;
}

/** R-03: which structures the cohort misidentifies most. */
export function HeatmapReport({ courseId, caseRec }: { courseId: string; caseRec?: CaseRecord }) {
  const { s, tx } = usePrefs();
  const q = caseRec ? `case_id=${encodeURIComponent(caseRec.id)}` : `course_id=${encodeURIComponent(courseId)}`;
  const res = useApi<StructureHeat[]>(`/reports/heatmap?${q}`);
  const models = useApi<ModelDef[]>('/models');
  const [showModel, setShowModel] = useState(false);
  const rows = [...(res.data ?? [])].sort((a, b) => b.missed + b.wrongly_selected - (a.missed + a.wrongly_selected));
  const max = Math.max(1, ...rows.map((r) => r.missed + r.wrongly_selected));
  const model = models.data?.find((m) => m.id === caseRec?.data.model) ?? models.data?.find((m) => rows.some((r) => m.structures.some((st) => st.id === r.structure_id)));
  const name = (id: string) => tx(model?.structures.find((st) => st.id === id)?.name) || id;
  const top = rows.filter((r) => r.missed + r.wrongly_selected > 0).slice(0, 5).map((r) => r.structure_id);
  return (
    <section>
      <ErrorBox error={res.error} />
      <Loading when={res.loading}>
        <Empty show={rows.length === 0} />
        {rows.length > 0 && (
          <>
            <div className="portal-colourbar" aria-label={s('p.heat_scale')}>
              <span>0</span><span className="portal-colourbar-ramp" style={{ background: `linear-gradient(to right, ${heatColour(0)}, ${heatColour(0.5)}, ${heatColour(1)})` }} /><span>{max}</span>
            </div>
            <table data-testid="heatmap-table">
              <thead><tr><th>{s('p.structure')}</th><th>{s('p.missed')}</th><th>{s('p.wrongly_selected')}</th><th>{s('p.total_errors')}</th><th>{s('p.as_target')}</th></tr></thead>
              <tbody>
                {rows.map((r) => {
                  const errors = r.missed + r.wrongly_selected;
                  return (
                    <tr key={r.structure_id} data-testid={`heat-${r.structure_id}`}>
                      <td>{name(r.structure_id)} <code className="muted">{r.structure_id}</code></td>
                      <td>{r.missed}</td>
                      <td>{r.wrongly_selected}</td>
                      <td style={{ background: heatColour(errors / max) }}><strong>{errors}</strong></td>
                      <td>{r.total}</td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
            {model && (
              <div className="portal-section">
                <button type="button" onClick={() => setShowModel(!showModel)} aria-pressed={showModel}>{s('p.show_on_model')}</button>
                {showModel && (
                  <>
                    <p className="muted">{s('p.top_missed_highlighted', { n: top.length })}</p>
                    <ModelViewer modelId={model.id} variant={caseRec?.data.variant ?? model.variants[0]?.id ?? 'normal'} labelsVisible selectedIds={top} className="portal-viewer" testId="heatmap-viewer" />
                  </>
                )}
              </div>
            )}
          </>
        )}
      </Loading>
    </section>
  );
}

/** R-04: compare cohorts by group or by year. */
export function CohortReport({ courseId }: { courseId: string }) {
  const { s } = usePrefs();
  const [by, setBy] = useState<'cohort' | 'year'>('cohort');
  const res = useApi<CohortStats[]>(`/reports/cohorts?course_id=${encodeURIComponent(courseId)}&by=${by}`);
  const rows = res.data ?? [];
  return (
    <section>
      <div className="row">
        <label>{s('p.group_by')}{' '}
          <select data-testid="cohort-by" value={by} onChange={(e) => setBy(e.target.value as 'cohort' | 'year')}>
            <option value="cohort">{s('p.cohort')}</option>
            <option value="year">{s('p.year')}</option>
          </select>
        </label>
      </div>
      <ErrorBox error={res.error} />
      <Loading when={res.loading}>
        <Empty show={rows.length === 0} />
        {rows.length > 0 && (
          <>
            <BarChart title={s('cohort_comparison')} bars={rows.map((r) => ({ label: r.group, value: r.mean_percent, sub: `n=${r.n}`, error: r.sd_percent }))} />
            <table data-testid="cohort-table">
              <thead><tr><th>{by === 'year' ? s('p.year') : s('p.cohort')}</th><th>n</th><th>{s('p.mean')}</th><th>{s('p.median')}</th><th>{s('p.sd')}</th></tr></thead>
              <tbody>{rows.map((r) => <tr key={r.group}><td>{r.group}</td><td>{r.n}</td><td>{pct(r.mean_percent, 1)}</td><td>{pct(r.median_percent, 1)}</td><td>{num(r.sd_percent, 1)}</td></tr>)}</tbody>
            </table>
          </>
        )}
      </Loading>
    </section>
  );
}

/** Flags for weak items (classical test theory rules of thumb). */
export function itemFlags(it: ItemAnalysis): string[] {
  const f: string[] = [];
  if (it.difficulty < 0.2) f.push('too_hard');
  if (it.difficulty > 0.9) f.push('too_easy');
  if (it.discrimination !== null && it.discrimination < 0.2) f.push('low_discrimination');
  if (it.point_biserial !== null && it.point_biserial < 0) f.push('negative_pb');
  else if (it.point_biserial !== null && it.point_biserial < 0.2) f.push('low_pb');
  return f;
}

/** R-06: difficulty, discrimination (upper/lower 27 %), point-biserial. */
export function ItemReport({ caseRec }: { caseRec: CaseRecord }) {
  const { s, tx } = usePrefs();
  const res = useApi<ItemAnalysis[]>(`/reports/items?case_id=${encodeURIComponent(caseRec.id)}`);
  const rows = res.data ?? [];
  const prompt = (qid: string) => tx(caseRec.data.questions.find((q) => q.id === qid)?.prompt);
  return (
    <section>
      <ErrorBox error={res.error} />
      <Loading when={res.loading}>
        <Empty show={rows.length === 0} />
        {rows.length > 0 && (
          <>
            <table data-testid="item-analysis">
              <thead><tr><th>{s('question')}</th><th>n</th><th>{s('difficulty')} (p)</th><th>{s('discrimination')} (D)</th><th>{s('p.point_biserial')}</th><th>{s('p.flags')}</th></tr></thead>
              <tbody>
                {rows.map((it) => {
                  const flags = itemFlags(it);
                  return (
                    <tr key={it.question_id} className={flags.length ? 'portal-flagged' : ''} data-testid={`item-${it.question_id}`} data-flagged={flags.length ? 'true' : 'false'}>
                      <td><code>{it.question_id}</code> {prompt(it.question_id)}</td>
                      <td>{it.n}</td>
                      <td>{num(it.difficulty)}</td>
                      <td>{num(it.discrimination)}</td>
                      <td>{num(it.point_biserial)}</td>
                      <td>{flags.length ? flags.map((f) => <span key={f} className="portal-badge portal-badge-warn">⚠ {s(`p.flag.${f}`)}</span>) : <span className="portal-ok">✓</span>}</td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
            <p className="muted">{s('p.item_help')}</p>
          </>
        )}
      </Loading>
    </section>
  );
}

/** §17 success metrics, T3-03. */
export function MetricsDashboard({ courseId }: { courseId: string }) {
  const { s } = usePrefs();
  const { hasRole } = useAuth();
  const isAdmin = hasRole('admin');
  const res = useApi<SuccessMetrics>(`/reports/metrics?course_id=${encodeURIComponent(courseId)}`);
  const sus = useApi<{ n: number; mean: number | null }>('/sus/summary');
  const [examCsv, setExamCsv] = useState('');
  const [msg, setMsg] = useState<string | null>(null);
  const [err, setErr] = useState<string | null>(null);
  const m = res.data;

  const uploadExam = async () => {
    setMsg(null); setErr(null);
    const rows = examCsv.split(/\r?\n/).map((l) => l.trim()).filter(Boolean)
      .map((l) => l.split(/[,;\t]/).map((x) => x.trim()))
      .filter((p) => p.length >= 2 && !Number.isNaN(Number(p[1])))
      .map((p) => ({ student_id: p[0], course_id: courseId, percent: Number(p[1]) }));
    if (!rows.length) { setErr(s('p.exam_none')); return; }
    try {
      await api('/exam-scores', { method: 'POST', json: { rows } });
      setMsg(s('p.exam_uploaded', { n: rows.length }));
      res.reload();
    } catch (e) { setErr(errorText(e)); }
  };

  const tiles: Array<{ key: string; label: string; value: string; target?: string; ok?: boolean | null }> = m ? [
    { key: 'completion', label: s('p.metric.completion'), value: rate(m.completion_without_help_rate), target: '≥ 80%', ok: m.completion_without_help_rate === null ? null : m.completion_without_help_rate >= 0.8 },
    { key: 'fallback', label: s('p.metric.fallback'), value: rate(m.fallback_usage_rate) },
    { key: 'publish', label: s('p.metric.time_to_publish'), value: m.avg_time_to_publish_hours === null ? '—' : `${m.avg_time_to_publish_hours.toFixed(1)} h` },
    { key: 'authors', label: s('p.metric.active_authors'), value: String(m.active_authors) },
    { key: 'sessions', label: s('p.metric.sessions'), value: String(m.sessions) },
    { key: 'sus', label: s('p.metric.sus'), value: m.sus_mean === null ? '—' : `${m.sus_mean.toFixed(1)}${sus.data ? ` (n=${sus.data.n})` : ''}`, target: '≥ 68', ok: m.sus_mean === null ? null : m.sus_mean >= 68 },
    { key: 'corr', label: s('p.metric.correlation'), value: num(m.score_exam_correlation) },
  ] : [];

  return (
    <section>
      <ErrorBox error={res.error} />
      <Loading when={res.loading && !m}>
        <div className="portal-tiles" data-testid="metrics">
          {tiles.map((t) => (
            <div key={t.key} className="card portal-tile" data-testid={`metric-${t.key}`}>
              <div className="muted">{t.label}</div>
              <div className="portal-tile-value">{t.value}</div>
              {t.target && <div className={t.ok === null || t.ok === undefined ? 'muted' : t.ok ? 'portal-ok' : 'error'}>{s('p.target')}: {t.target}</div>}
            </div>
          ))}
        </div>
      </Loading>
      {isAdmin && <details className="card portal-section">
        <summary>{s('p.exam_upload')}</summary>
        <p className="muted">{s('p.exam_help')}</p>
        <textarea data-testid="exam-csv" rows={4} style={{ width: '100%' }} value={examCsv} onChange={(e) => setExamCsv(e.target.value)} placeholder={'student1,72\nstudent2,85'} />
        <button type="button" onClick={() => void uploadExam()}>{s('p.upload')}</button>
        <ErrorBox error={err} />
        {msg && <p role="status" className="portal-ok">{msg}</p>}
      </details>}
    </section>
  );
}
