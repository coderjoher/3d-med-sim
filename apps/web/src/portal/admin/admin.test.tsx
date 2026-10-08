import { describe, it, expect, vi, afterEach } from 'vitest';
import { cleanup, fireEvent, screen, waitFor } from '@testing-library/react';
import type { CoursePackage, User } from '@medsim/core';
import { renderPortal, user, MODEL } from '../testUtils';

vi.mock('../../viewer/ModelViewer', async () => ({ ModelViewer: (await import('../testMocks')).MockModelViewer }));
vi.mock('../../viewer/ComparisonView', async () => ({ ComparisonView: (await import('../testMocks')).MockComparisonView }));
vi.mock('../../station/CasePlayer', async () => ({ CasePlayer: (await import('../testMocks')).MockCasePlayer }));

afterEach(() => { cleanup(); vi.unstubAllGlobals(); vi.restoreAllMocks(); });

const ADMIN = user(['admin'], 'admin');
const COHORTS = [{ id: 'co1', org_id: 'demo', name: 'Class of 2028', year: 2026 }, { id: 'co2', org_id: 'demo', name: 'Class of 2029', year: 2027 }];
const STUDENT: User = { id: 'u-s1', org_id: 'demo', username: 'student1', display_name: 'Student One', roles: ['student'], cohort_id: 'co1' };
const tab = (name: RegExp) => fireEvent.click(screen.getByRole('tab', { name }));

describe('admin', () => {
  it('[T1-02] admin creates a user with roles and cohort, and edits roles', async () => {
    const r = renderPortal('/portal/admin', {
      as: ADMIN,
      routes: [
        { path: '/api/users', reply: [STUDENT] },
        { path: '/api/cohorts', reply: COHORTS },
        { method: 'POST', path: '/api/users', reply: ({ body }) => ({ id: 'new', org_id: 'demo', ...(body as object) }) },
        { method: 'PATCH', path: '/api/users/u-s1', reply: { ...STUDENT, roles: ['student', 'proctor'] } },
      ],
    });
    fireEvent.change(await screen.findByTestId('user-username'), { target: { value: 'author9' } });
    fireEvent.change(screen.getByTestId('user-password'), { target: { value: 'pw123456' } });
    fireEvent.change(screen.getByTestId('user-display'), { target: { value: 'Dr Nine' } });
    fireEvent.click(screen.getByTestId('new-role-student')); // untick default
    fireEvent.click(screen.getByTestId('new-role-author'));
    fireEvent.click(screen.getByTestId('new-role-reviewer'));
    await screen.findByText('Class of 2029');
    fireEvent.change(screen.getByTestId('user-cohort'), { target: { value: 'co2' } });
    expect(screen.queryByTestId('new-role-superadmin')).toBeNull();
    fireEvent.click(screen.getByTestId('create-user'));
    await waitFor(() => expect(r.api.find('POST', '/api/users')).toHaveLength(1));
    expect(r.api.find('POST', '/api/users')[0].body).toEqual({ username: 'author9', password: 'pw123456', display_name: 'Dr Nine', roles: ['author', 'reviewer'], cohort_id: 'co2', lang: 'en' });

    fireEvent.click(await screen.findByTestId('edit-user-student1'));
    fireEvent.click(screen.getByTestId('edit-student1-role-proctor'));
    fireEvent.click(screen.getByTestId('save-user-student1'));
    await waitFor(() => expect(r.api.find('PATCH', '/api/users/u-s1')).toHaveLength(1));
    expect(r.api.find('PATCH', '/api/users/u-s1')[0].body).toEqual({ roles: ['student', 'proctor'], cohort_id: 'co1' });
  });

  it('[T1-02] admin manages cohorts, courses and enrolments', async () => {
    let enrolled = false;
    const r = renderPortal('/portal/admin', {
      as: ADMIN,
      routes: [
        { path: '/api/users', reply: [] },
        { path: '/api/cohorts', reply: COHORTS },
        { method: 'POST', path: '/api/cohorts', reply: { id: 'co3', org_id: 'demo', name: 'Class of 2030', year: 2028 } },
        { method: 'POST', path: '/api/courses', reply: { id: 'c9', org_id: 'demo', code: 'NEURO', name: 'Neuro' } },
        { method: 'POST', path: '/api/courses/c2/enrol', reply: () => { enrolled = true; return {}; } },
        { path: '/api/courses/c2/enrolments', reply: () => (enrolled ? [{ cohort_id: 'co2' }] : []) },
      ],
    });
    await screen.findByTestId('users-table');
    tab(/Cohorts/);
    fireEvent.change(await screen.findByTestId('cohort-name'), { target: { value: 'Class of 2030' } });
    fireEvent.change(screen.getByTestId('cohort-year'), { target: { value: '2028' } });
    fireEvent.click(screen.getByTestId('create-cohort'));
    await waitFor(() => expect(r.api.find('POST', '/api/cohorts')[0]?.body).toEqual({ name: 'Class of 2030', year: 2028 }));

    tab(/Courses/);
    fireEvent.change(await screen.findByTestId('course-code'), { target: { value: 'NEURO' } });
    fireEvent.change(screen.getByTestId('course-name'), { target: { value: 'Neuro' } });
    fireEvent.click(screen.getByTestId('create-course'));
    await waitFor(() => expect(r.api.find('POST', '/api/courses')[0]?.body).toEqual({ code: 'NEURO', name: 'Neuro' }));
    await screen.findByTestId('course-row-RENAL');
    fireEvent.change(screen.getByTestId('enrol-cohort-RENAL'), { target: { value: 'co2' } });
    fireEvent.click(screen.getByTestId('enrol-RENAL'));
    await waitFor(() => expect(r.api.find('POST', '/api/courses/c2/enrol')[0]?.body).toEqual({ cohort_id: 'co2' }));
    expect(await screen.findByRole('status')).toHaveTextContent('Class of 2029 enrolled in RENAL');
    await waitFor(() => expect(screen.getByTestId('enrolments-c2')).toHaveTextContent('Class of 2029'));
  });

  it('[T3-02] course package export downloads GET /courses/:id/package; import POSTs the package JSON', async () => {
    Object.assign(URL, { createObjectURL: vi.fn(() => 'blob:mock'), revokeObjectURL: vi.fn() });
    vi.spyOn(HTMLAnchorElement.prototype, 'click').mockImplementation(() => undefined);
    const pkg: CoursePackage = { format: 'medsim-course-package', version: 1, course: { code: 'ANAT2', name: 'Anatomy II' }, models: [MODEL], cases: [], exported_at: '2026-10-08T00:00:00Z' };
    const r = renderPortal('/portal/admin', {
      as: ADMIN,
      routes: [
        { path: '/api/users', reply: [] },
        { path: '/api/cohorts', reply: [] },
        { path: '/api/courses/c1/package', reply: pkg },
        { method: 'POST', path: '/api/packages/import', reply: { course: { id: 'c7', org_id: 'other', code: 'ANAT2', name: 'Anatomy II' }, cases: 3 } },
      ],
    });
    await screen.findByTestId('users-table');
    tab(/Course packages/);
    fireEvent.click(await screen.findByTestId('export-pkg-ANAT2'));
    await waitFor(() => expect(r.api.find('GET', '/api/courses/c1/package')).toHaveLength(1));
    await waitFor(() => expect(HTMLAnchorElement.prototype.click).toHaveBeenCalled());

    const file = new File([JSON.stringify(pkg)], 'ANAT2.medsim-package.json', { type: 'application/json' });
    fireEvent.change(screen.getByTestId('import-pkg-file'), { target: { files: [file] } });
    fireEvent.click(screen.getByTestId('import-pkg'));
    await waitFor(() => expect(r.api.find('POST', '/api/packages/import')).toHaveLength(1));
    expect(r.api.find('POST', '/api/packages/import')[0].body).toEqual(pkg);
    expect(await screen.findByRole('status')).toHaveTextContent('Imported course ANAT2 with 3 case(s).');
  });

  it('[T3-01] organisations tab is only offered to the superadmin, who can list and create orgs', async () => {
    renderPortal('/portal/admin', { as: ADMIN, routes: [{ path: '/api/users', reply: [] }, { path: '/api/cohorts', reply: [] }] });
    await screen.findByTestId('users-table');
    expect(screen.queryByRole('tab', { name: /Organisations/ })).toBeNull();
    cleanup();
    const r = renderPortal('/portal/admin', {
      as: user(['superadmin'], 'superadmin'),
      routes: [
        { path: '/api/users', reply: [] }, { path: '/api/cohorts', reply: [] },
        { path: '/api/orgs', reply: [{ id: 'demo', name: 'Demo University' }] },
        { method: 'POST', path: '/api/orgs', reply: { id: 'uni-b', name: 'Uni B' } },
      ],
    });
    await screen.findByTestId('users-table');
    tab(/Organisations/);
    expect(await screen.findByText('Demo University')).toBeInTheDocument();
    fireEvent.change(screen.getByTestId('org-id'), { target: { value: 'uni-b' } });
    fireEvent.change(screen.getByTestId('org-name'), { target: { value: 'Uni B' } });
    fireEvent.click(screen.getByTestId('create-org'));
    await waitFor(() => expect(r.api.find('POST', '/api/orgs')[0]?.body).toEqual({ id: 'uni-b', name: 'Uni B' }));
  });
});
