/**
 * Student station (PRD §8 student journey):
 * sign in -> calibration -> practice (non-graded) -> case list -> case player -> summary.
 *
 *   /station               server mode (lab server API)
 *   /station?mode=local    Phase 0 prototype: no backend, built-in cases, local scoring & logs
 *   /station/bench         performance harness (§15 exit criteria)
 *
 * Query options: station=<id>, input=mouse, kiosk=0, hb=<heartbeat ms>.
 */
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Route, Routes } from 'react-router-dom';
import {
  BUILTIN_CASES, PRACTICE_CASE, applyFeedbackLevel, scoreCase, toPlayerCase,
  type AnswerRecord, type CaseData, type InteractionLog, type LabSession, type PlayerCase,
  type ScoreResult, type StartAttemptResponse, type StationCommand, type StationStatus,
  type SubmitAttemptResponse,
} from '@medsim/core';
import { usePrefs } from '../shared/prefs';
import { useAuth } from '../shared/auth';
import { api, ApiError } from '../shared/api';
import { CasePlayer } from './CasePlayer';
import { Calibration } from './Calibration';
import { AccessibilityBar } from './AccessibilityBar';
import { HandCursor, HandLostWarning, InputNotice } from './HandOverlay';
import { KioskExitButton, LockOverlay, useKioskLock } from './Kiosk';
import { StationInputProvider, useStationInput, type InputMode } from './StationInput';
import { Bench } from './Bench';
import {
  downloadJson, listLocalAttempts, newId, notifyQueueChanged, saveLocalAttempt, stationId,
  syncQueue, useHeartbeat, useSyncQueue, type SyncItem,
} from './stationData';
import './strings';
import './station.css';

function query(): URLSearchParams {
  try { return new URLSearchParams(window.location.search); } catch { return new URLSearchParams(); }
}

export function StationApp() {
  return (
    <Routes>
      <Route path="bench" element={<Bench />} />
      <Route path="*" element={<StationShell />} />
    </Routes>
  );
}

function StationShell() {
  const { handedness } = usePrefs();
  const q = useMemo(query, []);
  const initialMode: InputMode = q.get('input') === 'mouse' ? 'fallback' : 'gesture';
  return (
    <StationInputProvider initialMode={initialMode} primaryHand={handedness}>
      <StationFlow />
    </StationInputProvider>
  );
}

type Step = 'signin' | 'calibration' | 'practice-intro' | 'practice' | 'cases' | 'playing';

interface Active {
  playerCase: PlayerCase;
  /** local mode: full case incl. keys for client-side scoring */
  full?: CaseData;
  attemptId: string;
  clientAttemptId: string;
  sessionId?: string;
  caseVersion?: number;
  modelVersion?: number;
  startedAt: number;
}

interface CaseEntry { case_id: string; session_id?: string; title: string; questions?: number; time_limit_min?: number; full?: CaseData }

function StationFlow() {
  const prefs = usePrefs();
  const { s, tx } = prefs;
  const auth = useAuth();
  const input = useStationInput()!;
  const q = useMemo(query, []);
  const local = q.get('mode') === 'local';
  const kioskWanted = q.get('kiosk') !== '0';
  const hbMs = Number(q.get('hb')) || 5000;
  const sid = useMemo(stationId, []);

  const [step, setStep] = useState<Step>('signin');
  const [studentId, setStudentId] = useState('');
  const [kiosk, setKiosk] = useState(kioskWanted);
  const [locked, setLocked] = useState(false);
  const [active, setActive] = useState<Active | null>(null);
  const [submitted, setSubmitted] = useState(false);
  const [summaryNote, setSummaryNote] = useState<string | undefined>();
  const [completed, setCompleted] = useState<string[]>([]);
  const [practiceRun, setPracticeRun] = useState(0);
  const [forceEnd, setForceEnd] = useState(false);
  const [notice, setNotice] = useState('');
  useKioskLock(kiosk);

  const { pending } = useSyncQueue(!local);

  // ---------------------------------------------------------- heartbeat + proctor commands (R-08)
  const status: StationStatus = step === 'calibration' ? 'calibrating'
    : step === 'practice' || step === 'practice-intro' ? 'practice'
      : step === 'playing' ? (submitted ? 'submitted' : 'in_progress') : 'idle';
  const signOut = useCallback(() => {
    setActive(null); setStep('signin'); setStudentId(''); setCompleted([]); setSubmitted(false);
    if (!local) auth.logout();
  }, [auth, local]);
  const onCommand = useCallback((c: StationCommand) => {
    switch (c.type) {
      case 'set-input': void input.setMode(c.mode === 'fallback' ? 'fallback' : 'gesture', 'proctor'); break;
      case 'lock': setLocked(true); break;
      case 'unlock': setLocked(false); break;
      case 'end-session':
        setNotice(s('station.session_ended'));
        if (step === 'playing' && !submitted) setForceEnd(true);
        else signOut();
        break;
    }
  }, [input, s, step, submitted, signOut]);
  const online = useHeartbeat(!local && !!auth.user, sid, () => ({
    status, camera_ok: input.cameraOk, input_mode: input.mode, locked,
    student_id: auth.user?.id, case_id: active?.playerCase.case_id, attempt_id: active?.attemptId,
    ...(active?.sessionId ? { session_id: active.sessionId } : {}),
  }), onCommand, hbMs);

  // ---------------------------------------------------------- sign in
  const [signinErr, setSigninErr] = useState('');
  const [username, setUsername] = useState('');
  const [password, setPassword] = useState('');
  const [localStation, setLocalStation] = useState(sid);
  const doSignIn = async (e: React.FormEvent) => {
    e.preventDefault();
    setSigninErr('');
    if (local) {
      if (!studentId.trim()) return;
      try { localStorage.setItem('medsim.station_id', localStation.trim() || sid); } catch { /* ignore */ }
      setStep('calibration');
      return;
    }
    try {
      const u = await auth.login(username.trim(), password);
      setStudentId(u.username);
      if (u.handedness) prefs.set({ handedness: u.handedness });
      if (u.lang) prefs.set({ lang: u.lang });
      setStep('calibration');
    } catch (err) {
      setSigninErr((err as unknown) instanceof ApiError && (err as ApiError).status === 401 ? s('login_failed') : `${s('station.server_error')}${(err as Error)?.message ? ` (${(err as Error).message})` : ''}`);
    }
  };

  // ---------------------------------------------------------- case list
  const [cases, setCases] = useState<CaseEntry[]>([]);
  const [casesErr, setCasesErr] = useState('');
  const sessions = useRef<LabSession[]>([]);
  const loadCases = useCallback(async () => {
    setCasesErr('');
    if (local) {
      const heart = BUILTIN_CASES.filter((c) => !c.practice && c.model.startsWith('heart'));
      setCases(heart.map((c) => ({ case_id: c.case_id, title: c.topic ?? c.case_id, questions: c.questions.length, time_limit_min: c.time_limit_min, full: c })));
      return;
    }
    try {
      const list = await api<LabSession[]>('/sessions/active');
      sessions.current = list;
      const out: CaseEntry[] = [];
      for (const ses of list) for (const cid of ses.case_ids) out.push({ case_id: cid, session_id: ses.id, title: `${cid} · ${ses.name}`, time_limit_min: ses.time_limit_min });
      setCases(out);
    } catch (e) {
      setCasesErr(e instanceof Error ? e.message : String(e));
    }
  }, [local]);
  useEffect(() => { if (step === 'cases') void loadCases(); }, [step, loadCases]);

  const startCase = async (entry: CaseEntry) => {
    const clientAttemptId = newId('ca-');
    setSubmitted(false);
    setSummaryNote(undefined);
    setForceEnd(false);
    if (local && entry.full) {
      setActive({ playerCase: toPlayerCase(entry.full), full: entry.full, attemptId: clientAttemptId, clientAttemptId, caseVersion: entry.full.meta?.version, startedAt: Date.now() });
      setStep('playing');
      return;
    }
    try {
      const res = await api<StartAttemptResponse>('/attempts/start', { method: 'POST', json: { client_attempt_id: clientAttemptId, session_id: entry.session_id, case_id: entry.case_id, station_id: sid } });
      const pc = { ...res.case, time_limit_min: res.case.time_limit_min ?? entry.time_limit_min };
      setActive({ playerCase: pc, attemptId: res.attempt_id, clientAttemptId, sessionId: entry.session_id, caseVersion: res.case_version, modelVersion: res.model_version, startedAt: res.started_at ?? Date.now() });
      setStep('playing');
    } catch (e) {
      setCasesErr(e instanceof Error ? e.message : String(e));
    }
  };

  // ---------------------------------------------------------- submit
  const submitLocal = async (a: Active, answers: AnswerRecord[], log: InteractionLog, timedOut: boolean) => {
    const full = a.full!;
    const result = scoreCase(full, answers);
    saveLocalAttempt({
      attempt_id: a.attemptId, station_id: localStation || sid, student_id: studentId, case_id: full.case_id,
      case_version: full.meta?.version, model_version: a.modelVersion, started_at: a.startedAt, submitted_at: Date.now(),
      timed_out: timedOut, answers, log: { ...log, student_id: studentId, station_id: localStation || sid }, result,
    });
    return applyFeedbackLevel(result, full.feedback_level ?? 'score');
  };

  const submitServer = async (a: Active, answers: AnswerRecord[], log: InteractionLog, timedOut: boolean): Promise<Partial<ScoreResult> | void> => {
    const req = { client_attempt_id: a.clientAttemptId, answers, log, timed_out: timedOut };
    try {
      const res = await api<SubmitAttemptResponse>(`/attempts/${encodeURIComponent(a.attemptId)}/submit`, { method: 'POST', json: req });
      return res.result && typeof res.result.score === 'number' ? (res.result as ScoreResult) : {};
    } catch (e) {
      if (e instanceof ApiError && e.status < 500) throw e;
      // server unreachable -> keep the attempt on the station and sync later (NFR reliability)
      const item: SyncItem = {
        ...req, attempt_id: a.attemptId, case_id: a.playerCase.case_id, case_version: a.caseVersion ?? 1,
        session_id: a.sessionId, station_id: sid, started_at: a.startedAt,
      };
      syncQueue().enqueue(item);
      notifyQueueChanged();
      setSummaryNote(s('station.queued'));
      return;
    }
  };

  const onSubmit = async (answers: AnswerRecord[], log: InteractionLog, timedOut: boolean) => {
    const a = active!;
    const r = local ? await submitLocal(a, answers, log, timedOut) : await submitServer(a, answers, log, timedOut);
    setSubmitted(true);
    setCompleted((c) => [...c, a.playerCase.case_id]);
    return r;
  };

  const onPracticeSubmit = async (answers: AnswerRecord[]): Promise<Partial<ScoreResult> | void> => {
    // Practice is never graded or stored (I-03, T0-12): score locally for feedback only.
    try { return applyFeedbackLevel(scoreCase(PRACTICE_CASE, answers), 'full'); } catch { return undefined; }
  };

  const practicePlayer = useMemo(() => { try { return toPlayerCase(PRACTICE_CASE); } catch { return null; } }, []);

  // ---------------------------------------------------------- render
  let body: React.ReactNode = null;
  if (step === 'signin') {
    body = (
      <div className="station-center card" data-testid="signin">
        <h1>{s('station.title')}</h1>
        {local && <p className="badge practice" data-testid="local-mode">{s('station.local_mode')}</p>}
        {notice && <p className="warn">{notice}</p>}
        <form onSubmit={doSignIn}>
          {local ? (
            <>
              <label>{s('station.station_id')}<input value={localStation} onChange={(e) => setLocalStation(e.target.value)} data-testid="station-id" /></label>
              <label>{s('station.student_id')}<input value={studentId} onChange={(e) => setStudentId(e.target.value)} required autoFocus data-testid="student-id" /></label>
            </>
          ) : (
            <>
              <label>{s('station.university_id')}<input value={username} onChange={(e) => setUsername(e.target.value)} required autoFocus autoComplete="username" data-testid="username" /></label>
              <label>{s('password')}<input type="password" value={password} onChange={(e) => setPassword(e.target.value)} required autoComplete="current-password" data-testid="password" /></label>
            </>
          )}
          {signinErr && <p className="error" role="alert">{signinErr}</p>}
          <button className="primary" type="submit" data-testid="signin-submit">{s('station.sign_in')}</button>
        </form>
      </div>
    );
  } else if (step === 'calibration') {
    body = <Calibration onDone={() => setStep('practice-intro')} />;
  } else if (step === 'practice-intro') {
    body = (
      <div className="station-center card" data-testid="practice-intro">
        <h2>{s('practice_mode')}</h2>
        <p>{s('station.practice_intro')}</p>
        <ul className="muted">
          <li>{s('gesture.point')}</li><li>{s('gesture.pinch')}</li><li>{s('gesture.drag')}</li><li>{s('gesture.zoom')}</li><li>{s('gesture.reset')}</li>
        </ul>
        <div className="row">
          <button className="primary" onClick={() => { setPracticeRun((n) => n + 1); setStep('practice'); }} disabled={!practicePlayer} data-testid="start-practice">{s('start_practice')}</button>
          <button onClick={() => setStep('cases')} data-testid="skip-practice">{s('skip_practice')}</button>
        </div>
      </div>
    );
  } else if (step === 'practice' && practicePlayer) {
    body = (
      <CasePlayer
        key={`practice-${practiceRun}`}
        playerCase={{ ...practicePlayer, labels_visible: practicePlayer.labels_visible ?? true }}
        mode="practice"
        onSubmit={onPracticeSubmit}
        onRepeat={() => setPracticeRun((n) => n + 1)}
        onExit={() => setStep('cases')}
        studentId={studentId}
        stationId={sid}
      />
    );
  } else if (step === 'cases') {
    const localCount = local ? listLocalAttempts().length : 0;
    body = (
      <div className="station-center" data-testid="case-list">
        <h2>{s('choose_case')}</h2>
        {local && (
          <div className="row" style={{ marginBottom: '0.75rem' }}>
            <span className="muted" data-testid="local-count">{s('station.local_attempts', { count: localCount })}</span>
            <button onClick={() => downloadJson(`medsim-local-${localStation || sid}-${new Date().toISOString().slice(0, 10)}.json`, { station_id: localStation || sid, exported_at: new Date().toISOString(), attempts: listLocalAttempts() })} data-testid="download-logs">{s('station.download_logs')}</button>
          </div>
        )}
        {casesErr && <p className="error" role="alert">{s('station.server_error')}: {casesErr}</p>}
        {cases.length === 0 && !casesErr && <p className="muted" data-testid="no-cases">{local ? s('station.no_cases') : s('waiting_for_session')}</p>}
        <div className="case-list">
          {cases.map((c) => {
            const done = completed.includes(c.case_id);
            return (
              <div className="card" key={`${c.session_id ?? ''}:${c.case_id}`} data-testid={`case-${c.case_id}`}>
                <div>
                  <strong>{c.full ? tx(c.full.topic ?? c.case_id) : c.title}</strong>
                  <div className="muted small">
                    {c.case_id}
                    {c.questions ? ` · ${s('station.questions_count', { count: c.questions })}` : ''}
                    {c.time_limit_min ? ` · ${s('station.minutes', { n: c.time_limit_min })}` : ''}
                  </div>
                </div>
                {done ? <span className="badge" data-testid="case-done">{s('station.completed')}</span> : (
                  <button className="primary" onClick={() => void startCase(c)} data-testid={`start-${c.case_id}`}>{s('start_case')}</button>
                )}
              </div>
            );
          })}
        </div>
        <div className="row" style={{ marginTop: '1rem' }}>
          {!local && <button onClick={() => void loadCases()} data-testid="refresh-cases">{s('station.refresh')}</button>}
          <button onClick={() => { setPracticeRun((n) => n + 1); setStep('practice'); }} data-testid="practice-again-list">{s('station.practice_again')}</button>
        </div>
      </div>
    );
  } else if (step === 'playing' && active) {
    body = (
      <CasePlayer
        key={active.attemptId}
        playerCase={active.playerCase}
        mode="assessment"
        attemptId={active.attemptId}
        startedAt={active.startedAt}
        studentId={local ? studentId : auth.user?.id}
        stationId={local ? localStation || sid : sid}
        caseVersion={active.caseVersion}
        modelVersion={active.modelVersion}
        onSubmit={onSubmit}
        summaryNote={summaryNote}
        forceSubmit={forceEnd}
        onExit={() => { setActive(null); if (forceEnd) signOut(); else setStep('cases'); }}
      />
    );
  }

  return (
    <div className="station-root" data-testid="station" data-step={step} data-local={local ? '1' : '0'}>
      <header className="station-topbar">
        <strong>{s('app.title')}</strong>
        <span className="small" data-testid="station-label">{s('station', { id: local ? localStation || sid : sid })}</span>
        {studentId && step !== 'signin' && <span className="small">· {studentId}</span>}
        {!local && (
          <span className="small" data-testid="sync-status" data-pending={pending}>
            {!online ? s('offline') : pending > 0 ? s('pending_sync', { count: pending }) : s('synced')}
          </span>
        )}
        <span className="spacer" />
        <AccessibilityBar />
        {step !== 'signin' && step !== 'playing' && <button onClick={signOut} data-testid="sign-out">{s('station.end_session')}</button>}
        {kiosk ? <KioskExitButton onExit={() => setKiosk(false)} /> : <span className="small" data-testid="kiosk-off">{kioskWanted ? s('kiosk.exited') : ''}</span>}
      </header>
      <main className="station-main">{body}</main>
      <HandCursor />
      <HandLostWarning />
      <InputNotice />
      {locked && <LockOverlay />}
    </div>
  );
}

