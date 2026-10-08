/** I-07: hand cursor, tracking-status indicator and "hand lost" warning. */
import { usePrefs } from '../shared/prefs';
import { useStationInput } from './StationInput';

export function HandCursor() {
  const input = useStationInput();
  if (!input?.cursor) return null;
  const { x, y, pinching } = input.cursor;
  return (
    <div
      className={`hand-cursor${pinching ? ' pinching' : ''}`}
      data-testid="hand-cursor"
      aria-hidden="true"
      style={{ transform: `translate(${x * 100}vw, ${y * 100}vh) translate(-50%, -50%)` }}
    />
  );
}

export function TrackingIndicator() {
  const input = useStationInput();
  const { s } = usePrefs();
  if (!input) return null;
  const { mode, status } = input;
  const ok = mode === 'gesture' && status === 'tracking';
  const label = mode === 'fallback'
    ? s('input.fallback')
    : status === 'tracking' ? s('tracking_ok')
      : status === 'starting' ? s('input.starting')
        : s('tracking_off');
  return (
    <span className={`tracking-indicator ${ok ? 'ok' : mode === 'fallback' ? 'fallback' : 'off'}`} data-testid="tracking-status" data-status={mode === 'fallback' ? 'fallback' : status} role="status">
      <span className="dot" aria-hidden="true" /> {label}
    </span>
  );
}

export function HandLostWarning() {
  const input = useStationInput();
  const { s } = usePrefs();
  if (!input?.handLost) return null;
  return <div className="hand-lost-warning" role="alert" data-testid="hand-lost">{s('hand_lost')}</div>;
}

export function InputNotice() {
  const input = useStationInput();
  const { s } = usePrefs();
  if (!input?.notice) return null;
  const vars = Object.fromEntries(Object.entries(input.notice.vars ?? {}).map(([k, v]) => [k, s(v)]));
  return (
    <div className="input-notice" role="status" data-testid="input-notice">
      <span>{s(input.notice.key, vars)}</span>
      <button onClick={input.dismissNotice} aria-label={s('close')}>×</button>
    </div>
  );
}
