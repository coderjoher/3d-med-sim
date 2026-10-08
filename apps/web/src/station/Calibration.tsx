/**
 * I-03 calibration (~10 s): the student reaches to four corner targets and pinches
 * (or clicks). Index-tip samples build the reach box via core computeCalibration.
 * "Skip — use mouse" switches to fallback input.
 */
import { useEffect, useRef, useState } from 'react';
import { computeCalibration, type Calibration as Cal } from '@medsim/core';
import { usePrefs } from '@shared/prefs';
import { useStationInput } from './StationInput';

const TARGETS = [
  { key: 'calibration.top_left', x: 0.1, y: 0.12 },
  { key: 'calibration.top_right', x: 0.9, y: 0.12 },
  { key: 'calibration.bottom_right', x: 0.9, y: 0.88 },
  { key: 'calibration.bottom_left', x: 0.1, y: 0.88 },
];

export function Calibration({ onDone }: { onDone(c: Cal | null): void }) {
  const { s } = usePrefs();
  const input = useStationInput();
  const [step, setStep] = useState(0);
  const samples = useRef<Array<{ x: number; y: number }>>([]);
  const wasPinching = useRef(false);
  const stepRef = useRef(step);
  stepRef.current = step;

  const finish = () => {
    const c = samples.current.length >= 2 ? computeCalibration(samples.current, true) : null;
    if (c) input?.setCalibration(c);
    onDone(c);
  };

  const advance = (sample?: { x: number; y: number }) => {
    if (sample) samples.current.push(sample);
    if (stepRef.current >= TARGETS.length - 1) finish();
    else setStep((n) => n + 1);
  };

  // pinch rising edge records the raw (camera) index-tip position for the active target
  useEffect(() => {
    if (!input) return;
    return input.onRawIndex((p, pinch) => {
      if (p && pinch && !wasPinching.current) advance(p);
      wasPinching.current = pinch;
    });
  }, [input]); // eslint-disable-line react-hooks/exhaustive-deps

  const skip = () => {
    void input?.setMode('fallback');
    onDone(null);
  };

  return (
    <div className="calibration" data-testid="calibration">
      {TARGETS.map((t, i) => (
        <button
          key={t.key}
          className={`cal-target ${i === step ? 'active' : ''} ${i < step ? 'done' : ''}`}
          style={{ left: `${t.x * 100}%`, top: `${t.y * 100}%` }}
          disabled={i !== step}
          aria-label={s(t.key)}
          data-testid={`cal-target-${i}`}
          // click/tap fallback: no hand sample, just advance
          onClick={() => i === step && advance()}
        />
      ))}
      <div className="cal-panel card">
        <h2>{s('calibration')}</h2>
        <p>{s('calibration.intro')}</p>
        <p className="muted">{s('calibration.step', { n: step + 1, total: TARGETS.length })}</p>
        <p data-testid="cal-instruction"><strong>{s(TARGETS[step].key)}</strong></p>
        <p className="muted small">{s('calibration.click_target')}</p>
        <button onClick={skip} data-testid="cal-skip">{s('calibration.skip')}</button>
      </div>
    </div>
  );
}
