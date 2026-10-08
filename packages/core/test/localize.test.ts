import { describe, expect, it } from 'vitest';
import { isRtl, registerStrings, t, ui, UI_STRINGS } from '../src/localize.js';
import { HEART_CASES } from '../src/content/index.js';

describe('localization', () => {
  it('[T1-16] bilingual text resolves per language with English fallback', () => {
    expect(t({ en: 'Heart', ar: 'القلب' }, 'ar')).toBe('القلب');
    expect(t({ en: 'Heart', ar: 'القلب' }, 'en')).toBe('Heart');
    expect(t({ en: 'Heart' }, 'ar')).toBe('Heart');
    expect(t('plain', 'ar')).toBe('plain');
    expect(t(undefined, 'en')).toBe('');
    const card = HEART_CASES[2];
    expect(t(card.stem, 'ar')).toMatch(/[؀-ۿ]/);
    expect(t(card.questions[0].prompt, 'ar')).toBe('اختر الصمام المصاب.');
  });

  it('[T1-16] Arabic is RTL, English LTR', () => {
    expect(isRtl('ar')).toBe(true);
    expect(isRtl('en')).toBe(false);
  });

  it('[T1-16] ui() interpolates variables and falls back to English, then the key', () => {
    expect(ui('question_of', 'en', { n: 2, total: 5 })).toBe('Question 2 of 5');
    expect(ui('question_of', 'ar', { n: 2, total: 5 })).toBe('السؤال 2 من 5');
    expect(ui('next', 'ar')).toBe('التالي');
    expect(ui('no.such.key', 'ar')).toBe('no.such.key');
    registerStrings({ 'test.only_en': { en: 'Only {x}', ar: '' } });
    expect(ui('test.only_en', 'ar', { x: 'EN' })).toBe('Only EN');
    expect(ui('question_of', 'en', { n: 1 })).toBe('Question 1 of {total}');
    delete UI_STRINGS['test.only_en'];
  });

  it('[T1-16] every UI string has an Arabic translation and the station/portal keys exist', () => {
    const keys = Object.keys(UI_STRINGS);
    expect(keys.length).toBeGreaterThan(100);
    for (const k of keys) {
      expect(UI_STRINGS[k].en, k).toBeTruthy();
      expect(UI_STRINGS[k].ar, k).toMatch(/[؀-ۿ]/);
    }
    for (const k of ['next', 'previous', 'confirm', 'cancel', 'submit', 'reset_view', 'labels', 'layers', 'time_remaining', 'hand_lost', 'calibration', 'practice_mode', 'score_summary', 'login']) {
      expect(UI_STRINGS[k], k).toBeDefined();
    }
  });
});
