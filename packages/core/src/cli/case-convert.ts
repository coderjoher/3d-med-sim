#!/usr/bin/env -S npx tsx
/**
 * A-01 converter: academic Case Template workbook → case JSON files.
 *
 * Usage: npx tsx packages/core/src/cli/case-convert.ts in.xlsx outDir/
 *        npx tsx packages/core/src/cli/case-convert.ts cases.csv questions.csv outDir/
 * Writes <outDir>/<CASE_ID>.json for every valid case and prints each row error.
 * Exit code: 0 = all rows converted, 1 = row errors, 2 = usage / IO error.
 */
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { convertCsv, convertWorkbook, type ConversionResult } from '../spreadsheet.js';

async function main(argv: string[]): Promise<number> {
  let result: ConversionResult;
  let outDir: string;
  if (argv.length === 2 && /\.xlsx$/i.test(argv[0])) {
    result = await convertWorkbook(new Uint8Array(await readFile(argv[0])));
    outDir = argv[1];
  } else if (argv.length === 3 && /\.csv$/i.test(argv[0]) && /\.csv$/i.test(argv[1])) {
    result = convertCsv(await readFile(argv[0], 'utf8'), await readFile(argv[1], 'utf8'));
    outDir = argv[2];
  } else {
    console.error('usage: case-convert <in.xlsx> <outDir>\n       case-convert <cases.csv> <questions.csv> <outDir>');
    return 2;
  }
  await mkdir(outDir, { recursive: true });
  for (const c of result.cases) {
    const path = join(outDir, `${c.case_id}.json`);
    await writeFile(path, JSON.stringify(c, null, 2) + '\n');
    console.log(`ok   ${c.case_id} (${c.questions.length} questions) -> ${path}`);
  }
  for (const e of result.errors) {
    console.error(`err  ${e.sheet} row ${e.row}${e.case_id ? ` [${e.case_id}]` : ''}: ${e.message}`);
  }
  console.log(`${result.cases.length} case(s) converted, ${result.errors.length} error(s)`);
  return result.errors.length ? 1 : 0;
}

main(process.argv.slice(2)).then(
  (code) => process.exit(code),
  (e) => {
    console.error(e instanceof Error ? e.message : e);
    process.exit(2);
  },
);
