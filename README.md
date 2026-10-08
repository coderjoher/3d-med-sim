# MedSim Lab

Glasses-free, camera-interactive 3D simulation platform for assessing medical
students in university labs. Built from `docs/MedSim_Lab_PRD_v0.1.pdf`.

- **Phase plan & test checklists:** [`docs/PHASES.md`](docs/PHASES.md)
- **Latest test report (checklist → tests):** [`docs/TEST_REPORT.md`](docs/TEST_REPORT.md)

## Layout

| Path | What |
|------|------|
| `packages/core` | Shared TypeScript domain logic: case schema & validation, scoring, gesture recognizer, calibration, head-tracked parallax, interaction log, analytics (R-02…R-06), SUS, CSV, offline queue, kiosk rules, EN/AR strings, built-in models & cases, spreadsheet ⇄ case JSON converter |
| `packages/server` | Lab server API (Fastify + PostgreSQL; in-memory pg-mem when `DATABASE_URL` is unset). Auth & roles, case workflow & versioning, sessions/stations, server-side scoring, reports, CSV/PDF export, multi-tenant orgs, course packages |
| `apps/web` | React + Babylon.js app. `/station` = student station (kiosk), `/station?mode=local` = Phase 0 prototype with no backend, `/station/bench` = fps/latency harness, `/station/explore` = free exploration; `/portal` = authoring, review, proctor console, reports, admin |
| `apps/kiosk` | Tauri v2 kiosk shell config + Chromium `--kiosk` launcher fallback |
| `content/` | Generated case JSON, model registry JSON, the academic case template (`templates/case-template.xlsx`) and the prototype cases in spreadsheet form |

## Quick start

```bash
npm install
npm run fetch:vision -w apps/web        # MediaPipe wasm + hand/face models into public/ (offline lab use)

# API with demo data (in-memory DB). For Postgres set DATABASE_URL=postgres://...
DATABASE_URL= SEED_DEMO=1 JWT_SECRET=change-me npm run dev:server   # :3000
npm run dev:web                                                      # :5173, proxies /api
```

Open <http://localhost:5173/station?mode=local> for the Phase 0 prototype, or
<http://localhost:5173/portal> for the portals. Demo users: `admin/admin123`,
`author1/author123`, `reviewer1/reviewer123`, `proctor1/proctor123`,
`student1…6/student123`, `superadmin/super123`.

**Production (on-prem lab server):** `npm run build`, then
`DATABASE_URL=… JWT_SECRET=… WEB_DIST=apps/web/dist node packages/server/dist/main.js`.
Stations open `http://<lab-server>/station` in the kiosk shell (`apps/kiosk`).

**Authoring from a spreadsheet:** fill `content/templates/case-template.xlsx`, then either
upload it in the portal (Cases → Import) or run
`npx tsx packages/core/src/cli/case-convert.ts cases.xlsx out/`.

## Tests

```bash
npm test                     # unit + integration (core, server, web)
npm run test:e2e             # Playwright (Chromium, SwiftShader, fake camera)
TEST_DATABASE_URL=postgres://postgres@localhost:5432/medsim_test npm run test:report   # everything → docs/TEST_REPORT.md
```

Test names carry checklist IDs (e.g. `[T1-05]`), so `test:report` shows which
checklist items each test proves.

## Limits of this build

- Anatomical models are **procedural placeholders** with the real structure IDs. Licensed glTF models plug in via `asset_url` in the model registry, with no code change.
- These need people or lab hardware: academic accuracy sign-off, the student pilot, the SUS target, fps and latency targets on the reference lab PC, real-hand pinch reliability, and a native Tauri build (no WebKitGTK in CI). The tools for each are included.
- The open questions in PRD §19 still need product decisions.
