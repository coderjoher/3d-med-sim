import type { AnswerRecord, AnswerValue, CaseData, CaseQuestion, FeedbackLevel, QuestionResult, ScoreResult } from './types.js';
/** Score one question against the author's key (C-06). text questions => pending_manual. */
export function scoreQuestion(q: CaseQuestion, value: AnswerValue | undefined): QuestionResult { throw new Error("not implemented"); }
/** Score a whole attempt. Unanswered questions get 0. Last confirmed answer per question wins. */
export function scoreCase(c: CaseData, answers: AnswerRecord[]): ScoreResult { throw new Error("not implemented"); }
/** Shape the result for the student per feedback level (C-08): none => score hidden; score => totals only; full => correct answers + feedback. */
export function applyFeedbackLevel(result: ScoreResult, level: FeedbackLevel): Partial<ScoreResult> { throw new Error("not implemented"); }
/** Apply a manual grade to a pending free-text question (C-05) and recompute totals. */
export function applyManualGrade(result: ScoreResult, questionId: string, points: number): ScoreResult { throw new Error("not implemented"); }
