import { readFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import ExcelJS from 'exceljs';
import { buildTemplateWorkbook, casesToCsv, casesToWorkbook, convertCsv, convertWorkbook, TEMPLATE_EXAMPLE_CASE } from '../src/spreadsheet.js';
import { parseCsv, toCsv } from '../src/csv.js';
import { BUILTIN_CASES, HEART_CASES, PRACTICE_CASE, courseSlug } from '../src/content/index.js';
import type { CaseData } from '../src/types.js';

const root = fileURLToPath(new URL('../../../', import.meta.url));

describe('csv', () => {
  it('[T0-22] CSV round trip with quotes, commas, newlines and Arabic', () => {
    const rows = [{ a: 'x,y', b: 'he said "hi"', c: 'line1\nline2' }, { a: 'القلب', b: 3, c: null }];
    const csv = toCsv(rows);
    expect(csv.startsWith('a,b,c\r\n')).toBe(true);
    expect(parseCsv(csv)).toEqual([['a', 'b', 'c'], ['x,y', 'he said "hi"', 'line1\nline2'], ['القلب', '3', '']]);
    expect(parseCsv('﻿a,b\n1,2')).toEqual([['a', 'b'], ['1', '2']]);
    expect(toCsv([{ a: 1 }], ['a', 'z'])).toBe('a,z\r\n1,\r\n');
  });
});

describe('spreadsheet conversion', () => {
  it('[T0-22] template workbook has instructions, headers and an example row that converts to valid JSON', async () => {
    const bytes = await buildTemplateWorkbook();
    const wb = new ExcelJS.Workbook();
    await wb.xlsx.load(bytes as any);
    expect(wb.worksheets.map((w) => w.name)).toEqual(['Instructions', 'Cases', 'Questions', 'Structures']);
    const r = await convertWorkbook(bytes);
    expect(r.errors).toEqual([]);
    expect(r.cases).toEqual([TEMPLATE_EXAMPLE_CASE]);
  });

  it('[T0-22] XLSX and CSV round trip all built-in cases', async () => {
    const all: CaseData[] = [PRACTICE_CASE, ...BUILTIN_CASES];
    const x = await convertWorkbook(await casesToWorkbook(all));
    expect(x.errors).toEqual([]);
    expect(x.cases).toEqual(all);
    const csv = casesToCsv(all);
    const c = convertCsv(csv.cases, csv.questions);
    expect(c.errors).toEqual([]);
    expect(c.cases).toEqual(all);
  });

  it('[T0-22] row errors are reported with sheet, row and case; structure names resolve to TA ids', () => {
    const cases = toCsv([
      { case_id: 'OK-1', course: 'C', model: 'heart_v1', variant: 'normal', stem_en: 'Stem', camera: 'anterior' },
      { case_id: 'BAD-1', course: 'C', model: 'heart_v1', variant: 'nonexistent', stem_en: 'Stem', labels_visible: 'maybe' },
      { case_id: 'BAD-2', course: 'C', model: 'heart_v1', variant: 'normal', stem_en: 'Stem' },
      { case_id: '', course: 'C', model: 'heart_v1', variant: 'normal', stem_en: 'orphan' },
    ]);
    const questions = toCsv([
      { case_id: 'OK-1', question_id: 'q1', type: 'identify', prompt_en: 'Select the mitral valve', answer: 'Mitral valve', points: 1 },
      { case_id: 'OK-1', question_id: 'q2', type: 'mcq', prompt_en: 'Pick', options: 'a=One|b=Two', options_ar: 'a=واحد|b=اثنان', answer: 'a', points: 1 },
      { case_id: 'BAD-1', question_id: 'q1', type: 'identify', prompt_en: 'x', answer: 'TA:mitral_valve', points: 'two' },
      { case_id: 'BAD-2', question_id: 'q1', type: 'identify', prompt_en: 'x', answer: 'TA:spleen', points: 1 },
      { case_id: 'BAD-1', question_id: 'q2', type: 'essay', prompt_en: 'x', answer: 'a', points: 1 },
      { case_id: 'NOPE', question_id: 'q1', type: 'mcq', prompt_en: 'x', answer: 'a', points: 1 },
    ]);
    const r = convertCsv(cases, questions);
    expect(r.cases.map((c) => c.case_id)).toEqual(['OK-1']);
    expect(r.cases[0].questions[0].answer).toEqual(['TA:mitral_valve']);
    expect(r.cases[0].questions[1].options).toEqual({ a: { en: 'One', ar: 'واحد' }, b: { en: 'Two', ar: 'اثنان' } });
    const has = (sheet: string, row: number, re: RegExp) =>
      expect(r.errors.some((e) => e.sheet === sheet && e.row === row && re.test(e.message)), `${sheet}:${row} ${re}`).toBe(true);
    has('Cases', 3, /labels_visible must be yes or no/);
    has('Cases', 5, /case_id is required/);
    has('Questions', 4, /points must be a number/);
    has('Questions', 5, /structure "TA:spleen" does not exist/);
    has('Questions', 6, /type must be one of/);
    expect(r.errors.filter((e) => e.sheet === 'Questions' && e.row === 6)).toHaveLength(1); // no duplicate schema message
    has('Questions', 7, /"NOPE" is not defined/);
    expect(r.errors.find((e) => e.row === 4 && e.sheet === 'Questions')?.case_id).toBe('BAD-1');
    const missing = convertCsv('case_id,course\nX,Y\n', questions);
    expect(missing.errors[0]).toMatchObject({ sheet: 'Cases', row: 1 });
    expect(missing.errors[0].message).toMatch(/missing column\(s\): model, variant, stem_en/);
  });

  it('[T0-22] unreadable workbook is reported, not thrown', async () => {
    const r = await convertWorkbook(new Uint8Array([1, 2, 3]));
    expect(r.cases).toEqual([]);
    expect(r.errors).toHaveLength(1);
  });

  it('[T0-23] shipped cases.xlsx converts to the three built-in heart cases; JSON files match', async () => {
    const dir = `${root}content/courses/${courseSlug(HEART_CASES[0].course)}`;
    const r = await convertWorkbook(new Uint8Array(await readFile(`${dir}/cases.xlsx`)));
    expect(r.errors).toEqual([]);
    expect(r.cases).toEqual(HEART_CASES);
    for (const c of [PRACTICE_CASE, ...BUILTIN_CASES]) {
      const json = JSON.parse(await readFile(`${root}content/courses/${courseSlug(c.course)}/${c.case_id}.json`, 'utf8'));
      expect(json).toEqual(c);
    }
    const tpl = await convertWorkbook(new Uint8Array(await readFile(`${root}content/templates/case-template.xlsx`)));
    expect(tpl.errors).toEqual([]);
  });
});
