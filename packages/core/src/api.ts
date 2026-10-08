/**
 * HTTP API contract between stations / portals and the lab server (PRD §12).
 * All routes are prefixed with /api. Auth: `Authorization: Bearer <token>`.
 * Errors: `{ error: string, details?: unknown }` with a 4xx/5xx status.
 */
import type {
  CaseData, CaseStatus, PlayerCase, ModelDef, Role, AnswerRecord, InteractionLog,
  ScoreResult, StationState, StationCommand, QuestionAnalytics, StructureHeat,
  ItemAnalysis, CohortStats, FeedbackLevel,
} from './types.js';

export interface User { id: string; org_id: string; username: string; display_name: string; roles: Role[]; lang?: 'en' | 'ar'; cohort_id?: string; handedness?: 'left' | 'right' }
export interface Org { id: string; name: string }
export interface Cohort { id: string; org_id: string; name: string; year: number }
export interface Course { id: string; org_id: string; code: string; name: string }

// POST /api/auth/login
export interface LoginRequest { username: string; password: string; org_id?: string }
export interface LoginResponse { token: string; user: User }
// GET /api/me -> User

// Admin (R-07): GET/POST /api/users, PATCH /api/users/:id, GET/POST /api/cohorts, GET/POST /api/courses,
// POST /api/courses/:id/enrol { cohort_id }
export interface CreateUserRequest { username: string; password: string; display_name: string; roles: Role[]; cohort_id?: string; lang?: 'en' | 'ar' }

// Models: GET /api/models -> ModelDef[]; POST /api/models/:id/sign-off { notes } (reviewer)

// Cases (A-02, A-05, A-06)
export interface CaseRecord {
  id: string;            // == case_id
  org_id: string;
  course_id: string;
  version: number;       // latest version number
  status: CaseStatus;
  author_id: string;
  reviewer_id?: string;
  data: CaseData;        // full data incl. keys (authors/reviewers only)
  model_version: number;
  created_at: string;
  updated_at: string;
  review_comment?: string;
}
// GET  /api/cases?course_id=&status=      -> CaseRecord[] (latest version of each)
// GET  /api/cases/:id?version=            -> CaseRecord
// GET  /api/cases/:id/versions            -> CaseRecord[]
// POST /api/cases            { course_id, data }   -> CaseRecord (draft v1)          [author]
// PUT  /api/cases/:id        { data }               -> CaseRecord (new draft version if published, else update draft) [author]
// POST /api/cases/:id/submit                        -> CaseRecord (in_review)          [author]
// POST /api/cases/:id/approve { comment? }          -> CaseRecord (published)          [reviewer != author]
// POST /api/cases/:id/reject  { comment }           -> CaseRecord (draft)              [reviewer]
// GET  /api/cases/:id/preview?version=              -> PlayerCase (keys stripped)      [author/reviewer] (A-04)
// POST /api/cases/import (multipart xlsx/csv, field course_id) -> { created: CaseRecord[], errors: ConversionError[] }

// Sessions & stations (R-08)
export interface LabSession {
  id: string; org_id: string; name: string; cohort_id: string; case_ids: string[];
  status: 'scheduled' | 'running' | 'stopped'; started_at?: string; stopped_at?: string;
  time_limit_min?: number; created_by: string;
}
// POST /api/sessions { name, cohort_id, case_ids, time_limit_min? } -> LabSession  [proctor]
// GET  /api/sessions  -> LabSession[] ; GET /api/sessions/active -> LabSession[] (station/student)
// POST /api/sessions/:id/start | /stop -> LabSession
// GET  /api/sessions/:id/stations -> StationState[]
// POST /api/stations/:id/command  StationCommand -> { queued: true }                  [proctor]
// POST /api/stations/:id/heartbeat  Partial<StationState> -> HeartbeatResponse        [any authed]
export interface HeartbeatResponse { commands: StationCommand[]; server_time: number }

// Attempts (C-06, C-09, NFR security/reliability)
// POST /api/attempts/start { client_attempt_id, session_id?, case_id, station_id? } -> StartAttemptResponse   [student]
export interface StartAttemptResponse { attempt_id: string; case: PlayerCase; case_version: number; model_version: number; started_at: number }
// POST /api/attempts/:id/submit SubmitAttemptRequest -> SubmitAttemptResponse  (idempotent on client_attempt_id)
export interface SubmitAttemptRequest { client_attempt_id: string; answers: AnswerRecord[]; log: InteractionLog; timed_out?: boolean }
export interface SubmitAttemptResponse { attempt_id: string; feedback_level: FeedbackLevel; result: ScoreResult | { score?: undefined } ; }
// POST /api/attempts/sync { items: SubmitAttemptRequest & { case_id, case_version, session_id?, station_id?, started_at } [] } -> { synced: string[] } (offline queue, idempotent)
// GET  /api/attempts?student_id=&case_id=&course_id= -> AttemptSummary[]
export interface AttemptSummary { id: string; student_id: string; student_name?: string; case_id: string; case_version: number; session_id?: string; score: number; max_score: number; percent: number; pending_manual: number; submitted_at: string }
// GET  /api/grading/pending -> { attempt_id, question_id, prompt, response, student_id }[]   [author/reviewer/proctor]
// POST /api/grading/:attemptId/:questionId { points } -> AttemptSummary   (C-05)

// Reports (R-01..R-06)
// GET /api/reports/students?course_id=          -> StudentCourseResult[]  (R-01)
export interface StudentCourseResult { student_id: string; student_name: string; cohort_id?: string; cases: Array<{ case_id: string; best_percent: number; attempts: number }>; course_percent: number }
// GET /api/reports/questions?case_id=           -> QuestionAnalytics[]   (R-02)
// GET /api/reports/heatmap?case_id=|course_id=  -> StructureHeat[]       (R-03)
// GET /api/reports/cohorts?course_id=&by=cohort|year -> CohortStats[]    (R-04)
// GET /api/reports/items?case_id=               -> ItemAnalysis[]        (R-06)
// GET /api/reports/export.csv?course_id=  |  /api/reports/export.pdf?course_id=   (R-05)
// GET /api/reports/metrics?course_id=           -> SuccessMetrics        (§17)
export interface SuccessMetrics {
  completion_without_help_rate: number | null;
  fallback_usage_rate: number | null;
  avg_time_to_publish_hours: number | null;
  active_authors: number;
  sessions: number;
  sus_mean: number | null;
  score_exam_correlation: number | null;
}
// POST /api/sus { answers: number[10], lang } -> { score }   ; GET /api/sus/summary -> { n, mean }
// POST /api/exam-scores { rows: {student_id, course_id, percent}[] } (for correlation metric)

// Packages (Phase 3, G4)
export interface CoursePackage { format: 'medsim-course-package'; version: 1; course: { code: string; name: string }; models: ModelDef[]; cases: CaseData[]; exported_at: string }
// GET /api/courses/:id/package -> CoursePackage ; POST /api/packages/import CoursePackage -> { course: Course, cases: number }
// Orgs (superadmin): GET/POST /api/orgs

export type { QuestionAnalytics, StructureHeat, ItemAnalysis, CohortStats, StationState, StationCommand };
