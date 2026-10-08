# MedSim Lab — Delivery Phases & Test Checklists

Source: `docs/MedSim_Lab_PRD_v0.1.pdf` (PRD v0.1, 8 Oct 2026).

The PRD roadmap (§16) defines four phases. Every functional requirement (§9) and
non-functional requirement (§13) is assigned to exactly one phase below, and each
phase has a test checklist. Test IDs (e.g. `T0-05`) appear in the names of the
automated tests, so `npm run test:report` maps checklist → passing tests.

**Status (8 Oct 2026): all 62 checklist items across Phases 0–3 pass their automated
tests. See `docs/TEST_REPORT.md`. The items marked `[~]` below need people, licences or
lab hardware; the software tools for them are included.**

Legend: `[x]` automated test passes · `[~]` tooling delivered, needs people /
lab hardware to sign off (cannot be completed in software) · `[ ]` open.

---

## Phase 0 — Rapid prototype (PRD §15, ~6 weeks)

**Scope:** one organ (heart) with named structures + one pathology variant
(mitral stenosis); three cases / ~10 questions authored in a spreadsheet and
converted to JSON; identify-on-model + MCQ; automatic scoring + summary;
core gesture set, calibration, practice mode, confirmation, mouse fallback;
experimental head-tracked parallax; single station, kiosk mode, **no backend**
(cases and logs are local files).

Requirements: V-01…V-06, I-01…I-05, I-06 (experimental), I-07, C-01, C-02, C-03,
C-06, C-07 (basic), C-08 (score only), C-09 (local log), A-01 (spreadsheet),
R-01 (summary screen), R-09.

### Test checklist

| ID | Test | Req |
|----|------|-----|
| T0-01 | Heart model builds with every structure carrying a stable `TA:` id and a layer | V-01, §10 |
| T0-02 | Rotate / zoom / pan change the camera; reset returns to the case's preset view | V-02 |
| T0-03 | Hiding / showing a layer toggles visibility of all its structures | V-03 |
| T0-04 | Selecting a structure highlights it; isolate hides all others; un-isolate restores | V-04 |
| T0-05 | Labels toggle; labels are forced off in assessment mode even if requested | V-05 |
| T0-06 | Pathology variant (`mitral_stenosis`) changes the model's geometry/material | V-06 |
| T0-07 | Gesture recognizer: index movement → `point`; pinch → `select` | I-02 |
| T0-08 | Gesture recognizer: pinch-and-drag → `rotate`; two-hand pinch apart/together → `zoom` | I-02 |
| T0-09 | Gesture recognizer: open palm held ≥1.5 s → `reset` (not before) | I-02 |
| T0-10 | Hand tracking runs in a Web Worker on-device; no frames leave the worker (only landmarks) | I-01, §7 privacy |
| T0-11 | Calibration maps the student's reach box to the full screen | I-03 |
| T0-12 | Practice mode uses the non-graded sample and records no graded attempt | I-03 |
| T0-13 | No answer is recorded without an explicit confirmation step | I-04 |
| T0-14 | Mouse, keyboard and touch produce the same semantic events as gestures; fallback switchable at any time | I-05, §7 |
| T0-15 | Head position → off-axis parallax camera shift (toggle, experimental) | I-06 |
| T0-16 | Hand cursor, tracking-status indicator and "hand lost" warning render | I-07 |
| T0-17 | Case JSON (PRD §10 example) validates; invalid cases rejected with clear errors | C-01 |
| T0-18 | Identify question scored by structure id; MCQ by option key | C-02, C-03, C-06 |
| T0-19 | Time limit counts down and auto-submits; next/previous navigation works | C-07 |
| T0-20 | Score-only feedback shown on summary screen after submit | C-08, R-01 |
| T0-21 | Interaction log records answers, time per question, structures viewed; saved locally | C-09 |
| T0-22 | Spreadsheet template (XLSX / CSV) converts to valid case JSON; row errors reported | A-01 |
| T0-23 | Three prototype cases (~10 questions) ship and validate against the heart model | §15 |
| T0-24 | Kiosk lockdown: blocks exit shortcuts / context menu; exit needs proctor PIN | R-09 |
| T0-25 | End-to-end (browser): calibrate → practice → case → answer w/ confirm → submit → summary, mouse only | §8 |
| T0-26 | Performance harness reports fps and hand-to-cursor latency | §15 exit |

**Exit criteria needing people/hardware** (tooling delivered, sign-off is human):
`[~]` ≥60 fps @1080p on lab PC · `[~]` ≥95 % pinch-selection success · `[~]` median
latency <100 ms · `[~]` ≥80 % complete without help · `[~]` SUS ≥ 68 · `[~]` academic sign-off.

---

## Phase 1 — MVP: first course (one semester)

**Scope:** backend + accounts, authoring web form, preview as student, review &
approval workflow, versioning, server-side scoring, proctor sessions, basic
reports, export, offline-tolerant stations, all P0 requirements, bilingual
EN/AR interface with RTL.

Requirements: A-02, A-04, A-05, A-06, R-01 (full), R-02, R-05, R-07, R-08,
C-09 (server), NFR security / auditability / reliability / privacy /
localization / accessibility / maintainability, plus P1 items pulled in:
I-08 (left/right hand), A-07 (bilingual fields), C-04 (multi-select, ordering),
C-08 (none / score / full feedback).

### Test checklist

| ID | Test | Req |
|----|------|-----|
| T1-01 | Login issues token; roles student / author / reviewer / proctor / admin enforced on every route | R-07, NFR security |
| T1-02 | Admin manages users, cohorts, courses and enrolments | R-07 |
| T1-03 | Author creates a case via the web form (model, variant, preset view, questions, keys) | A-02 |
| T1-04 | Author previews the case exactly as a student sees it (labels off, no keys) | A-04 |
| T1-05 | Workflow draft → in_review → published; reviewer must differ from author; reject returns to draft | A-05, §7 accuracy |
| T1-06 | Editing a published case creates a new version; old attempts stay linked to their version | A-06, NFR audit |
| T1-07 | Answer keys never sent to stations before submit; scoring is server-side | NFR security |
| T1-08 | Proctor creates a session (cohort + case set), starts/stops timer, sees live station status | R-08, §8 |
| T1-09 | Proctor switches a station to fallback input / locks a station remotely | R-08, I-05 |
| T1-10 | Station keeps working when the server drops; queued attempts sync, idempotently | NFR reliability |
| T1-11 | Per-student results per case and per course | R-01 |
| T1-12 | Per-question analytics: correct rate, average time, most common wrong selection | R-02 |
| T1-13 | Export results to CSV and PDF | R-05 |
| T1-14 | Multi-select (partial credit configurable) and ordering questions scored | C-04 |
| T1-15 | Feedback level none / score / full respected after submit | C-08 |
| T1-16 | Bilingual stem/prompt/feedback; Arabic interface renders RTL | A-07, NFR localization |
| T1-17 | Left- or right-handed primary hand configurable | I-08 |
| T1-18 | Adjustable text size; colour-blind-safe highlight palette | NFR accessibility |
| T1-19 | New case published with no code change and appears at stations | NFR maintainability |
| T1-20 | Model version and academic sign-off recorded; attempts reference model version | §11 validate, NFR audit |
| T1-21 | Data persists in PostgreSQL (integration test on real Postgres) | §12 |
| T1-22 | End-to-end (browser): author → review → publish → proctor session → student attempt → report | §8 |

---

## Phase 2 — Authoring & analytics (following semester)

**Scope:** visual 3D authoring, structure heatmaps, item analysis, cohort
comparison, cross-sections, physiological animation, comparison view, free-text
questions with manual grading, second course.

Requirements: A-03, R-03, R-04, R-06, V-07, V-08, V-09, C-05, second course.

| ID | Test | Req |
|----|------|-----|
| T2-01 | Author clicks structures in 3D to set identify-answer targets and captures camera view | A-03 |
| T2-02 | Structure heatmap: cohort misidentification counts per structure | R-03 |
| T2-03 | Cohort comparison across groups and years | R-04 |
| T2-04 | Item analysis: difficulty index and discrimination index (upper/lower 27 %) | R-06 |
| T2-05 | Clipping plane / cross-section on any axis | V-07 |
| T2-06 | Cardiac-cycle animation plays / pauses | V-08 |
| T2-07 | Side-by-side normal vs pathological comparison view | V-09 |
| T2-08 | Free-text question stored ungraded; manual grading updates score | C-05 |
| T2-09 | Second course (kidney model + cases) packaged and playable | §16 |
| T2-10 | Bilingual SUS questionnaire collected and scored | §17 |

---

## Phase 3 — Scale (year 2+)

**Scope:** course-by-course expansion, other colleges/universities via
multi-tenant deployment, course package import/export, optional
autostereoscopic displays.

| ID | Test | Req |
|----|------|-----|
| T3-01 | Organisations (tenants) are isolated: no cross-tenant reads/writes | §16 |
| T3-02 | Course package exports (models refs, cases, questions) and imports into another tenant | §16, G4 |
| T3-03 | Success-metric dashboard: completion without help, fallback usage, time-to-publish, score↔exam correlation | §17 |
| T3-04 | Display-output abstraction: autostereoscopic (side-by-side stereo) mode toggle | §14 future |

---

## Not completable in software (needs people, licences or lab hardware)

`[~]` Licensed high-fidelity anatomical models (placeholder procedural models ship instead,
loaded through the same glTF-ready registry) · `[~]` Academic accuracy sign-off ·
`[~]` Pilot with 10–20 students · `[~]` Benchmarks on the reference lab PC ·
`[~]` Native Tauri kiosk build on a lab station (config ships; needs WebKitGTK/WebView2 on the target) ·
`[~]` Open questions in PRD §19.
