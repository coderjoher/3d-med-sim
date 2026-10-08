import { useState } from 'react';
import { Link, useNavigate, useParams } from 'react-router-dom';
import type { CaseData, CaseRecord, ModelDef } from '@medsim/core';
import { api } from '../../shared/api';
import { useAuth } from '../../shared/auth';
import { usePrefs } from '../../shared/prefs';
import { errorList, useApi } from '../hooks';
import { Empty, ErrorBox, Loading, StatusBadge } from '../ui';
import { fmtDate, truncate } from '../author/CaseList';
import { CasePreview } from '../author/PreviewPage';
import { describeView } from '../author/QuestionEditor';

/** Queue of cases awaiting review (A-05). */
export function ReviewQueue() {
  const { s, tx } = usePrefs();
  const { user } = useAuth();
  const queue = useApi<CaseRecord[]>('/cases?status=in_review');
  const rows = (queue.data ?? []).filter((c) => c.status === 'in_review');
  return (
    <div>
      <h1>{s('p.review_queue')}</h1>
      <ErrorBox error={queue.error} />
      <Loading when={queue.loading}>
        <Empty show={rows.length === 0} />
        {rows.length > 0 && (
          <table data-testid="review-queue">
            <thead><tr><th>{s('case')}</th><th>{s('stem')}</th><th>{s('course')}</th><th>{s('p.version_col')}</th><th>{s('role.author')}</th><th>{s('p.updated')}</th><th /></tr></thead>
            <tbody>
              {rows.map((c) => (
                <tr key={c.id} data-testid={`review-row-${c.id}`}>
                  <td><code>{c.id}</code></td>
                  <td>{truncate(tx(c.data.stem), 80)}</td>
                  <td>{c.data.course}</td>
                  <td>v{c.version}</td>
                  <td>{c.author_id}{c.author_id === user?.id ? ` (${s('p.you')})` : ''}</td>
                  <td>{fmtDate(c.updated_at)}</td>
                  <td><Link to={`/portal/review/${encodeURIComponent(c.id)}`} data-testid={`review-open-${c.id}`}>{s('p.review')}</Link></td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </Loading>
    </div>
  );
}

/** Side-by-side: full case with keys on one side, student preview on the other; approve / reject with comment. */
export function ReviewCase() {
  const { id = '' } = useParams();
  const { s } = usePrefs();
  const { user } = useAuth();
  const navigate = useNavigate();
  const rec = useApi<CaseRecord>(`/cases/${encodeURIComponent(id)}`);
  const models = useApi<ModelDef[]>('/models');
  const [comment, setComment] = useState('');
  const [errors, setErrors] = useState<string[]>([]);
  const [busy, setBusy] = useState(false);
  const [done, setDone] = useState<string | null>(null);

  const act = async (action: 'approve' | 'reject') => {
    if (action === 'reject' && !comment.trim()) { setErrors([s('p.reject_needs_comment')]); return; }
    setBusy(true); setErrors([]);
    try {
      const r = await api<CaseRecord>(`/cases/${encodeURIComponent(id)}/${action}`, { method: 'POST', json: comment.trim() ? { comment: comment.trim() } : {} });
      rec.setData(r);
      setDone(action === 'approve' ? s('p.approved_msg', { n: r.version }) : s('p.rejected_msg'));
    } catch (e) {
      setErrors(errorList(e));
    } finally {
      setBusy(false);
    }
  };

  const r = rec.data;
  const ownCase = !!r && r.author_id === user?.id;
  const model = models.data?.find((m) => m.id === r?.data.model);
  return (
    <div>
      <div className="row">
        <h1>{s('p.review')}: <code>{id}</code></h1>
        {r && <StatusBadge status={r.status} />}
        {r && <span className="muted">{s('version', { n: r.version })}</span>}
        <button type="button" onClick={() => navigate('/portal/review')}>{s('back')}</button>
      </div>
      <ErrorBox error={rec.error} />
      <Loading when={rec.loading}>
        {r && (
          <div className="portal-split">
            <section className="card">
              <h2>{s('p.case_with_keys')}</h2>
              <CaseSummary data={r.data} model={model} />
            </section>
            <section className="card">
              <h2>{s('preview')}</h2>
              <CasePreview id={id} />
            </section>
          </div>
        )}
        {r && r.status === 'in_review' && (
          <section className="card portal-section">
            <label>{s('review_comment')}<br />
              <textarea data-testid="review-comment-input" rows={3} value={comment} onChange={(e) => setComment(e.target.value)} style={{ width: '100%' }} />
            </label>
            {ownCase && <p className="error" data-testid="own-case-warning">{s('p.cannot_review_own')}</p>}
            <div className="row">
              <button type="button" className="primary" data-testid="approve" disabled={busy || ownCase} onClick={() => void act('approve')}>{s('approve')}</button>
              <button type="button" data-testid="reject" disabled={busy || ownCase} onClick={() => void act('reject')}>{s('reject')}</button>
            </div>
          </section>
        )}
        <ErrorBox errors={errors} />
        {done && <p role="status" className="portal-ok">{done}</p>}
      </Loading>
    </div>
  );
}

/** Read-only summary of a case including answer keys (for reviewers). */
export function CaseSummary({ data, model }: { data: CaseData; model?: ModelDef }) {
  const { s, tx } = usePrefs();
  const sname = (id: string) => tx(model?.structures.find((x) => x.id === id)?.name) || id;
  const bilingual = (t: CaseData['stem'] | undefined) => (t === undefined ? '' : typeof t === 'string' ? t : `${t.en}${t.ar ? ` / ${t.ar}` : ''}`);
  return (
    <div data-testid="case-summary">
      <dl className="portal-dl">
        <dt>{s('course')}</dt><dd>{data.course}</dd>
        <dt>{s('model')}</dt><dd>{model ? tx(model.name) : data.model} · {data.variant}{model ? ` (v${model.version}${model.sign_off ? ', ✓' : ''})` : ''}</dd>
        <dt>{s('stem')}</dt><dd>{bilingual(data.stem)}</dd>
        <dt>{s('initial_view')}</dt><dd>{describeView(data.initial_view)}</dd>
        <dt>{s('time_limit')}</dt><dd>{data.time_limit_min ?? '—'}</dd>
        <dt>{s('feedback_level')}</dt><dd>{s(`feedback.${data.feedback_level ?? 'score'}`)}</dd>
        {data.meta?.objectives?.length ? (<><dt>{s('p.objectives')}</dt><dd>{data.meta.objectives.join('; ')}</dd></>) : null}
      </dl>
      <ol>
        {data.questions.map((q) => {
          const ans = q.answer === undefined ? [] : Array.isArray(q.answer) ? q.answer : [q.answer];
          return (
            <li key={q.id}>
              <strong>[{s(`p.qtype.${q.type}`)} · {q.points}]</strong> {bilingual(q.prompt)}
              {q.options && <ul>{Object.entries(q.options).map(([k, t]) => <li key={k}>{ans.includes(k) ? '✔ ' : ''}<code>{k}</code> {bilingual(t)}</li>)}</ul>}
              <div className="muted">{s('answer_key')}: {q.type === 'identify' ? ans.map(sname).join(', ') : ans.join(q.type === 'order' ? ' → ' : ', ') || '—'}</div>
              {q.feedback && <div className="muted">{s('feedback')}: {bilingual(q.feedback)}</div>}
            </li>
          );
        })}
      </ol>
    </div>
  );
}
