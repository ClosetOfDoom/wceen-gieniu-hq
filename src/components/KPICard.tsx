import { useState, useEffect, useRef } from 'react'

interface Props {
  label: string
  value: string
  accent?: boolean
  warning?: boolean
  positive?: boolean
  danger?: boolean
  dim?: boolean
  sublabel?: string
}

// ── AnimatedNumber ────────────────────────────────────────────────────────────
// Parses the numeric prefix from a value string (e.g. "1 234.56 PLN", "3.2x",
// "42%", "12") and count-ups from 0 → target over 700 ms using ease-out cubic.
// The non-numeric suffix is preserved and appended after the animated number.

function parseNumericValue(value: string): { numeric: number; prefix: string; suffix: string } | null {
  if (value === '—' || value === '') return null
  // Match: optional leading sign, digits, optional decimal, optional trailing non-digit suffix
  // Handles "1 234.56 PLN", "3.2x", "42%", "12"
  const m = value.match(/^([^0-9-]*)(-?[\d\s]+(?:[.,]\d+)?)(.*)$/)
  if (!m) return null
  const prefix = m[1] ?? ''
  const rawNum = (m[2] ?? '').replace(/\s/g, '').replace(',', '.')
  const numeric = parseFloat(rawNum)
  if (isNaN(numeric)) return null
  const suffix = m[3] ?? ''
  return { numeric, prefix, suffix }
}

function easeOutCubic(t: number): number {
  return 1 - Math.pow(1 - t, 3)
}

function AnimatedNumber({ value }: { value: string }) {
  const parsed = parseNumericValue(value)
  const [displayed, setDisplayed] = useState<string>(value)
  const rafRef = useRef<number | null>(null)
  const startRef = useRef<number | null>(null)

  useEffect(() => {
    if (!parsed) {
      setDisplayed(value)
      return
    }
    const { numeric, prefix, suffix } = parsed
    const duration = 700
    if (rafRef.current !== null) cancelAnimationFrame(rafRef.current)
    startRef.current = null

    function step(now: number) {
      if (startRef.current === null) startRef.current = now
      const elapsed = now - startRef.current
      const t = Math.min(elapsed / duration, 1)
      const eased = easeOutCubic(t)
      const current = numeric * eased

      // Format the number to match original decimal places
      const decimals = (parsed!.suffix.trimStart().startsWith('PLN') || /\.\d{2}/.test(value)) ? 2 : 0
      const formatted = current.toLocaleString('en-US', {
        minimumFractionDigits: decimals,
        maximumFractionDigits: decimals,
      })
      setDisplayed(prefix + formatted + suffix)

      if (t < 1) {
        rafRef.current = requestAnimationFrame(step)
      } else {
        setDisplayed(value)
      }
    }

    rafRef.current = requestAnimationFrame(step)
    return () => { if (rafRef.current !== null) cancelAnimationFrame(rafRef.current) }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [value])

  return <>{displayed}</>
}

// ── Corner ornament ────────────────────────────────────────────────────────────

function CornerOrnament({ pos }: { pos: 'tl' | 'tr' | 'bl' | 'br' }) {
  const size = 10
  const borderWidth = '1.5px'
  const color = 'var(--border-gold)'

  const style: React.CSSProperties = {
    position: 'absolute',
    width: size,
    height: size,
    borderColor: color,
    borderStyle: 'solid',
    borderWidth: 0,
    opacity: 0.6,
  }

  if (pos === 'tl') { style.top = 5; style.left = 5; style.borderTopWidth = borderWidth; style.borderLeftWidth = borderWidth }
  if (pos === 'tr') { style.top = 5; style.right = 5; style.borderTopWidth = borderWidth; style.borderRightWidth = borderWidth }
  if (pos === 'bl') { style.bottom = 5; style.left = 5; style.borderBottomWidth = borderWidth; style.borderLeftWidth = borderWidth }
  if (pos === 'br') { style.bottom = 5; style.right = 5; style.borderBottomWidth = borderWidth; style.borderRightWidth = borderWidth }

  return <div style={style} aria-hidden="true" />
}

// ── KPICard ────────────────────────────────────────────────────────────────────

export function KPICard({ label, value, accent, warning, positive, danger, dim, sublabel }: Props) {
  const valueColor = danger
    ? '#ef4444'
    : warning
      ? 'var(--orange)'
      : positive
        ? 'var(--teal)'
        : accent
          ? 'var(--gold-bright)'
          : dim
            ? 'var(--muted)'
            : 'var(--text)'

  const borderColor = danger
    ? 'rgba(239, 68, 68, 0.35)'
    : warning
      ? 'rgba(251, 146, 60, 0.35)'
      : positive
        ? 'rgba(94, 234, 212, 0.25)'
        : accent
          ? 'rgba(238, 157, 0, 0.3)'
          : 'var(--border)'

  const topAccentBg = danger
    ? '#ef4444'
    : warning
      ? 'var(--orange)'
      : positive
        ? 'var(--teal)'
        : 'linear-gradient(90deg, var(--gold), transparent)'

  const isAccentVariant = accent || warning || positive || danger

  return (
    <div
      className="kpi-card panel-illuminate"
      style={{
        background: 'var(--surface)',
        border: `1px solid ${borderColor}`,
        borderRadius: '4px',
        padding: '20px 24px',
        minWidth: '140px',
        flex: '1 1 140px',
        position: 'relative',
        overflow: 'hidden',
      }}
    >
      {/* Corner ornaments */}
      <CornerOrnament pos="tl" />
      <CornerOrnament pos="tr" />
      <CornerOrnament pos="bl" />
      <CornerOrnament pos="br" />

      {/* Top accent bar — 3px tall on accent variants, with glow */}
      {isAccentVariant && (
        <div style={{
          position: 'absolute',
          top: 0,
          left: 0,
          right: 0,
          height: '3px',
          background: topAccentBg,
          boxShadow: accent ? `0 0 8px var(--glow-gold)` : undefined,
        }} />
      )}

      <div style={{
        fontFamily: 'var(--font-sans)',
        fontSize: '0.72rem',
        fontWeight: 600,
        color: 'var(--text2)',
        textTransform: 'uppercase',
        letterSpacing: '0.09em',
        marginBottom: '10px',
      }}>
        {label}
      </div>
      <div className="kpi-value" style={{
        fontSize: 'clamp(2.1rem, 3vw, 2.9rem)',
        fontWeight: 700,
        color: valueColor,
        fontVariantNumeric: 'tabular-nums',
        lineHeight: 1.1,
        fontFamily: 'var(--font-mono)',
        letterSpacing: '-0.01em',
      }}>
        <AnimatedNumber value={value} />
      </div>
      {sublabel && (
        <div style={{ fontSize: '0.7rem', color: 'var(--muted2)', marginTop: '5px', fontFamily: 'var(--font-mono)' }}>
          {sublabel}
        </div>
      )}
    </div>
  )
}
