#!/usr/bin/env node
/**
 * Runs every test suite with JSON reporters, maps test names to the checklist
 * IDs in docs/PHASES.md (e.g. "[T0-18] ..."), and writes docs/TEST_REPORT.md.
 *
 *   npm run test:report              # unit + integration + e2e
 *   npm run test:report -- --no-e2e  # skip Playwright
 *
 * Set TEST_DATABASE_URL to also run the server suite against real PostgreSQL.
 */
import { spawnSync } from 'node:child_process';
import { readFileSync, writeFileSync, mkdtempSync, existsSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const out = mkdtempSync(join(tmpdir(), 'medsim-report-'));
const skipE2E = process.argv.includes('--no-e2e');

/** @type {Array<{suite: string, name: string, status: 'passed'|'failed'|'skipped'}>} */
const results = [];

function runVitest(workspace) {
  const file = join(out, `${workspace.replace(/\W/g, '_')}.json`);
  spawnSync('npx', ['vitest', 'run', '--reporter=json', `--outputFile=${file}`], {
    cwd: join(root, workspace),
    stdio: 'inherit',
    env: process.env,
  });
  if (!existsSync(file)) {
    results.push({ suite: workspace, name: '(suite failed to run)', status: 'failed' });
    return;
  }
  const json = JSON.parse(readFileSync(file, 'utf8'));
  for (const f of json.testResults ?? []) {
    for (const a of f.assertionResults ?? []) {
      const status = a.status === 'passed' ? 'passed' : a.status === 'failed' ? 'failed' : 'skipped';
      results.push({ suite: workspace, name: [...(a.ancestorTitles ?? []), a.title].join(' › '), status });
    }
  }
}

function runPlaywright() {
  const file = join(out, 'e2e.json');
  spawnSync('npx', ['playwright', 'test', '--reporter=json'], {
    cwd: join(root, 'apps/web'),
    stdio: ['ignore', 'pipe', 'inherit'],
    env: { ...process.env, PLAYWRIGHT_JSON_OUTPUT_NAME: file },
  });
  if (!existsSync(file)) {
    results.push({ suite: 'e2e', name: '(playwright failed to run)', status: 'failed' });
    return;
  }
  const json = JSON.parse(readFileSync(file, 'utf8'));
  const walk = (suite, trail) => {
    for (const s of suite.suites ?? []) walk(s, [...trail, s.title]);
    for (const spec of suite.specs ?? []) {
      const ok = spec.tests.every((t) => t.results.at(-1)?.status === 'passed' || t.status === 'expected');
      const skipped = spec.tests.every((t) => t.status === 'skipped');
      results.push({
        suite: 'e2e',
        name: [...trail, spec.title].filter(Boolean).join(' › '),
        status: skipped ? 'skipped' : ok ? 'passed' : 'failed',
      });
    }
  };
  for (const s of json.suites ?? []) walk(s, []);
}

for (const ws of ['packages/core', 'packages/server', 'apps/web']) runVitest(ws);
if (!skipE2E) runPlaywright();

// Checklist IDs + titles from the phase plan
const phases = readFileSync(join(root, 'docs/PHASES.md'), 'utf8');
const checklist = [...phases.matchAll(/^\| (T\d-\d\d) \| (.+?) \| (.+?) \|$/gm)].map((m) => ({
  id: m[1],
  title: m[2],
  req: m[3],
}));

const byId = new Map();
for (const r of results) {
  for (const m of r.name.matchAll(/\[(T\d-\d\d)\]/g)) {
    if (!byId.has(m[1])) byId.set(m[1], []);
    byId.get(m[1]).push(r);
  }
}

const lines = [
  '# MedSim Lab — Test Report',
  '',
  `Generated ${new Date().toISOString()} by \`npm run test:report\`${skipE2E ? ' (e2e skipped)' : ''}.`,
  `PostgreSQL integration: ${process.env.TEST_DATABASE_URL ? 'enabled' : 'not enabled (pg-mem only)'}.`,
  '',
  `Total tests: ${results.length} · passed ${results.filter((r) => r.status === 'passed').length} · failed ${results.filter((r) => r.status === 'failed').length} · skipped ${results.filter((r) => r.status === 'skipped').length}`,
  '',
];

let complete = 0;
let currentPhase = '';
for (const item of checklist) {
  const phase = item.id.slice(0, 2);
  if (phase !== currentPhase) {
    currentPhase = phase;
    lines.push('', `## Phase ${phase.slice(1)}`, '', '| | ID | Checklist item | Tests (pass/total) |', '|---|---|---|---|');
  }
  const tests = byId.get(item.id) ?? [];
  const passed = tests.filter((t) => t.status === 'passed').length;
  const failed = tests.filter((t) => t.status === 'failed').length;
  const done = tests.length > 0 && failed === 0 && passed > 0;
  if (done) complete++;
  lines.push(`| ${done ? '✅' : tests.length ? '❌' : '⬜'} | ${item.id} | ${item.title} | ${passed}/${tests.length} |`);
}
lines.splice(6, 0, `Checklist items covered by passing tests: **${complete}/${checklist.length}**`, '');

const failures = results.filter((r) => r.status === 'failed');
if (failures.length) {
  lines.push('', '## Failing tests', '');
  for (const f of failures) lines.push(`- \`${f.suite}\` — ${f.name}`);
}

writeFileSync(join(root, 'docs/TEST_REPORT.md'), lines.join('\n') + '\n');
console.log(`\nChecklist: ${complete}/${checklist.length} items green. Report: docs/TEST_REPORT.md`);
process.exit(failures.length || complete < checklist.length ? 1 : 0);
