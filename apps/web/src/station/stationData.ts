/**
 * Station persistence: local-mode attempt store (Phase 0, C-09 "local log"),
 * offline submission queue + sync (NFR reliability), heartbeat (R-08).
 */
import { useEffect, useRef, useState } from 'react';
import {
  OfflineQueue, type AnswerRecord, type HeartbeatResponse, type InteractionLog, type KeyValueStorage,
  type ScoreResult, type StationCommand, type StationState, type SubmitAttemptRequest,
} from '@medsim/core';
import { api } from '../shared/api';

export function storage(): KeyValueStorage {
  try {
    const ls = window.localStorage;
    const k = '__medsim_probe';
    ls.setItem(k, '1');
    ls.removeItem(k);
    return ls;
  } catch {
    const mem = new Map<string, string>();
    return { getItem: (k) => mem.get(k) ?? null, setItem: (k, v) => void mem.set(k, v), removeItem: (k) => void mem.delete(k) };
  }
}

export function newId(prefix = ''): string {
  const r = typeof crypto !== 'undefined' && 'randomUUID' in crypto ? crypto.randomUUID() : `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 10)}`;
  return prefix + r;
}

export function stationId(): string {
  const st = storage();
  try {
    const q = new URLSearchParams(location.search).get('station');
    if (q) { st.setItem('medsim.station_id', q); return q; }
  } catch { /* ignore */ }
  let id = st.getItem('medsim.station_id');
  if (!id) { id = `ST-${Math.random().toString(36).slice(2, 6).toUpperCase()}`; st.setItem('medsim.station_id', id); }
  return id;
}

// ------------------------------------------------------------------ local mode store

export interface LocalAttempt {
  attempt_id: string;
  station_id: string;
  student_id: string;
  case_id: string;
  case_version?: number;
  model_version?: number;
  started_at: number;
  submitted_at: number;
  timed_out: boolean;
  answers: AnswerRecord[];
  log: InteractionLog;
  result: ScoreResult;
}

const LOCAL_KEY = 'medsim.local.attempts';

export function listLocalAttempts(): LocalAttempt[] {
  try { return JSON.parse(storage().getItem(LOCAL_KEY) ?? '[]') as LocalAttempt[]; } catch { return []; }
}

export function saveLocalAttempt(a: LocalAttempt) {
  const all = listLocalAttempts().filter((x) => x.attempt_id !== a.attempt_id);
  all.push(a);
  storage().setItem(LOCAL_KEY, JSON.stringify(all));
}

export function downloadJson(filename: string, data: unknown) {
  const blob = new Blob([JSON.stringify(data, null, 2)], { type: 'application/json' });
  const a = document.createElement('a');
  a.href = URL.createObjectURL(blob);
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(a.href), 1000);
}

// ------------------------------------------------------------------ offline queue (server mode)

export type SyncItem = SubmitAttemptRequest & {
  attempt_id: string;
  case_id: string;
  case_version: number;
  session_id?: string;
  station_id?: string;
  started_at: number;
};

let queue: OfflineQueue<SyncItem> | null = null;
export function syncQueue(): OfflineQueue<SyncItem> {
  queue ??= new OfflineQueue<SyncItem>(storage(), 'medsim.station.queue');
  return queue;
}

/** Push queued submissions to POST /api/attempts/sync (idempotent server-side on client_attempt_id). */
export async function flushQueue(): Promise<{ sent: number; remaining: number }> {
  return syncQueue().flush(async (item) => {
    const res = await api<{ synced: string[]; failed?: Array<{ client_attempt_id: string; error: string }> }>('/attempts/sync', { method: 'POST', json: { items: [item] } });
    // server answers with the client_attempt_ids it stored (idempotent); anything else stays queued
    if (!Array.isArray(res?.synced) || !res.synced.includes(item.client_attempt_id)) throw new Error(res?.failed?.[0]?.error ?? 'not synced');
  });
}

/** Re-render on queue changes; flushes on reconnect and periodically. */
export function useSyncQueue(enabled: boolean, intervalMs = 5000) {
  const [pending, setPending] = useState(() => (enabled ? syncQueue().size() : 0));
  const [lastSync, setLastSync] = useState<number | null>(null);
  useEffect(() => {
    if (!enabled) return;
    let stop = false;
    const tick = async () => {
      if (syncQueue().size() > 0) {
        const r = await flushQueue().catch(() => ({ sent: 0, remaining: syncQueue().size() }));
        if (r.sent > 0) setLastSync(Date.now());
      }
      if (!stop) setPending(syncQueue().size());
    };
    void tick();
    const id = setInterval(tick, intervalMs);
    const online = () => void tick();
    window.addEventListener('online', online);
    window.addEventListener('medsim-queue', online);
    return () => { stop = true; clearInterval(id); window.removeEventListener('online', online); window.removeEventListener('medsim-queue', online); };
  }, [enabled, intervalMs]);
  return { pending, lastSync };
}

export function notifyQueueChanged() {
  window.dispatchEvent(new Event('medsim-queue'));
}

// ------------------------------------------------------------------ heartbeat (R-08, T1-09)

export function useHeartbeat(enabled: boolean, id: string, state: () => Partial<StationState> & { session_id?: string }, onCommand: (c: StationCommand) => void, intervalMs = 5000) {
  const stateRef = useRef(state);
  stateRef.current = state;
  const cmdRef = useRef(onCommand);
  cmdRef.current = onCommand;
  const [online, setOnline] = useState(true);
  useEffect(() => {
    if (!enabled) return;
    let stop = false;
    const beat = async () => {
      try {
        const res = await api<HeartbeatResponse>(`/stations/${encodeURIComponent(id)}/heartbeat`, { method: 'POST', json: { ...stateRef.current(), station_id: id } });
        if (stop) return;
        setOnline(true);
        for (const c of res?.commands ?? []) cmdRef.current(c);
      } catch {
        if (!stop) setOnline(false);
      }
    };
    void beat();
    const t = setInterval(beat, intervalMs);
    return () => { stop = true; clearInterval(t); };
  }, [enabled, id, intervalMs]);
  return online;
}
