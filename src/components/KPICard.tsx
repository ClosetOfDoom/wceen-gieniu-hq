interface Props {
  label: string
  value: string
  accent?: boolean
  warning?: boolean
}

export function KPICard({ label, value, accent, warning }: Props) {
  const color = warning ? '#ff6b00' : accent ? '#e8ff00' : '#fff'

  return (
    <div
      style={{
        background: '#1a1a1a',
        border: `1px solid ${warning ? '#ff6b00' : '#2a2a2a'}`,
        borderRadius: '10px',
        padding: '16px 20px',
        minWidth: '130px',
        flex: '1 1 130px',
      }}
    >
      <div
        style={{
          fontSize: '0.68rem',
          color: '#888',
          fontFamily: 'monospace',
          textTransform: 'uppercase',
          letterSpacing: '0.06em',
          marginBottom: '8px',
        }}
      >
        {label}
      </div>
      <div
        style={{
          fontSize: '1.5rem',
          fontWeight: 700,
          color,
          fontVariantNumeric: 'tabular-nums',
          lineHeight: 1.1,
        }}
      >
        {value}
      </div>
    </div>
  )
}
