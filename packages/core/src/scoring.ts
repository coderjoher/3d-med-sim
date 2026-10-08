import type { AnswerRecord, AnswerValue, CaseData, CaseQuestion, FeedbackLevel, QuestionResult, ScoreResult } from './types.js';

const round2 = (n: number) => Math.round(n * 100) / 100;

function toList(v: AnswerValue | undefined): string[] {
  if (v === undefined || v === null) return [];
  const arr = Array.isArray(v) ? v : [v];
  return arr.map((s) => String(s).trim()).filter((s) => s.length > 0);
}

function isEmpty(v: AnswerValue | undefined): boolean {
  if (v === undefined || v === null) return true;
  if (Array.isArray(v)) return toList(v).length === 0;
  return v.trim().length === 0;
}

/** Score one question against the author's key (C-06). text questions => pending_manual. */
export function scoreQuestion(q: CaseQuestion, value: AnswerValue | undefined): QuestionResult {
  const key = toList(q.answer);
  const resp = toList(value);
  const possible = round2(Math.max(0, q.points));
  const base: QuestionResult = {
    question_id: q.id,
    type: q.type,
    points_awarded: 0,
    points_possible: possible,
    correct: false,
    pending_manual: false,
  };
  if (value !== undefined) base.response = value;

  if (q.type === 'text') {
    return { ...base, pending_manual: !isEmpty(value) };
  }
  if (resp.length === 0) return base;

  let fraction = 0;
  switch (q.type) {
    case 'identify': {
      const picked = new Set(resp);
      if (q.match === 'all') fraction = key.length > 0 && key.every((k) => picked.has(k)) && resp.every((r) => key.includes(r)) ? 1 : 0;
      else fraction = resp.some((r) => key.includes(r)) && resp.every((r) => key.includes(r)) ? 1 : 0;
      break;
    }
    case 'mcq':
      fraction = resp.length === 1 && key.length >= 1 && resp[0] === key[0] ? 1 : 0;
      break;
    case 'multi': {
      const keySet = new Set(key);
      const picked = new Set(resp);
      const right = [...picked].filter((p) => keySet.has(p)).length;
      const wrong = picked.size - right;
      if (right === keySet.size && wrong === 0) fraction = 1;
      else if (q.partial_credit && keySet.size > 0) fraction = Math.max(0, (right - wrong) / keySet.size);
      else fraction = 0;
      break;
    }
    case 'order':
      fraction = resp.length === key.length && resp.every((r, i) => r === key[i]) ? 1 : 0;
      break;
  }
  const awarded = round2(fraction * possible);
  return { ...base, points_awarded: awarded, correct: fraction === 1 };
}

function totals(questions: QuestionResult[]): Omit<ScoreResult, 'questions'> {
  const score = round2(questions.reduce((s, q) => s + q.points_awarded, 0));
  const max = round2(questions.reduce((s, q) => s + q.points_possible, 0));
  return {
    score,
    max_score: max,
    percent: max > 0 ? round2((score / max) * 100) : 0,
    pending_manual: questions.filter((q) => q.pending_manual).length,
  };
}

/** Score a whole attempt. Unanswered questions get 0. Last confirmed answer per question wins. */
export function scoreCase(c: CaseData, answers: AnswerRecord[]): ScoreResult {
  const latest = new Map<string, AnswerRecord>();
  for (const a of answers) {
    const prev = latest.get(a.question_id);
    if (!prev || a.confirmed_at >= prev.confirmed_at) latest.set(a.question_id, a);
  }
  const questions = c.questions.map((q) => {
    const r = scoreQuestion(q, latest.get(q.id)?.value);
    return { ...r, correct_answer: q.answer, ...(q.feedback !== undefined ? { feedback: q.feedback } : {}) };
  });
  // correct_answer/feedback are kept on the full (server-side) result; applyFeedbackLevel decides what students see.
  for (const q of questions) if (q.correct_answer === undefined) delete q.correct_answer;
  return { ...totals(questions), questions };
}

/** Shape the result for the student per feedback level (C-08): none => score hidden; score => totals only; full => correct answers + feedback. */
export function applyFeedbackLevel(result: ScoreResult, level: FeedbackLevel): Partial<ScoreResult> {
  if (level === 'none') return {};
  if (level === 'score')
    return { score: result.score, max_score: result.max_score, percent: result.percent, pending_manual: result.pending_manual };
  return {
    ...result,
    questions: result.questions.map((q) => ({ ...q })),
  };
}

/** Apply a manual grade to a pending free-text question (C-05) and recompute totals. */
export function applyManualGrade(result: ScoreResult, questionId: string, points: number): ScoreResult {
  const idx = result.questions.findIndex((q) => q.question_id === questionId);
  if (idx < 0) throw new Error(`question ${questionId} not found in result`);
  const q = result.questions[idx];
  if (q.type !== 'text') throw new Error(`question ${questionId} is not a free-text question`);
  if (!Number.isFinite(points) || points < 0 || points > q.points_possible)
    throw new Error(`points must be between 0 and ${q.points_possible}`);
  const awarded = round2(points);
  const questions = result.questions.map((x, i) =>
    i === idx ? { ...x, points_awarded: awarded, pending_manual: false, correct: awarded === x.points_possible } : x,
  );
  return { ...totals(questions), questions };
}
