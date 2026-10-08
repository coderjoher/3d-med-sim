/**
 * Case player (PRD §9.3): clinical stem, question navigation, timer with
 * auto-submit (C-07), identify-on-model / MCQ / multi / order / text questions,
 * explicit confirmation before any answer is recorded (I-04), interaction log
 * (C-09) and a summary screen per feedback level (C-08, R-01).
 */
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  InputBus, InteractionLogger, formatClock, remainingMs,
  type AnswerRecord, type AnswerValue, type CameraView, type InputSource, type InteractionLog,
  type PlayerCase, type PlayerQuestion, type ScoreResult,
} from '@medsim/core';
import { usePrefs } from '../shared/prefs';
import { ModelViewer } from '../viewer/ModelViewer';
import { ComparisonView } from '../viewer/ComparisonView';
import { resolveModel, structureName } from '../viewer/models';
import { useStationInput } from './StationInput';
import './strings';
import './station.css';

export interface CasePlayerProps {
  playerCase: PlayerCase;
  mode: 'assessment' | 'practice' | 'preview';   // preview = author "preview as student" (A-04), never records
  onSubmit?(answers: AnswerRecord[], log: InteractionLog, timedOut: boolean): Promise<Partial<ScoreResult> | void> | void;
  inputBus?: InputBus; attemptId?: string;
  // ---- optional extensions
  /** Attempt start (ms epoch) for the countdown; defaults to mount time. */
  startedAt?: number;
  studentId?: string;
  stationId?: string;
  caseVersion?: number;
  modelVersion?: number;
  /** Shown on the summary screen ("Back to case list" / "Finish"). */
  onExit?(): void;
  /** Practice only: repeat button on the summary. */
  onRepeat?(): void;
  /** Extra text under the summary (e.g. "saved offline"). */
  summaryNote?: string;
  /** Submit now with the confirmed answers (proctor ended the session). */
  forceSubmit?: boolean;
}

type Dialog = { kind: 'answer'; qid: string; value: AnswerValue } | { kind: 'submit' } | null;
type Phase = 'answering' | 'submitting' | 'summary';

const PRESETS: CameraView['camera'][] = ['anterior', 'posterior', 'left', 'right', 'superior', 'inferior'];

function isEmptyValue(v: AnswerValue | undefined): boolean {
  if (v === undefined) return true;
  if (typeof v === 'string') return v.trim() === '';
  return v.length === 0;
}

export function CasePlayer(props: CasePlayerProps) {
  const { playerCase: pc, mode } = props;
  const { s, tx, lang } = usePrefs();
  const station = useStationInput();
  const localBus = useMemo(() => new InputBus(), []);
  const bus = props.inputBus ?? station?.bus ?? localBus;
  const model = useMemo(() => resolveModel(pc.model), [pc.model]);
  const questions = pc.questions;
  const startedAt = useMemo(() => props.startedAt ?? Date.now(), [props.startedAt]);

  const logger = useMemo(() => new InteractionLogger({
    attempt_id: props.attemptId ?? `${mode}-${pc.case_id}-${startedAt}`,
    case_id: pc.case_id,
    case_version: props.caseVersion ?? pc.meta?.version,
    model_version: props.modelVersion ?? model?.version,
    student_id: props.studentId,
    station_id: props.stationId,
    started_at: startedAt,
  }), []); // eslint-disable-line react-hooks/exhaustive-deps

  const [index, setIndex] = useState(0);
  const [staged, setStaged] = useState<Record<string, AnswerValue>>({});
  const [confirmed, setConfirmed] = useState<Record<string, AnswerRecord>>({});
  const confirmedRef = useRef(confirmed);
  confirmedRef.current = confirmed;
  const [dialog, setDialog] = useState<Dialog>(null);
  const [phase, setPhase] = useState<Phase>('answering');
  const [result, setResult] = useState<Partial<ScoreResult> | null>(null);
  const [timedOut, setTimedOut] = useState(false);
  const [submitError, setSubmitError] = useState('');
  const [toast, setToast] = useState('');
  const [now, setNow] = useState(Date.now());

  // viewer state
  const homeView: CameraView = useMemo(() => questions[index]?.view ?? pc.initial_view ?? { camera: 'anterior' }, [index, questions, pc.initial_view]);
  const [view, setView] = useState<CameraView>(homeView);
  const [hiddenLayers, setHiddenLayers] = useState<string[]>(pc.initial_view?.hidden_layers ?? []);
  const [exploreSel, setExploreSel] = useState<string | null>(null);
  const [isolateId, setIsolateId] = useState<string | null>(null);
  const labelsAllowed = mode === 'practice';
  const [labelsOn, setLabelsOn] = useState<boolean>(labelsAllowed && !!pc.labels_visible);
  const [clipAxis, setClipAxis] = useState<'off' | 'x' | 'y' | 'z'>('off');
  const [clipOffset, setClipOffset] = useState(0);
  const [animate, setAnimate] = useState(false);
  const [compare, setCompare] = useState(false);
  const [toolsOpen, setToolsOpen] = useState(false);

  const q: PlayerQuestion | undefined = questions[index];
  const layers = (model?.layers ?? []).filter((l) => !pc.allowed_layers || pc.allowed_layers.includes(l.id));
  const variantDef = model?.variants.find((v) => v.id === pc.variant);
  const canCompare = mode !== 'assessment' && !!variantDef?.pathological;
  const canAnimate = !!model?.animations?.length;

  // ------------------------------------------------------------ logging: case + question open/close
  const openQ = useRef<string | null>(null);
  useEffect(() => {
    logger.record('case-open', { data: { mode, variant: pc.variant, model: pc.model } });
    return () => { if (openQ.current) logger.record('question-close', { question_id: openQ.current }); };
  }, []); // eslint-disable-line react-hooks/exhaustive-deps
  useEffect(() => {
    if (phase !== 'answering' || !q) return;
    if (openQ.current && openQ.current !== q.id) logger.record('question-close', { question_id: openQ.current });
    if (openQ.current !== q.id) logger.record('question-open', { question_id: q.id });
    openQ.current = q.id;
    setView(homeView);
    if (q.view?.hidden_layers) setHiddenLayers(q.view.hidden_layers);
  }, [q?.id, phase]); // eslint-disable-line react-hooks/exhaustive-deps

  // ------------------------------------------------------------ input-mode, hand-lost, reset logging
  const lastSource = useRef<InputSource | null>(null);
  useEffect(() => bus.on((e) => {
    if (e.type === 'hand-lost') { logger.record('hand-lost', { question_id: openQ.current ?? undefined }); return; }
    if (e.type === 'hand-found') return;
    if (e.type === 'point') return;
    if (lastSource.current !== e.source) {
      lastSource.current = e.source;
      logger.record('input-mode', { data: { source: e.source } });
    }
    if (e.type === 'reset') {
      logger.record('reset-view', { question_id: openQ.current ?? undefined });
      setView({ ...homeView });
    }
  }), [bus, logger, homeView]);
  useEffect(() => {
    if (station) logger.record('input-mode', { data: { mode: station.mode === 'gesture' ? 'gesture' : 'mouse', station_mode: station.mode } });
  }, [station?.mode]); // eslint-disable-line react-hooks/exhaustive-deps

  // ------------------------------------------------------------ timer (C-07)
  const limit = pc.time_limit_min;
  const remaining = remainingMs(startedAt, limit, now);
  useEffect(() => {
    if (!limit || phase !== 'answering') return;
    const id = setInterval(() => setNow(Date.now()), 250);
    return () => clearInterval(id);
  }, [limit, phase]);

  // ------------------------------------------------------------ submit
  const doSubmit = useCallback(async (isTimeout: boolean) => {
    if (phase !== 'answering') return;
    setDialog(null);
    setPhase('submitting');
    setTimedOut(isTimeout);
    if (openQ.current) { logger.record('question-close', { question_id: openQ.current }); openQ.current = null; }
    logger.record(isTimeout ? 'timeout' : 'submit');
    if (isTimeout) logger.record('submit', { data: { auto: true } });
    logger.end();
    const answers = Object.values(confirmedRef.current);
    try {
      const r = await props.onSubmit?.(answers, logger.toJSON(), isTimeout);
      setResult(r ?? null);
      setPhase('summary');
    } catch (e) {
      setSubmitError(e instanceof Error ? e.message : String(e));
      setResult(null);
      setPhase('summary');
    }
  }, [phase, logger, props]);

  useEffect(() => {
    if (limit && phase === 'answering' && remaining <= 0) void doSubmit(true);
  }, [remaining, limit, phase, doSubmit]);
  useEffect(() => {
    if (props.forceSubmit && phase === 'answering') void doSubmit(true);
  }, [props.forceSubmit, phase, doSubmit]);

  // ------------------------------------------------------------ structure interaction
  const hoverTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const lastViewed = useRef<string | null>(null);
  const onHover = useCallback((id: string | null) => {
    if (hoverTimer.current) clearTimeout(hoverTimer.current);
    if (!id || id === lastViewed.current) return;
    hoverTimer.current = setTimeout(() => {
      lastViewed.current = id;
      logger.record('structure-view', { structure_id: id, question_id: openQ.current ?? undefined });
    }, 350);
  }, [logger]);

  const onSelect = useCallback((id: string | null) => {
    if (phase !== 'answering') return;
    if (id) logger.record('structure-select', { structure_id: id, question_id: q?.id });
    if (q?.type === 'identify') {
      if (!id) return;
      setStaged((st) => {
        let v: string[];
        if (q.match === 'all') {
          const cur = Array.isArray(st[q.id]) ? (st[q.id] as string[]) : [];
          v = cur.includes(id) ? cur.filter((x) => x !== id) : [...cur, id];
        } else v = [id];
        return { ...st, [q.id]: v };
      });
      logger.record('answer-staged', { question_id: q.id, structure_id: id });
    } else {
      setExploreSel(id);
    }
  }, [q, phase, logger]);

  const stage = (qid: string, v: AnswerValue) => {
    setStaged((st) => ({ ...st, [qid]: v }));
    logger.record('answer-staged', { question_id: qid, data: { value: v } });
  };

  const currentValue = (qq: PlayerQuestion | undefined): AnswerValue | undefined => {
    if (!qq) return undefined;
    if (qq.id in staged) return staged[qq.id];
    if (confirmed[qq.id]) return confirmed[qq.id].value;
    if (qq.type === 'order' && qq.options) return Object.keys(qq.options);
    return undefined;
  };

  const requestConfirm = () => {
    if (!q) return;
    const v = currentValue(q);
    if (isEmptyValue(v)) return;
    setDialog({ kind: 'answer', qid: q.id, value: v! });
  };

  const confirmAnswer = () => {
    if (dialog?.kind !== 'answer') return;
    const rec: AnswerRecord = { question_id: dialog.qid, value: dialog.value, confirmed_at: Date.now() };
    setConfirmed((c) => ({ ...c, [dialog.qid]: rec }));
    setStaged((st) => { const n = { ...st }; delete n[dialog.qid]; return n; });
    logger.record('answer-confirmed', { question_id: dialog.qid, data: { value: dialog.value } });
    setDialog(null);
    setToast(s('answer_recorded'));
  };

  const cancelAnswer = () => {
    if (dialog?.kind === 'answer') logger.record('answer-cancelled', { question_id: dialog.qid });
    setDialog(null);
    setToast(s('answer_cancelled'));
  };

  useEffect(() => {
    if (!toast) return;
    const id = setTimeout(() => setToast(''), 1800);
    return () => clearTimeout(id);
  }, [toast]);

  const toggleLayer = (layer: string) => {
    setHiddenLayers((h) => {
      const visible = h.includes(layer);
      logger.record('layer-toggle', { data: { layer, visible } });
      return visible ? h.filter((x) => x !== layer) : [...h, layer];
    });
  };

  const go = (i: number) => {
    if (i < 0 || i >= questions.length) return;
    setIndex(i);
    setExploreSel(null);
  };

  // ------------------------------------------------------------ formatting helpers
  const fmtValue = (qq: PlayerQuestion | undefined, v: AnswerValue | undefined): string => {
    if (!qq || v === undefined) return '';
    const arr = Array.isArray(v) ? v : [v];
    if (qq.type === 'identify') return arr.map((id) => tx(structureName(model, id))).join(', ');
    if (qq.type === 'text') return String(v);
    const sep = qq.type === 'order' ? ' → ' : ', ';
    return arr.map((k) => (qq.options?.[k] !== undefined ? `${k}. ${tx(qq.options[k])}` : k)).join(sep);
  };

  // ------------------------------------------------------------ summary (C-08, R-01)
  if (phase === 'summary' || phase === 'submitting') {
    return (
      <div className="case-player summary" data-testid="case-summary" data-mode={mode}>
        <div className="card summary-card">
          <h2>{mode === 'practice' ? s('practice_mode') : s('score_summary')}</h2>
          {phase === 'submitting' && <p>{s('player.submitting')}</p>}
          {phase === 'summary' && (
            <>
              {timedOut && <p className="warn" data-testid="timed-out">{s('time_up')}</p>}
              {mode === 'preview' && <p className="muted">{s('station.preview_note')}</p>}
              {mode === 'practice' && <p className="muted">{s('station.practice_done')}</p>}
              {submitError && <p className="error">{s('error')}: {submitError}</p>}
              {result && typeof result.score === 'number' ? (
                <p className="score" data-testid="score">{s('your_score', { score: result.score, max: result.max_score ?? 0, percent: Math.round(result.percent ?? 0) })}</p>
              ) : (
                mode === 'assessment' && <p data-testid="score-hidden">{s('score_hidden')}</p>
              )}
              {props.summaryNote && <p className="muted" data-testid="summary-note">{props.summaryNote}</p>}
              {result?.questions && result.questions.length > 0 && (
                <ol className="summary-questions">
                  {result.questions.map((qr) => {
                    const qq = questions.find((x) => x.id === qr.question_id);
                    return (
                      <li key={qr.question_id} data-testid={`summary-${qr.question_id}`} className={qr.pending_manual ? 'pending' : qr.correct ? 'correct' : 'incorrect'}>
                        <strong>{qq ? tx(qq.prompt) : qr.question_id}</strong>{' '}
                        <span>{qr.pending_manual ? s('pending_grading') : qr.correct ? s('correct') : s('incorrect')}</span>{' '}
                        <span className="muted">{s('player.points_of', { score: qr.points_awarded, max: qr.points_possible })}</span>
                        {qr.response !== undefined && <div>{s('your_answer')}: {fmtValue(qq, qr.response) || s('not_answered')}</div>}
                        {qr.correct_answer !== undefined && <div>{s('correct_answer')}: {fmtValue(qq, qr.correct_answer)}</div>}
                        {qr.feedback && <div className="feedback">{s('feedback')}: {tx(qr.feedback)}</div>}
                      </li>
                    );
                  })}
                </ol>
              )}
              <div className="row">
                {props.onRepeat && <button onClick={props.onRepeat} data-testid="practice-again">{s('station.practice_again')}</button>}
                {props.onExit && <button className="primary" onClick={props.onExit} data-testid="summary-exit">{mode === 'practice' ? s('station.go_to_cases') : s('finish')}</button>}
              </div>
            </>
          )}
        </div>
      </div>
    );
  }

  // ------------------------------------------------------------ answering
  const value = currentValue(q);
  const isConfirmed = q ? !!confirmed[q.id] && !(q.id in staged) : false;
  const identifySel = q?.type === 'identify' ? ((Array.isArray(value) ? value : value ? [value] : []) as string[]) : [];
  const selectedIds = q?.type === 'identify' ? identifySel : exploreSel ? [exploreSel] : [];
  const isolateTarget = selectedIds[0] ?? null;
  const unanswered = questions.filter((qq) => !confirmed[qq.id]);
  const clipping = clipAxis === 'off' ? null : { axis: clipAxis, offset: clipOffset };

  return (
    <div className="case-player" data-testid="case-player" data-mode={mode} data-question={q?.id}>
      <header className="player-header">
        <div className="player-title">
          <strong>{pc.topic ?? pc.case_id}</strong>
          {mode === 'practice' && <span className="badge practice" data-testid="practice-badge">{s('practice_note')}</span>}
          {mode === 'preview' && <span className="badge preview">{s('station.preview_note')}</span>}
        </div>
        <nav className="question-nav" aria-label={s('player.question_nav')}>
          {questions.map((qq, i) => (
            <button
              key={qq.id}
              className={`qnav ${i === index ? 'current' : ''} ${confirmed[qq.id] ? 'answered' : ''}`}
              aria-current={i === index ? 'step' : undefined}
              aria-label={s('player.go_to_question', { n: i + 1 })}
              data-testid={`qnav-${i + 1}`}
              onClick={() => go(i)}
            >{i + 1}</button>
          ))}
        </nav>
        {limit ? (
          <div className={`timer ${remaining < 60_000 ? 'low' : ''}`} data-testid="timer" role="timer" aria-label={s('time_remaining')}>
            ⏱ {formatClock(remaining)}
          </div>
        ) : null}
      </header>

      <div className="player-body">
        <section className="player-viewer">
          {compare && canCompare ? (
            <ComparisonView modelId={pc.model} variant={pc.variant} view={view} inputBus={bus} lang={lang} hiddenLayers={hiddenLayers} />
          ) : (
            <ModelViewer
              modelId={pc.model}
              variant={pc.variant}
              view={view}
              labelsVisible={labelsAllowed && labelsOn}
              hiddenLayers={hiddenLayers}
              selectedIds={selectedIds}
              isolateId={isolateId}
              onSelect={onSelect}
              onHover={onHover}
              clipping={clipping}
              animate={animate}
              stereo={station?.stereo ?? false}
              parallax={station?.parallax ?? null}
              inputBus={bus}
              lang={lang}
              testId="case-viewer"
            />
          )}
          <div className="viewer-toolbar" role="toolbar">
            <button onClick={() => { bus.emit({ type: 'reset', source: lastSource.current === 'gesture' ? 'gesture' : 'mouse' }); }} data-testid="reset-view">{s('reset_view')}</button>
            <select aria-label={s('player.view_preset')} data-testid="view-preset" value="" onChange={(e) => { if (e.target.value) setView({ camera: e.target.value as CameraView['camera'] }); }}>
              <option value="">{s('player.view_preset')}…</option>
              {PRESETS.map((p) => <option key={p} value={p}>{s(`view.${p}`)}</option>)}
            </select>
            <button
              onClick={() => setLabelsOn((v) => !v)}
              disabled={!labelsAllowed}
              title={labelsAllowed ? undefined : s('labels.disabled')}
              aria-pressed={labelsAllowed && labelsOn}
              data-testid="labels-toggle"
            >{labelsAllowed && labelsOn ? s('labels.hide') : s('labels.show')}</button>
            {!labelsAllowed && <span className="muted small" data-testid="labels-disabled">{s('labels.disabled')}</span>}
            {isolateId ? (
              <button onClick={() => setIsolateId(null)} data-testid="unisolate">{s('unisolate')}</button>
            ) : (
              <button onClick={() => isolateTarget && setIsolateId(isolateTarget)} disabled={!isolateTarget} data-testid="isolate">{s('isolate')}</button>
            )}
            <button onClick={() => setToolsOpen((v) => !v)} aria-expanded={toolsOpen} data-testid="tools-toggle">{s('player.tools')}</button>
          </div>
          <fieldset className="layer-panel" data-testid="layer-panel">
            <legend>{s('layers')}</legend>
            {layers.map((l) => (
              <label key={l.id} className="layer-toggle">
                <input type="checkbox" checked={!hiddenLayers.includes(l.id)} onChange={() => toggleLayer(l.id)} data-testid={`layer-${l.id}`} />
                {tx(l.name)}
              </label>
            ))}
          </fieldset>
          {toolsOpen && (
            <div className="tools-panel" data-testid="tools-panel">
              <label>{s('cross_section')}{' '}
                <select value={clipAxis} onChange={(e) => setClipAxis(e.target.value as typeof clipAxis)} data-testid="clip-axis">
                  <option value="off">{s('player.clip_off')}</option>
                  <option value="x">{s('axis.x')}</option>
                  <option value="y">{s('axis.y')}</option>
                  <option value="z">{s('axis.z')}</option>
                </select>
              </label>
              {clipAxis !== 'off' && (
                <label>{s('player.clip_offset')}{' '}
                  <input type="range" min={-1} max={1} step={0.05} value={clipOffset} onChange={(e) => setClipOffset(Number(e.target.value))} data-testid="clip-offset" />
                </label>
              )}
              {canAnimate && (
                <button onClick={() => setAnimate((a) => !a)} aria-pressed={animate} data-testid="animate-toggle">{s('animation')}: {animate ? s('pause') : s('play')}</button>
              )}
              {canCompare && (
                <button onClick={() => setCompare((c) => !c)} aria-pressed={compare} data-testid="compare-toggle">{s('compare')}</button>
              )}
            </div>
          )}
        </section>

        <aside className="player-panel">
          <div className="stem card" data-testid="stem">{tx(pc.stem)}</div>
          {q && (
            <div className="question card" data-testid="question">
              <div className="muted">{s('question_of', { n: index + 1, total: questions.length })} · {s('points', { points: q.points })}</div>
              <h3 data-testid="prompt">{tx(q.prompt)}</h3>
              <QuestionInput q={q} value={value} onStage={(v) => stage(q.id, v)} hint={s} tx={tx} />
              {q.type === 'identify' && (
                <p className="selection" data-testid="identify-selection">
                  {identifySel.length ? s('player.your_selection', { value: fmtValue(q, identifySel) }) : s('select_structure')}
                </p>
              )}
              {confirmed[q.id] && (
                <p className="recorded" data-testid="recorded">✔ {s('player.recorded_value', { value: fmtValue(q, confirmed[q.id].value) })}</p>
              )}
              <button className="primary" onClick={requestConfirm} disabled={isEmptyValue(value) || isConfirmed} data-testid="confirm-answer">
                {s('player.confirm_answer_btn')}
              </button>
            </div>
          )}
          <div className="row nav-row">
            <button onClick={() => go(index - 1)} disabled={index === 0} data-testid="prev">{s('previous')}</button>
            <button onClick={() => go(index + 1)} disabled={index >= questions.length - 1} data-testid="next">{s('next')}</button>
            <button className="primary submit-case" onClick={() => setDialog({ kind: 'submit' })} data-testid="submit-case">{s('submit_case')}</button>
          </div>
          {toast && <div className="toast" role="status" data-testid="toast">{toast}</div>}
        </aside>
      </div>

      {dialog?.kind === 'answer' && (
        <div className="modal-backdrop">
          <div className="modal card" role="dialog" aria-modal="true" aria-labelledby="confirm-title" data-testid="confirm-dialog">
            <h3 id="confirm-title">{s('confirm_answer')}</h3>
            <p data-testid="confirm-value">{fmtValue(questions.find((x) => x.id === dialog.qid), dialog.value)}</p>
            <div className="row">
              <button className="primary" onClick={confirmAnswer} data-testid="confirm-yes" autoFocus>{s('confirm')}</button>
              <button onClick={cancelAnswer} data-testid="confirm-no">{s('cancel')}</button>
            </div>
          </div>
        </div>
      )}
      {dialog?.kind === 'submit' && (
        <div className="modal-backdrop">
          <div className="modal card" role="dialog" aria-modal="true" aria-labelledby="submit-title" data-testid="submit-dialog">
            <h3 id="submit-title">{s('submit_confirm')}</h3>
            {unanswered.length > 0 && (
              <p className="warn" data-testid="unanswered-warning">{s('unanswered_warning', { count: unanswered.length })}</p>
            )}
            <div className="row">
              <button className="primary" onClick={() => void doSubmit(false)} data-testid="submit-yes" autoFocus>{s('submit')}</button>
              <button onClick={() => setDialog(null)} data-testid="submit-no">{s('cancel')}</button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

function QuestionInput({ q, value, onStage, hint, tx }: {
  q: PlayerQuestion; value: AnswerValue | undefined; onStage(v: AnswerValue): void;
  hint(key: string): string; tx(t: PlayerQuestion['prompt']): string;
}) {
  const opts = Object.entries(q.options ?? {});
  if (q.type === 'mcq') {
    const cur = Array.isArray(value) ? value[0] : value;
    return (
      <div className="options" role="radiogroup" aria-label={hint('select_option')}>
        {opts.map(([k, text]) => (
          <button key={k} role="radio" aria-checked={cur === k} className={`option ${cur === k ? 'chosen' : ''}`} onClick={() => onStage(k)} data-testid={`option-${k}`}>
            <span className="key">{k}.</span> {tx(text)}
          </button>
        ))}
      </div>
    );
  }
  if (q.type === 'multi') {
    const cur = Array.isArray(value) ? value : [];
    return (
      <div className="options" role="group" aria-label={hint('select_all_apply')}>
        <p className="muted small">{hint('select_all_apply')}</p>
        {opts.map(([k, text]) => {
          const on = cur.includes(k);
          return (
            <button key={k} role="checkbox" aria-checked={on} className={`option ${on ? 'chosen' : ''}`} onClick={() => onStage(on ? cur.filter((x) => x !== k) : [...cur, k])} data-testid={`option-${k}`}>
              <span className="key">{on ? '☑' : '☐'}</span> {tx(text)}
            </button>
          );
        })}
      </div>
    );
  }
  if (q.type === 'order') {
    const cur = Array.isArray(value) && value.length ? value : opts.map(([k]) => k);
    const move = (i: number, d: number) => {
      const n = [...cur];
      const j = i + d;
      if (j < 0 || j >= n.length) return;
      [n[i], n[j]] = [n[j], n[i]];
      onStage(n);
    };
    return (
      <div>
        <p className="muted small">{hint('order_items')}</p>
        <ol className="order-list">
          {cur.map((k, i) => (
            <li key={k} data-testid={`order-item-${k}`}>
              <span>{tx(q.options?.[k] ?? k)}</span>
              <button onClick={() => move(i, -1)} disabled={i === 0} aria-label={hint('move_up')} data-testid={`up-${k}`}>↑</button>
              <button onClick={() => move(i, 1)} disabled={i === cur.length - 1} aria-label={hint('move_down')} data-testid={`down-${k}`}>↓</button>
            </li>
          ))}
        </ol>
      </div>
    );
  }
  if (q.type === 'text') {
    return (
      <textarea
        aria-label={hint('type_answer')}
        placeholder={hint('type_answer')}
        value={typeof value === 'string' ? value : ''}
        onChange={(e) => onStage(e.target.value)}
        rows={4}
        data-testid="text-answer"
      />
    );
  }
  return null; // identify: answered on the model
}
