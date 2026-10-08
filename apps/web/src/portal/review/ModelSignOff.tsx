import { useState } from 'react';
import type { ModelDef } from '@medsim/core';
import { api } from '../../shared/api';
import { useAuth } from '../../shared/auth';
import { usePrefs } from '../../shared/prefs';
import { errorText, useApi } from '../hooks';
import { ErrorBox, Loading } from '../ui';

/** Academic sign-off per model version (PRD §7 accuracy first, §11). */
export function ModelSignOff() {
  const { s, tx } = usePrefs();
  const { hasRole } = useAuth();
  const models = useApi<ModelDef[]>('/models');
  const [notes, setNotes] = useState<Record<string, string>>({});
  const [error, setError] = useState<string | null>(null);
  const canSign = hasRole('reviewer');

  const sign = async (m: ModelDef) => {
    setError(null);
    try {
      await api(`/models/${encodeURIComponent(m.id)}/sign-off`, { method: 'POST', json: { notes: notes[m.id] ?? '' } });
      models.reload();
    } catch (e) {
      setError(errorText(e));
    }
  };

  return (
    <div>
      <h1>{s('p.models')}</h1>
      <ErrorBox error={error || models.error} />
      <Loading when={models.loading && !models.data}>
        <table data-testid="models-table">
          <thead><tr><th>{s('model')}</th><th>{s('p.organ')}</th><th>{s('p.version_col')}</th><th>{s('p.structures')}</th><th>{s('p.variants')}</th><th>{s('p.sign_off')}</th>{canSign && <th />}</tr></thead>
          <tbody>
            {(models.data ?? []).map((m) => (
              <tr key={m.id} data-testid={`model-row-${m.id}`}>
                <td>{tx(m.name)} <code>{m.id}</code></td>
                <td>{m.organ}</td>
                <td>v{m.version}</td>
                <td>{m.structures.length}</td>
                <td>{m.variants.map((v) => tx(v.name)).join(', ')}</td>
                <td data-testid={`signoff-${m.id}`}>
                  {m.sign_off
                    ? <span className="portal-badge portal-badge-published">{s('p.signed_by', { who: m.sign_off.reviewer, date: m.sign_off.date.slice(0, 10) })}</span>
                    : <span className="portal-badge portal-badge-warn">{s('p.not_signed')}</span>}
                  {m.sign_off?.notes && <div className="muted">{m.sign_off.notes}</div>}
                </td>
                {canSign && (
                  <td>
                    <div className="row">
                      <input aria-label={s('p.notes')} placeholder={s('p.notes')} value={notes[m.id] ?? ''} onChange={(e) => setNotes({ ...notes, [m.id]: e.target.value })} />
                      <button type="button" data-testid={`sign-${m.id}`} onClick={() => void sign(m)}>{s('p.sign_off_action')}</button>
                    </div>
                  </td>
                )}
              </tr>
            ))}
          </tbody>
        </table>
      </Loading>
    </div>
  );
}
