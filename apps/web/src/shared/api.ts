/** Thin fetch wrapper for the lab server API (contract: packages/core/src/api.ts). */
const TOKEN_KEY = 'medsim.token';

export class ApiError extends Error {
  constructor(public status: number, message: string, public details?: unknown) {
    super(message);
  }
}

function safeGet(k: string): string | null {
  try { return localStorage.getItem(k); } catch { return null; }
}

export function getToken(): string | null { return safeGet(TOKEN_KEY); }
export function setToken(token: string | null) {
  try {
    if (token) localStorage.setItem(TOKEN_KEY, token);
    else localStorage.removeItem(TOKEN_KEY);
  } catch { /* storage unavailable */ }
}

export async function api<T>(path: string, init: RequestInit & { json?: unknown } = {}): Promise<T> {
  const headers = new Headers(init.headers);
  const token = getToken();
  if (token) headers.set('Authorization', `Bearer ${token}`);
  let body = init.body;
  if (init.json !== undefined) {
    headers.set('Content-Type', 'application/json');
    body = JSON.stringify(init.json);
  }
  const res = await fetch(`/api${path}`, { ...init, headers, body });
  if (!res.ok) {
    let msg = res.statusText;
    let details: unknown;
    try { const j = await res.json(); msg = j.error ?? msg; details = j.details; } catch { /* not json */ }
    throw new ApiError(res.status, msg, details);
  }
  const ct = res.headers.get('content-type') ?? '';
  return (ct.includes('application/json') ? res.json() : res.text()) as Promise<T>;
}

/** Download a binary/text export (CSV/PDF) with auth. */
export async function download(path: string, filename: string) {
  const token = getToken();
  const res = await fetch(`/api${path}`, { headers: token ? { Authorization: `Bearer ${token}` } : {} });
  if (!res.ok) throw new ApiError(res.status, res.statusText);
  const blob = await res.blob();
  const a = document.createElement('a');
  a.href = URL.createObjectURL(blob);
  a.download = filename;
  a.click();
  URL.revokeObjectURL(a.href);
}
