import type { DataStatus } from '../services/data'

interface Props {
  status: DataStatus
}

const LABELS: Record<DataStatus, string> = {
  OK:            'Operational',
  META_NOT_LIVE: 'Meta Offline',
  SALES_WARNING: 'Sales Alert',
  NO_DATA:       'No Data',
}

const COLORS: Record<DataStatus, string> = {
  OK:            'var(--emerald)',
  META_NOT_LIVE: 'var(--amber)',
  SALES_WARNING: 'var(--orange)',
  NO_DATA:       'var(--muted)',
}

export function StatusBadge({ status }: Props) {
  const color = COLORS[status]
  return (
    <span style={{
      display: 'inline-flex',
      alignItems: 'center',
      gap: '5px',
      padding: '3px 10px',
      border: `1px solid ${color}`,
      borderRadius: '3px',
      color,
      fontFamily: 'var(--font-mono)',
      fontSize: '0.62rem',
      letterSpacing: '0.1em',
      textTransform: 'uppercase',
    }}>
      <span style={{ width: 5, height: 5, borderRadius: '50%', background: color, display: 'inline-block' }} />
      {LABELS[status]}
    </span>
  )
}
