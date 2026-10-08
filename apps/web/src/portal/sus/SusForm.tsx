import { useState } from 'react';
import { SUS_ITEMS } from '@medsim/core';
import { api } from '../../shared/api';
import { usePrefs } from '../../shared/prefs';
import { errorText } from '../hooks';
import '../strings';

/**
 * Bilingual System Usability Scale questionnaire (§17, T2-10). 10 items, 1–5 Likert, POST /api/sus.
 * Self-contained (no router) so the station can embed it after a session.
 */
export function SusForm({ onDone }: { onDone?(score: number): void }) {
  const { s, lang } = usePrefs();
  const [answers, setAnswers] = useState<Array<number | null>>(() => SUS_ITEMS.map(() => null));
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [score, setScore] = useState<number | null>(null);
  const complete = answers.length > 0 && answers.every((a) => a !== null);

  const submit = async () => {
    if (!complete) return;
    setBusy(true); setError(null);
    try {
      const r = await api<{ score: number }>('/sus', { method: 'POST', json: { answers, lang } });
      setScore(r.score);
      onDone?.(r.score);
    } catch (e) {
      setError(errorText(e));
    } finally {
      setBusy(false);
    }
  };

  if (score !== null) {
    return (
      <div className="portal-sus card" role="status" data-testid="sus-done">
        <h2>{s('thank_you')}</h2>
        <p>{s('p.sus_score', { score: score.toFixed(1) })}</p>
      </div>
    );
  }

  return (
    <form className="portal-sus card" data-testid="sus-form" onSubmit={(e) => { e.preventDefault(); void submit(); }}>
      <h2>{s('sus_title')}</h2>
      <p className="muted">{s('p.sus_intro')}</p>
      <ol className="portal-sus-items">
        {SUS_ITEMS.map((item, i) => (
          <li key={i}>
            <fieldset>
              <legend>{lang === 'ar' ? item.ar : item.en}</legend>
              <div className="row portal-likert">
                <span className="muted">{s('sus.disagree')}</span>
                {[1, 2, 3, 4, 5].map((v) => (
                  <label key={v} className="portal-likert-option">
                    <input type="radio" name={`sus-${i}`} value={v} data-testid={`sus-${i}-${v}`} checked={answers[i] === v} onChange={() => setAnswers((a) => a.map((x, j) => (j === i ? v : x)))} />
                    {v}
                  </label>
                ))}
                <span className="muted">{s('sus.agree')}</span>
              </div>
            </fieldset>
          </li>
        ))}
      </ol>
      {error && <p role="alert" className="error">{error}</p>}
      {!complete && <p className="muted">{s('p.sus_answer_all', { n: answers.filter((a) => a === null).length })}</p>}
      <button type="submit" className="primary" data-testid="sus-submit" disabled={!complete || busy}>{s('submit')}</button>
    </form>
  );
}
