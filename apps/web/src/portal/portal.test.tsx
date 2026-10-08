import { describe, it, expect, vi, afterEach } from 'vitest';
import { cleanup, fireEvent, screen, waitFor, within } from '@testing-library/react';
import { UI_STRINGS } from '@medsim/core';
import { renderPortal, user } from './testUtils';
import { PORTAL_STRINGS } from './strings';

vi.mock('../viewer/ModelViewer', async () => ({ ModelViewer: (await import('./testMocks')).MockModelViewer }));
vi.mock('../viewer/ComparisonView', async () => ({ ComparisonView: (await import('./testMocks')).MockComparisonView }));
vi.mock('../station/CasePlayer', async () => ({ CasePlayer: (await import('./testMocks')).MockCasePlayer }));

afterEach(() => { cleanup(); vi.unstubAllGlobals(); document.documentElement.dir = 'ltr'; });

describe('portal shell', () => {
  it('[T1-01] unauthenticated users are sent to login; login stores the token and shows role-aware navigation', async () => {
    const r = renderPortal('/portal/cases', {
      as: null,
      routes: [
        { method: 'POST', path: '/api/auth/login', reply: ({ body }) => (body as { password: string }).password === 'author123' ? { token: 'tok', user: user(['author'], 'author1') } : new Response(JSON.stringify({ error: 'Invalid credentials' }), { status: 401, headers: { 'content-type': 'application/json' } }) },
        { path: '/api/cases', reply: [] },
      ],
    });
    fireEvent.change(await screen.findByTestId('login-username'), { target: { value: 'author1' } });
    fireEvent.change(screen.getByTestId('login-password'), { target: { value: 'wrong' } });
    fireEvent.click(screen.getByTestId('login-submit'));
    expect(await screen.findByTestId('login-error')).toHaveTextContent('Invalid username or password');
    fireEvent.change(screen.getByTestId('login-password'), { target: { value: 'author123' } });
    fireEvent.click(screen.getByTestId('login-submit'));
    const nav = await screen.findByTestId('portal-nav');
    expect(localStorage.getItem('medsim.token')).toBe('tok');
    expect(r.api.find('POST', '/api/auth/login')[1].body).toEqual({ username: 'author1', password: 'author123' });
    // returned to the page originally requested
    expect(await screen.findByTestId('cases-drafts')).toBeInTheDocument();
    expect(within(nav).getByTestId('nav-cases')).toBeInTheDocument();
    expect(within(nav).queryByTestId('nav-admin')).toBeNull();
    expect(within(nav).queryByTestId('nav-sessions')).toBeNull();
  });

  it('[T1-01] role guard: a proctor cannot open the admin page; nav differs per role', async () => {
    renderPortal('/portal/admin', { as: user(['proctor'], 'proctor1'), routes: [{ path: '/api/sessions', reply: [] }] });
    expect(await screen.findByTestId('forbidden')).toBeInTheDocument();
    const nav = screen.getByTestId('portal-nav');
    expect(within(nav).getByTestId('nav-sessions')).toBeInTheDocument();
    expect(within(nav).getByTestId('nav-reports')).toBeInTheDocument();
    expect(within(nav).queryByTestId('nav-cases')).toBeNull();
    expect(within(nav).queryByTestId('nav-admin')).toBeNull();
  });

  it('[T1-16] switching to Arabic renders the portal RTL with Arabic UI text', async () => {
    renderPortal('/portal', { as: user(['admin'], 'admin') });
    const nav = await screen.findByTestId('portal-nav');
    expect(within(nav).getByText('Reports')).toBeInTheDocument();
    fireEvent.change(screen.getByTestId('lang-select'), { target: { value: 'ar' } });
    await waitFor(() => expect(document.documentElement.dir).toBe('rtl'));
    expect(document.documentElement.lang).toBe('ar');
    expect(screen.getByTestId('portal-root')).toHaveAttribute('dir', 'rtl');
    expect(within(nav).getByText('التقارير')).toBeInTheDocument();
    expect(within(nav).getByText('الإدارة')).toBeInTheDocument();
    expect(screen.getByTestId('logout')).toHaveTextContent('تسجيل الخروج');
  });

  it('[T1-16] Arabic login page is RTL', async () => {
    renderPortal('/portal/login', { as: null, lang: 'ar' });
    expect(await screen.findByTestId('login-submit')).toHaveTextContent('تسجيل الدخول');
    expect(screen.getByTestId('portal-root')).toHaveAttribute('dir', 'rtl');
  });

  it('[T1-16] every portal UI string used in the source has English and Arabic text', () => {
    const sources = import.meta.glob('./**/*.tsx', { query: '?raw', import: 'default', eager: true }) as Record<string, string>;
    const used = new Set<string>();
    for (const [file, src] of Object.entries(sources)) {
      if (file.includes('.test.')) continue;
      for (const m of src.matchAll(/\bs\('([a-z0-9_.-]+)'/gi)) used.add(m[1]);
      for (const m of src.matchAll(/label: '([a-z0-9_.-]+)'/gi)) used.add(m[1]);
    }
    expect(used.size).toBeGreaterThan(100);
    const missing = [...used].filter((k) => !UI_STRINGS[k]?.en || !UI_STRINGS[k]?.ar);
    expect(missing).toEqual([]);
    for (const [k, v] of Object.entries(PORTAL_STRINGS)) {
      expect(v.en, k).toBeTruthy();
      expect(v.ar, k).toMatch(/[؀-ۿ]/);
    }
  });

  it('[T1-18] text size and colour-blind palette controls update the document', async () => {
    renderPortal('/portal', { as: user(['admin'], 'admin') });
    await screen.findByTestId('portal-nav');
    expect(screen.getByTestId('text-scale')).toHaveTextContent('100%');
    fireEvent.click(screen.getByTestId('text-larger'));
    fireEvent.click(screen.getByTestId('text-larger'));
    expect(screen.getByTestId('text-scale')).toHaveTextContent('130%');
    await waitFor(() => expect(document.documentElement.style.getPropertyValue('--text-scale')).toBe('1.3'));
    fireEvent.click(screen.getByTestId('palette-toggle'));
    await waitFor(() => expect(document.documentElement.dataset.palette).toBe('cb'));
  });
});
