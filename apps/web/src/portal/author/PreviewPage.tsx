import { Link, useParams, useSearchParams } from 'react-router-dom';
import type { PlayerCase } from '@medsim/core';
import { usePrefs } from '../../shared/prefs';
import { CasePlayer } from '../../station/CasePlayer';
import { useApi } from '../hooks';
import { ErrorBox, Loading } from '../ui';

/** Fetch the keys-stripped player case for preview (A-04). */
export function usePreviewCase(id: string | undefined, version?: string | null) {
  const q = version ? `?version=${encodeURIComponent(version)}` : '';
  return useApi<PlayerCase>(id ? `/cases/${encodeURIComponent(id)}/preview${q}` : null);
}

/** Render a case exactly as a student sees it: labels off, no answer keys (A-04). */
export function CasePreview({ id, version }: { id: string; version?: string | null }) {
  const { s } = usePrefs();
  const pc = usePreviewCase(id, version);
  return (
    <div className="portal-preview" data-testid="case-preview">
      <ErrorBox error={pc.error} />
      <Loading when={pc.loading}>
        {pc.data && (
          <>
            <p className="muted">{s('p.preview_note')}</p>
            <CasePlayer playerCase={pc.data} mode="preview" onSubmit={() => undefined} />
          </>
        )}
      </Loading>
    </div>
  );
}

export function PreviewPage() {
  const { id } = useParams();
  const [params] = useSearchParams();
  const { s } = usePrefs();
  if (!id) return null;
  return (
    <div>
      <div className="row">
        <h1>{s('preview')}: <code>{id}</code>{params.get('version') ? ` (v${params.get('version')})` : ''}</h1>
        <Link to={`/portal/cases/${encodeURIComponent(id)}/edit`}>{s('back')}</Link>
      </div>
      <CasePreview id={id} version={params.get('version')} />
    </div>
  );
}
