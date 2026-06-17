import type { DailyPerformance } from '../services/data'

interface Props {
  rows: DailyPerformance[]
  loading: boolean
}

function fmtK(n: number): string {
  if (n >= 1000) return (n / 1000).toFixed(1) + 'k'
  return n.toFixed(0)
}

export function RevenueTrendChart({ rows, loading }: Props) {
  if (loading) {
    return (
      <div style={{ height: 280, display: 'flex', alignItems: 'center', justifyContent: 'center', color: 'var(--muted)', fontFamily: 'var(--font-mono)', fontSize: '0.82rem' }}>
        Loading trend…
      </div>
    )
  }

  const sorted = [...rows].reverse() // oldest → newest
  if (sorted.length === 0) {
    return (
      <div style={{ height: 280, display: 'flex', alignItems: 'center', justifyContent: 'center', color: 'var(--muted)', fontFamily: 'var(--font-mono)', fontSize: '0.82rem' }}>
        No trend data yet
      </div>
    )
  }

  const W = 680
  const H = 280
  const pad = { top: 20, right: 16, bottom: 44, left: 58 }
  const chartW = W - pad.left - pad.right
  const chartH = H - pad.top - pad.bottom
  const n = sorted.length
  const xStep = n > 1 ? chartW / (n - 1) : chartW

  const maxRev   = Math.max(...sorted.map(r => r.wix_revenue ?? 0), 1)
  const maxSpend = Math.max(...sorted.map(r => r.meta_spend ?? 0), 1)
  const maxY     = Math.max(maxRev, maxSpend) * 1.15

  function x(i: number) { return pad.left + i * xStep }
  function y(v: number) { return pad.top + chartH - (v / maxY) * chartH }
  function pt(i: number, v: number) { return `${x(i)},${y(v)}` }

  const revLine   = sorted.map((r, i) => pt(i, r.wix_revenue ?? 0)).join(' ')
  const spendLine = sorted.map((r, i) => pt(i, r.meta_spend ?? 0)).join(' ')

  const revArea   = [
    ...sorted.map((r, i) => pt(i, r.wix_revenue ?? 0)),
    `${x(n - 1)},${y(0)}`,
    `${x(0)},${y(0)}`,
  ].join(' ')

  const gridValues = [0.25, 0.5, 0.75, 1]

  return (
    <svg viewBox={`0 0 ${W} ${H}`} style={{ width: '100%', height: 'auto', display: 'block', minHeight: 160 }}>
      <defs>
        <linearGradient id="gRevGrad" x1="0" y1="0" x2="0" y2="1">
          <stop offset="0%"   stopColor="#c9a96e" stopOpacity="0.35" />
          <stop offset="100%" stopColor="#c9a96e" stopOpacity="0" />
        </linearGradient>
        <clipPath id="chartClip">
          <rect x={pad.left} y={pad.top} width={chartW} height={chartH} />
        </clipPath>
      </defs>

      {/* Grid lines */}
      {gridValues.map(frac => {
        const gy = y(maxY * frac)
        return (
          <g key={frac}>
            <line x1={pad.left} y1={gy} x2={W - pad.right} y2={gy} stroke="var(--border)" strokeWidth="1" strokeDasharray="3 5" />
            <text x={pad.left - 6} y={gy + 4} textAnchor="end" fill="var(--muted2)" fontSize="11" fontFamily="monospace">
              {fmtK(maxY * frac)}
            </text>
          </g>
        )
      })}

      {/* Revenue area fill */}
      <polygon points={revArea} fill="url(#gRevGrad)" clipPath="url(#chartClip)" />

      {/* Spend dashed line */}
      <polyline
        points={spendLine}
        fill="none"
        stroke="var(--teal)"
        strokeWidth="1.5"
        strokeDasharray="5 3"
        clipPath="url(#chartClip)"
      />

      {/* Revenue solid line */}
      <polyline
        points={revLine}
        fill="none"
        stroke="var(--gold)"
        strokeWidth="2.5"
        strokeLinejoin="round"
        clipPath="url(#chartClip)"
      />

      {/* Dots on revenue */}
      {sorted.map((r, i) => (
        <circle key={r.date} cx={x(i)} cy={y(r.wix_revenue ?? 0)} r="4" fill="var(--gold)" stroke="var(--bg)" strokeWidth="1.5" />
      ))}

      {/* X-axis labels */}
      {sorted.map((r, i) => {
        if (n > 5 && i % 2 !== 0) return null
        const label = new Date(r.date).toLocaleDateString('en-GB', { day: '2-digit', month: '2-digit' })
        return (
          <text key={r.date + '-lbl'} x={x(i)} y={H - 10} textAnchor="middle" fill="var(--muted)" fontSize="11" fontFamily="monospace">
            {label}
          </text>
        )
      })}

      {/* Legend */}
      <line x1={W - 100} y1={pad.top + 10} x2={W - 82} y2={pad.top + 10} stroke="var(--gold)" strokeWidth="2.5" />
      <text x={W - 78} y={pad.top + 14} fill="var(--gold)" fontSize="11" fontFamily="monospace">Revenue</text>
      <line x1={W - 100} y1={pad.top + 26} x2={W - 82} y2={pad.top + 26} stroke="var(--teal)" strokeWidth="1.5" strokeDasharray="4 2" />
      <text x={W - 78} y={pad.top + 30} fill="var(--teal)" fontSize="11" fontFamily="monospace">Ad Spend</text>
    </svg>
  )
}
