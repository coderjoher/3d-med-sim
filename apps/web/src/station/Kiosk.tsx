/**
 * R-09 kiosk lockdown (browser layer; the Tauri / Chromium --kiosk shell adds OS-level lockdown):
 * full screen, exit shortcuts and context menu blocked, navigation guarded,
 * exit requires the proctor PIN.
 */
import { useEffect, useState } from 'react';
import { checkProctorPin, isBlockedKey } from '@medsim/core';
import { usePrefs } from '../shared/prefs';
import { debugRoot } from '../viewer/debug';

export const PROCTOR_PIN: string = (import.meta.env?.VITE_PROCTOR_PIN as string | undefined) || '2468';

export function useKioskLock(enabled: boolean) {
  useEffect(() => {
    if (!enabled) return;
    const d = debugRoot();
    d.kiosk = { active: true, blocked: 0 };
    const kiosk = d.kiosk as { active: boolean; blocked: number };
    const onKey = (e: KeyboardEvent) => {
      // Escape still closes our own dialogs when one is open
      if (e.key === 'Escape' && document.querySelector('[role="dialog"]')) return;
      if (isBlockedKey(e)) {
        e.preventDefault();
        e.stopPropagation();
        kiosk.blocked++;
      }
    };
    const onCtx = (e: Event) => { e.preventDefault(); kiosk.blocked++; };
    const onBefore = (e: BeforeUnloadEvent) => { e.preventDefault(); e.returnValue = ''; return ''; };
    const goFull = () => {
      const el = document.documentElement;
      if (!document.fullscreenElement && el.requestFullscreen) el.requestFullscreen({ navigationUI: 'hide' }).catch(() => undefined);
    };
    // requestFullscreen needs a user gesture: enter on the first interaction and re-enter if left
    const onPointer = () => goFull();
    const onDrop = (e: DragEvent) => e.preventDefault();
    const onPop = () => history.pushState(null, '', location.href);
    history.pushState(null, '', location.href);
    window.addEventListener('keydown', onKey, true);
    window.addEventListener('contextmenu', onCtx, true);
    window.addEventListener('beforeunload', onBefore);
    window.addEventListener('pointerdown', onPointer, true);
    window.addEventListener('dragover', onDrop);
    window.addEventListener('drop', onDrop);
    window.addEventListener('popstate', onPop);
    document.documentElement.dataset.kiosk = 'locked';
    return () => {
      kiosk.active = false;
      window.removeEventListener('keydown', onKey, true);
      window.removeEventListener('contextmenu', onCtx, true);
      window.removeEventListener('beforeunload', onBefore);
      window.removeEventListener('pointerdown', onPointer, true);
      window.removeEventListener('dragover', onDrop);
      window.removeEventListener('drop', onDrop);
      window.removeEventListener('popstate', onPop);
      delete document.documentElement.dataset.kiosk;
    };
  }, [enabled]);
}

export function KioskExitButton({ onExit }: { onExit(): void }) {
  const { s } = usePrefs();
  const [open, setOpen] = useState(false);
  const [pin, setPin] = useState('');
  const [err, setErr] = useState('');
  const submit = (e: React.FormEvent) => {
    e.preventDefault();
    if (checkProctorPin(pin, PROCTOR_PIN)) {
      setOpen(false);
      setPin('');
      setErr('');
      if (document.fullscreenElement) document.exitFullscreen().catch(() => undefined);
      // Inside the Tauri kiosk shell, the native side re-checks the PIN and quits the app.
      const tauri = (window as unknown as { __TAURI__?: { core?: { invoke(cmd: string, args: unknown): Promise<unknown> } } }).__TAURI__;
      tauri?.core?.invoke('exit_kiosk', { pin }).catch(() => undefined);
      onExit();
    } else {
      setErr(s('wrong_pin'));
      setPin('');
    }
  };
  return (
    <>
      <button className="kiosk-exit" onClick={() => setOpen(true)} aria-label={s('exit_kiosk')} title={s('exit_kiosk')} data-testid="kiosk-exit">⏻</button>
      {open && (
        <div className="modal-backdrop">
          <form className="modal card" role="dialog" aria-modal="true" aria-labelledby="pin-title" onSubmit={submit} data-testid="pin-dialog">
            <h3 id="pin-title">{s('kiosk.exit_prompt')}</h3>
            <label>{s('proctor_pin')}{' '}
              <input type="password" inputMode="numeric" autoComplete="off" value={pin} onChange={(e) => setPin(e.target.value)} autoFocus data-testid="pin-input" />
            </label>
            {err && <p className="error" role="alert" data-testid="pin-error">{err}</p>}
            <div className="row">
              <button className="primary" type="submit" data-testid="pin-submit">{s('ok')}</button>
              <button type="button" onClick={() => { setOpen(false); setErr(''); setPin(''); }}>{s('cancel')}</button>
            </div>
          </form>
        </div>
      )}
    </>
  );
}

export function LockOverlay() {
  const { s } = usePrefs();
  return (
    <div className="lock-overlay" role="alertdialog" aria-modal="true" data-testid="lock-overlay">
      <div>
        <div style={{ fontSize: '3rem' }} aria-hidden="true">🔒</div>
        <p>{s('station_locked')}</p>
        <p style={{ fontSize: '1rem', opacity: 0.8 }}>{s('kiosk.locked_hint')}</p>
      </div>
    </div>
  );
}
