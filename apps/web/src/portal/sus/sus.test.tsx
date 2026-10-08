import { describe, it, expect, vi, afterEach } from 'vitest';
import { cleanup, fireEvent, screen, waitFor } from '@testing-library/react';
import { mockApi, renderWithPrefs } from '../testUtils';
import { SusForm } from './SusForm';

/** The core engineer ships the 10 SUS items; until then fall back to a fixture so the form logic is still tested. */
vi.mock('@medsim/core', async (importOriginal) => {
  const orig = await importOriginal<typeof import('@medsim/core')>();
  const fixture = Array.from({ length: 10 }, (_, i) => ({ en: `Statement ${i + 1}`, ar: `العبارة ${i + 1}` }));
  return { ...orig, SUS_ITEMS: orig.SUS_ITEMS?.length === 10 ? orig.SUS_ITEMS : fixture };
});

afterEach(() => { cleanup(); vi.unstubAllGlobals(); localStorage.clear(); });

describe('SUS questionnaire', () => {
  it('[T2-10] bilingual SUS form: 10 Likert items, submit only when complete, POSTs answers + lang', async () => {
    const { SUS_ITEMS } = await import('@medsim/core');
    const api = mockApi([{ method: 'POST', path: '/api/sus', reply: { score: 72.5 } }]);
    const onDone = vi.fn();
    renderWithPrefs(<SusForm onDone={onDone} />);
    expect(screen.getAllByRole('group').length).toBeGreaterThanOrEqual(10);
    expect(screen.getByText(SUS_ITEMS[0].en)).toBeInTheDocument();
    const submit = screen.getByTestId('sus-submit');
    expect(submit).toBeDisabled();
    const values = [5, 1, 4, 2, 5, 1, 4, 2, 5, 1];
    values.forEach((v, i) => fireEvent.click(screen.getByTestId(`sus-${i}-${v}`)));
    expect(submit).toBeEnabled();
    fireEvent.click(submit);
    await waitFor(() => expect(onDone).toHaveBeenCalledWith(72.5));
    expect(api.find('POST', '/api/sus')[0].body).toEqual({ answers: values, lang: 'en' });
    expect(screen.getByTestId('sus-done')).toHaveTextContent('72.5');
  });

  it('[T2-10] SUS form renders Arabic statements and posts lang "ar"', async () => {
    const { SUS_ITEMS } = await import('@medsim/core');
    localStorage.setItem('medsim.prefs', JSON.stringify({ lang: 'ar' }));
    const api = mockApi([{ method: 'POST', path: '/api/sus', reply: { score: 50 } }]);
    renderWithPrefs(<SusForm />);
    expect(screen.getByText(SUS_ITEMS[3].ar)).toBeInTheDocument();
    expect(screen.getByText('استبيان سهولة الاستخدام')).toBeInTheDocument();
    for (let i = 0; i < 10; i++) fireEvent.click(screen.getByTestId(`sus-${i}-3`));
    fireEvent.click(screen.getByTestId('sus-submit'));
    await waitFor(() => expect(api.find('POST', '/api/sus')).toHaveLength(1));
    expect(api.find('POST', '/api/sus')[0].body).toEqual({ answers: Array(10).fill(3), lang: 'ar' });
  });
});
