import { createContext, useContext, useEffect, useState, type ReactNode } from 'react';
import { isRtl, t as tText, ui, type Lang, type LocalizedText } from '@medsim/core';

/** Per-station display preferences (NFR accessibility & localization, I-08). */
export interface Prefs {
  lang: Lang;
  textScale: number; // 0.85 .. 1.6
  highContrastPalette: boolean; // colour-blind-safe highlight palette
  handedness: 'left' | 'right';
}

const DEFAULTS: Prefs = { lang: 'en', textScale: 1, highContrastPalette: false, handedness: 'right' };
const KEY = 'medsim.prefs';

interface PrefsCtx extends Prefs {
  set(p: Partial<Prefs>): void;
  /** UI string lookup */
  s(key: string, vars?: Record<string, string | number>): string;
  /** Resolve bilingual content */
  tx(text: LocalizedText | undefined): string;
}

const Ctx = createContext<PrefsCtx | null>(null);

function load(): Prefs {
  try { return { ...DEFAULTS, ...JSON.parse(localStorage.getItem(KEY) ?? '{}') }; } catch { return DEFAULTS; }
}

export function PrefsProvider({ children }: { children: ReactNode }) {
  const [prefs, setPrefs] = useState<Prefs>(load);

  useEffect(() => {
    try { localStorage.setItem(KEY, JSON.stringify(prefs)); } catch { /* ignore */ }
    const root = document.documentElement;
    root.lang = prefs.lang;
    root.dir = isRtl(prefs.lang) ? 'rtl' : 'ltr';
    root.style.setProperty('--text-scale', String(prefs.textScale));
    root.dataset.palette = prefs.highContrastPalette ? 'cb' : 'default';
  }, [prefs]);

  const value: PrefsCtx = {
    ...prefs,
    set: (p) => setPrefs((old) => ({ ...old, ...p })),
    s: (key, vars) => ui(key, prefs.lang, vars),
    tx: (text) => tText(text, prefs.lang),
  };
  return <Ctx.Provider value={value}>{children}</Ctx.Provider>;
}

export function usePrefs(): PrefsCtx {
  const c = useContext(Ctx);
  if (!c) throw new Error('usePrefs outside PrefsProvider');
  return c;
}
