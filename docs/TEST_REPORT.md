# MedSim Lab — Test Report

Generated 2026-10-08T18:16:43.827Z by `npm run test:report`.
PostgreSQL integration: enabled.

Total tests: 211 · passed 211 · failed 0 · skipped 0
Checklist items covered by passing tests: **62/62**



## Phase 0

| | ID | Checklist item | Tests (pass/total) |
|---|---|---|---|
| ✅ | T0-01 | Heart model builds with every structure carrying a stable `TA:` id and a layer | 3/3 |
| ✅ | T0-02 | Rotate / zoom / pan change the camera; reset returns to the case's preset view | 4/4 |
| ✅ | T0-03 | Hiding / showing a layer toggles visibility of all its structures | 2/2 |
| ✅ | T0-04 | Selecting a structure highlights it; isolate hides all others; un-isolate restores | 2/2 |
| ✅ | T0-05 | Labels toggle; labels are forced off in assessment mode even if requested | 3/3 |
| ✅ | T0-06 | Pathology variant (`mitral_stenosis`) changes the model's geometry/material | 3/3 |
| ✅ | T0-07 | Gesture recognizer: index movement → `point`; pinch → `select` | 4/4 |
| ✅ | T0-08 | Gesture recognizer: pinch-and-drag → `rotate`; two-hand pinch apart/together → `zoom` | 2/2 |
| ✅ | T0-09 | Gesture recognizer: open palm held ≥1.5 s → `reset` (not before) | 2/2 |
| ✅ | T0-10 | Hand tracking runs in a Web Worker on-device; no frames leave the worker (only landmarks) | 4/4 |
| ✅ | T0-11 | Calibration maps the student's reach box to the full screen | 1/1 |
| ✅ | T0-12 | Practice mode uses the non-graded sample and records no graded attempt | 4/4 |
| ✅ | T0-13 | No answer is recorded without an explicit confirmation step | 4/4 |
| ✅ | T0-14 | Mouse, keyboard and touch produce the same semantic events as gestures; fallback switchable at any time | 8/8 |
| ✅ | T0-15 | Head position → off-axis parallax camera shift (toggle, experimental) | 1/1 |
| ✅ | T0-16 | Hand cursor, tracking-status indicator and "hand lost" warning render | 3/3 |
| ✅ | T0-17 | Case JSON (PRD §10 example) validates; invalid cases rejected with clear errors | 3/3 |
| ✅ | T0-18 | Identify question scored by structure id; MCQ by option key | 3/3 |
| ✅ | T0-19 | Time limit counts down and auto-submits; next/previous navigation works | 3/3 |
| ✅ | T0-20 | Score-only feedback shown on summary screen after submit | 3/3 |
| ✅ | T0-21 | Interaction log records answers, time per question, structures viewed; saved locally | 3/3 |
| ✅ | T0-22 | Spreadsheet template (XLSX / CSV) converts to valid case JSON; row errors reported | 9/9 |
| ✅ | T0-23 | Three prototype cases (~10 questions) ship and validate against the heart model | 2/2 |
| ✅ | T0-24 | Kiosk lockdown: blocks exit shortcuts / context menu; exit needs proctor PIN | 4/4 |
| ✅ | T0-25 | End-to-end (browser): calibrate → practice → case → answer w/ confirm → submit → summary, mouse only | 1/1 |
| ✅ | T0-26 | Performance harness reports fps and hand-to-cursor latency | 1/1 |

## Phase 1

| | ID | Checklist item | Tests (pass/total) |
|---|---|---|---|
| ✅ | T1-01 | Login issues token; roles student / author / reviewer / proctor / admin enforced on every route | 6/6 |
| ✅ | T1-02 | Admin manages users, cohorts, courses and enrolments | 4/4 |
| ✅ | T1-03 | Author creates a case via the web form (model, variant, preset view, questions, keys) | 8/8 |
| ✅ | T1-04 | Author previews the case exactly as a student sees it (labels off, no keys) | 4/4 |
| ✅ | T1-05 | Workflow draft → in_review → published; reviewer must differ from author; reject returns to draft | 7/7 |
| ✅ | T1-06 | Editing a published case creates a new version; old attempts stay linked to their version | 3/3 |
| ✅ | T1-07 | Answer keys never sent to stations before submit; scoring is server-side | 3/3 |
| ✅ | T1-08 | Proctor creates a session (cohort + case set), starts/stops timer, sees live station status | 4/4 |
| ✅ | T1-09 | Proctor switches a station to fallback input / locks a station remotely | 4/4 |
| ✅ | T1-10 | Station keeps working when the server drops; queued attempts sync, idempotently | 4/4 |
| ✅ | T1-11 | Per-student results per case and per course | 3/3 |
| ✅ | T1-12 | Per-question analytics: correct rate, average time, most common wrong selection | 4/4 |
| ✅ | T1-13 | Export results to CSV and PDF | 3/3 |
| ✅ | T1-14 | Multi-select (partial credit configurable) and ordering questions scored | 4/4 |
| ✅ | T1-15 | Feedback level none / score / full respected after submit | 4/4 |
| ✅ | T1-16 | Bilingual stem/prompt/feedback; Arabic interface renders RTL | 9/9 |
| ✅ | T1-17 | Left- or right-handed primary hand configurable | 2/2 |
| ✅ | T1-18 | Adjustable text size; colour-blind-safe highlight palette | 2/2 |
| ✅ | T1-19 | New case published with no code change and appears at stations | 2/2 |
| ✅ | T1-20 | Model version and academic sign-off recorded; attempts reference model version | 3/3 |
| ✅ | T1-21 | Data persists in PostgreSQL (integration test on real Postgres) | 2/2 |
| ✅ | T1-22 | End-to-end (browser): author → review → publish → proctor session → student attempt → report | 1/1 |

## Phase 2

| | ID | Checklist item | Tests (pass/total) |
|---|---|---|---|
| ✅ | T2-01 | Author clicks structures in 3D to set identify-answer targets and captures camera view | 2/2 |
| ✅ | T2-02 | Structure heatmap: cohort misidentification counts per structure | 4/4 |
| ✅ | T2-03 | Cohort comparison across groups and years | 4/4 |
| ✅ | T2-04 | Item analysis: difficulty index and discrimination index (upper/lower 27 %) | 4/4 |
| ✅ | T2-05 | Clipping plane / cross-section on any axis | 2/2 |
| ✅ | T2-06 | Cardiac-cycle animation plays / pauses | 2/2 |
| ✅ | T2-07 | Side-by-side normal vs pathological comparison view | 2/2 |
| ✅ | T2-08 | Free-text question stored ungraded; manual grading updates score | 4/4 |
| ✅ | T2-09 | Second course (kidney model + cases) packaged and playable | 2/2 |
| ✅ | T2-10 | Bilingual SUS questionnaire collected and scored | 5/5 |

## Phase 3

| | ID | Checklist item | Tests (pass/total) |
|---|---|---|---|
| ✅ | T3-01 | Organisations (tenants) are isolated: no cross-tenant reads/writes | 3/3 |
| ✅ | T3-02 | Course package exports (models refs, cases, questions) and imports into another tenant | 3/3 |
| ✅ | T3-03 | Success-metric dashboard: completion without help, fallback usage, time-to-publish, score↔exam correlation | 4/4 |
| ✅ | T3-04 | Display-output abstraction: autostereoscopic (side-by-side stereo) mode toggle | 2/2 |
