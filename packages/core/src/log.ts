import type { InputSource, InteractionLog, LogEvent, LogEventType, LogSummary } from './types.js';

/** Per-attempt interaction log (C-09). */
export class InteractionLogger {
  private log: InteractionLog;
  private now: () => number;

  constructor(init: Omit<InteractionLog, 'events' | 'started_at'> & { started_at?: number }, now: () => number = Date.now) {
    this.now = now;
    this.log = { ...init, started_at: init.started_at ?? now(), events: [] };
  }

  record(type: LogEventType, extra: Omit<LogEvent, 't' | 'type'> = {}): LogEvent {
    const ev: LogEvent = { t: this.now(), type, ...extra };
    this.log.events.push(ev);
    return ev;
  }

  end(): void {
    if (this.log.ended_at === undefined) this.log.ended_at = this.now();
  }

  toJSON(): InteractionLog {
    return JSON.parse(JSON.stringify(this.log)) as InteractionLog;
  }
}

const INPUT_SOURCES: InputSource[] = ['gesture', 'mouse', 'touch', 'keyboard'];

/** Time per question (sum of open→close spans), unique structures viewed/selected, input modes used, hand-lost count. */
export function summarizeLog(log: InteractionLog): LogSummary {
  const events = [...log.events].sort((a, b) => a.t - b.t);
  const time: Record<string, number> = {};
  const structures: string[] = [];
  const modes: InputSource[] = [];
  let handLost = 0;
  let open: { q: string; t: number } | null = null;
  const close = (t: number) => {
    if (!open) return;
    time[open.q] = (time[open.q] ?? 0) + Math.max(0, t - open.t);
    open = null;
  };
  for (const e of events) {
    switch (e.type) {
      case 'question-open':
        close(e.t);
        if (e.question_id) {
          open = { q: e.question_id, t: e.t };
          time[e.question_id] ??= 0;
        }
        break;
      case 'question-close':
        if (open && (!e.question_id || e.question_id === open.q)) close(e.t);
        break;
      case 'submit':
      case 'timeout':
        close(e.t);
        break;
      case 'structure-view':
      case 'structure-select':
        if (e.structure_id && !structures.includes(e.structure_id)) structures.push(e.structure_id);
        break;
      case 'input-mode': {
        const m = (e.data?.mode ?? e.data?.source) as InputSource | undefined;
        if (m && INPUT_SOURCES.includes(m) && !modes.includes(m)) modes.push(m);
        break;
      }
      case 'hand-lost':
        handLost++;
        break;
    }
  }
  const lastT = events.length ? events[events.length - 1].t : log.started_at;
  const end = log.ended_at ?? lastT;
  close(end);
  return {
    time_per_question_ms: time,
    structures_viewed: structures,
    input_modes: modes,
    hand_lost_count: handLost,
    total_ms: Math.max(0, end - log.started_at),
  };
}
