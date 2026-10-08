/** Minimal accessible SVG bar chart (R-04 cohort comparison). Values are percentages 0..100. */
export interface Bar { label: string; value: number; sub?: string; error?: number }

export function BarChart({ bars, title, max = 100 }: { bars: Bar[]; title: string; max?: number }) {
  const w = 560;
  const rowH = 34;
  const labelW = 140;
  const h = Math.max(1, bars.length) * rowH + 24;
  const scale = (v: number) => ((w - labelW - 60) * Math.max(0, Math.min(v, max))) / max;
  return (
    <svg role="img" aria-label={title} viewBox={`0 0 ${w} ${h}`} width="100%" style={{ maxWidth: w }} data-testid="bar-chart" className="portal-chart">
      <title>{title}</title>
      {[0, 25, 50, 75, 100].filter((t) => t <= max).map((t) => (
        <g key={t}>
          <line x1={labelW + scale(t)} x2={labelW + scale(t)} y1={0} y2={h - 18} stroke="var(--border)" />
          <text x={labelW + scale(t)} y={h - 4} fontSize="11" textAnchor="middle" fill="var(--muted)">{t}</text>
        </g>
      ))}
      {bars.map((b, i) => {
        const y = i * rowH + 4;
        return (
          <g key={b.label} data-testid="bar">
            <text x={labelW - 8} y={y + rowH / 2} fontSize="13" textAnchor="end" dominantBaseline="middle" fill="var(--ink)">{b.label}</text>
            <rect x={labelW} y={y + 4} width={scale(b.value)} height={rowH - 12} fill="var(--brand)" rx="3">
              <title>{`${b.label}: ${b.value.toFixed(1)}${b.sub ? ` (${b.sub})` : ''}`}</title>
            </rect>
            {b.error !== undefined && b.error > 0 && (
              <line x1={labelW + scale(b.value - b.error)} x2={labelW + scale(b.value + b.error)} y1={y + rowH / 2 - 2} y2={y + rowH / 2 - 2} stroke="var(--ink)" strokeWidth="1.5" />
            )}
            <text x={labelW + scale(b.value) + 6} y={y + rowH / 2} fontSize="12" dominantBaseline="middle" fill="var(--ink)">{b.value.toFixed(1)}%{b.sub ? ` · ${b.sub}` : ''}</text>
          </g>
        );
      })}
    </svg>
  );
}
