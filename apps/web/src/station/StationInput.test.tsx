import { afterEach, describe, expect, it, vi } from 'vitest';
import { act, cleanup, render, screen, waitFor } from '@testing-library/react';
import type { SemanticEvent } from '@medsim/core';
import { PrefsProvider } from '../shared/prefs';
import { StationInputProvider, useStationInput, type StationInputCtx } from './StationInput';
import { HandLostWarning, InputNotice, TrackingIndicator } from './HandOverlay';

let ctx: StationInputCtx | null = null;
function Probe() { ctx = useStationInput(); return null; }

function setup(initialMode: 'gesture' | 'fallback') {
  render(
    <PrefsProvider>
      <StationInputProvider initialMode={initialMode}>
        <Probe /><TrackingIndicator /><HandLostWarning /><InputNotice />
      </StationInputProvider>
    </PrefsProvider>,
  );
}

afterEach(() => { cleanup(); ctx = null; vi.unstubAllGlobals(); });

describe('station input', () => {
  it('[T0-14] camera unavailable -> automatic fallback to mouse with a notice', async () => {
    Object.defineProperty(navigator, 'mediaDevices', { configurable: true, value: { getUserMedia: vi.fn().mockRejectedValue(Object.assign(new Error('denied'), { name: 'NotAllowedError' })) } });
    setup('gesture');
    await waitFor(() => expect(ctx!.mode).toBe('fallback'));
    expect(screen.getByTestId('input-notice')).toHaveTextContent('Camera unavailable — using mouse and keyboard');
    expect(screen.getByTestId('tracking-status')).toHaveAttribute('data-status', 'fallback');
  });

  it('[T0-14] keyboard emits semantic events; fallback can be switched at any time (student or proctor)', async () => {
    setup('fallback');
    const seen: SemanticEvent[] = [];
    ctx!.bus.on((e) => seen.push(e));
    act(() => { window.dispatchEvent(new KeyboardEvent('keydown', { key: 'ArrowRight', bubbles: true, cancelable: true })); });
    act(() => { window.dispatchEvent(new KeyboardEvent('keydown', { key: '+', bubbles: true, cancelable: true })); });
    expect(seen.map((e) => e.type)).toEqual(['rotate', 'zoom']);
    expect(seen.every((e) => 'source' in e && e.source === 'keyboard')).toBe(true);
    Object.defineProperty(navigator, 'mediaDevices', { configurable: true, value: undefined });
    await act(async () => { await ctx!.setMode('gesture', 'proctor'); });
    // no camera API -> stays usable in fallback
    expect(ctx!.mode).toBe('fallback');
    await act(async () => { await ctx!.setMode('fallback', 'proctor'); });
    expect(screen.getByTestId('input-notice')).toHaveTextContent('The proctor switched this station to Mouse / keyboard / touch');
  });

  it('[T0-16] hand-lost events raise the warning in gesture mode', async () => {
    Object.defineProperty(navigator, 'mediaDevices', { configurable: true, value: { getUserMedia: vi.fn().mockRejectedValue(new Error('x')) } });
    setup('fallback');
    // simulate gesture mode active
    act(() => { ctx!.bus.emit({ type: 'hand-lost', source: 'gesture' }); });
    expect(screen.queryByTestId('hand-lost')).toBeNull(); // not shown while on mouse
  });
});
