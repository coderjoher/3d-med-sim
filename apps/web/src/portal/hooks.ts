import { useCallback, useEffect, useRef, useState } from 'react';
import { api, ApiError } from '../shared/api';

export interface Loaded<T> {
  data: T | undefined;
  error: string | null;
  loading: boolean;
  reload(): void;
  setData(d: T | undefined): void;
}

/** GET a JSON resource from the lab API. `path === null` skips loading. */
export function useApi<T>(path: string | null): Loaded<T> {
  const [data, setData] = useState<T | undefined>(undefined);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(path !== null);
  const [tick, setTick] = useState(0);

  useEffect(() => {
    if (path === null) { setLoading(false); return; }
    let alive = true;
    setLoading(true);
    api<T>(path)
      .then((d) => { if (alive) { setData(d); setError(null); } })
      .catch((e: unknown) => { if (alive) setError(errorText(e)); })
      .finally(() => { if (alive) setLoading(false); });
    return () => { alive = false; };
  }, [path, tick]);

  const reload = useCallback(() => setTick((t) => t + 1), []);
  return { data, error, loading, reload, setData };
}

/** Poll a resource every `ms` milliseconds (R-08 live station grid). */
export function usePoll<T>(path: string | null, ms: number): Loaded<T> & { lastUpdated: number | null } {
  const res = useApi<T>(path);
  const [lastUpdated, setLastUpdated] = useState<number | null>(null);
  const reloadRef = useRef(res.reload);
  reloadRef.current = res.reload;
  useEffect(() => {
    if (path === null) return;
    const h = setInterval(() => reloadRef.current(), ms);
    return () => clearInterval(h);
  }, [path, ms]);
  useEffect(() => { if (res.data !== undefined) setLastUpdated(Date.now()); }, [res.data]);
  return { ...res, lastUpdated };
}

/** Human-readable message for an API error, including server validation details. */
export function errorText(e: unknown): string {
  if (e instanceof ApiError) {
    const d = e.details;
    if (Array.isArray(d) && d.length) return `${e.message}: ${d.map((x) => (typeof x === 'string' ? x : JSON.stringify(x))).join('; ')}`;
    return e.message;
  }
  return e instanceof Error ? e.message : String(e);
}

/** Server validation details as a list (for showing beneath a form). */
export function errorList(e: unknown): string[] {
  if (e instanceof ApiError && Array.isArray(e.details) && e.details.length)
    return e.details.map((x) => (typeof x === 'string' ? x : JSON.stringify(x)));
  return [errorText(e)];
}

export function pct(v: number | null | undefined, digits = 0): string {
  if (v === null || v === undefined || Number.isNaN(v)) return '—';
  return `${v.toFixed(digits)}%`;
}

/** Rate 0..1 → "NN%". */
export function rate(v: number | null | undefined): string {
  return v === null || v === undefined ? '—' : pct(v * 100);
}

export function num(v: number | null | undefined, digits = 2): string {
  return v === null || v === undefined || Number.isNaN(v) ? '—' : v.toFixed(digits);
}

export function secs(ms: number | null | undefined): string {
  return ms === null || ms === undefined ? '—' : `${(ms / 1000).toFixed(1)} s`;
}
