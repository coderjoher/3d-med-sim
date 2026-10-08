/** Test helpers for portal unit tests: fetch mock router + full portal render. Not shipped in the app bundle. */
import { render } from '@testing-library/react';
import { MemoryRouter, Route, Routes } from 'react-router-dom';
import { vi } from 'vitest';
import type { ReactNode } from 'react';
import type { Course, ModelDef, Role, User } from '@medsim/core';
import { PrefsProvider } from '../shared/prefs';
import { AuthProvider } from '../shared/auth';
import { PortalApp } from './PortalApp';
import './strings';

export interface Call { method: string; path: string; url: string; body: unknown }
type Handler = (call: Call) => unknown;
export interface RouteSpec { method?: string; path: string | RegExp; reply: unknown | Handler; status?: number }

export const MODEL: ModelDef = {
  id: 'heart_v1',
  organ: 'heart',
  name: { en: 'Heart', ar: 'القلب' },
  version: 2,
  layers: [
    { id: 'pericardium', name: { en: 'Pericardium', ar: 'التامور' } },
    { id: 'chambers', name: { en: 'Chambers', ar: 'الحجرات' } },
    { id: 'valves', name: { en: 'Valves', ar: 'الصمامات' } },
  ],
  structures: [
    { id: 'TA:left_ventricle', name: { en: 'Left ventricle', ar: 'البطين الأيسر' }, layer: 'chambers' },
    { id: 'TA:right_atrium', name: { en: 'Right atrium', ar: 'الأذين الأيمن' }, layer: 'chambers' },
    { id: 'TA:mitral_valve', name: { en: 'Mitral valve', ar: 'الصمام التاجي' }, layer: 'valves' },
  ],
  variants: [
    { id: 'normal', name: { en: 'Normal', ar: 'طبيعي' }, pathological: false },
    { id: 'mitral_stenosis', name: { en: 'Mitral stenosis', ar: 'تضيق الصمام التاجي' }, pathological: true, affects: ['TA:mitral_valve'] },
  ],
};
export const COURSES: Course[] = [
  { id: 'c1', org_id: 'demo', code: 'ANAT2', name: 'Anatomy II' },
  { id: 'c2', org_id: 'demo', code: 'RENAL', name: 'Renal' },
];

export function user(roles: Role[], id = `u-${roles[0]}`): User {
  return { id, org_id: 'demo', username: id, display_name: `Test ${roles.join('+')}`, roles };
}

/** Install a fetch mock. Unmatched requests return 404 so tests notice. */
export function mockApi(routes: RouteSpec[]) {
  const calls: Call[] = [];
  const fetchMock = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
    const url = typeof input === 'string' ? input : input instanceof URL ? input.toString() : input.url;
    const method = (init?.method ?? 'GET').toUpperCase();
    const path = url.replace(/^https?:\/\/[^/]+/, '');
    let body: unknown = init?.body;
    if (typeof body === 'string') { try { body = JSON.parse(body); } catch { /* keep text */ } }
    const call: Call = { method, path, url, body };
    calls.push(call);
    const pathNoQuery = path.split('?')[0];
    const r = routes.find((rt) => (rt.method ?? 'GET').toUpperCase() === method && (typeof rt.path === 'string' ? rt.path === path || rt.path === pathNoQuery : rt.path.test(path)));
    if (!r) return new Response(JSON.stringify({ error: `unmocked ${method} ${path}` }), { status: 404, headers: { 'content-type': 'application/json' } });
    const payload = typeof r.reply === 'function' ? (r.reply as Handler)(call) : r.reply;
    if (payload instanceof Response) return payload;
    return new Response(JSON.stringify(payload ?? {}), { status: r.status ?? 200, headers: { 'content-type': 'application/json' } });
  });
  vi.stubGlobal('fetch', fetchMock);
  return {
    calls,
    fetchMock,
    find: (method: string, path: string | RegExp) => calls.filter((c) => c.method === method && (typeof path === 'string' ? c.path === path : path.test(c.path))),
  };
}

export function renderPortal(path: string, opts: { as?: User | null; routes?: RouteSpec[]; lang?: 'en' | 'ar' } = {}) {
  localStorage.clear();
  if (opts.lang) localStorage.setItem('medsim.prefs', JSON.stringify({ lang: opts.lang }));
  if (opts.as) localStorage.setItem('medsim.token', 'test-token');
  const api = mockApi([
    ...(opts.as ? [{ path: '/api/me', reply: opts.as }] : []),
    ...(opts.routes ?? []),
    { path: '/api/models', reply: [MODEL] },
    { path: '/api/courses', reply: COURSES },
  ]);
  const utils = render(
    <PrefsProvider>
      <AuthProvider>
        <MemoryRouter initialEntries={[path]}>
          <Routes>
            <Route path="/portal/*" element={<PortalApp />} />
          </Routes>
        </MemoryRouter>
      </AuthProvider>
    </PrefsProvider>,
  );
  return { ...utils, api };
}

/** Render an isolated component with prefs + router (no auth fetch). */
export function renderWithPrefs(ui: ReactNode, path = '/') {
  return render(
    <PrefsProvider>
      <MemoryRouter initialEntries={[path]}>{ui}</MemoryRouter>
    </PrefsProvider>,
  );
}
