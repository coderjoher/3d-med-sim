import type { Lang, LocalizedText } from './types.js';
/** Resolve bilingual text, falling back to English. */
export function t(text: LocalizedText | undefined, lang: Lang): string { throw new Error("not implemented"); }
export function isRtl(lang: Lang): boolean { throw new Error("not implemented"); }
/** UI string table keyed by id, EN and AR (NFR localization). */
export const UI_STRINGS: Record<string, { en: string; ar: string }> = {};
export function ui(key: string, lang: Lang, vars?: Record<string, string | number>): string { throw new Error("not implemented"); }
