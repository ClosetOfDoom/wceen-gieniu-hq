import { useState, useRef } from 'react'
import type { DailyPerformance, MetaAdDaily } from '../services/data'
import { KPI_METRICS, fmtMetric, aggregateByCampaign } from '../lib/kpiMetrics'

interface Props {
  rows: DailyPerformance[]        // current period (any order)
  prevRows: DailyPerformance[]    // previous period of the SAME length (comparison)
  campaignRows: MetaAdDaily[]     // raw per-ad rows for the range (day breakdown on click)
  from: string
  to: string
  loading: boolean
}

// Metrics offered by the series switcher. Each maps to a KPI_METRICS entry that
// computes the value PER DAY from that day's own components (never avg-of-avgs).
const SERIES_IDS = ['wix_revenue', 'meta_spend', 'wix_orders', 'real_cpa', 'real_roas', 'ctr', 'cpc', 'cpm', 'clicks', 'impressions']

// All calendar days in [from, to] inclusive — so a day with no row shows as a gap.
function eachDay(from: string, to: string): string[] {
  const out: string[] = []
  let t = Date.parse(from + 'T12:00:00Z')
  const end = Date.parse(to + 'T12:00:00Z')
  if (!Number.isFinite(t) || !Number.isFinite(end) || end < t) return from ? [from] : []
  while (t <= end) { out.push(new Date(t).toISOString().slice(0, 10)); t += 86400000 }
  return out
}

function fmtK(n: number): string {
  if (Math.abs(n) >= 1000) return (n / 1000).toFixed(1) + 'k'
  return n.toFixed(n % 1 === 0 ? 0 : 1)
}

export function RevenueTrendChart({ rows, prevRows, campaignRows, from, to, loading }: Props) {
  const [seriesId, setSeriesId] = useState<string>('wix_revenue')
  const [hover, setHover] = useState<{ i: number; px: number } | null>(null)
  const [openDay, setOpenDay] = useState<string | null>(null)
  const wrapRef = useRef<HTMLDivElement | null>(null)

  const metric = KPI_METRICS[seriesId] ?? KPI_METRICS.wix_revenue

  if (loading) {
    return <div style={{ height: 280, display: 'flex', alignItems: 'center', justifyContent: 'center', color: 'var(--muted)', fontFamily: 'var(--font-mono)', fontSize: '0.82rem' }}>Loading trend…</div>
  }

  const byDate = new Map(rows.map(r => [r.date, r]))
  const days = eachDay(from, to)
  if (days.length === 0) {
    return <div style={{ height: 280, display: 'flex', alignItems: 'center', justifyContent: 'center', color: 'var(--muted)', fontFamily: 'var(--font-mono)', fontSize: '0.82rem' }}>No trend data yet</div>
  }

  // Current-period series: value per day (null → gap, i.e. missing day or n/a metric).
  const cur = days.map(d => {
    const r = byDate.get(d)
    return { date: d, value: r ? metric.daily?.(r) ?? null : null }
  })
  // Previous period (same length) — aligned by index; dashed comparison line.
  const prevSorted = [...prevRows].sort((a, b) => a.date.localeCompare(b.date))
  const prev = days.map((_, i) => {
    const r = prevSorted[i]
    return r ? metric.daily?.(r) ?? null : null
  })

  const allVals = [...cur.map(p => p.value), ...prev].filter((v): v is number => v != null)
  if (allVals.length === 0) {
    return (
      <div>
        <SeriesSwitcher seriesId={seriesId} onPick={setSeriesId} />
        <div style={{ height: 200, display: 'flex', alignItems: 'center', justifyContent: 'center', color: 'var(--amber)', fontFamily: 'var(--font-mono)', fontSize: '0.8rem', textAlign: 'center', padding: '0 20px' }}>
          brak wartości dla „{metric.label}” w tym zakresie ({from} → {to}) — nie rysuję pustego wykresu
        </div>
      </div>
    )
  }

  const W = 680, H = 280
  const pad = { top: 20, right: 16, bottom: 44, left: 58 }
  const chartW = W - pad.left - pad.right
  const chartH = H - pad.top - pad.bottom
  const n = days.length
  const xStep = n > 1 ? chartW / (n - 1) : chartW
  let maxY = Math.max(...allVals), minY = Math.min(...allVals, 0)
  if (maxY === minY) maxY = minY + 1
  maxY = maxY * 1.12

  const x = (i: number) => pad.left + (n <= 1 ? chartW / 2 : i * xStep)
  const y = (v: number) => pad.top + chartH - ((v - minY) / (maxY - minY)) * chartH

  // Break a series into segments of consecutive non-null points → gaps stay gaps.
  const segments = (vals: (number | null)[]) => {
    const segs: { i: number; v: number }[][] = []
    let s: { i: number; v: number }[] = []
    vals.forEach((v, i) => { if (v == null) { if (s.length) { segs.push(s); s = [] } } else s.push({ i, v }) })
    if (s.length) segs.push(s)
    return segs
  }
  const curSegs = segments(cur.map(p => p.value))
  const prevSegs = segments(prev)
  const gridValues = [0, 0.25, 0.5, 0.75, 1]

  const onMove = (e: React.MouseEvent<SVGSVGElement>) => {
    const rect = wrapRef.current?.getBoundingClientRect()
    if (!rect) return
    const frac = (e.clientX - rect.left) / rect.width       // 0..1 across the SVG
    const svgX = frac * W
    const i = Math.max(0, Math.min(n - 1, Math.round((svgX - pad.left) / (xStep || 1))))
    setHover({ i, px: (x(i) / W) * rect.width })
  }
  const clickDay = (i: number) => setOpenDay(d => (d === days[i] ? null : days[i]))

  const hoveredRow = hover ? byDate.get(days[hover.i]) : undefined
  const tip = hover ? tooltipLines(days[hover.i], hoveredRow) : null

  return (
    <div>
      <SeriesSwitcher seriesId={seriesId} onPick={setSeriesId} />
      <div ref={wrapRef} style={{ position: 'relative' }}>
        <svg
          viewBox={`0 0 ${W} ${H}`} style={{ width: '100%', height: 'auto', display: 'block', minHeight: 160 }}
          onMouseMove={onMove} onMouseLeave={() => setHover(null)}
          onClick={() => { if (hover) clickDay(hover.i) }}
          role="img" aria-label={`${metric.label} trend`}
        >
          <defs>
            <filter id="gold-glow" x="-20%" y="-60%" width="140%" height="220%">
              <feGaussianBlur in="SourceGraphic" stdDeviation="3" result="blur" />
              <feFlood floodColor="#ee9d00" floodOpacity="0.6" result="color" />
              <feComposite in="color" in2="blur" operator="in" result="glow" />
              <feMerge><feMergeNode in="glow" /><feMergeNode in="SourceGraphic" /></feMerge>
            </filter>
          </defs>

          {gridValues.map(frac => {
            const gv = minY + frac * (maxY - minY)
            const gy = y(gv)
            return (
              <g key={frac}>
                <line x1={pad.left} y1={gy} x2={W - pad.right} y2={gy} stroke="var(--border)" strokeWidth="1" strokeDasharray="3 5" />
                <text x={pad.left - 6} y={gy + 4} textAnchor="end" fill="var(--muted2)" fontSize="11" fontFamily="monospace">{fmtK(gv)}</text>
              </g>
            )
          })}

          {/* Previous-period comparison — dashed, greyed */}
          {prevSegs.map((seg, si) => (
            <polyline key={'p' + si} points={seg.map(p => `${x(p.i)},${y(p.v)}`).join(' ')} fill="none" stroke="var(--muted2)" strokeWidth="1.5" strokeDasharray="5 4" opacity="0.7" />
          ))}

          {/* Current-period selected metric — gold glow */}
          {curSegs.map((seg, si) => (
            <polyline key={'c' + si} points={seg.map(p => `${x(p.i)},${y(p.v)}`).join(' ')} fill="none" stroke="var(--gold)" strokeWidth="2.5" strokeLinejoin="round" filter="url(#gold-glow)" />
          ))}

          {/* Dots (clickable) on current series */}
          {cur.map((p, i) => p.value == null ? null : (
            <circle key={p.date} cx={x(i)} cy={y(p.value)} r="4" fill="var(--gold)" stroke="var(--bg)" strokeWidth="1.5" style={{ cursor: 'pointer' }} onClick={(e) => { e.stopPropagation(); clickDay(i) }} />
          ))}

          {/* Hover guide + marker */}
          {hover && (
            <g>
              <line x1={x(hover.i)} y1={pad.top} x2={x(hover.i)} y2={pad.top + chartH} stroke="var(--gold)" strokeWidth="1" strokeDasharray="2 3" opacity="0.5" />
              {cur[hover.i].value != null && <circle cx={x(hover.i)} cy={y(cur[hover.i].value!)} r="5.5" fill="none" stroke="var(--gold)" strokeWidth="1.5" />}
            </g>
          )}

          {/* Clicked-day marker */}
          {openDay && days.includes(openDay) && (
            <line x1={x(days.indexOf(openDay))} y1={pad.top} x2={x(days.indexOf(openDay))} y2={pad.top + chartH} stroke="var(--gold-bright)" strokeWidth="1.5" />
          )}

          {/* X-axis labels */}
          {days.map((d, i) => {
            if (n > 8 && i % Math.ceil(n / 8) !== 0 && i !== n - 1) return null
            return <text key={d + '-lbl'} x={x(i)} y={H - 10} textAnchor="middle" fill="var(--muted)" fontSize="11" fontFamily="monospace">{d.slice(5)}</text>
          })}

          {/* Legend */}
          <line x1={W - 150} y1={pad.top + 8} x2={W - 132} y2={pad.top + 8} stroke="var(--gold)" strokeWidth="2.5" />
          <text x={W - 128} y={pad.top + 12} fill="var(--gold)" fontSize="10.5" fontFamily="monospace">{metric.label}</text>
          <line x1={W - 150} y1={pad.top + 24} x2={W - 132} y2={pad.top + 24} stroke="var(--muted2)" strokeWidth="1.5" strokeDasharray="4 3" />
          <text x={W - 128} y={pad.top + 28} fill="var(--muted2)" fontSize="10.5" fontFamily="monospace">poprz. okres</text>
        </svg>

        {/* Tooltip — all series for the hovered day, each computed from that day's components */}
        {tip && hover && (
          <div style={{
            position: 'absolute', top: 6, left: Math.max(4, Math.min((wrapRef.current?.clientWidth ?? 300) - 190, hover.px + 12)),
            background: 'var(--surface)', border: '1px solid var(--border-gold)', borderRadius: '5px', padding: '8px 10px',
            fontFamily: 'var(--font-mono)', fontSize: '0.68rem', color: 'var(--text2)', pointerEvents: 'none', minWidth: 172, boxShadow: '0 4px 14px rgba(0,0,0,0.3)', zIndex: 3,
          }}>
            <div style={{ color: 'var(--gold)', marginBottom: 4 }}>{tip.date}</div>
            {tip.lines.map((l, i) => (
              <div key={i} style={{ display: 'flex', justifyContent: 'space-between', gap: 12 }}>
                <span style={{ color: 'var(--muted)' }}>{l.k}</span><span>{l.v}</span>
              </div>
            ))}
            <div style={{ color: 'var(--muted2)', marginTop: 4, fontSize: '0.6rem' }}>klik → rozbicie per kampania</div>
          </div>
        )}
      </div>

      {openDay && (
        <DayBreakdown day={openDay} campaignRows={campaignRows} onClose={() => setOpenDay(null)} />
      )}
    </div>
  )
}

// Fixed tooltip set (spec): revenue, ad spend, orders, real CPA, real ROAS — each
// derived from THAT day's own components.
function tooltipLines(date: string, r: DailyPerformance | undefined) {
  if (!r) return { date, lines: [{ k: 'brak danych', v: '—' }] }
  const rev = Number(r.wix_revenue ?? 0), sp = Number(r.meta_spend ?? 0), ord = Number(r.wix_orders ?? 0)
  const cpa = ord > 0 ? sp / ord : null
  const roas = sp > 0 ? rev / sp : null
  return {
    date,
    lines: [
      { k: 'Revenue', v: fmtMetric('pln', rev) },
      { k: 'Ad spend', v: fmtMetric('pln', sp) },
      { k: 'Orders', v: fmtMetric('num', ord) },
      { k: 'Real CPA', v: cpa == null ? '— (0 zamówień)' : fmtMetric('pln', cpa) },
      { k: 'Real ROAS', v: roas == null ? '— (0 spend)' : fmtMetric('x', roas) },
    ],
  }
}

function SeriesSwitcher({ seriesId, onPick }: { seriesId: string; onPick: (id: string) => void }) {
  return (
    <div style={{ display: 'flex', flexWrap: 'wrap', gap: 6, marginBottom: 10 }}>
      {SERIES_IDS.map(id => {
        const m = KPI_METRICS[id]
        const active = id === seriesId
        return (
          <button
            key={id}
            onClick={() => onPick(id)}
            style={{
              fontFamily: 'var(--font-mono)', fontSize: '0.66rem', padding: '3px 9px', borderRadius: '3px', cursor: 'pointer',
              border: `1px solid ${active ? 'var(--border-gold)' : 'var(--border)'}`,
              background: active ? 'var(--surface2)' : 'transparent',
              color: active ? 'var(--gold)' : 'var(--muted)',
            }}
          >{m.label}</button>
        )
      })}
    </div>
  )
}

// Per-campaign breakdown for a clicked day: spend, CTR, CPC, CPM, impressions.
function DayBreakdown({ day, campaignRows, onClose }: { day: string; campaignRows: MetaAdDaily[]; onClose: () => void }) {
  const aggs = aggregateByCampaign(campaignRows.filter(r => r.date === day)).sort((a, b) => b.spend - a.spend)
  return (
    <div style={{ marginTop: 12, border: '1px solid var(--border-gold)', borderRadius: '6px', padding: '10px 12px', background: 'var(--surface)' }}>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 8 }}>
        <span style={{ fontFamily: 'var(--font-mono)', fontSize: '0.74rem', color: 'var(--gold)' }}>Rozbicie per kampania — {day}</span>
        <button onClick={onClose} style={{ background: 'none', border: '1px solid var(--border)', color: 'var(--muted)', borderRadius: '3px', padding: '2px 8px', cursor: 'pointer', fontFamily: 'var(--font-mono)', fontSize: '0.7rem' }}>✕</button>
      </div>
      {aggs.length === 0 ? (
        <div style={{ fontFamily: 'var(--font-mono)', fontSize: '0.72rem', color: 'var(--muted)' }}>brak wierszy kampanii dla {day}</div>
      ) : (
        <div style={{ overflowX: 'auto' }}>
          <table style={{ width: '100%', borderCollapse: 'collapse', fontFamily: 'var(--font-mono)', fontSize: '0.7rem' }}>
            <thead>
              <tr style={{ color: 'var(--muted2)', textAlign: 'right' }}>
                <th style={{ textAlign: 'left', padding: '3px 6px' }}>Kampania</th>
                <th style={{ padding: '3px 6px' }}>Spend</th>
                <th style={{ padding: '3px 6px' }}>CTR</th>
                <th style={{ padding: '3px 6px' }}>CPC</th>
                <th style={{ padding: '3px 6px' }}>CPM</th>
                <th style={{ padding: '3px 6px' }}>Wyświetlenia</th>
              </tr>
            </thead>
            <tbody>
              {aggs.map((c, i) => {
                const ctr = c.impressions > 0 ? c.link_clicks / c.impressions * 100 : null
                const cpc = c.clicks > 0 ? c.spend / c.clicks : null
                const cpm = c.impressions > 0 ? c.spend / c.impressions * 1000 : null
                return (
                  <tr key={i} style={{ color: 'var(--text2)', textAlign: 'right', borderTop: '1px solid var(--border)' }}>
                    <td style={{ textAlign: 'left', padding: '3px 6px', maxWidth: 200, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }} title={c.campaign}>{c.campaign}</td>
                    <td style={{ padding: '3px 6px' }}>{fmtMetric('pln', c.spend)}</td>
                    <td style={{ padding: '3px 6px' }}>{fmtMetric('pct', ctr)}</td>
                    <td style={{ padding: '3px 6px' }}>{fmtMetric('pln', cpc)}</td>
                    <td style={{ padding: '3px 6px' }}>{fmtMetric('pln', cpm)}</td>
                    <td style={{ padding: '3px 6px' }}>{fmtMetric('num', c.impressions)}</td>
                  </tr>
                )
              })}
            </tbody>
          </table>
        </div>
      )}
    </div>
  )
}
