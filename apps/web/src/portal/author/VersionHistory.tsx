import { Link, useParams } from 'react-router-dom';
import type { CaseRecord } from '@medsim/core';
import { usePrefs } from '../../shared/prefs';
import { useApi } from '../hooks';
import { Empty, ErrorBox, Loading, StatusBadge } from '../ui';
import { fmtDate } from './CaseList';

/** Version history of a case (A-06): every published edit is a new version. */
export function VersionHistory() {
  const { id = '' } = useParams();
  const { s } = usePrefs();
  const versions = useApi<CaseRecord[]>(`/cases/${encodeURIComponent(id)}/versions`);
  const rows = [...(versions.data ?? [])].sort((a, b) => b.version - a.version);
  return (
    <div>
      <div className="row">
        <h1>{s('versions')}: <code>{id}</code></h1>
        <Link to={`/portal/cases/${encodeURIComponent(id)}/edit`}>{s('back')}</Link>
      </div>
      <ErrorBox error={versions.error} />
      <Loading when={versions.loading}>
        <Empty show={rows.length === 0} />
        {rows.length > 0 && (
          <table data-testid="versions-table">
            <thead><tr><th>{s('p.version_col')}</th><th>{s('status')}</th><th>{s('p.model_version')}</th><th>{s('role.reviewer')}</th><th>{s('review_comment')}</th><th>{s('p.updated')}</th><th /></tr></thead>
            <tbody>
              {rows.map((v) => (
                <tr key={v.version}>
                  <td>v{v.version}</td>
                  <td><StatusBadge status={v.status} /></td>
                  <td>v{v.model_version}</td>
                  <td>{v.reviewer_id ?? '—'}</td>
                  <td>{v.review_comment ?? ''}</td>
                  <td>{fmtDate(v.updated_at)}</td>
                  <td><Link to={`/portal/cases/${encodeURIComponent(id)}/preview?version=${v.version}`}>{s('preview')}</Link></td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </Loading>
    </div>
  );
}
