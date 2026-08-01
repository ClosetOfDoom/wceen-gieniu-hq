// KpiDetailChart — the panel that expands under the KPI grid when a card is clicked.
//
// Behaviour driven by the selected range's day span:
//   • span >= 2 days (TYDZIEŃ / MIESIĄC past day 1): a per-day time series of the
//     metric, each day computed from that day's own components.
//   • span  < 2 days (DZIŚ / WCZORAJ, or a 1-day month): a per-campaign breakdown,
//     since a single day is not a series.
// A metric that has no data for the chosen view shows an explicit message naming the
// missing field — never an empty chart.

import type { DailyPerformance, MetaAdDaily } from '../services/data'
import type { KpiMetric } from '../lib/kpiMetrics'
import { fmtMetric, daySpan, aggregateByCampaign } from '../lib/kpiMetrics'

interface Props {
  metric: KpiMetric
  from: string
  to: string
  dailyRows: DailyPerformance[]   // rows within [from, to]
  campaignRows: MetaAdDaily[]     // raw per-ad rows for the range (for the breakdown)
  onClose: () => void
}

const GOLD = 'var(--gold)'

function Shell({ metric, subtitle, onClose, children }: { metric: KpiMetric; subtitle: string; onClose: () => void; children: React.ReactNode }) {
  return (
    <div className="panel-illuminate card" style={{ borderColor: 'var(--border-gold)' }}>
      <div style={{ display: 'flex', alignItems: 'baseline', justifyContent: 'space-between', gap: '12px', marginBottom: '10px' }}>
        <div>
          <div className="section-title section-title-gold">{metric.label} — szereg / rozbicie</div>
          <div style={{ fontFamily: 'var(--font-mono)', fontSize: '0.68rem', color: 'var(--muted2)', marginTop: '2px' }}>{subtitle}</div>
        </div>
        <button
          onClick={onClose}
          style={{ background: 'none', border: '1px solid var(--border)', color: 'var(--muted)', borderRadius: '3px', padding: '2px 9px', cursor: 'pointer', fontFamily: 'var(--font-mono)', fontSize: '0.72rem' }}
          aria-label="Zamknij wykres"
        >✕ zamknij</button>
      </div>
      {children}
    </div>
  )
}

function NoSeries({ metric, onClose, reason }: { metric: KpiMetric; onClose: () => void; reason: string }) {
  return (
    <Shell metric={metric} subtitle="brak danych do wykresu" onClose={onClose}>
      <div style={{ fontFamily: 'var(--font-mono)', fontSize: '0.8rem', color: 'var(--amber)', padding: '14px 16px', background: 'rgba(251,191,36,0.06)', border: '1px solid rgba(251,191,36,0.2)', borderRadius: '4px', lineHeight: 1.7 }}>
        brak szeregu czasowego dla tej metryki
        <div style={{ color: 'var(--muted)', marginTop: '6px' }}>Brakujące pole: <b style={{ color: 'var(--text2)' }}>{reason}</b></div>
      </div>
    </Shell>
  )
}

// ── Time series (span >= 2 days) ─────────────────────────────────────────────────

function TimeSeries({ metric, from, to, dailyRows, onClose }: Omit<Props, 'campaignRows'>) {
  if (!metric.daily) {
    return <NoSeries metric={metric} onClose={onClose} reason={metric.missingField ?? metric.label} />
  }
  const compute = metric.daily
  const rows = [...dailyRows]
    .filter(r => r.date >= from && r.date <= to)
    .sort((a, b) => a.date.localeCompare(b.date))
  const points = rows.map(r => ({ date: r.date, value: compute(r) }))
  const valued = points.filter(p => p.value != null) as { date: string; value: number }[]

  if (valued.length === 0) {
    return <NoSeries metric={metric} onClose={onClose} reason={`${metric.label} — 0 dni z policzalną wartością w ${from} → ${to}`} />
  }

  const W = 680, H = 240, padL = 56, padR = 16, padT = 16, padB = 34
  const vals = valued.map(p => p.value)
  let maxY = Math.max(...vals), minY = Math.min(...vals, 0)
  if (maxY === minY) maxY = minY + 1
  const n = points.length
  const x = (i: number) => padL + (n <= 1 ? (W - padL - padR) / 2 : (i * (W - padL - padR)) / (n - 1))
  const y = (v: number) => padT + (1 - (v - minY) / (maxY - minY)) * (H - padT - padB)

  // Only connect consecutive non-null points; break the line on null days.
  const segments: { i: number; date: string; value: number }[][] = []
  let cur: { i: number; date: string; value: number }[] = []
  points.forEach((p, i) => {
    if (p.value == null) { if (cur.length) { segments.push(cur); cur = [] } }
    else cur.push({ i, date: p.date, value: p.value })
  })
  if (cur.length) segments.push(cur)

  const gridYs = [0, 0.25, 0.5, 0.75, 1].map(f => minY + f * (maxY - minY))

  return (
    <Shell metric={metric} subtitle={`${from} → ${to} · ${n} dni · ${metricFormula(metric.id)}`} onClose={onClose}>
      <svg viewBox={`0 0 ${W} ${H}`} style={{ width: '100%', height: 'auto', display: 'block' }} role="img" aria-label={`${metric.label} time series`}>
        {gridYs.map((gv, i) => (
          <g key={i}>
            <line x1={padL} y1={y(gv)} x2={W - padR} y2={y(gv)} stroke="var(--border)" strokeWidth={0.5} />
            <text x={padL - 8} y={y(gv) + 3} textAnchor="end" fontSize={9} fill="var(--muted2)" fontFamily="var(--font-mono)">{fmtAxis(metric.unit, gv)}</text>
          </g>
        ))}
        {segments.map((seg, si) => (
          <polyline
            key={si}
            points={seg.map(p => `${x(p.i)},${y(p.value)}`).join(' ')}
            fill="none" stroke={GOLD} strokeWidth={2} strokeLinejoin="round" strokeLinecap="round"
          />
        ))}
        {valued.map((p, i) => {
          const idx = points.findIndex(q => q.date === p.date)
          return <circle key={i} cx={x(idx)} cy={y(p.value)} r={3} fill={GOLD} />
        })}
        {points.map((p, i) => (
          (i === 0 || i === n - 1 || n <= 10 || i % Math.ceil(n / 8) === 0) ? (
            <text key={i} x={x(i)} y={H - padB + 16} textAnchor="middle" fontSize={9} fill="var(--muted2)" fontFamily="var(--font-mono)">{p.date.slice(5)}</text>
          ) : null
        ))}
      </svg>
      <div style={{ marginTop: '10px', display: 'flex', flexWrap: 'wrap', gap: '4px 14px', fontFamily: 'var(--font-mono)', fontSize: '0.68rem', color: 'var(--muted)' }}>
        {points.map((p, i) => (
          <span key={i} style={{ color: p.value == null ? 'var(--muted2)' : 'var(--text2)' }}>
            {p.date.slice(5)}: {p.value == null ? '—' : fmtMetric(metric.unit, p.value)}
          </span>
        ))}
      </div>
    </Shell>
  )
}

// ── Per-campaign breakdown (span < 2 days) ───────────────────────────────────────

function CampaignBreakdown({ metric, from, campaignRows, onClose }: { metric: KpiMetric; from: string; campaignRows: MetaAdDaily[]; onClose: () => void }) {
  if (!metric.campaign) {
    return <NoSeries metric={metric} onClose={onClose} reason={metric.missingField ?? `${metric.label} — brak rozbicia per kampania`} />
  }
  const computeC = metric.campaign
  const rowsInDay = campaignRows.filter(r => r.date === from)
  const aggs = aggregateByCampaign(rowsInDay.length > 0 ? rowsInDay : campaignRows)
    .map(c => ({ name: c.campaign, value: computeC(c) }))
    .filter(c => c.value != null) as { name: string; value: number }[]
  aggs.sort((a, b) => b.value - a.value)

  if (aggs.length === 0) {
    return <NoSeries metric={metric} onClose={onClose} reason={`${metric.label} — brak wierszy kampanii dla ${from}`} />
  }

  const maxV = Math.max(...aggs.map(a => Math.abs(a.value)), 1)
  return (
    <Shell metric={metric} subtitle={`rozbicie per kampania · ${from} (zakres < 2 dni → brak szeregu czasowego)`} onClose={onClose}>
      <div style={{ display: 'flex', flexDirection: 'column', gap: '8px' }}>
        {aggs.map((a, i) => (
          <div key={i} style={{ display: 'grid', gridTemplateColumns: '220px 1fr 96px', alignItems: 'center', gap: '10px' }}>
            <span style={{ fontFamily: 'var(--font-mono)', fontSize: '0.72rem', color: 'var(--text2)', whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }} title={a.name}>{a.name}</span>
            <div style={{ background: 'var(--surface2)', borderRadius: '3px', height: '16px', position: 'relative', overflow: 'hidden' }}>
              <div style={{ width: `${(Math.abs(a.value) / maxV) * 100}%`, height: '100%', background: `linear-gradient(90deg, ${GOLD}, var(--gold-bright))`, borderRadius: '3px' }} />
            </div>
            <span style={{ fontFamily: 'var(--font-mono)', fontSize: '0.72rem', color: 'var(--text)', textAlign: 'right' }}>{fmtMetric(metric.unit, a.value)}</span>
          </div>
        ))}
      </div>
    </Shell>
  )
}

// Short human formula, shown in the subtitle so the per-day math is transparent.
function metricFormula(id: string): string {
  switch (id) {
    case 'real_cpa':
    case 'true_cpa':  return 'per dzień: meta_spend ÷ wix_orders'
    case 'real_roas': return 'per dzień: wix_revenue ÷ meta_spend'
    case 'ctr':       return 'per dzień: link_clicks ÷ impressions'
    case 'cpc':       return 'per dzień: meta_spend ÷ clicks'
    case 'cpm':       return 'per dzień: meta_spend ÷ impressions × 1000'
    default:          return 'per dzień'
  }
}

function fmtAxis(unit: string, v: number): string {
  if (unit === 'pln') return Math.round(v).toLocaleString('en-US')
  if (unit === 'x')   return v.toFixed(1)
  if (unit === 'pct') return v.toFixed(1)
  return Math.round(v).toLocaleString('en-US')
}

// ── Entry point ──────────────────────────────────────────────────────────────────

export function KpiDetailChart({ metric, from, to, dailyRows, campaignRows, onClose }: Props) {
  const span = daySpan(from, to)
  if (span < 2) {
    return <CampaignBreakdown metric={metric} from={from} campaignRows={campaignRows} onClose={onClose} />
  }
  return <TimeSeries metric={metric} from={from} to={to} dailyRows={dailyRows} onClose={onClose} />
}
