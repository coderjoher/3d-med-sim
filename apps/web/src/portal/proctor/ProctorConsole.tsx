import { useState } from 'react';
import { Link, useParams } from 'react-router-dom';
import type { CaseRecord, Cohort, LabSession, StationCommand, StationState, User } from '@medsim/core';
import { api } from '../../shared/api';
import { usePrefs } from '../../shared/prefs';
import { errorText, errorList, useApi, usePoll } from '../hooks';
import { Empty, ErrorBox, Loading } from '../ui';
import { fmtDate } from '../author/CaseList';

export const STATION_POLL_MS = 3000;
/** A station that has not sent a heartbeat for this long is shown as offline. */
export const OFFLINE_AFTER_MS = 15000;

/** Session list + create form (R-08, §8 proctor journey). */
export function SessionsPage() {
  const { s } = usePrefs();
  const sessions = useApi<LabSession[]>('/sessions');
  const cohorts = useApi<Cohort[]>('/cohorts');
  const cases = useApi<CaseRecord[]>('/cases?status=published');
  const [name, setName] = useState('');
  const [cohortId, setCohortId] = useState('');
  const [caseIds, setCaseIds] = useState<string[]>([]);
  const [timeLimit, setTimeLimit] = useState('');
  const [errors, setErrors] = useState<string[]>([]);
  const cohort = cohortId || cohorts.data?.[0]?.id || '';
  const published = (cases.data ?? []).filter((c) => c.status === 'published');
  const cohortName = (id: string) => cohorts.data?.find((c) => c.id === id)?.name ?? id;

  const create = async () => {
    const errs: string[] = [];
    if (!name.trim()) errs.push(s('p.err_session_name'));
    if (!cohort) errs.push(s('p.err_cohort'));
    if (!caseIds.length) errs.push(s('p.err_case_set'));
    setErrors(errs);
    if (errs.length) return;
    try {
      const body: Record<string, unknown> = { name: name.trim(), cohort_id: cohort, case_ids: caseIds };
      if (timeLimit.trim()) body.time_limit_min = Number(timeLimit);
      await api<LabSession>('/sessions', { method: 'POST', json: body });
      setName(''); setCaseIds([]); setTimeLimit('');
      sessions.reload();
    } catch (e) {
      setErrors(errorList(e));
    }
  };

  return (
    <div>
      <h1>{s('sessions')}</h1>
      <section className="card portal-section">
        <h2>{s('new_session')}</h2>
        <div className="row">
          <label>{s('p.session_name')} <input data-testid="session-name" value={name} onChange={(e) => setName(e.target.value)} /></label>
          <label>{s('p.cohort')}{' '}
            <select data-testid="session-cohort" value={cohort} onChange={(e) => setCohortId(e.target.value)}>
              {(cohorts.data ?? []).map((c) => <option key={c.id} value={c.id}>{c.name} ({c.year})</option>)}
            </select>
          </label>
          <label>{s('time_limit')} <input data-testid="session-time" type="number" min={1} value={timeLimit} onChange={(e) => setTimeLimit(e.target.value)} style={{ width: '6em' }} /></label>
        </div>
        <fieldset className="portal-checks" data-testid="session-cases">
          <legend>{s('p.case_set')}</legend>
          {published.length === 0 && <span className="muted">{s('p.no_published')}</span>}
          {published.map((c) => (
            <label key={c.id}>
              <input type="checkbox" data-testid={`session-case-${c.id}`} checked={caseIds.includes(c.id)} onChange={() => setCaseIds(caseIds.includes(c.id) ? caseIds.filter((x) => x !== c.id) : [...caseIds, c.id])} />
              {' '}<code>{c.id}</code> v{c.version} <span className="muted">({c.data.course})</span>
            </label>
          ))}
        </fieldset>
        <ErrorBox errors={errors} />
        <button type="button" className="primary" data-testid="create-session" onClick={() => void create()}>{s('p.create_session')}</button>
      </section>

      <ErrorBox error={sessions.error} />
      <Loading when={sessions.loading && !sessions.data}>
        <Empty show={(sessions.data ?? []).length === 0} />
        {(sessions.data ?? []).length > 0 && (
          <table data-testid="sessions-table">
            <thead><tr><th>{s('p.session_name')}</th><th>{s('p.cohort')}</th><th>{s('cases')}</th><th>{s('status')}</th><th>{s('p.started')}</th><th /></tr></thead>
            <tbody>
              {[...(sessions.data ?? [])].reverse().map((x) => (
                <tr key={x.id} data-testid={`session-row-${x.id}`}>
                  <td>{x.name}</td>
                  <td>{cohortName(x.cohort_id)}</td>
                  <td>{x.case_ids.join(', ')}</td>
                  <td><span className={`portal-badge portal-session-${x.status}`}>{s(`p.session.${x.status}`)}</span></td>
                  <td>{fmtDate(x.started_at)}</td>
                  <td><Link to={`/portal/sessions/${encodeURIComponent(x.id)}`} data-testid={`open-session-${x.id}`}>{s('p.open_console')}</Link></td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </Loading>
    </div>
  );
}

/** Live proctor console for one session: start/stop, station grid polled every 3 s, remote commands (R-08, I-05). */
export function SessionConsole() {
  const { id = '' } = useParams();
  const { s } = usePrefs();
  const sessionRes = useApi<LabSession>(`/sessions/${encodeURIComponent(id)}`);
  const users = useApi<User[]>('/users');
  const stations = usePoll<StationState[]>(`/sessions/${encodeURIComponent(id)}/stations`, STATION_POLL_MS);
  const [override, setOverride] = useState<LabSession | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const session = override ?? sessionRes.data;
  const studentName = (sid?: string) => (sid ? users.data?.find((u) => u.id === sid || u.username === sid)?.display_name ?? sid : '—');

  const control = async (action: 'start' | 'stop') => {
    setError(null);
    try {
      setOverride(await api<LabSession>(`/sessions/${encodeURIComponent(id)}/${action}`, { method: 'POST' }));
    } catch (e) { setError(errorText(e)); }
  };
  const command = async (stationId: string, cmd: StationCommand) => {
    setError(null);
    try {
      await api(`/stations/${encodeURIComponent(stationId)}/command`, { method: 'POST', json: cmd });
      setNotice(s('p.command_queued', { station: stationId, cmd: s(`p.cmd.${cmd.type}${cmd.type === 'set-input' ? `.${cmd.mode}` : ''}`) }));
      stations.reload();
    } catch (e) { setError(errorText(e)); }
  };

  const now = Date.now();
  const list = stations.data ?? [];
  return (
    <div>
      <div className="row">
        <h1>{session?.name ?? id}</h1>
        {session && <span className={`portal-badge portal-session-${session.status}`} data-testid="session-status">{s(`p.session.${session.status}`)}</span>}
        <Link to="/portal/sessions">{s('back')}</Link>
      </div>
      {session && (
        <p className="muted">
          {s('cases')}: {session.case_ids.join(', ')}{session.time_limit_min ? ` · ${s('time_limit')}: ${session.time_limit_min}` : ''}
          {session.started_at ? ` · ${s('p.started')}: ${fmtDate(session.started_at)}` : ''}
        </p>
      )}
      <div className="row">
        <button type="button" className="primary" data-testid="start-session" disabled={!session || session.status === 'running'} onClick={() => void control('start')}>{s('start_session')}</button>
        <button type="button" data-testid="stop-session" disabled={!session || session.status !== 'running'} onClick={() => void control('stop')}>{s('stop_session')}</button>
        <span className="muted" data-testid="poll-info">{s('p.auto_refresh', { n: STATION_POLL_MS / 1000 })}</span>
      </div>
      <ErrorBox error={error || sessionRes.error || stations.error} />
      {notice && <p role="status" className="portal-ok">{notice}</p>}

      <h2>{s('stations')} <span className="muted">({list.length})</span></h2>
      <Empty show={list.length === 0 && !stations.loading} />
      <div className="portal-station-grid" data-testid="station-grid">
        {list.map((st) => {
          const offline = st.status === 'offline' || now - st.last_seen > OFFLINE_AFTER_MS;
          return (
            <div key={st.station_id} className={`card portal-station${offline ? ' portal-station-offline' : ''}${st.locked ? ' portal-station-locked' : ''}`} data-testid={`station-${st.station_id}`} data-offline={offline ? 'true' : 'false'}>
              <div className="row"><strong>{s('station', { id: st.station_id })}</strong>{offline && <span className="portal-badge portal-badge-bad">{s('station.offline')}</span>}{st.locked && <span className="portal-badge">🔒 {s('p.locked')}</span>}</div>
              <dl className="portal-dl">
                <dt>{s('status')}</dt><dd data-testid={`station-status-${st.station_id}`}>{s(`station.${offline ? 'offline' : st.status}`)}</dd>
                <dt>{s('p.camera')}</dt><dd className={st.camera_ok ? 'portal-ok' : 'error'}>{st.camera_ok ? s('p.camera_ok') : s('p.camera_fail')}</dd>
                <dt>{s('input_mode')}</dt><dd>{s(`input.${st.input_mode}`)}</dd>
                <dt>{s('student')}</dt><dd>{studentName(st.student_id)}</dd>
                <dt>{s('case')}</dt><dd>{st.case_id ?? '—'}</dd>
                <dt>{s('p.last_seen')}</dt><dd>{ago(now - st.last_seen, s)}</dd>
              </dl>
              <div className="row">
                {st.input_mode === 'gesture'
                  ? <button type="button" data-testid={`fallback-${st.station_id}`} onClick={() => void command(st.station_id, { type: 'set-input', mode: 'fallback' })}>{s('switch_to_mouse')}</button>
                  : <button type="button" data-testid={`gesture-${st.station_id}`} onClick={() => void command(st.station_id, { type: 'set-input', mode: 'gesture' })}>{s('switch_to_gestures')}</button>}
                {st.locked
                  ? <button type="button" data-testid={`unlock-${st.station_id}`} onClick={() => void command(st.station_id, { type: 'unlock' })}>{s('unlock_station')}</button>
                  : <button type="button" data-testid={`lock-${st.station_id}`} onClick={() => void command(st.station_id, { type: 'lock' })}>{s('lock_station')}</button>}
                <button type="button" data-testid={`end-${st.station_id}`} onClick={() => void command(st.station_id, { type: 'end-session' })}>{s('p.end_station_session')}</button>
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
}

function ago(ms: number, s: (k: string, v?: Record<string, string | number>) => string): string {
  const sec = Math.max(0, Math.round(ms / 1000));
  return sec < 60 ? s('p.seconds_ago', { n: sec }) : s('p.minutes_ago', { n: Math.round(sec / 60) });
}
