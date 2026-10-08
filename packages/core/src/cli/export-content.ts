/**
 * Regenerates the built-in content files from packages/core/src/content:
 *   content/courses/<course-slug>/<CASE_ID>.json   (every BUILTIN_CASE)
 *   content/courses/practice/PRACTICE-001.json
 *   content/templates/case-template.xlsx            (blank academic template, A-01)
 *   content/courses/anatomy-ii-thorax/cases.xlsx    (the 3 Phase-0 heart cases in template form)
 *   content/models/<model-id>.json                  (model registry, for reference)
 *
 * Usage: npx tsx packages/core/src/cli/export-content.ts [contentDir]
 */
import { mkdir, writeFile } from 'node:fs/promises';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { BUILTIN_CASES, HEART_CASES, MODELS, PRACTICE_CASE, courseSlug, getModel } from '../content/index.js';
import { validateCase } from '../schema.js';
import { buildTemplateWorkbook, casesToWorkbook } from '../spreadsheet.js';

const here = dirname(fileURLToPath(import.meta.url));
const contentDir = resolve(process.argv[2] ?? join(here, '../../../../content'));

async function write(path: string, data: string | Uint8Array): Promise<void> {
  await mkdir(dirname(path), { recursive: true });
  await writeFile(path, data);
  console.log('wrote', path);
}

async function main(): Promise<void> {
  for (const c of [PRACTICE_CASE, ...BUILTIN_CASES]) {
    const res = validateCase(c, getModel(c.model));
    if (!res.ok) throw new Error(`${c.case_id} is invalid:\n  ${res.errors.join('\n  ')}`);
    await write(join(contentDir, 'courses', courseSlug(c.course), `${c.case_id}.json`), JSON.stringify(c, null, 2) + '\n');
  }
  for (const m of MODELS) await write(join(contentDir, 'models', `${m.id}.json`), JSON.stringify(m, null, 2) + '\n');
  await write(join(contentDir, 'templates', 'case-template.xlsx'), await buildTemplateWorkbook());
  await write(join(contentDir, 'courses', courseSlug(HEART_CASES[0].course), 'cases.xlsx'), await casesToWorkbook(HEART_CASES));
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
