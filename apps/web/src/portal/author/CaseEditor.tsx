import { useEffect, useRef, useState } from 'react';
import { Link, useNavigate, useParams } from 'react-router-dom';
import { validateCase, type CameraView, type CaseRecord, type Course, type ModelDef } from '@medsim/core';
import { api } from '../../shared/api';
import { usePrefs } from '../../shared/prefs';
import { ModelViewer } from '../../viewer/ModelViewer';
import { errorList, useApi } from '../hooks';
import { BiField, ErrorBox, Loading, StatusBadge } from '../ui';
import { CAMERA_PRESETS, caseToForm, emptyForm, formToCase, newQuestion, toggleTarget, type CaseForm, type QuestionForm } from './caseForm';
import { describeView, QuestionEditor } from './QuestionEditor';

/** Web authoring form (A-02) with visual 3D tagging (A-03) and bilingual fields (A-07). */
export function CaseEditor() {
  const { id } = useParams();
  const models = useApi<ModelDef[]>('/models');
  const courses = useApi<Course[]>('/courses');
  const record = useApi<CaseRecord>(id ? `/cases/${encodeURIComponent(id)}` : null);
  const ready = !models.loading && !courses.loading && !record.loading;
  const { s } = usePrefs();

  if (!ready) return <Loading when />;
  const loadError = models.error || courses.error || record.error;
  if (loadError) return <ErrorBox error={loadError} />;
  return (
    <EditorForm
      key={record.data ? `${record.data.id}@${record.data.version}` : 'new'}
      models={models.data ?? []}
      courses={courses.data ?? []}
      record={record.data}
      onSaved={(r) => record.setData(r)}
      title={record.data ? `${s('edit')}: ${record.data.id}` : s('new_case')}
    />
  );
}

interface FormProps { models: ModelDef[]; courses: Course[]; record?: CaseRecord; onSaved(r: CaseRecord): void; title: string }

function EditorForm({ models, courses, record, onSaved, title }: FormProps) {
  const { s, tx } = usePrefs();
  const navigate = useNavigate();
  const [form, setForm] = useState<CaseForm>(() => (record ? caseToForm(record.data, record.course_id) : emptyForm(models[0], courses[0])));
  const [errors, setErrors] = useState<string[]>([]);
  const [message, setMessage] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [tagIndex, setTagIndex] = useState<number | null>(() => firstIdentify(form.questions));
  const currentView = useRef<CameraView | null>(null);

  const model = models.find((m) => m.id === form.model);
  const set = (p: Partial<CaseForm>) => setForm((f) => ({ ...f, ...p }));
  const setQuestion = (i: number, q: QuestionForm) => setForm((f) => ({ ...f, questions: f.questions.map((x, j) => (j === i ? q : x)) }));
  const status = record?.status;
  const editable = !status || status === 'draft' || status === 'published';

  useEffect(() => {
    if (tagIndex !== null && form.questions[tagIndex]?.type !== 'identify') setTagIndex(firstIdentify(form.questions));
  }, [form.questions, tagIndex]);

  const tagQuestion = tagIndex !== null ? form.questions[tagIndex] : undefined;

  const onSelectStructure = (structureId: string | null) => {
    if (!structureId || tagIndex === null) return;
    setForm((f) => ({ ...f, questions: f.questions.map((q, j) => (j === tagIndex && q.type === 'identify' ? toggleTarget(q, structureId) : q)) }));
  };
  const onViewChange = (v: CameraView) => { currentView.current = v; };
  const captured = (): CameraView | null => (currentView.current ? { ...currentView.current } : null);
  const captureInitial = () => {
    const v = captured();
    if (!v) { setMessage(s('p.no_view_yet')); return; }
    set({ initial_view: { ...v, hidden_layers: form.initial_view.hidden_layers ?? [] } });
    setMessage(s('p.view_captured'));
  };
  const captureQuestion = (i: number) => {
    const v = captured();
    if (!v) { setMessage(s('p.no_view_yet')); return; }
    setQuestion(i, { ...form.questions[i], view: { ...v, hidden_layers: v.hidden_layers ?? form.initial_view.hidden_layers ?? [] } });
    setMessage(s('p.view_captured'));
  };

  const changeModel = (modelId: string) => {
    const m = models.find((x) => x.id === modelId);
    set({ model: modelId, variant: m?.variants[0]?.id ?? '', initial_view: { ...form.initial_view, hidden_layers: [] }, allowed_layers: [] });
  };
  const changeCourse = (courseId: string) => {
    const c = courses.find((x) => x.id === courseId);
    set({ course_id: courseId, course_code: c?.code ?? '' });
  };
  const toggleList = (list: string[], v: string) => (list.includes(v) ? list.filter((x) => x !== v) : [...list, v]);

  const validate = () => {
    const local: string[] = [];
    if (!form.course_id) local.push(s('p.err_course'));
    const res = validateCase(formToCase(form), model);
    const all = [...local, ...(res.ok ? [] : res.errors)];
    setErrors(all);
    return all.length === 0;
  };

  const save = async () => {
    setMessage(null);
    if (!validate()) return null;
    setBusy(true);
    try {
      const data = formToCase(form);
      const saved = record
        ? await api<CaseRecord>(`/cases/${encodeURIComponent(record.id)}`, { method: 'PUT', json: { data } })
        : await api<CaseRecord>('/cases', { method: 'POST', json: { course_id: form.course_id, data } });
      setMessage(s('p.saved_version', { n: saved.version }));
      if (!record) navigate(`/portal/cases/${encodeURIComponent(saved.id)}/edit`, { replace: true });
      else onSaved(saved);
      return saved;
    } catch (e) {
      setErrors(errorList(e));
      return null;
    } finally {
      setBusy(false);
    }
  };

  const submitForReview = async () => {
    if (!record) return;
    setBusy(true);
    try {
      const r = await api<CaseRecord>(`/cases/${encodeURIComponent(record.id)}/submit`, { method: 'POST' });
      onSaved(r);
      setMessage(s('p.submitted_for_review'));
    } catch (e) {
      setErrors(errorList(e));
    } finally {
      setBusy(false);
    }
  };

  const layers = model?.layers ?? [];
  const hidden = form.initial_view.hidden_layers ?? [];
  const viewerHidden = tagQuestion?.view?.hidden_layers ?? hidden;

  return (
    <div className="portal-editor">
      <div className="row">
        <h1>{title}</h1>
        {record && <StatusBadge status={record.status} />}
        {record && <span className="muted">{s('version', { n: record.version })}</span>}
      </div>
      {record?.review_comment && <p className="portal-alert" data-testid="review-comment"><strong>{s('review_comment')}:</strong> {record.review_comment}</p>}
      {status === 'in_review' && <p className="muted">{s('p.locked_in_review')}</p>}
      {status === 'published' && <p className="muted">{s('p.published_new_version')}</p>}

      <form onSubmit={(e) => { e.preventDefault(); void save(); }} aria-label={s('p.case_form')}>
        <div className="portal-editor-grid">
          <div className="portal-editor-main">
            <section className="card">
              <h2>{s('p.case_details')}</h2>
              <div className="row">
                <label>{s('p.case_id')} <input data-testid="case-id" value={form.case_id} onChange={(e) => set({ case_id: e.target.value })} disabled={!!record} /></label>
                <label>{s('course')}{' '}
                  <select data-testid="case-course" value={form.course_id} onChange={(e) => changeCourse(e.target.value)} disabled={!!record}>
                    <option value="">—</option>
                    {courses.map((c) => <option key={c.id} value={c.id}>{c.code} — {c.name}</option>)}
                  </select>
                </label>
                <label>{s('p.topic')} <input data-testid="case-topic" value={form.topic} onChange={(e) => set({ topic: e.target.value })} /></label>
              </div>
              <div className="row">
                <label>{s('model')}{' '}
                  <select data-testid="case-model" value={form.model} onChange={(e) => changeModel(e.target.value)}>
                    {models.map((m) => <option key={m.id} value={m.id}>{tx(m.name)} (v{m.version})</option>)}
                  </select>
                </label>
                <label>{s('variant')}{' '}
                  <select data-testid="case-variant" value={form.variant} onChange={(e) => set({ variant: e.target.value })}>
                    {(model?.variants ?? []).map((v) => <option key={v.id} value={v.id}>{tx(v.name)}</option>)}
                  </select>
                </label>
                {model && !model.sign_off && <span className="portal-badge portal-badge-warn">{s('p.model_not_signed')}</span>}
              </div>
              <BiField label={s('stem')} value={form.stem} onChange={(stem) => set({ stem })} testId="case-stem" multiline />
            </section>

            <section className="card">
              <h2>{s('initial_view')}</h2>
              <div className="row">
                <label>{s('p.camera_preset')}{' '}
                  <select data-testid="case-camera" value={form.initial_view.camera} onChange={(e) => set({ initial_view: { camera: e.target.value as CameraView['camera'], hidden_layers: hidden } })}>
                    {CAMERA_PRESETS.map((c) => <option key={c} value={c}>{s(`p.camera.${c}`)}</option>)}
                  </select>
                </label>
                <span className="muted" data-testid="initial-view-desc">{describeView(form.initial_view)}</span>
              </div>
              <fieldset className="portal-checks">
                <legend>{s('p.hidden_layers')}</legend>
                {layers.map((l) => (
                  <label key={l.id}><input type="checkbox" data-testid={`hidden-${l.id}`} checked={hidden.includes(l.id)} onChange={() => set({ initial_view: { ...form.initial_view, hidden_layers: toggleList(hidden, l.id) } })} /> {tx(l.name)}</label>
                ))}
              </fieldset>
              <fieldset className="portal-checks">
                <legend>{s('p.allowed_layers')} <span className="muted">({s('p.allowed_layers_hint')})</span></legend>
                {layers.map((l) => (
                  <label key={l.id}><input type="checkbox" data-testid={`allowed-${l.id}`} checked={form.allowed_layers.includes(l.id)} onChange={() => set({ allowed_layers: toggleList(form.allowed_layers, l.id) })} /> {tx(l.name)}</label>
                ))}
              </fieldset>
            </section>

            <section className="card">
              <h2>{s('p.settings')}</h2>
              <div className="row">
                <label><input type="checkbox" data-testid="case-labels" checked={form.labels_visible} onChange={(e) => set({ labels_visible: e.target.checked })} /> {s('p.labels_allowed')}</label>
                <label>{s('time_limit')} <input data-testid="case-time" type="number" min={1} value={form.time_limit_min} onChange={(e) => set({ time_limit_min: e.target.value })} style={{ width: '6em' }} /></label>
                <label>{s('feedback_level')}{' '}
                  <select data-testid="case-feedback" value={form.feedback_level} onChange={(e) => set({ feedback_level: e.target.value as CaseForm['feedback_level'] })}>
                    {(['none', 'score', 'full'] as const).map((f) => <option key={f} value={f}>{s(`feedback.${f}`)}</option>)}
                  </select>
                </label>
                <label><input type="checkbox" checked={form.practice} onChange={(e) => set({ practice: e.target.checked })} /> {s('p.practice_case')}</label>
              </div>
              <div className="row">
                <label>{s('difficulty')}{' '}
                  <select data-testid="case-difficulty" value={form.difficulty} onChange={(e) => set({ difficulty: e.target.value as CaseForm['difficulty'] })}>
                    <option value="">—</option>
                    {(['easy', 'medium', 'hard'] as const).map((d) => <option key={d} value={d}>{s(`p.difficulty.${d}`)}</option>)}
                  </select>
                </label>
                <label className="portal-grow">{s('p.objectives')}<br />
                  <textarea data-testid="case-objectives" rows={2} value={form.objectives} onChange={(e) => set({ objectives: e.target.value })} placeholder={s('p.objectives_hint')} />
                </label>
              </div>
            </section>

            <section>
              <h2>{s('p.questions')}</h2>
              {form.questions.map((q, i) => (
                <QuestionEditor
                  key={i}
                  q={q}
                  index={i}
                  model={model}
                  tagging={tagIndex === i}
                  onChange={(nq) => setQuestion(i, nq)}
                  onRemove={() => setForm((f) => ({ ...f, questions: f.questions.filter((_, j) => j !== i) }))}
                  onTag={() => setTagIndex(i)}
                  onCaptureView={() => captureQuestion(i)}
                />
              ))}
              <button type="button" data-testid="add-question" onClick={() => setForm((f) => ({ ...f, questions: [...f.questions, { ...newQuestion(f.questions.length), id: uniqueQid(f.questions) }] }))}>{s('add_question')}</button>
            </section>
          </div>

          <aside className="portal-editor-side card">
            <h2>{s('p.visual_tagging')}</h2>
            <p className="muted">{tagQuestion ? s('p.tagging_for', { id: tagQuestion.id }) : s('p.tagging_none')}</p>
            {form.model && form.variant && (
              <ModelViewer
                modelId={form.model}
                variant={form.variant}
                view={tagQuestion?.view ?? form.initial_view}
                labelsVisible
                hiddenLayers={viewerHidden}
                selectedIds={tagQuestion?.answer ?? []}
                onSelect={onSelectStructure}
                onViewChange={onViewChange}
                className="portal-viewer"
                testId="author-viewer"
              />
            )}
            <div className="row">
              <button type="button" data-testid="capture-initial-view" onClick={captureInitial}>{s('capture_view')}</button>
            </div>
          </aside>
        </div>

        <ErrorBox errors={errors} />
        {message && <p role="status" className="portal-ok">{message}</p>}
        <div className="row portal-actions">
          <button type="button" data-testid="validate-case" onClick={() => { if (validate()) setMessage(s('p.valid')); }}>{s('p.validate')}</button>
          <button type="submit" className="primary" data-testid="save-case" disabled={busy || !editable}>{s('save')}</button>
          {record && record.status === 'draft' && (
            <button type="button" data-testid="submit-review" disabled={busy} onClick={() => void submitForReview()}>{s('submit_for_review')}</button>
          )}
          {record && <Link to={`/portal/cases/${encodeURIComponent(record.id)}/preview`}>{s('preview')}</Link>}
          {record && <Link to={`/portal/cases/${encodeURIComponent(record.id)}/versions`}>{s('versions')}</Link>}
        </div>
      </form>
    </div>
  );
}

function firstIdentify(qs: QuestionForm[]): number | null {
  const i = qs.findIndex((q) => q.type === 'identify');
  return i >= 0 ? i : null;
}

function uniqueQid(qs: QuestionForm[]): string {
  const used = new Set(qs.map((q) => q.id));
  let n = qs.length + 1;
  while (used.has(`q${n}`)) n++;
  return `q${n}`;
}
