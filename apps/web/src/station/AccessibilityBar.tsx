/** NFR accessibility / localization + I-05, I-06, I-08 and T3-04 station toggles. */
import { usePrefs } from '@shared/prefs';
import { useStationInput } from './StationInput';
import { TrackingIndicator } from './HandOverlay';

export function AccessibilityBar() {
  const p = usePrefs();
  const { s } = p;
  const input = useStationInput();
  const scale = Math.round(p.textScale * 100) / 100;
  return (
    <div className="a11y-bar" role="group" aria-label={s('a11y.bar')} data-testid="a11y-bar">
      <label>{s('language')}
        <select value={p.lang} onChange={(e) => p.set({ lang: e.target.value as 'en' | 'ar' })} data-testid="lang-select">
          <option value="en">English</option>
          <option value="ar">العربية</option>
        </select>
      </label>
      <span aria-label={s('text_size')} className="row" style={{ gap: '0.2rem' }}>
        <button onClick={() => p.set({ textScale: Math.max(0.85, Math.round((scale - 0.15) * 100) / 100) })} aria-label={s('a11y.text_smaller')} data-testid="text-smaller">A−</button>
        <button onClick={() => p.set({ textScale: Math.min(1.6, Math.round((scale + 0.15) * 100) / 100) })} aria-label={s('a11y.text_larger')} data-testid="text-larger">A+</button>
      </span>
      <label>
        <input type="checkbox" checked={p.highContrastPalette} onChange={(e) => p.set({ highContrastPalette: e.target.checked })} data-testid="cb-palette" />
        {s('high_contrast')}
      </label>
      <label>{s('primary_hand')}
        <select value={p.handedness} onChange={(e) => p.set({ handedness: e.target.value as 'left' | 'right' })} data-testid="hand-select">
          <option value="right">{s('hand.right')}</option>
          <option value="left">{s('hand.left')}</option>
        </select>
      </label>
      {input && (
        <>
          <button onClick={() => void input.setMode(input.mode === 'gesture' ? 'fallback' : 'gesture')} data-testid="input-toggle">
            {input.mode === 'gesture' ? s('switch_to_mouse') : s('switch_to_gestures')}
          </button>
          <label>
            <input type="checkbox" checked={input.parallaxOn} onChange={(e) => input.setParallaxOn(e.target.checked)} data-testid="parallax-toggle" />
            {s('parallax')}
          </label>
          <label>
            <input type="checkbox" checked={input.stereo} onChange={(e) => input.setStereo(e.target.checked)} data-testid="stereo-toggle" />
            {s('player.stereo')}
          </label>
          <TrackingIndicator />
        </>
      )}
    </div>
  );
}
