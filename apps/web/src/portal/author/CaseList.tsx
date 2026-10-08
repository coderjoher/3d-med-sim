import { Link } from 'react-router-dom';
import type { CaseRecord, CaseStatus } from '@medsim/core';
import { useAuth } from '../../shared/auth';
import { usePrefs } from '../../shared/prefs';
import { useApi } from '../hooks';
import { Empty, ErrorBox, Loading, StatusBadge } from '../ui';

/** Author's case list grouped by workflow state, with version numbers (A-02, A-05, A-06). */
export function CaseList() {
  const { s, tx } = usePrefs();
  const { user } = useAuth();
  const cases = useApi<CaseRecord[]>('/cases');
  const all = cases.data ?? [];
  const mine = (c: CaseRecord) => c.author_id === user?.id;
  const groups: Array<{ key: string; title: string; items: CaseRecord[] }> = [
    { key: 'drafts', title: s('p.my_drafts'), items: all.filter((c) => c.status === 'draft' && mine(c)) },
    { key: 'review', title: s('status.in_review'), items: all.filter((c) => c.status === 'in_review') },
    { key: 'published', title: s('status.published'), items: all.filter((c) => c.status === 'published') },
    { key: 'other', title: s('p.other_drafts'), items: all.filter((c) => (c.status === 'draft' && !mine(c)) || c.status === 'archived') },
  ];
  return (
    <div>
      <div className="row">
        <h1>{s('cases')}</h1>
        <Link className="portal-button primary" to="/portal/cases/new" data-testid="new-case">{s('new_case')}</Link>
        <Link className="portal-button" to="/portal/cases/import">{s('import_spreadsheet')}</Link>
      </div>
      <ErrorBox error={cases.error} />
      <Loading when={cases.loading && !cases.data}>
        {groups.filter((g) => g.key !== 'other' || g.items.length).map((g) => (
          <section key={g.key} className="card portal-section" data-testid={`cases-${g.key}`}>
            <h2>{g.title} <span className="muted">({g.items.length})</span></h2>
            <Empty show={g.items.length === 0} />
            {g.items.length > 0 && (
              <table>
                <thead><tr><th>{s('case')}</th><th>{s('stem')}</th><th>{s('course')}</th><th>{s('p.version_col')}</th><th>{s('status')}</th><th>{s('p.updated')}</th><th>{s('p.actions')}</th></tr></thead>
                <tbody>
                  {g.items.map((c) => (
                    <tr key={c.id} data-testid={`case-row-${c.id}`}>
                      <td><code>{c.id}</code></td>
                      <td>{truncate(tx(c.data.stem), 80)}</td>
                      <td>{c.data.course}</td>
                      <td>v{c.version}</td>
                      <td><StatusBadge status={c.status as CaseStatus} /></td>
                      <td>{fmtDate(c.updated_at)}</td>
                      <td className="row">
                        <Link to={`/portal/cases/${encodeURIComponent(c.id)}/edit`}>{s('edit')}</Link>
                        <Link to={`/portal/cases/${encodeURIComponent(c.id)}/preview`}>{s('preview')}</Link>
                        <Link to={`/portal/cases/${encodeURIComponent(c.id)}/versions`}>{s('versions')}</Link>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            )}
          </section>
        ))}
      </Loading>
    </div>
  );
}

export function truncate(t: string, n: number) { return t.length > n ? `${t.slice(0, n - 1)}…` : t; }
export function fmtDate(iso?: string) {
  if (!iso) return '—';
  const d = new Date(iso);
  return Number.isNaN(d.getTime()) ? iso : d.toLocaleString();
}
