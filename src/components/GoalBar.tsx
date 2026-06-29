// GoalBar — visual KPI-vs-target progress bar in the forest palette.
// Green = on target, amber = watch, red = attention. Colour is driven by an
// explicit `status` computed against business thresholds (not by fill %), so an
// inverted metric like CPA (lower = better) still colours correctly.

export type GoalStatus = 'green' | 'amber' | 'red'

interface GoalBarProps {
  label: string        // e.g. "PP — zamówienia dziś"
  valueText: string    // e.g. "12 / 18" or "32.40 PLN (cel <40)"
  pct: number          // fill 0–100
  status: GoalStatus
  note: string         // short verdict, e.g. "obserwuj"
}

const COLOR: Record<GoalStatus, string> = {
  green: 'var(--emerald)',
  amber: 'var(--amber)',
  red:   'var(--red)',
}

export function GoalBar({ label, valueText, pct, status, note }: GoalBarProps) {
  const fill = Math.max(0, Math.min(100, pct))
  const color = COLOR[status]

  return (
    <div style={{ marginBottom: '4px' }}>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'baseline', marginBottom: '6px', gap: '10px' }}>
        <span style={{
          fontFamily: 'var(--font-sans)', fontSize: '0.72rem', fontWeight: 600,
          color: 'var(--text2)', textTransform: 'uppercase', letterSpacing: '0.07em',
        }}>
          {label}
        </span>
        <span style={{
          fontFamily: 'var(--font-mono)', fontSize: '0.84rem', fontWeight: 600,
          color: 'var(--text)', whiteSpace: 'nowrap',
        }}>
          {valueText}
        </span>
      </div>

      {/* Track */}
      <div style={{
        position: 'relative', height: '11px', borderRadius: '6px',
        background: 'var(--surface3)', border: '1px solid var(--border)', overflow: 'hidden',
      }}>
        <div style={{
          position: 'absolute', top: 0, left: 0, bottom: 0,
          width: `${fill}%`,
          background: color,
          borderRadius: '6px',
          boxShadow: `0 0 8px ${color}`,
          opacity: 0.92,
          transition: 'width 0.6s cubic-bezier(0.22,1,0.36,1)',
        }} />
      </div>

      <div style={{
        fontFamily: 'var(--font-mono)', fontSize: '0.66rem', color,
        marginTop: '4px', letterSpacing: '0.02em',
      }}>
        {note}
      </div>
    </div>
  )
}
