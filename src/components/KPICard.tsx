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

/** Exposed for tests — the parsing is where the Impressions bug lived. */
export const parseNumericValueForTest = (v: string) => parseNumericValue(v)

function parseNumericValue(value: string):
  { numeric: number; prefix: string; suffix: string; decimals: number; locale: string } | null {
  if (value === '—' || value === '') return null
  // Match: optional leading sign, digits, separators, optional trailing suffix.
  // Handles "1 234,56 PLN", "5,826", "3.2x", "42%", "12".
  const m = value.match(/^([^0-9-]*)(-?[\d\s.,]*\d)(.*)$/)
  if (!m) return null
  const prefix = m[1] ?? ''
  const numeric = toNumber(m[2] ?? '')
  if (numeric == null) return null
  const suffix = m[3] ?? ''
  // Show the same number of decimals mid-animation as the final value has,
  // read off the string rather than guessed from the suffix. The old rule
  // ("PLN or a dot-two-digits pattern") gave 0 decimals to "2,88×", so a ROAS
  // counted up to a flat 3.
  const dec = decimalsOf(m[2] ?? '')
  return { numeric, prefix, suffix, decimals: dec.count, locale: dec.locale }
}

/** How many decimals the formatted string shows, and in which convention. */
function decimalsOf(raw: string): { count: number; locale: string } {
  const s = raw.replace(/\s/g, '')
  const lastComma = s.lastIndexOf(',')
  const lastDot = s.lastIndexOf('.')
  const sep = lastComma > lastDot ? lastComma : lastDot
  if (sep < 0) return { count: 0, locale: raw.includes(' ') ? 'pl-PL' : 'en-US' }
  const after = s.length - sep - 1
  // Three digits after a lone separator is a thousands group, not decimals.
  const grouping = after === 3 && s.indexOf(s[sep]) === sep && sep > 0
  const locale = lastComma > lastDot || raw.includes(' ') ? 'pl-PL' : 'en-US'
  return { count: grouping ? 0 : after, locale }
}

/**
 * A formatted number back into a number, without assuming which separator is
 * which.
 *
 * This used to be `.replace(',', '.')`, which reads every comma as a decimal
 * point. The Reklamy — kampanie cards format with en-US, so "5,826"
 * impressions parsed as 5.826 and the count-up animation rendered it with zero
 * decimals: the card read **6**. The animation restarts on every re-render, so
 * it never reached the final `setDisplayed(value)` and the wrong number simply
 * sat there. CPM on the same card was right, because CPM is computed from the
 * data and only the display went through here.
 *
 * The rule: whichever of `.` or `,` appears LAST is the decimal separator, and
 * a lone separator followed by exactly three digits is a thousands grouping.
 * That resolves "1,234" (1234), "1,23" (1.23), "1.234,56" (1234.56) and
 * "1,234.56" (1234.56) the same way a reader would.
 */
function toNumber(raw: string): number | null {
  const s = raw.replace(/\s/g, '')
  const lastComma = s.lastIndexOf(',')
  const lastDot = s.lastIndexOf('.')
  let cleaned: string
  if (lastComma >= 0 && lastDot >= 0) {
    // Both present: the later one is the decimal mark, the other groups.
    cleaned = lastComma > lastDot
      ? s.replace(/\./g, '').replace(',', '.')
      : s.replace(/,/g, '')
  } else if (lastComma >= 0) {
    // Only commas. Exactly three digits after a single comma = grouping.
    const after = s.length - lastComma - 1
    const onlyOne = s.indexOf(',') === lastComma
    cleaned = (after === 3 && onlyOne && lastComma > 0) || !onlyOne
      ? s.replace(/,/g, '')
      : s.replace(',', '.')
  } else {
    // Only dots. Same reasoning, mirrored.
    const after = s.length - lastDot - 1
    const onlyOne = s.indexOf('.') === lastDot
    cleaned = lastDot >= 0 && ((after === 3 && onlyOne && lastDot > 0) || !onlyOne)
      ? s.replace(/\./g, '')
      : s
  }
  const n = parseFloat(cleaned)
  return Number.isFinite(n) ? n : null
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

      // Same shape as the final value — decimals and locale both read off it.
      const formatted = current.toLocaleString(parsed!.locale, {
        minimumFractionDigits: parsed!.decimals,
        maximumFractionDigits: parsed!.decimals,
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
