import { useState, type ReactNode } from 'react';
import { Link, Navigate, NavLink, Route, Routes, useLocation, useNavigate } from 'react-router-dom';
import { isRtl, type Role } from '@medsim/core';
import { useAuth } from '../shared/auth';
import { usePrefs } from '../shared/prefs';
import { errorText } from './hooks';
import './strings';
import './portal.css';
import { CaseList } from './author/CaseList';
import { CaseEditor } from './author/CaseEditor';
import { PreviewPage } from './author/PreviewPage';
import { VersionHistory } from './author/VersionHistory';
import { ImportCases } from './author/ImportCases';
import { ReviewCase, ReviewQueue } from './review/ReviewQueue';
import { ModelSignOff } from './review/ModelSignOff';
import { SessionConsole, SessionsPage } from './proctor/ProctorConsole';
import { ReportsPage } from './reports/ReportsPage';
import { GradingQueue } from './reports/GradingQueue';
import { AdminPage } from './admin/AdminPage';
import { SusForm } from './sus/SusForm';
import { ComparePage } from './compare/ComparePage';

/** Which roles may open each portal area (server enforces the same on every route, T1-01). */
export const AREA_ROLES = {
  cases: ['author'],
  review: ['reviewer'],
  models: ['author', 'reviewer'],
  compare: ['author', 'reviewer'],
  sessions: ['proctor', 'admin'],
  reports: ['author', 'reviewer', 'proctor', 'admin'],
  grading: ['author', 'reviewer', 'proctor'],
  admin: ['admin'],
} satisfies Record<string, Role[]>;
type Area = keyof typeof AREA_ROLES;

const NAV: Array<{ area: Area; to: string; label: string }> = [
  { area: 'cases', to: 'cases', label: 'cases' },
  { area: 'review', to: 'review', label: 'p.review_queue' },
  { area: 'models', to: 'models', label: 'p.models' },
  { area: 'compare', to: 'compare', label: 'compare' },
  { area: 'sessions', to: 'sessions', label: 'sessions' },
  { area: 'reports', to: 'reports', label: 'reports' },
  { area: 'grading', to: 'grading', label: 'grading' },
  { area: 'admin', to: 'admin', label: 'p.admin' },
];

/** Staff portal: authoring, review, proctor console, reports, admin (PRD §6, §8, §9.4, §9.5). Mounted at /portal/*. */
export function PortalApp() {
  const { user, loading } = useAuth();
  const { lang, s } = usePrefs();
  const dir = isRtl(lang) ? 'rtl' : 'ltr';
  return (
    <div className="portal" dir={dir} lang={lang} data-testid="portal-root">
      {loading ? <p className="muted portal-main">{s('loading')}</p> : (
        <Routes>
          <Route path="login" element={user ? <Navigate to="/portal" replace /> : <LoginPage />} />
          <Route path="*" element={user ? <PortalLayout /> : <LoginRedirect />} />
        </Routes>
      )}
    </div>
  );
}

function LoginRedirect() {
  const location = useLocation();
  return <Navigate to="/portal/login" replace state={{ from: location.pathname + location.search }} />;
}

function Guard({ area, children }: { area: Area; children: ReactNode }) {
  const { hasRole } = useAuth();
  const { s } = usePrefs();
  if (!hasRole(...AREA_ROLES[area])) return <p role="alert" className="error" data-testid="forbidden">{s('p.forbidden')}</p>;
  return <>{children}</>;
}

function PortalLayout() {
  const { user, logout, hasRole } = useAuth();
  const { s } = usePrefs();
  const navigate = useNavigate();
  return (
    <>
      <header className="portal-header">
        <Link to="/portal" className="portal-brand">{s('app.title')}</Link>
        <nav aria-label={s('p.main_nav')} className="portal-nav" data-testid="portal-nav">
          {NAV.filter((n) => hasRole(...AREA_ROLES[n.area])).map((n) => (
            <NavLink key={n.to} to={`/portal/${n.to}`} data-testid={`nav-${n.to}`}>{s(n.label)}</NavLink>
          ))}
          <NavLink to="/portal/sus" data-testid="nav-sus">{s('p.sus_short')}</NavLink>
        </nav>
        <PrefsBar />
        <span className="portal-user" data-testid="portal-user">{user?.display_name} <span className="muted">({user?.roles.map((r) => s(`role.${r}`)).join(', ')})</span></span>
        <button type="button" data-testid="logout" onClick={() => { logout(); navigate('/portal/login'); }}>{s('logout')}</button>
      </header>
      <main className="portal-main">
        <Routes>
          <Route index element={<Home />} />
          <Route path="cases" element={<Guard area="cases"><CaseList /></Guard>} />
          <Route path="cases/new" element={<Guard area="cases"><CaseEditor /></Guard>} />
          <Route path="cases/import" element={<Guard area="cases"><ImportCases /></Guard>} />
          <Route path="cases/:id/edit" element={<Guard area="cases"><CaseEditor /></Guard>} />
          <Route path="cases/:id/preview" element={<Guard area="models"><PreviewPage /></Guard>} />
          <Route path="cases/:id/versions" element={<Guard area="models"><VersionHistory /></Guard>} />
          <Route path="review" element={<Guard area="review"><ReviewQueue /></Guard>} />
          <Route path="review/:id" element={<Guard area="review"><ReviewCase /></Guard>} />
          <Route path="models" element={<Guard area="models"><ModelSignOff /></Guard>} />
          <Route path="compare" element={<Guard area="compare"><ComparePage /></Guard>} />
          <Route path="sessions" element={<Guard area="sessions"><SessionsPage /></Guard>} />
          <Route path="sessions/:id" element={<Guard area="sessions"><SessionConsole /></Guard>} />
          <Route path="reports" element={<Guard area="reports"><ReportsPage /></Guard>} />
          <Route path="grading" element={<Guard area="grading"><GradingQueue /></Guard>} />
          <Route path="admin" element={<Guard area="admin"><AdminPage /></Guard>} />
          <Route path="sus" element={<SusPage />} />
          <Route path="*" element={<Navigate to="/portal" replace />} />
        </Routes>
      </main>
    </>
  );
}

/** Language (EN/AR, RTL) and text-size / palette controls (NFR localization & accessibility). */
export function PrefsBar() {
  const { s, lang, textScale, highContrastPalette, set } = usePrefs();
  const step = (d: number) => set({ textScale: Math.round(Math.min(1.6, Math.max(0.85, textScale + d)) * 100) / 100 });
  return (
    <div className="portal-prefs row" role="group" aria-label={s('settings')}>
      <label>
        <span className="portal-sr">{s('language')}</span>
        <select data-testid="lang-select" aria-label={s('language')} value={lang} onChange={(e) => set({ lang: e.target.value as 'en' | 'ar' })}>
          <option value="en">English</option>
          <option value="ar">العربية</option>
        </select>
      </label>
      <span role="group" aria-label={s('text_size')} className="row">
        <button type="button" data-testid="text-smaller" aria-label={s('p.text_smaller')} onClick={() => step(-0.15)} disabled={textScale <= 0.85}>A−</button>
        <span className="muted" data-testid="text-scale">{Math.round(textScale * 100)}%</span>
        <button type="button" data-testid="text-larger" aria-label={s('p.text_larger')} onClick={() => step(0.15)} disabled={textScale >= 1.6}>A+</button>
      </span>
      <label title={s('high_contrast')}>
        <input type="checkbox" data-testid="palette-toggle" checked={highContrastPalette} onChange={(e) => set({ highContrastPalette: e.target.checked })} /> <span className="portal-sr-sm">{s('p.cb_palette_short')}</span>
      </label>
    </div>
  );
}

function LoginPage() {
  const { login } = useAuth();
  const { s } = usePrefs();
  const navigate = useNavigate();
  const location = useLocation();
  const [username, setUsername] = useState('');
  const [password, setPassword] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const submit = async () => {
    setBusy(true); setError(null);
    try {
      await login(username.trim(), password);
      const from = (location.state as { from?: string } | null)?.from;
      navigate(from || '/portal', { replace: true });
    } catch (e) {
      const msg = errorText(e);
      setError(/401|invalid|unauthor/i.test(msg) ? s('login_failed') : `${s('login_failed')} (${msg})`);
    } finally {
      setBusy(false);
    }
  };
  return (
    <main className="portal-login">
      <div className="row portal-login-prefs"><PrefsBar /></div>
      <form className="card" aria-label={s('login')} onSubmit={(e) => { e.preventDefault(); void submit(); }}>
        <h1>{s('app.title')}</h1>
        <p className="muted">{s('p.portal_subtitle')}</p>
        <label>{s('username')}<input data-testid="login-username" autoComplete="username" value={username} onChange={(e) => setUsername(e.target.value)} required /></label>
        <label>{s('password')}<input data-testid="login-password" type="password" autoComplete="current-password" value={password} onChange={(e) => setPassword(e.target.value)} required /></label>
        {error && <p role="alert" className="error" data-testid="login-error">{error}</p>}
        <button type="submit" className="primary" data-testid="login-submit" disabled={busy}>{s('login')}</button>
      </form>
    </main>
  );
}

function Home() {
  const { user, hasRole } = useAuth();
  const { s } = usePrefs();
  const tiles: Array<{ area: Area; to: string; title: string; text: string }> = [
    { area: 'cases', to: 'cases', title: s('cases'), text: s('p.home.cases') },
    { area: 'review', to: 'review', title: s('p.review_queue'), text: s('p.home.review') },
    { area: 'sessions', to: 'sessions', title: s('sessions'), text: s('p.home.sessions') },
    { area: 'reports', to: 'reports', title: s('reports'), text: s('p.home.reports') },
    { area: 'grading', to: 'grading', title: s('grading'), text: s('p.home.grading') },
    { area: 'admin', to: 'admin', title: s('p.admin'), text: s('p.home.admin') },
  ];
  const visible = tiles.filter((t) => hasRole(...AREA_ROLES[t.area]));
  return (
    <div>
      <h1>{s('welcome', { name: user?.display_name ?? '' })}</h1>
      {visible.length === 0 && <p className="muted">{s('p.home.student')}</p>}
      <div className="portal-tiles">
        {visible.map((t) => (
          <Link key={t.to} to={`/portal/${t.to}`} className="card portal-tile portal-tile-link">
            <strong>{t.title}</strong>
            <span className="muted">{t.text}</span>
          </Link>
        ))}
      </div>
    </div>
  );
}

function SusPage() {
  const navigate = useNavigate();
  const { s } = usePrefs();
  const [done, setDone] = useState(false);
  return (
    <div>
      <SusForm onDone={() => setDone(true)} />
      {done && <button type="button" onClick={() => navigate('/portal')}>{s('finish')}</button>}
    </div>
  );
}
