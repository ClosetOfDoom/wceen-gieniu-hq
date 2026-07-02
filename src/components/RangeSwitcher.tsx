// Shared time-range switcher chips (DZIŚ / WCZORAJ / TYDZIEŃ / MIESIĄC).
// One component, used in Command Center and Campaigns for a consistent control.

import { RANGE_ORDER, RANGE_LABELS, rangeSubLabel, type TimeRange } from '../lib/timeRange'

export function RangeSwitcher({
  range, onChange, showSub = true,
}: {
  range: TimeRange
  onChange: (r: TimeRange) => void
  showSub?: boolean
}) {
  return (
    <div style={{ display: 'flex', alignItems: 'center', gap: '12px', flexWrap: 'wrap' }}>
      <span style={{ fontFamily: 'var(--font-serif)', fontSize: '0.72rem', letterSpacing: '0.14em', textTransform: 'uppercase', color: 'var(--muted)' }}>
        Zakres
      </span>
      <div style={{ display: 'flex', gap: '6px', flexWrap: 'wrap' }}>
        {RANGE_ORDER.map(r => (
          <button
            key={r}
            className={`scope-chip${range === r ? ' active' : ''}`}
            onClick={() => onChange(r)}
          >
            {RANGE_LABELS[r]}
          </button>
        ))}
      </div>
      {showSub && (
        <span style={{ marginLeft: 'auto', fontFamily: 'var(--font-mono)', fontSize: '0.68rem', color: 'var(--muted2)' }}>
          {rangeSubLabel(range)}
        </span>
      )}
    </div>
  )
}
