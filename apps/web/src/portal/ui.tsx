import type { ReactNode } from 'react';
import type { CaseStatus } from '@medsim/core';
import { usePrefs } from '../shared/prefs';
import type { Bi } from './author/caseForm';

/** Paired English / Arabic input (A-07). The Arabic box is always RTL. */
export function BiField({ label, value, onChange, testId, multiline }: { label: string; value: Bi; onChange(v: Bi): void; testId?: string; multiline?: boolean }) {
  const Tag = multiline ? 'textarea' : 'input';
  return (
    <div className="portal-bi">
      <span className="portal-bi-label">{label}</span>
      <label className="portal-bi-half">
        <span className="muted">EN</span>
        <Tag data-testid={testId ? `${testId}-en` : undefined} aria-label={`${label} (English)`} lang="en" dir="ltr" value={value.en} onChange={(e: { target: { value: string } }) => onChange({ ...value, en: e.target.value })} rows={multiline ? 2 : undefined} />
      </label>
      <label className="portal-bi-half">
        <span className="muted">AR</span>
        <Tag data-testid={testId ? `${testId}-ar` : undefined} aria-label={`${label} (العربية)`} lang="ar" dir="rtl" value={value.ar} onChange={(e: { target: { value: string } }) => onChange({ ...value, ar: e.target.value })} rows={multiline ? 2 : undefined} />
      </label>
    </div>
  );
}

export function StatusBadge({ status }: { status: CaseStatus }) {
  const { s } = usePrefs();
  return <span className={`portal-badge portal-badge-${status}`} data-testid="status-badge">{s(`status.${status}`)}</span>;
}

export function ErrorBox({ error, errors }: { error?: string | null; errors?: string[] }) {
  const list = errors?.length ? errors : error ? [error] : [];
  if (!list.length) return null;
  return (
    <div role="alert" className="portal-alert error">
      {list.length === 1 ? list[0] : <ul>{list.map((e, i) => <li key={i}>{e}</li>)}</ul>}
    </div>
  );
}

export function Loading({ when, children }: { when: boolean; children?: ReactNode }) {
  const { s } = usePrefs();
  return when ? <p className="muted">{s('loading')}</p> : <>{children}</>;
}

export function Empty({ show }: { show: boolean }) {
  const { s } = usePrefs();
  return show ? <p className="muted">{s('no_data')}</p> : null;
}

export function Tabs<K extends string>({ tabs, value, onChange, label }: { tabs: Array<{ key: K; label: string }>; value: K; onChange(k: K): void; label: string }) {
  return (
    <div role="tablist" aria-label={label} className="portal-tabs">
      {tabs.map((t) => (
        <button key={t.key} role="tab" type="button" aria-selected={value === t.key} className={value === t.key ? 'primary' : ''} onClick={() => onChange(t.key)}>
          {t.label}
        </button>
      ))}
    </div>
  );
}
