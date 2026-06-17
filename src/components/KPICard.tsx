interface Props {
  label: string
  value: string
  accent?: boolean
  warning?: boolean
  dim?: boolean
  sublabel?: string
}

export function KPICard({ label, value, accent, warning, dim, sublabel }: Props) {
  const valueColor = warning
    ? 'var(--orange)'
    : accent
      ? 'var(--gold-bright)'
      : dim
        ? 'var(--muted)'
        : 'var(--text)'

  const borderColor = warning
    ? 'rgba(251, 146, 60, 0.35)'
    : accent
      ? 'rgba(201, 169, 110, 0.3)'
      : 'var(--border)'

  return (
    <div
      style={{
        background: 'var(--surface)',
        border: `1px solid ${borderColor}`,
        borderRadius: '4px',
        padding: '20px 24px',
        minWidth: '150px',
        flex: '1 1 150px',
        position: 'relative',
        overflow: 'hidden',
      }}
    >
      {(accent || warning) && (
        <div style={{
          position: 'absolute',
          top: 0,
          left: 0,
          right: 0,
          height: '2px',
          background: warning ? 'var(--orange)' : 'linear-gradient(90deg, var(--gold), transparent)',
        }} />
      )}

      <div style={{
        fontFamily: 'var(--font-serif)',
        fontSize: '0.74rem',
        color: 'var(--muted)',
        textTransform: 'uppercase',
        letterSpacing: '0.14em',
        marginBottom: '10px',
      }}>
        {label}
      </div>
      <div style={{
        fontSize: 'clamp(2.0rem, 3vw, 2.8rem)',
        fontWeight: 700,
        color: valueColor,
        fontVariantNumeric: 'tabular-nums',
        lineHeight: 1.1,
        fontFamily: 'var(--font-mono)',
      }}>
        {value}
      </div>
      {sublabel && (
        <div style={{ fontSize: '0.7rem', color: 'var(--muted2)', marginTop: '5px', fontFamily: 'var(--font-mono)' }}>
          {sublabel}
        </div>
      )}
    </div>
  )
}
