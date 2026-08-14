import { useState, useEffect, useLayoutEffect, useRef } from 'react'

interface Props {
  label: string
  value: string
  accent?: boolean
  warning?: boolean
  positive?: boolean
  danger?: boolean
  dim?: boolean
  sublabel?: string
  onClick?: () => void
  active?: boolean
}

// Shrink long values so they never overflow the fixed-width card. Length-based and
// deterministic — a big PLN value like "123,456.78 PLN" gets a smaller font than "12".
function valueFontSize(value: string): string {
  const len = value.length
  if (len <= 6)  return 'clamp(1.9rem, 2.7vw, 2.7rem)'
  if (len <= 9)  return 'clamp(1.55rem, 2.2vw, 2.15rem)'
  if (len <= 12) return 'clamp(1.3rem, 1.8vw, 1.75rem)'
  if (len <= 15) return 'clamp(1.1rem, 1.5vw, 1.45rem)'
  return 'clamp(0.95rem, 1.3vw, 1.25rem)'
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

export function KPICard({ label, value, accent, warning, positive, danger, dim, sublabel, onClick, active }: Props) {
  const valueColor = danger
    ? '#ef4444'
    : warning
      ? 'var(--orange)'
      : positive
        ? 'var(--emerald)'   /* healthy KPI → nature green */
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
        ? 'rgba(91, 140, 90, 0.34)'   /* green edge */
        : accent
          ? 'rgba(238, 157, 0, 0.3)'
          : 'var(--border)'

  const topAccentBg = danger
    ? '#ef4444'
    : warning
      ? 'var(--orange)'
      : positive
        ? 'var(--emerald)'
        : 'linear-gradient(90deg, var(--gold), transparent)'

  const isAccentVariant = accent || warning || positive || danger
  const clickable = !!onClick

  // Guaranteed fit: measure the full value against the card's content width and
  // scale it down if it would overflow. Independent of font metrics, so the longest
  // real value always fits — even at 360 px. Recomputes on resize (orientation change).
  const boxRef = useRef<HTMLDivElement>(null)
  const measureRef = useRef<HTMLSpanElement>(null)
  const [fitScale, setFitScale] = useState(1)
  useLayoutEffect(() => {
    const box = boxRef.current, m = measureRef.current
    if (!box || !m) return
    const fit = () => {
      const avail = box.clientWidth
      const need = m.scrollWidth
      setFitScale(need > avail && need > 0 ? avail / need : 1)
    }
    fit()
    const ro = new ResizeObserver(fit)
    ro.observe(box)
    return () => ro.disconnect()
  }, [value])
  const baseFont = valueFontSize(value)

  return (
    <div
      className="kpi-card panel-illuminate"
      onClick={onClick}
      role={clickable ? 'button' : undefined}
      tabIndex={clickable ? 0 : undefined}
      onKeyDown={clickable ? (e) => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); onClick!() } } : undefined}
      aria-pressed={clickable ? !!active : undefined}
      style={{
        background: active ? 'var(--surface2)' : 'var(--surface)',
        border: `1px solid ${active ? 'var(--border-gold)' : borderColor}`,
        borderRadius: '4px',
        padding: '20px 22px',
        minWidth: 0,
        height: '100%',
        display: 'flex',
        flexDirection: 'column',
        position: 'relative',
        overflow: 'hidden',
        cursor: clickable ? 'pointer' : undefined,
        boxShadow: active ? '0 0 0 1px var(--border-gold), 0 0 14px var(--glow-gold)' : undefined,
        transition: 'box-shadow 0.15s, border-color 0.15s, background 0.15s',
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
        display: 'flex',
        alignItems: 'center',
        gap: '6px',
        flexShrink: 0,
      }}>
        <span className="kpi-label-text" title={label}>{label}</span>
        {clickable && (
          <span aria-hidden="true" style={{ color: active ? 'var(--gold)' : 'var(--muted2)', fontSize: '0.7rem', flexShrink: 0, transition: 'color 0.15s' }}>
            {active ? '▾' : '▸'}
          </span>
        )}
      </div>
      <div ref={boxRef} style={{ maxWidth: '100%', overflow: 'hidden' }}>
        <div className="kpi-value" style={{
          fontSize: baseFont,
          fontWeight: 700,
          color: valueColor,
          fontVariantNumeric: 'tabular-nums',
          lineHeight: 1.1,
          fontFamily: 'var(--font-mono)',
          letterSpacing: '-0.01em',
          whiteSpace: 'nowrap',
          transform: fitScale < 1 ? `scale(${fitScale})` : undefined,
          transformOrigin: 'left center',
          width: 'max-content',
        }}>
          <AnimatedNumber value={value} />
        </div>
        {/* Hidden measurer — the full (final) value at the same font, for fit scaling */}
        <span ref={measureRef} aria-hidden="true" style={{
          position: 'absolute', visibility: 'hidden', pointerEvents: 'none', whiteSpace: 'nowrap',
          fontSize: baseFont, fontWeight: 700, fontFamily: 'var(--font-mono)',
          fontVariantNumeric: 'tabular-nums', letterSpacing: '-0.01em',
        }}>
          {value}
        </span>
      </div>
      {sublabel && (
        <div className="kpi-sublabel" title={sublabel} style={{ color: 'var(--muted2)', marginTop: 'auto', paddingTop: '5px', fontFamily: 'var(--font-mono)' }}>
          {sublabel}
        </div>
      )}
    </div>
  )
}
