import type { DataStatus } from '../services/data'

interface Props {
  status: DataStatus
}

const LABELS: Record<DataStatus, string> = {
  OK: 'OK',
  META_NOT_LIVE: 'META NOT LIVE',
  SALES_WARNING: 'SALES WARNING',
  NO_DATA: 'NO DATA',
}

const COLORS: Record<DataStatus, string> = {
  OK: '#00ff88',
  META_NOT_LIVE: '#e8ff00',
  SALES_WARNING: '#ff6b00',
  NO_DATA: '#888',
}

export function StatusBadge({ status }: Props) {
  const color = COLORS[status]
  return (
    <span
      style={{
        display: 'inline-block',
        padding: '3px 12px',
        borderRadius: '20px',
        border: `2px solid ${color}`,
        color,
        fontFamily: 'monospace',
        fontWeight: 700,
        fontSize: '0.75rem',
        letterSpacing: '0.08em',
        textTransform: 'uppercase',
      }}
    >
      {LABELS[status]}
    </span>
  )
}
