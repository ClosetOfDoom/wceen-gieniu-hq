// DayDigest — today's numbers rendered in the chat panel WITHOUT waking Stanley.
//
// The panel used to show a duck, an empty "speak to receive the briefing" box, and
// a large dead gap above the input. The numbers were already loaded; they just
// needed rendering. This fills that gap with the four figures worth glancing at —
// orders, revenue, CPA, ROAS — each against the same figure from yesterday.
//
// Reads the daily-performance rows only. Nothing here computes, estimates or
// invents a number that the dashboard does not already show.

import type { DailyPerformance } from '../services/data'

interface Props {
  today: DailyPerformance | null
  yesterday: DailyPerformance | null
  /** Set when today's row hasn't landed yet and `today` is the latest available day. */
  stale?: boolean
  /** Date of the row actually shown (YYYY-MM-DD). */
  dateLabel?: string
}

const fmtInt = (n: number | null | undefined) =>
  n == null ? '—' : Math.round(n).toLocaleString('pl-PL')

const fmtPln = (n: number | null | undefined) =>
  n == null ? '—' : n.toLocaleString('pl-PL', { minimumFractionDigits: 0, maximumFractionDigits: 0 }) + ' zł'

const fmtRoas = (n: number | null | undefined) => (n == null ? '—' : n.toFixed(2) + '×')

// Percentage change vs yesterday. `lowerIsBetter` flips the colour only — the
// arrow always points the way the number actually moved.
function delta(
  cur: number | null | undefined,
  prev: number | null | undefined,
  lowerIsBetter = false,
): { text: string; color: string } | null {
  if (cur == null || prev == null || prev === 0) return null
  const pct = ((cur - prev) / Math.abs(prev)) * 100
  if (!Number.isFinite(pct)) return null
  const up = pct >= 0
  const good = lowerIsBetter ? !up : up
  const flat = Math.abs(pct) < 1
  return {
    text: `${up ? '▲' : '▼'} ${Math.abs(pct).toFixed(0)}%`,
    color: flat ? 'var(--muted2)' : good ? 'var(--emerald)' : 'var(--orange)',
  }
}

function Row({
  label,
  value,
  d,
}: {
  label: string
  value: string
  d: { text: string; color: string } | null
}) {
  return (
    <div
      style={{
        display: 'flex',
        alignItems: 'baseline',
        justifyContent: 'space-between',
        gap: 8,
        padding: '5px 0',
        borderBottom: '1px solid var(--border)',
      }}
    >
      <span
        style={{
          fontFamily: 'var(--font-sans)',
          fontSize: '0.66rem',
          fontWeight: 600,
          color: 'var(--text2)',
          textTransform: 'uppercase',
          letterSpacing: '0.08em',
          whiteSpace: 'nowrap',
        }}
      >
        {label}
      </span>
      <span style={{ display: 'flex', alignItems: 'baseline', gap: 8, whiteSpace: 'nowrap' }}>
        <span
          style={{
            fontFamily: 'var(--font-mono)',
            fontSize: '0.95rem',
            fontWeight: 700,
            color: 'var(--text)',
            fontVariantNumeric: 'tabular-nums',
          }}
        >
          {value}
        </span>
        <span
          style={{
            fontFamily: 'var(--font-mono)',
            fontSize: '0.64rem',
            color: d ? d.color : 'var(--muted2)',
            minWidth: 46,
            textAlign: 'right',
          }}
        >
          {d ? d.text : '—'}
        </span>
      </span>
    </div>
  )
}

export function DayDigest({ today, yesterday, stale, dateLabel }: Props) {
  const hasAny = !!today
  const cmp = yesterday ? 'vs wczoraj' : 'brak danych z wczoraj'

  return (
    <div
      className="panel-illuminate"
      style={{
        background: 'var(--surface)',
        border: '1px solid var(--border)',
        borderLeft: '3px solid var(--gold)',
        borderRadius: 4,
        padding: '12px 14px',
        marginBottom: 14,
      }}
    >
      <div
        style={{
          display: 'flex',
          alignItems: 'baseline',
          justifyContent: 'space-between',
          gap: 8,
          marginBottom: 8,
        }}
      >
        <span
          style={{
            fontFamily: 'var(--font-serif)',
            fontSize: '0.72rem',
            color: 'var(--gold)',
            letterSpacing: '0.14em',
            textTransform: 'uppercase',
          }}
        >
          Skrót dnia
        </span>
        <span style={{ fontFamily: 'var(--font-mono)', fontSize: '0.62rem', color: 'var(--muted2)' }}>
          {cmp}
        </span>
      </div>

      {hasAny ? (
        <>
          <Row
            label="Zamówienia"
            value={fmtInt(today?.wix_orders)}
            d={delta(today?.wix_orders, yesterday?.wix_orders)}
          />
          <Row
            label="Przychód"
            value={fmtPln(today?.wix_revenue)}
            d={delta(today?.wix_revenue, yesterday?.wix_revenue)}
          />
          <Row
            label="CPA"
            value={today?.real_cpa != null ? fmtPln(today.real_cpa) : '—'}
            d={delta(today?.real_cpa, yesterday?.real_cpa, true)}
          />
          <Row
            label="ROAS"
            value={fmtRoas(today?.real_roas)}
            d={delta(today?.real_roas, yesterday?.real_roas)}
          />
          {stale && dateLabel && (
            <div
              style={{
                fontFamily: 'var(--font-mono)',
                fontSize: '0.62rem',
                color: 'var(--amber)',
                marginTop: 7,
              }}
            >
              Brak danych na dziś — pokazuję {dateLabel}
            </div>
          )}
        </>
      ) : (
        <div style={{ fontFamily: 'var(--font-mono)', fontSize: '0.7rem', color: 'var(--muted)', padding: '4px 0' }}>
          Brak danych dziennych.
        </div>
      )}
    </div>
  )
}
