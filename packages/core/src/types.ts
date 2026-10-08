/**
 * Shared domain types for MedSim Lab (PRD §10 Case Content Model).
 * Case JSON keeps the snake_case field names used in the PRD example so that
 * academics' spreadsheet output and the documented format stay identical.
 */

/** Text that may be bilingual (A-07). A plain string is treated as English. */
export type LocalizedText = string | { en: string; ar?: string };

export type Lang = 'en' | 'ar';

export type QuestionType =
  | 'identify' // select a structure on the model (C-02)
  | 'mcq' // single-answer multiple choice (C-03)
  | 'multi' // multi-select (C-04)
  | 'order' // ordering / sequence (C-04)
  | 'text'; // short free text, manual grading (C-05)

export type CameraPreset =
  | 'anterior'
  | 'posterior'
  | 'left'
  | 'right'
  | 'superior'
  | 'inferior'
  | 'custom';

export interface CameraView {
  /** Named preset; 'custom' uses alpha/beta/radius (Babylon ArcRotate convention, radians). */
  camera: CameraPreset;
  alpha?: number;
  beta?: number;
  radius?: number;
  /** Layer ids hidden when the case opens. */
  hidden_layers?: string[];
}

export interface CaseQuestion {
  id: string;
  type: QuestionType;
  prompt: LocalizedText;
  /** Option key → option text, for mcq / multi / order. */
  options?: Record<string, LocalizedText>;
  /**
   * Answer key. identify: structure ids (any one is correct unless
   * `match: 'all'`); mcq: one option key (string or 1-element array);
   * multi: set of option keys; order: option keys in correct order;
   * text: optional model answer (not auto-scored). Stripped before sending to stations.
   */
  answer?: string | string[];
  points: number;
  /** identify only: 'any' (default) = selecting any listed structure is correct. */
  match?: 'any' | 'all';
  /** multi only: award partial credit (default false = all-or-nothing). */
  partial_credit?: boolean;
  feedback?: LocalizedText;
  /** Optional camera view to move to when this question opens (A-03). */
  view?: CameraView;
}

export type FeedbackLevel = 'none' | 'score' | 'full';
export type CaseStatus = 'draft' | 'in_review' | 'published' | 'archived';

export interface CaseMeta {
  author?: string;
  reviewer?: string;
  version?: number;
  status?: CaseStatus;
  objectives?: string[];
  difficulty?: 'easy' | 'medium' | 'hard';
}

export interface CaseData {
  case_id: string;
  course: string;
  topic?: string;
  model: string;
  variant: string;
  stem: LocalizedText;
  initial_view: CameraView;
  labels_visible?: boolean;
  time_limit_min?: number;
  /** Layers the student may toggle; omitted = all. */
  allowed_layers?: string[];
  feedback_level?: FeedbackLevel;
  /** Practice cases are never graded (I-03). */
  practice?: boolean;
  questions: CaseQuestion[];
  meta?: CaseMeta;
}

/** Case as delivered to a station before submission: answer keys removed (NFR security). */
export type PlayerQuestion = Omit<CaseQuestion, 'answer' | 'feedback'>;
export type PlayerCase = Omit<CaseData, 'questions'> & { questions: PlayerQuestion[] };

// ---------------------------------------------------------------------------
// Models (PRD §10, §11)
// ---------------------------------------------------------------------------

export interface LayerDef {
  id: string;
  name: LocalizedText;
}

export interface StructureDef {
  /** Stable id mapped to Terminologia Anatomica, e.g. "TA:mitral_valve". */
  id: string;
  name: LocalizedText;
  layer: string;
  /** Optional TA98/TA2 code for traceability. */
  ta_code?: string;
}

export interface VariantDef {
  id: string;
  name: LocalizedText;
  pathological: boolean;
  /** Structures whose geometry/material differ in this variant. */
  affects?: string[];
}

export interface ModelSignOff {
  reviewer: string;
  date: string;
  notes?: string;
}

export interface ModelDef {
  id: string; // e.g. "heart_v1"
  organ: string;
  name: LocalizedText;
  version: number;
  /** URL of a glTF/GLB asset; absent = built-in procedural placeholder model. */
  asset_url?: string;
  layers: LayerDef[];
  structures: StructureDef[];
  variants: VariantDef[];
  sign_off?: ModelSignOff;
  /** Supports physiological animation (V-08). */
  animations?: string[];
}

// ---------------------------------------------------------------------------
// Input abstraction (PRD §7 "one input language", I-02, I-05)
// ---------------------------------------------------------------------------

export type InputSource = 'gesture' | 'mouse' | 'touch' | 'keyboard';

/** Normalised screen coordinates: 0..1, origin top-left. */
export type SemanticEvent =
  | { type: 'point'; x: number; y: number; source: InputSource }
  | { type: 'select'; x: number; y: number; source: InputSource }
  | { type: 'rotate'; dx: number; dy: number; source: InputSource }
  | { type: 'pan'; dx: number; dy: number; source: InputSource }
  /** factor > 1 zooms in, < 1 zooms out. */
  | { type: 'zoom'; factor: number; source: InputSource }
  | { type: 'reset'; source: InputSource }
  | { type: 'hand-lost'; source: 'gesture' }
  | { type: 'hand-found'; source: 'gesture' };

/** One 3D landmark as produced by MediaPipe (normalised image coords, z relative). */
export interface Landmark {
  x: number;
  y: number;
  z: number;
}

export interface HandFrame {
  /** 21 landmarks, MediaPipe hand topology. */
  landmarks: Landmark[];
  /** From the user's point of view after mirroring. */
  handedness: 'Left' | 'Right';
}

export interface TrackingFrame {
  /** ms timestamp */
  t: number;
  hands: HandFrame[];
}

export interface Calibration {
  /** Comfortable reach box in camera-normalised coords, mapped to the full screen. */
  minX: number;
  maxX: number;
  minY: number;
  maxY: number;
  /** Mirror x (selfie view). */
  mirror: boolean;
}

export interface HeadPose {
  /** Head position relative to screen centre, normalised -1..1 (x right, y up), z distance in arbitrary units (≈1 = calibrated distance). */
  x: number;
  y: number;
  z: number;
}

// ---------------------------------------------------------------------------
// Attempts, scoring, logs (C-06, C-09)
// ---------------------------------------------------------------------------

/** Student response: structure ids (identify), option keys (mcq/multi/order) or text. */
export type AnswerValue = string[] | string;

export interface AnswerRecord {
  question_id: string;
  value: AnswerValue;
  /** ms timestamp of confirmation (I-04) */
  confirmed_at: number;
}

export interface QuestionResult {
  question_id: string;
  type: QuestionType;
  points_awarded: number;
  points_possible: number;
  correct: boolean;
  /** Free-text awaiting manual grading. */
  pending_manual: boolean;
  response?: AnswerValue;
  /** Only filled when feedback level is 'full'. */
  correct_answer?: AnswerValue;
  feedback?: LocalizedText;
}

export interface ScoreResult {
  score: number;
  max_score: number;
  percent: number;
  questions: QuestionResult[];
  pending_manual: number;
}

export type LogEventType =
  | 'case-open'
  | 'question-open'
  | 'question-close'
  | 'structure-view'
  | 'structure-select'
  | 'layer-toggle'
  | 'answer-staged'
  | 'answer-confirmed'
  | 'answer-cancelled'
  | 'input-mode'
  | 'hand-lost'
  | 'reset-view'
  | 'submit'
  | 'timeout';

export interface LogEvent {
  t: number;
  type: LogEventType;
  question_id?: string;
  structure_id?: string;
  data?: Record<string, unknown>;
}

export interface InteractionLog {
  attempt_id: string;
  case_id: string;
  case_version?: number;
  model_version?: number;
  student_id?: string;
  station_id?: string;
  started_at: number;
  ended_at?: number;
  events: LogEvent[];
}

export interface LogSummary {
  time_per_question_ms: Record<string, number>;
  structures_viewed: string[];
  input_modes: InputSource[];
  hand_lost_count: number;
  total_ms: number;
}

// ---------------------------------------------------------------------------
// Analytics (R-02, R-03, R-04, R-06)
// ---------------------------------------------------------------------------

/** Minimal attempt shape used by analytics (server and tests produce it). */
export interface AttemptForAnalytics {
  attempt_id: string;
  student_id: string;
  cohort_id?: string;
  year?: number;
  case_id: string;
  case_version?: number;
  score: number;
  max_score: number;
  questions: QuestionResult[];
  /** question id → ms spent */
  time_per_question_ms?: Record<string, number>;
  /** 0..1 manual instruction: whether proctor help/fallback was needed (success metrics) */
  used_fallback?: boolean;
  needed_help?: boolean;
}

export interface QuestionAnalytics {
  question_id: string;
  attempts: number;
  correct_rate: number;
  avg_time_ms: number | null;
  /** Most common wrong responses, descending. */
  common_wrong: Array<{ response: string; count: number }>;
}

export interface StructureHeat {
  structure_id: string;
  /** Times this structure was the target but the student chose something else. */
  missed: number;
  /** Times this structure was wrongly selected for another target. */
  wrongly_selected: number;
  total: number;
}

export interface ItemAnalysis {
  question_id: string;
  /** Proportion correct (p-value), 0..1. */
  difficulty: number;
  /** Upper-lower 27% discrimination index, -1..1 (null if n too small). */
  discrimination: number | null;
  /** Point-biserial correlation with total score (null if undefined). */
  point_biserial: number | null;
  n: number;
}

export interface CohortStats {
  group: string;
  n: number;
  mean_percent: number;
  median_percent: number;
  sd_percent: number;
}

// ---------------------------------------------------------------------------
// Users / roles (R-07)
// ---------------------------------------------------------------------------

export type Role = 'student' | 'author' | 'reviewer' | 'proctor' | 'admin' | 'superadmin';

export type StationStatus = 'idle' | 'calibrating' | 'practice' | 'in_progress' | 'submitted' | 'offline';

export interface StationState {
  station_id: string;
  status: StationStatus;
  camera_ok: boolean;
  input_mode: 'gesture' | 'fallback';
  locked: boolean;
  student_id?: string;
  case_id?: string;
  attempt_id?: string;
  last_seen: number;
}

/** Command queued by a proctor and delivered on the station's next heartbeat. */
export type StationCommand =
  | { type: 'set-input'; mode: 'gesture' | 'fallback' }
  | { type: 'lock' }
  | { type: 'unlock' }
  | { type: 'end-session' };
