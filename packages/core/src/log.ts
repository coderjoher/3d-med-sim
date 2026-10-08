import type { InteractionLog, LogEvent, LogEventType, LogSummary } from './types.js';
/** Per-attempt interaction log (C-09). */
export class InteractionLogger {
  constructor(init: Omit<InteractionLog, 'events' | 'started_at'> & { started_at?: number }, now?: () => number) { throw new Error("not implemented"); }
  record(type: LogEventType, extra?: Omit<LogEvent, 't' | 'type'>): LogEvent { throw new Error("not implemented"); }
  end(): void { throw new Error("not implemented"); }
  toJSON(): InteractionLog { throw new Error("not implemented"); }
}
/** Time per question (sum of open→close spans), unique structures viewed/selected, input modes used, hand-lost count. */
export function summarizeLog(log: InteractionLog): LogSummary { throw new Error("not implemented"); }
