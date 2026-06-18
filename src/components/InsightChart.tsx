import type { InsightChartSpec } from '../brain/responses'

// ── Layout constants ──────────────────────────────────────────────────────────
const W    = 640
const H    = 220
const PAD  = { top: 28, right: 20, bottom: 52, left: 58 }
const CW   = W - PAD.left - PAD.right   // chart width
const CH   = H - PAD.top  - PAD.bottom  // chart height

function fmtLabel(n: number): string {
  if (n >= 1000) return (n / 1000).toFixed(1) + 'k'
  return n.toFixed(0)
}

// ── Main entry ────────────────────────────────────────────────────────────────

export function InsightChart({ spec }: { spec: InsightChartSpec }) {
  if (spec.type === 'funnel') return <FunnelChart spec={spec} />
  if (spec.type === 'line')   return <LineChart   spec={spec} />
  return <BarChart spec={spec} />
}

// ── Vertical grouped bar chart ────────────────────────────────────────────────

function BarChart({ spec }: { spec: InsightChartSpec }) {
  const { data, xKey, series, title } = spec
  const n       = data.length
  const nSeries = series.length
  if (n === 0) return null

  const groupW = CW / n
  const gap    = 4
  const barW   = Math.min(40, (groupW - gap * (nSeries + 1)) / nSeries)

  const maxVal = Math.max(
    ...data.flatMap(d => series.map(s => Number(d[s.key] ?? 0))),
    1
  ) * 1.12

  const gridFracs = [0.25, 0.5, 0.75, 1]

  function xBar(groupIdx: number, serIdx: number) {
    const gStart = PAD.left + groupIdx * groupW + (groupW - nSeries * barW - (nSeries - 1) * gap) / 2
    return gStart + serIdx * (barW + gap)
  }
  function yVal(v: number) { return PAD.top + CH - (v / maxVal) * CH }
  function bh(v: number)   { return (v / maxVal) * CH }

  return (
    <div style={{ marginTop: '14px' }}>
      <div style={{ fontFamily: 'var(--font-serif)', fontSize: '0.72rem', color: 'var(--gold)', letterSpacing: '0.14em', textTransform: 'uppercase', marginBottom: '6px' }}>
        {title}
      </div>
      <svg viewBox={`0 0 ${W} ${H}`} style={{ width: '100%', height: 'auto', display: 'block' }}>
        {/* Grid lines */}
        {gridFracs.map(f => {
          const gy = PAD.top + CH - f * CH
          return (
            <g key={f}>
              <line x1={PAD.left} y1={gy} x2={W - PAD.right} y2={gy}
                stroke="var(--border)" strokeWidth="1" strokeDasharray="3 4" />
              <text x={PAD.left - 5} y={gy + 4} textAnchor="end"
                fill="var(--muted2)" fontSize="10" fontFamily="monospace">
                {fmtLabel(maxVal * f)}
              </text>
            </g>
          )
        })}

        {/* Bars */}
        {data.map((d, gi) => (
          <g key={String(d[xKey])}>
            {series.map((s, si) => {
              const val  = Number(d[s.key] ?? 0)
              if (val <= 0) return null
              const bx    = xBar(gi, si)
              const color = s.color ?? 'var(--gold)'
              return (
                <g key={s.key}>
                  <rect x={bx} y={yVal(val)} width={barW} height={bh(val)}
                    fill={color} opacity={0.82} rx={2} />
                  {bh(val) > 14 && (
                    <text x={bx + barW / 2} y={yVal(val) - 3}
                      textAnchor="middle" fill={color} fontSize="9" fontFamily="monospace">
                      {fmtLabel(val)}
                    </text>
                  )}
                </g>
              )
            })}
            {/* X label */}
            <text
              x={PAD.left + gi * groupW + groupW / 2}
              y={H - 8}
              textAnchor="middle"
              fill="var(--muted)"
              fontSize="11"
              fontFamily="monospace"
            >
              {String(d[xKey]).slice(0, 14)}
            </text>
          </g>
        ))}

        {/* Legend */}
        {series.map((s, i) => {
          const color = s.color ?? 'var(--gold)'
          const lx    = W - PAD.right - series.length * 76 + i * 76
          return (
            <g key={s.key}>
              <rect x={lx} y={8} width={10} height={10} fill={color} rx={2} />
              <text x={lx + 13} y={17} fill={color} fontSize="10" fontFamily="monospace">{s.label}</text>
            </g>
          )
        })}
      </svg>
    </div>
  )
}

// ── Multi-series line chart ───────────────────────────────────────────────────

function LineChart({ spec }: { spec: InsightChartSpec }) {
  const { data, xKey, series, title } = spec
  const n = data.length
  if (n === 0) return null

  const xStep  = n > 1 ? CW / (n - 1) : CW
  const maxVal = Math.max(...data.flatMap(d => series.map(s => Number(d[s.key] ?? 0))), 1) * 1.12
  const clipId = `lc-${title.replace(/\s/g, '')}`
  const gridFracs = [0.25, 0.5, 0.75, 1]

  function xPt(i: number) { return PAD.left + i * xStep }
  function yPt(v: number) { return PAD.top + CH - (v / maxVal) * CH }
  function pts(key: string) {
    return data.map((d, i) => `${xPt(i)},${yPt(Number(d[key] ?? 0))}`).join(' ')
  }

  return (
    <div style={{ marginTop: '14px' }}>
      <div style={{ fontFamily: 'var(--font-serif)', fontSize: '0.72rem', color: 'var(--gold)', letterSpacing: '0.14em', textTransform: 'uppercase', marginBottom: '6px' }}>
        {title}
      </div>
      <svg viewBox={`0 0 ${W} ${H}`} style={{ width: '100%', height: 'auto', display: 'block' }}>
        <defs>
          <clipPath id={clipId}>
            <rect x={PAD.left} y={PAD.top} width={CW} height={CH} />
          </clipPath>
        </defs>

        {/* Grid */}
        {gridFracs.map(f => {
          const gy = PAD.top + CH - f * CH
          return (
            <g key={f}>
              <line x1={PAD.left} y1={gy} x2={W - PAD.right} y2={gy}
                stroke="var(--border)" strokeWidth="1" strokeDasharray="3 4" />
              <text x={PAD.left - 5} y={gy + 4} textAnchor="end"
                fill="var(--muted2)" fontSize="10" fontFamily="monospace">
                {fmtLabel(maxVal * f)}
              </text>
            </g>
          )
        })}

        {/* Lines + dots */}
        {series.map((s, si) => {
          const color  = s.color ?? 'var(--gold)'
          const dashes = si > 0 ? '5 3' : undefined
          return (
            <g key={s.key} clipPath={`url(#${clipId})`}>
              <polyline points={pts(s.key)} fill="none" stroke={color}
                strokeWidth="2" strokeLinejoin="round" strokeDasharray={dashes} />
              {data.map((d, i) => (
                <circle key={i} cx={xPt(i)} cy={yPt(Number(d[s.key] ?? 0))}
                  r="3.5" fill={color} stroke="var(--bg)" strokeWidth="1.5" />
              ))}
            </g>
          )
        })}

        {/* X-axis labels */}
        {data.map((d, i) => {
          if (n > 6 && i % 2 !== 0) return null
          return (
            <text key={i} x={xPt(i)} y={H - 8}
              textAnchor="middle" fill="var(--muted)" fontSize="10" fontFamily="monospace">
              {String(d[xKey]).slice(0, 6)}
            </text>
          )
        })}

        {/* Legend */}
        {series.map((s, i) => {
          const color = s.color ?? 'var(--gold)'
          const lx    = W - PAD.right - series.length * 76 + i * 76
          return (
            <g key={s.key}>
              <line x1={lx} y1={12} x2={lx + 16} y2={12} stroke={color} strokeWidth="2"
                strokeDasharray={i > 0 ? '4 2' : undefined} />
              <text x={lx + 20} y={16} fill={color} fontSize="10" fontFamily="monospace">{s.label}</text>
            </g>
          )
        })}
      </svg>
    </div>
  )
}

// ── Horizontal funnel / campaign chart ────────────────────────────────────────

function FunnelChart({ spec }: { spec: InsightChartSpec }) {
  const { data, xKey, series, title } = spec
  if (data.length === 0 || series.length === 0) return null

  const mainKey  = series[0].key
  const color    = series[0].color ?? 'var(--gold)'
  const maxVal   = Math.max(...data.map(d => Number(d[mainKey] ?? 0)), 1)
  const rowH     = 40
  const labelW   = 148
  const barMaxW  = 380
  const infoW    = 110
  const totalW   = labelW + barMaxW + infoW
  const totalH   = data.length * rowH + 20

  return (
    <div style={{ marginTop: '14px' }}>
      <div style={{ fontFamily: 'var(--font-serif)', fontSize: '0.72rem', color: 'var(--gold)', letterSpacing: '0.14em', textTransform: 'uppercase', marginBottom: '6px' }}>
        {title}
      </div>
      <svg viewBox={`0 0 ${totalW} ${totalH}`} style={{ width: '100%', height: 'auto', display: 'block' }}>
        {data.map((d, i) => {
          const val    = Number(d[mainKey] ?? 0)
          const bw     = maxVal > 0 ? (val / maxVal) * barMaxW : 0
          const y      = i * rowH + 4
          const prevVal = i > 0 ? Number(data[i - 1][mainKey] ?? 0) : val
          const conv   = i > 0 && prevVal > 0 ? ` (${((val / prevVal) * 100).toFixed(0)}%)` : ''

          // Extra info column (cpa / purchases)
          const cpa       = d['cpa']       != null ? `CPA: ${d['cpa']} PLN` : ''
          const purchases = d['purchases'] != null && Number(d['purchases']) > 0 ? `${d['purchases']} purch.` : ''
          const extraInfo = [purchases, cpa].filter(Boolean).join(' · ')

          return (
            <g key={String(d[xKey])}>
              {/* Row label */}
              <text x={labelW - 8} y={y + 22}
                textAnchor="end" fill="var(--muted)" fontSize="11" fontFamily="monospace">
                {String(d[xKey]).slice(0, 20)}
              </text>

              {/* Bar background track */}
              <rect x={labelW} y={y + 6} width={barMaxW} height={22}
                fill="var(--surface)" rx={3} />

              {/* Filled bar */}
              {bw > 0 && (
                <rect x={labelW} y={y + 6} width={bw} height={22}
                  fill={color} opacity={0.78} rx={3} />
              )}

              {/* Value label */}
              <text x={labelW + Math.max(bw, 2) + 6} y={y + 21}
                fill={color} fontSize="11" fontFamily="monospace">
                {val.toLocaleString()}{conv}
              </text>

              {/* Extra info (purchases, CPA) */}
              {extraInfo && (
                <text x={totalW - 4} y={y + 21}
                  textAnchor="end" fill="var(--muted2)" fontSize="10" fontFamily="monospace">
                  {extraInfo}
                </text>
              )}
            </g>
          )
        })}
      </svg>
    </div>
  )
}
