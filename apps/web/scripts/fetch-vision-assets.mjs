#!/usr/bin/env node
/**
 * Prepares MediaPipe Tasks Vision assets for offline lab use (PRD §12: works without internet):
 *   - copies the wasm runtime from node_modules/@mediapipe/tasks-vision/wasm -> public/mediapipe/wasm
 *   - downloads hand_landmarker.task and face_landmarker.task -> public/mediapipe
 * public/mediapipe/ is gitignored. Run once per checkout (npm run fetch:vision -w apps/web).
 *
 *   --force    re-download models even if present
 */
import { copyFileSync, existsSync, mkdirSync, readdirSync, statSync, writeFileSync, renameSync } from 'node:fs';
import { createRequire } from 'node:module';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { spawnSync } from 'node:child_process';

const here = dirname(fileURLToPath(import.meta.url));
const appRoot = join(here, '..');
const outDir = join(appRoot, 'public', 'mediapipe');
const wasmOut = join(outDir, 'wasm');
const force = process.argv.includes('--force');

const MODELS = {
  'hand_landmarker.task': 'https://storage.googleapis.com/mediapipe-models/hand_landmarker/hand_landmarker/float16/latest/hand_landmarker.task',
  'face_landmarker.task': 'https://storage.googleapis.com/mediapipe-models/face_landmarker/face_landmarker/float16/latest/face_landmarker.task',
};

function findWasmDir() {
  const require = createRequire(join(appRoot, 'package.json'));
  try {
    const pkg = require.resolve('@mediapipe/tasks-vision/package.json');
    return join(dirname(pkg), 'wasm');
  } catch {
    for (const base of [appRoot, join(appRoot, '..', '..')]) {
      const p = join(base, 'node_modules', '@mediapipe', 'tasks-vision', 'wasm');
      if (existsSync(p)) return p;
    }
  }
  throw new Error('@mediapipe/tasks-vision is not installed (run npm install)');
}

async function download(url, dest) {
  const tmp = `${dest}.part`;
  try {
    const res = await fetch(url);
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    writeFileSync(tmp, Buffer.from(await res.arrayBuffer()));
  } catch (e) {
    // Node's fetch ignores HTTPS_PROXY on older versions; curl honours it.
    console.warn(`  fetch failed (${e.message}), trying curl…`);
    const r = spawnSync('curl', ['-fsSL', '--retry', '3', '-o', tmp, url], { stdio: 'inherit' });
    if (r.status !== 0) throw new Error(`could not download ${url}`);
  }
  renameSync(tmp, dest);
}

mkdirSync(wasmOut, { recursive: true });
const wasmSrc = findWasmDir();
let copied = 0;
for (const f of readdirSync(wasmSrc)) {
  copyFileSync(join(wasmSrc, f), join(wasmOut, f));
  copied++;
}
console.log(`copied ${copied} wasm files -> ${wasmOut}`);

let failed = 0;
for (const [name, url] of Object.entries(MODELS)) {
  const dest = join(outDir, name);
  if (!force && existsSync(dest) && statSync(dest).size > 1000) {
    console.log(`ok   ${name} (already present)`);
    continue;
  }
  try {
    console.log(`get  ${name}`);
    await download(url, dest);
    console.log(`ok   ${name} (${(statSync(dest).size / 1e6).toFixed(1)} MB)`);
  } catch (e) {
    failed++;
    console.error(`FAIL ${name}: ${e.message}`);
  }
}
if (failed) {
  console.error(`${failed} model(s) missing — hand tracking will fall back to mouse until they are present in ${outDir}`);
  process.exit(1);
}
