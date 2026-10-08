import { useState } from 'react';
import type { Cohort, Course, CoursePackage, Org, Role, User } from '@medsim/core';
import { api, download } from '../../shared/api';
import { useAuth } from '../../shared/auth';
import { usePrefs } from '../../shared/prefs';
import { errorList, errorText, useApi } from '../hooks';
import { Empty, ErrorBox, Loading, Tabs } from '../ui';

export const ALL_ROLES: Role[] = ['student', 'author', 'reviewer', 'proctor', 'admin', 'superadmin'];
type Tab = 'users' | 'cohorts' | 'courses' | 'packages' | 'orgs';

/** Administration (R-07): users, roles, cohorts, courses + enrolments, course packages, organisations (Phase 3). */
export function AdminPage() {
  const { s } = usePrefs();
  const { user } = useAuth();
  const isSuper = !!user?.roles.includes('superadmin');
  const [tab, setTab] = useState<Tab>('users');
  const tabs: Array<{ key: Tab; label: string }> = [
    { key: 'users', label: s('users') },
    { key: 'cohorts', label: s('cohorts') },
    { key: 'courses', label: s('courses') },
    { key: 'packages', label: s('p.packages') },
    ...(isSuper ? [{ key: 'orgs' as Tab, label: s('p.organisations') }] : []),
  ];
  return (
    <div>
      <h1>{s('p.admin')}</h1>
      <Tabs<Tab> tabs={tabs} value={tab} onChange={setTab} label={s('p.admin')} />
      <div role="tabpanel" className="portal-tabpanel">
        {tab === 'users' && <UsersAdmin isSuper={isSuper} />}
        {tab === 'cohorts' && <CohortsAdmin />}
        {tab === 'courses' && <CoursesAdmin />}
        {tab === 'packages' && <PackagesAdmin />}
        {tab === 'orgs' && isSuper && <OrgsAdmin />}
      </div>
    </div>
  );
}

function RoleChecks({ value, onChange, isSuper, idPrefix }: { value: Role[]; onChange(r: Role[]): void; isSuper: boolean; idPrefix: string }) {
  const { s } = usePrefs();
  return (
    <span className="portal-checks-inline">
      {ALL_ROLES.filter((r) => isSuper || r !== 'superadmin').map((r) => (
        <label key={r}>
          <input type="checkbox" data-testid={`${idPrefix}-role-${r}`} checked={value.includes(r)} onChange={() => onChange(value.includes(r) ? value.filter((x) => x !== r) : [...value, r])} />
          {s(`role.${r}`)}
        </label>
      ))}
    </span>
  );
}

export function UsersAdmin({ isSuper }: { isSuper: boolean }) {
  const { s } = usePrefs();
  const users = useApi<User[]>('/users');
  const cohorts = useApi<Cohort[]>('/cohorts');
  const [form, setForm] = useState({ username: '', password: '', display_name: '', roles: ['student'] as Role[], cohort_id: '', lang: 'en' as 'en' | 'ar' });
  const [edits, setEdits] = useState<Record<string, { roles: Role[]; cohort_id: string }>>({});
  const [errors, setErrors] = useState<string[]>([]);
  const [msg, setMsg] = useState<string | null>(null);

  const create = async () => {
    setErrors([]); setMsg(null);
    if (!form.username.trim() || !form.password || !form.display_name.trim() || !form.roles.length) { setErrors([s('p.err_user_fields')]); return; }
    try {
      const body: Record<string, unknown> = { username: form.username.trim(), password: form.password, display_name: form.display_name.trim(), roles: form.roles, lang: form.lang };
      if (form.cohort_id) body.cohort_id = form.cohort_id;
      await api<User>('/users', { method: 'POST', json: body });
      setMsg(s('p.user_created', { name: form.username }));
      setForm({ ...form, username: '', password: '', display_name: '' });
      users.reload();
    } catch (e) { setErrors(errorList(e)); }
  };
  const saveEdit = async (u: User) => {
    const e = edits[u.id];
    if (!e) return;
    setErrors([]);
    try {
      await api<User>(`/users/${encodeURIComponent(u.id)}`, { method: 'PATCH', json: { roles: e.roles, cohort_id: e.cohort_id || undefined } });
      setEdits((x) => { const n = { ...x }; delete n[u.id]; return n; });
      users.reload();
    } catch (err) { setErrors(errorList(err)); }
  };

  return (
    <section>
      <div className="card portal-section">
        <h2>{s('p.new_user')}</h2>
        <div className="row">
          <label>{s('username')} <input data-testid="user-username" value={form.username} onChange={(e) => setForm({ ...form, username: e.target.value })} /></label>
          <label>{s('password')} <input data-testid="user-password" type="password" value={form.password} onChange={(e) => setForm({ ...form, password: e.target.value })} /></label>
          <label>{s('p.display_name')} <input data-testid="user-display" value={form.display_name} onChange={(e) => setForm({ ...form, display_name: e.target.value })} /></label>
          <label>{s('p.cohort')}{' '}
            <select data-testid="user-cohort" value={form.cohort_id} onChange={(e) => setForm({ ...form, cohort_id: e.target.value })}>
              <option value="">—</option>
              {(cohorts.data ?? []).map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}
            </select>
          </label>
          <label>{s('language')}{' '}
            <select value={form.lang} onChange={(e) => setForm({ ...form, lang: e.target.value as 'en' | 'ar' })}>
              <option value="en">{s('lang.en')}</option><option value="ar">{s('lang.ar')}</option>
            </select>
          </label>
        </div>
        <div className="row"><strong>{s('p.roles')}:</strong> <RoleChecks idPrefix="new" value={form.roles} onChange={(roles) => setForm({ ...form, roles })} isSuper={isSuper} /></div>
        <button type="button" className="primary" data-testid="create-user" onClick={() => void create()}>{s('p.create')}</button>
      </div>
      <ErrorBox errors={errors} />
      {msg && <p role="status" className="portal-ok">{msg}</p>}
      <ErrorBox error={users.error} />
      <Loading when={users.loading && !users.data}>
        <table data-testid="users-table">
          <thead><tr><th>{s('username')}</th><th>{s('p.display_name')}</th><th>{s('p.roles')}</th><th>{s('p.cohort')}</th><th /></tr></thead>
          <tbody>
            {(users.data ?? []).map((u) => {
              const e = edits[u.id];
              return (
                <tr key={u.id} data-testid={`user-row-${u.username}`}>
                  <td>{u.username}</td>
                  <td>{u.display_name}</td>
                  <td>{e
                    ? <RoleChecks idPrefix={`edit-${u.username}`} value={e.roles} onChange={(roles) => setEdits({ ...edits, [u.id]: { ...e, roles } })} isSuper={isSuper} />
                    : u.roles.map((r) => s(`role.${r}`)).join(', ')}</td>
                  <td>{e
                    ? (
                      <select aria-label={s('p.cohort')} value={e.cohort_id} onChange={(ev) => setEdits({ ...edits, [u.id]: { ...e, cohort_id: ev.target.value } })}>
                        <option value="">—</option>
                        {(cohorts.data ?? []).map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}
                      </select>
                    )
                    : cohorts.data?.find((c) => c.id === u.cohort_id)?.name ?? u.cohort_id ?? '—'}</td>
                  <td>{e
                    ? <><button type="button" className="primary" data-testid={`save-user-${u.username}`} onClick={() => void saveEdit(u)}>{s('save')}</button><button type="button" onClick={() => setEdits((x) => { const n = { ...x }; delete n[u.id]; return n; })}>{s('cancel')}</button></>
                    : <button type="button" data-testid={`edit-user-${u.username}`} onClick={() => setEdits({ ...edits, [u.id]: { roles: [...u.roles], cohort_id: u.cohort_id ?? '' } })}>{s('edit')}</button>}</td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </Loading>
    </section>
  );
}

export function CohortsAdmin() {
  const { s } = usePrefs();
  const cohorts = useApi<Cohort[]>('/cohorts');
  const [name, setName] = useState('');
  const [year, setYear] = useState(String(new Date().getFullYear()));
  const [errors, setErrors] = useState<string[]>([]);
  const create = async () => {
    setErrors([]);
    if (!name.trim() || !Number(year)) { setErrors([s('p.err_cohort_fields')]); return; }
    try {
      await api<Cohort>('/cohorts', { method: 'POST', json: { name: name.trim(), year: Number(year) } });
      setName('');
      cohorts.reload();
    } catch (e) { setErrors(errorList(e)); }
  };
  return (
    <section>
      <div className="card row portal-section">
        <label>{s('p.name')} <input data-testid="cohort-name" value={name} onChange={(e) => setName(e.target.value)} /></label>
        <label>{s('p.year')} <input data-testid="cohort-year" type="number" value={year} onChange={(e) => setYear(e.target.value)} style={{ width: '6em' }} /></label>
        <button type="button" className="primary" data-testid="create-cohort" onClick={() => void create()}>{s('p.create')}</button>
      </div>
      <ErrorBox errors={errors} />
      <ErrorBox error={cohorts.error} />
      <Loading when={cohorts.loading && !cohorts.data}>
        <Empty show={(cohorts.data ?? []).length === 0} />
        {(cohorts.data ?? []).length > 0 && (
          <table data-testid="cohorts-table">
            <thead><tr><th>{s('p.name')}</th><th>{s('p.year')}</th><th>ID</th></tr></thead>
            <tbody>{(cohorts.data ?? []).map((c) => <tr key={c.id}><td>{c.name}</td><td>{c.year}</td><td><code>{c.id}</code></td></tr>)}</tbody>
          </table>
        )}
      </Loading>
    </section>
  );
}

export function CoursesAdmin() {
  const { s } = usePrefs();
  const courses = useApi<Course[]>('/courses');
  const cohorts = useApi<Cohort[]>('/cohorts');
  const [code, setCode] = useState('');
  const [name, setName] = useState('');
  const [enrolSel, setEnrolSel] = useState<Record<string, string>>({});
  const [enrolTick, setEnrolTick] = useState(0);
  const [errors, setErrors] = useState<string[]>([]);
  const [msg, setMsg] = useState<string | null>(null);
  const create = async () => {
    setErrors([]); setMsg(null);
    if (!code.trim() || !name.trim()) { setErrors([s('p.err_course_fields')]); return; }
    try {
      await api<Course>('/courses', { method: 'POST', json: { code: code.trim(), name: name.trim() } });
      setCode(''); setName('');
      courses.reload();
    } catch (e) { setErrors(errorList(e)); }
  };
  const enrol = async (c: Course) => {
    const cohortId = enrolSel[c.id] || cohorts.data?.[0]?.id;
    if (!cohortId) return;
    setErrors([]); setMsg(null);
    try {
      await api(`/courses/${encodeURIComponent(c.id)}/enrol`, { method: 'POST', json: { cohort_id: cohortId } });
      setEnrolTick((t) => t + 1);
      setMsg(s('p.enrolled', { cohort: cohorts.data?.find((x) => x.id === cohortId)?.name ?? cohortId, course: c.code }));
    } catch (e) { setErrors(errorList(e)); }
  };
  return (
    <section>
      <div className="card row portal-section">
        <label>{s('p.code')} <input data-testid="course-code" value={code} onChange={(e) => setCode(e.target.value)} /></label>
        <label>{s('p.name')} <input data-testid="course-name" value={name} onChange={(e) => setName(e.target.value)} /></label>
        <button type="button" className="primary" data-testid="create-course" onClick={() => void create()}>{s('p.create')}</button>
      </div>
      <ErrorBox errors={errors} />
      {msg && <p role="status" className="portal-ok">{msg}</p>}
      <ErrorBox error={courses.error} />
      <Loading when={courses.loading && !courses.data}>
        <table data-testid="courses-table">
          <thead><tr><th>{s('p.code')}</th><th>{s('p.name')}</th><th>{s('p.enrolled_cohorts')}</th><th>{s('enrol')}</th></tr></thead>
          <tbody>
            {(courses.data ?? []).map((c) => (
              <tr key={c.id} data-testid={`course-row-${c.code}`}>
                <td>{c.code}</td>
                <td>{c.name}</td>
                <td><EnrolledCohorts key={`${c.id}-${enrolTick}`} courseId={c.id} cohorts={cohorts.data ?? []} /></td>
                <td className="row">
                  <select aria-label={s('p.cohort')} data-testid={`enrol-cohort-${c.code}`} value={enrolSel[c.id] ?? cohorts.data?.[0]?.id ?? ''} onChange={(e) => setEnrolSel({ ...enrolSel, [c.id]: e.target.value })}>
                    {(cohorts.data ?? []).map((co) => <option key={co.id} value={co.id}>{co.name}</option>)}
                  </select>
                  <button type="button" data-testid={`enrol-${c.code}`} onClick={() => void enrol(c)}>{s('enrol')}</button>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </Loading>
    </section>
  );
}

/** GET /api/courses/:id/enrolments — tolerant of cohort ids, cohort objects or {cohort_id} rows. */
function EnrolledCohorts({ courseId, cohorts }: { courseId: string; cohorts: Cohort[] }) {
  const res = useApi<unknown[]>(`/courses/${encodeURIComponent(courseId)}/enrolments`);
  const names = (res.data ?? []).map((e) => {
    const id = typeof e === 'string' ? e : (e as { cohort_id?: string; id?: string }).cohort_id ?? (e as { id?: string }).id ?? '';
    return cohorts.find((c) => c.id === id)?.name ?? (e as { name?: string }).name ?? id;
  });
  return <span data-testid={`enrolments-${courseId}`}>{res.error ? '—' : names.join(', ') || '—'}</span>;
}

/** Phase 3 / G4: export a course package and import it (e.g. into another tenant). */
export function PackagesAdmin() {
  const { s } = usePrefs();
  const courses = useApi<Course[]>('/courses');
  const [errors, setErrors] = useState<string[]>([]);
  const [msg, setMsg] = useState<string | null>(null);
  const [file, setFile] = useState<File | null>(null);

  const exportPkg = async (c: Course) => {
    setErrors([]);
    try { await download(`/courses/${encodeURIComponent(c.id)}/package`, `${c.code}.medsim-package.json`); }
    catch (e) { setErrors([errorText(e)]); }
  };
  const importPkg = async () => {
    if (!file) return;
    setErrors([]); setMsg(null);
    let pkg: CoursePackage;
    try {
      pkg = JSON.parse(await readText(file)) as CoursePackage;
      if (pkg.format !== 'medsim-course-package') throw new Error(s('p.err_not_package'));
    } catch (e) { setErrors([errorText(e)]); return; }
    try {
      const r = await api<{ course: Course; cases: number; errors?: unknown[] }>('/packages/import', { method: 'POST', json: pkg });
      setMsg(s('p.package_imported', { course: r.course.code, n: r.cases }));
      if (r.errors?.length) setErrors([s('p.package_errors'), ...r.errors.map((x) => (typeof x === 'string' ? x : JSON.stringify(x)))]);
      courses.reload();
    } catch (e) { setErrors(errorList(e)); }
  };

  return (
    <section>
      <div className="card portal-section">
        <h2>{s('p.export_package')}</h2>
        <ErrorBox error={courses.error} />
        <ul>
          {(courses.data ?? []).map((c) => (
            <li key={c.id} className="row">{c.code} — {c.name} <button type="button" data-testid={`export-pkg-${c.code}`} onClick={() => void exportPkg(c)}>{s('p.export')}</button></li>
          ))}
        </ul>
      </div>
      <div className="card portal-section">
        <h2>{s('p.import_package')}</h2>
        <div className="row">
          <input type="file" accept=".json,application/json" data-testid="import-pkg-file" onChange={(e) => setFile(e.target.files?.[0] ?? null)} />
          <button type="button" className="primary" data-testid="import-pkg" disabled={!file} onClick={() => void importPkg()}>{s('p.import')}</button>
        </div>
      </div>
      <ErrorBox errors={errors} />
      {msg && <p role="status" className="portal-ok">{msg}</p>}
    </section>
  );
}

function readText(f: File): Promise<string> {
  if (typeof f.text === 'function') return f.text();
  return new Promise((resolve, reject) => {
    const r = new FileReader();
    r.onload = () => resolve(String(r.result));
    r.onerror = () => reject(r.error);
    r.readAsText(f);
  });
}

export function OrgsAdmin() {
  const { s } = usePrefs();
  const orgs = useApi<Org[]>('/orgs');
  const [id, setId] = useState('');
  const [name, setName] = useState('');
  const [errors, setErrors] = useState<string[]>([]);
  const create = async () => {
    setErrors([]);
    if (!name.trim()) { setErrors([s('p.err_org_fields')]); return; }
    try {
      await api<Org>('/orgs', { method: 'POST', json: { ...(id.trim() ? { id: id.trim() } : {}), name: name.trim() } });
      setId(''); setName('');
      orgs.reload();
    } catch (e) { setErrors(errorList(e)); }
  };
  return (
    <section>
      <div className="card row portal-section">
        <label>ID <input data-testid="org-id" value={id} onChange={(e) => setId(e.target.value)} placeholder="uni-x" /></label>
        <label>{s('p.name')} <input data-testid="org-name" value={name} onChange={(e) => setName(e.target.value)} /></label>
        <button type="button" className="primary" data-testid="create-org" onClick={() => void create()}>{s('p.create')}</button>
      </div>
      <ErrorBox errors={errors} />
      <ErrorBox error={orgs.error} />
      <Loading when={orgs.loading && !orgs.data}>
        <table data-testid="orgs-table">
          <thead><tr><th>ID</th><th>{s('p.name')}</th></tr></thead>
          <tbody>{(orgs.data ?? []).map((o) => <tr key={o.id}><td><code>{o.id}</code></td><td>{o.name}</td></tr>)}</tbody>
        </table>
      </Loading>
    </section>
  );
}
