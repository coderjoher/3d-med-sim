import { useState } from 'react';
import type { AttemptSummary } from '@medsim/core';
import { api } from '../../shared/api';
import { usePrefs } from '../../shared/prefs';
import { errorText, useApi } from '../hooks';
import { Empty, ErrorBox, Loading } from '../ui';

export interface PendingItem { attempt_id: string; question_id: string; prompt: string | { en: string; ar?: string }; response: string | string[]; student_id: string; points_possible?: number }

/** Manual grading queue for free-text answers (C-05). */
export function GradingQueue() {
  const { s, tx } = usePrefs();
  const pending = useApi<PendingItem[]>('/grading/pending');
  const [points, setPoints] = useState<Record<string, string>>({});
  const [done, setDone] = useState<Record<string, AttemptSummary>>({});
  const [error, setError] = useState<string | null>(null);
  const key = (p: PendingItem) => `${p.attempt_id}/${p.question_id}`;
  const items = (pending.data ?? []).filter((p) => !done[key(p)]);

  const grade = async (p: PendingItem) => {
    const v = Number(points[key(p)]);
    if (points[key(p)] === undefined || points[key(p)] === '' || Number.isNaN(v) || v < 0) { setError(s('p.err_points')); return; }
    setError(null);
    try {
      const r = await api<AttemptSummary>(`/grading/${encodeURIComponent(p.attempt_id)}/${encodeURIComponent(p.question_id)}`, { method: 'POST', json: { points: v } });
      setDone((d) => ({ ...d, [key(p)]: r }));
    } catch (e) { setError(errorText(e)); }
  };

  const graded = Object.entries(done);
  return (
    <div>
      <h1>{s('grading')}</h1>
      <ErrorBox error={error || pending.error} />
      <Loading when={pending.loading}>
        <Empty show={items.length === 0} />
        {items.length > 0 && (
          <table data-testid="grading-queue">
            <thead><tr><th>{s('student')}</th><th>{s('question')}</th><th>{s('p.response')}</th><th>{s('grade')}</th><th /></tr></thead>
            <tbody>
              {items.map((p) => (
                <tr key={key(p)} data-testid={`grade-row-${p.attempt_id}-${p.question_id}`}>
                  <td>{p.student_id}</td>
                  <td><code>{p.question_id}</code> {tx(p.prompt)}</td>
                  <td><blockquote className="portal-response">{Array.isArray(p.response) ? p.response.join(', ') : p.response}</blockquote></td>
                  <td>
                    <input type="number" min={0} step="0.5" aria-label={s('grade')} data-testid={`points-${p.attempt_id}-${p.question_id}`} value={points[key(p)] ?? ''} onChange={(e) => setPoints({ ...points, [key(p)]: e.target.value })} style={{ width: '5em' }} />
                    {p.points_possible !== undefined && <span className="muted"> / {p.points_possible}</span>}
                  </td>
                  <td><button type="button" className="primary" data-testid={`grade-${p.attempt_id}-${p.question_id}`} onClick={() => void grade(p)}>{s('save')}</button></td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </Loading>
      {graded.length > 0 && (
        <section className="card portal-section" data-testid="graded">
          <h2>{s('p.graded_now')}</h2>
          <ul>{graded.map(([k, r]) => <li key={k}>{k}: {r.score} / {r.max_score} ({r.percent.toFixed(0)}%){r.pending_manual ? ` · ${s('pending_grading')}: ${r.pending_manual}` : ''}</li>)}</ul>
        </section>
      )}
    </div>
  );
}
