import { afterEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, renderHook, screen } from '@testing-library/react';
import { PrefsProvider } from '../shared/prefs';
import { KioskExitButton, PROCTOR_PIN, useKioskLock } from './Kiosk';

afterEach(cleanup);

function key(init: KeyboardEventInit) {
  const e = new KeyboardEvent('keydown', { bubbles: true, cancelable: true, ...init });
  window.dispatchEvent(e);
  return e.defaultPrevented;
}

describe('kiosk lockdown', () => {
  it('[T0-24] blocks exit shortcuts and the context menu while locked; normal keys pass', () => {
    const { unmount } = renderHook(() => useKioskLock(true));
    expect(key({ key: 'w', ctrlKey: true })).toBe(true);
    expect(key({ key: 'F4', altKey: true })).toBe(true);
    expect(key({ key: 'F11' })).toBe(true);
    expect(key({ key: 'I', ctrlKey: true, shiftKey: true })).toBe(true);
    expect(key({ key: 'ArrowLeft' })).toBe(false);
    expect(key({ key: 'a' })).toBe(false);
    const ctx = new MouseEvent('contextmenu', { bubbles: true, cancelable: true });
    window.dispatchEvent(ctx);
    expect(ctx.defaultPrevented).toBe(true);
    const bu = new Event('beforeunload', { cancelable: true });
    window.dispatchEvent(bu);
    expect(bu.defaultPrevented).toBe(true);
    unmount();
    expect(key({ key: 'w', ctrlKey: true })).toBe(false);
  });

  it('[T0-24] exiting kiosk mode requires the proctor PIN', () => {
    const onExit = vi.fn();
    render(<PrefsProvider><KioskExitButton onExit={onExit} /></PrefsProvider>);
    fireEvent.click(screen.getByTestId('kiosk-exit'));
    fireEvent.change(screen.getByTestId('pin-input'), { target: { value: '0000' } });
    fireEvent.click(screen.getByTestId('pin-submit'));
    expect(screen.getByTestId('pin-error')).toHaveTextContent('Incorrect PIN');
    expect(onExit).not.toHaveBeenCalled();
    fireEvent.change(screen.getByTestId('pin-input'), { target: { value: PROCTOR_PIN } });
    fireEvent.click(screen.getByTestId('pin-submit'));
    expect(onExit).toHaveBeenCalledTimes(1);
    expect(screen.queryByTestId('pin-dialog')).toBeNull();
  });
});
