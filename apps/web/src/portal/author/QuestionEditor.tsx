import type { ModelDef, QuestionType } from '@medsim/core';
import { usePrefs } from '../../shared/prefs';
import { BiField } from '../ui';
import { newQuestion, nextOptionKey, QUESTION_TYPES, type QuestionForm } from './caseForm';

interface Props {
  q: QuestionForm;
  index: number;
  model?: ModelDef;
  tagging: boolean;
  onChange(q: QuestionForm): void;
  onRemove(): void;
  onTag(): void;
  onCaptureView(): void;
}

/** One question in the authoring form: type, bilingual prompt/feedback, options, answer key, points (A-02, A-07, C-04). */
export function QuestionEditor({ q, index, model, tagging, onChange, onRemove, onTag, onCaptureView }: Props) {
  const { s, tx } = usePrefs();
  const set = (p: Partial<QuestionForm>) => onChange({ ...q, ...p });
  const tid = (x: string) => `q${index}-${x}`;
  const hasOptions = q.type === 'mcq' || q.type === 'multi' || q.type === 'order';

  const changeType = (type: QuestionType) => {
    const fresh = newQuestion(index, type);
    onChange({ ...q, type, options: hasOptionsFor(type) ? (q.options.length ? q.options : fresh.options) : [], answer: [], match: 'any', partial_credit: false });
  };

  const setOption = (i: number, p: Partial<QuestionForm['options'][number]>) => {
    const old = q.options[i];
    const options = q.options.map((o, j) => (j === i ? { ...o, ...p } : o));
    let answer = q.answer;
    if (p.key !== undefined && p.key !== old.key) answer = answer.map((a) => (a === old.key ? p.key! : a));
    set({ options, answer });
  };
  const removeOption = (i: number) => {
    const key = q.options[i].key;
    set({ options: q.options.filter((_, j) => j !== i), answer: q.answer.filter((a) => a !== key) });
  };
  const toggleAnswer = (key: string, single: boolean) => {
    if (single) set({ answer: [key] });
    else set({ answer: q.answer.includes(key) ? q.answer.filter((a) => a !== key) : [...q.answer, key] });
  };
  const structureName = (id: string) => tx(model?.structures.find((st) => st.id === id)?.name) || id;

  return (
    <fieldset className="card portal-question" data-testid={`question-${index}`}>
      <legend>{s('question')} {index + 1}</legend>
      <div className="row">
        <label>{s('p.question_id')} <input data-testid={tid('id')} value={q.id} onChange={(e) => set({ id: e.target.value })} size={8} /></label>
        <label>{s('p.question_type')}{' '}
          <select data-testid={tid('type')} value={q.type} onChange={(e) => changeType(e.target.value as QuestionType)}>
            {QUESTION_TYPES.map((t) => <option key={t} value={t}>{s(`p.qtype.${t}`)}</option>)}
          </select>
        </label>
        <label>{s('p.points')} <input data-testid={tid('points')} type="number" min={0} step="0.5" value={q.points} onChange={(e) => set({ points: Number(e.target.value) })} style={{ width: '5em' }} /></label>
        <button type="button" onClick={onRemove} data-testid={tid('remove')}>{s('remove_question')}</button>
      </div>
      <BiField label={s('prompt')} value={q.prompt} onChange={(prompt) => set({ prompt })} testId={tid('prompt')} />

      {hasOptions && (
        <div className="portal-options">
          <strong>{s('options')}</strong>
          {q.type !== 'order' && <span className="muted"> — {s('p.tick_correct')}</span>}
          {q.options.map((o, i) => (
            <div className="row" key={i}>
              {q.type === 'mcq' && (
                <input type="radio" name={`${q.id}-answer-${index}`} aria-label={s('p.correct_option', { key: o.key })} data-testid={tid(`correct-${i}`)} checked={q.answer.includes(o.key)} onChange={() => toggleAnswer(o.key, true)} />
              )}
              {q.type === 'multi' && (
                <input type="checkbox" aria-label={s('p.correct_option', { key: o.key })} data-testid={tid(`correct-${i}`)} checked={q.answer.includes(o.key)} onChange={() => toggleAnswer(o.key, false)} />
              )}
              <input aria-label={s('p.option_key')} value={o.key} onChange={(e) => setOption(i, { key: e.target.value })} size={3} data-testid={tid(`opt-${i}-key`)} />
              <input aria-label={`${s('p.option_text')} (EN)`} placeholder="English" value={o.en} onChange={(e) => setOption(i, { en: e.target.value })} data-testid={tid(`opt-${i}-en`)} />
              <input aria-label={`${s('p.option_text')} (AR)`} placeholder="العربية" dir="rtl" lang="ar" value={o.ar} onChange={(e) => setOption(i, { ar: e.target.value })} data-testid={tid(`opt-${i}-ar`)} />
              <button type="button" onClick={() => removeOption(i)} aria-label={s('p.remove_option')}>✕</button>
            </div>
          ))}
          <button type="button" data-testid={tid('add-option')} onClick={() => set({ options: [...q.options, { key: nextOptionKey(q.options), en: '', ar: '' }] })}>{s('p.add_option')}</button>
          {q.type === 'multi' && (
            <label className="row"><input type="checkbox" data-testid={tid('partial')} checked={q.partial_credit} onChange={(e) => set({ partial_credit: e.target.checked })} /> {s('p.partial_credit')}</label>
          )}
          {q.type === 'order' && (
            <div className="row">
              <label>{s('p.correct_order')}{' '}
                <input data-testid={tid('order')} value={q.answer.join(', ')} onChange={(e) => set({ answer: e.target.value.split(',').map((x) => x.trim()).filter(Boolean) })} placeholder="A, B, C" />
              </label>
              <button type="button" onClick={() => set({ answer: q.options.map((o) => o.key) })}>{s('p.use_listed_order')}</button>
            </div>
          )}
        </div>
      )}

      {q.type === 'identify' && (
        <div className="portal-identify">
          <strong>{s('answer_key')}</strong> <span className="muted">{s('p.identify_hint')}</span>
          <div className="row" data-testid={tid('targets')}>
            {q.answer.length === 0 && <span className="muted">{s('p.no_targets')}</span>}
            {q.answer.map((id) => (
              <span key={id} className="portal-chip" data-testid={tid(`target-${id}`)}>
                {structureName(id)} <code>{id}</code>
                <button type="button" aria-label={s('p.remove_target')} onClick={() => set({ answer: q.answer.filter((a) => a !== id) })}>✕</button>
              </span>
            ))}
          </div>
          <div className="row">
            <select aria-label={s('p.add_target')} data-testid={tid('add-target')} value="" onChange={(e) => e.target.value && !q.answer.includes(e.target.value) && set({ answer: [...q.answer, e.target.value] })}>
              <option value="">{s('p.add_target')}…</option>
              {(model?.structures ?? []).map((st) => <option key={st.id} value={st.id}>{tx(st.name)} ({st.id})</option>)}
            </select>
            <label>{s('p.match')}{' '}
              <select value={q.match} onChange={(e) => set({ match: e.target.value as 'any' | 'all' })}>
                <option value="any">{s('p.match.any')}</option>
                <option value="all">{s('p.match.all')}</option>
              </select>
            </label>
            <button type="button" className={tagging ? 'primary' : ''} aria-pressed={tagging} data-testid={tid('tag')} onClick={onTag}>
              {tagging ? s('p.tagging_active') : s('p.tag_on_model')}
            </button>
          </div>
        </div>
      )}

      {q.type === 'text' && (
        <label>{s('p.model_answer')}{' '}
          <input data-testid={tid('model-answer')} value={q.answer[0] ?? ''} onChange={(e) => set({ answer: e.target.value ? [e.target.value] : [] })} />
          <span className="muted"> {s('p.manual_grading_note')}</span>
        </label>
      )}

      <BiField label={s('feedback')} value={q.feedback} onChange={(feedback) => set({ feedback })} testId={tid('feedback')} multiline />

      <div className="row">
        <span className="muted">{s('p.question_view')}: {q.view ? describeView(q.view) : s('p.case_default')}</span>
        <button type="button" data-testid={tid('capture-view')} onClick={onCaptureView}>{s('p.capture_for_question')}</button>
        {q.view && <button type="button" onClick={() => set({ view: undefined })}>{s('p.clear_view')}</button>}
      </div>
    </fieldset>
  );
}

function hasOptionsFor(t: QuestionType) { return t === 'mcq' || t === 'multi' || t === 'order'; }

export function describeView(v: { camera: string; alpha?: number; beta?: number; radius?: number; hidden_layers?: string[] }): string {
  const parts = [v.camera];
  if (v.camera === 'custom') parts.push(`α=${(v.alpha ?? 0).toFixed(2)} β=${(v.beta ?? 0).toFixed(2)} r=${(v.radius ?? 0).toFixed(1)}`);
  if (v.hidden_layers?.length) parts.push(`−${v.hidden_layers.join(', ')}`);
  return parts.join(' · ');
}
