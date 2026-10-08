/** Remaining ms for a case with a time limit (C-07). Infinity if no limit. Never negative. */
export function remainingMs(startedAt: number, limitMin: number | undefined, now: number): number {
  if (limitMin === undefined || limitMin === null || !Number.isFinite(limitMin) || limitMin <= 0) return Infinity;
  return Math.max(0, startedAt + limitMin * 60_000 - now);
}

/** "MM:SS" (or "H:MM:SS" from one hour), rounding up so 0:00 only shows when time is fully up. "--:--" for no limit. */
export function formatClock(ms: number): string {
  if (!Number.isFinite(ms)) return '--:--';
  const total = Math.max(0, Math.ceil(ms / 1000));
  const h = Math.floor(total / 3600);
  const m = Math.floor((total % 3600) / 60);
  const s = total % 60;
  const pad = (n: number) => String(n).padStart(2, '0');
  return h > 0 ? `${h}:${pad(m)}:${pad(s)}` : `${pad(m)}:${pad(s)}`;
}
