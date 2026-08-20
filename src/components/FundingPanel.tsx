import { useEffect, useMemo, useState } from 'react'
import { FUNDING, FUNDING_PATHS, type FundingItem, type FundingVerdict, type FundingPathKey } from '../data/funding'
import {
  hermes, counters, statusesFor, effectiveCheckBy, zeroOwn, isLubelskie, openWindow,
  daysUntil, sortByUrgency, sortByAmount, sortByDeadline,
  STATUS_COLOR, type CheckMap, type FundingStatus,
} from '../lib/fundingStatus'
import { fetchFundingChecks, saveFundingCheck } from '../services/fundingChecks'

// Amount formatting — mirrors dashboard.html fmtAmt, in the Stanley palette.
function fmtAmt(o: FundingItem): string {
  if (o.amtNote && o.amtMin == null && o.amtMax == null) return o.amtNote
  const f = (n: number) => n >= 1_000_000
    ? (n / 1_000_000).toLocaleString('pl-PL', { maximumFractionDigits: 2 }) + ' mln'
    : (n / 1000).toLocaleString('pl-PL') + ' tys.'
  if (o.amtMin != null && o.amtMax != null) return `${f(o.amtMin)}–${f(o.amtMax)} zł`
  if (o.amtMax != null) return `do ${f(o.amtMax)} zł`
  return o.amtNote || '—'
}

const VERDICT_COLOR: Record<FundingVerdict, string> = {
  GO: 'var(--emerald)', MAYBE: 'var(--amber)', SKIP: 'var(--muted)',
}

const warsawTodayISO = () => new Date().toLocaleDateString('en-CA', { timeZone: 'Europe/Warsaw' })

type SortKey = 'urgency' | 'amount' | 'deadline'

/** Short window text for the collapsed row — a hard deadline wins over prose. */
function windowText(o: FundingItem, todayISO: string): { text: string; color: string } {
  const d = daysUntil(o.deadline, todayISO)
  if (o.deadline && d != null) {
    if (d < 0) return { text: `termin minął (${-d} dni temu)`, color: 'var(--muted)' }
    return { text: `termin za ${d} dni`, color: d <= 30 ? 'var(--orange)' : 'var(--text2)' }
  }
  if (openWindow(o, todayISO)) return { text: 'okno otwarte', color: 'var(--emerald)' }
  return { text: o.timing, color: 'var(--muted)' }
}

export function FundingPanel() {
  const todayISO = warsawTodayISO()
  const [verdictFilter, setVerdictFilter] = useState<FundingVerdict | 'ALL'>('ALL')
  const [pathFilter, setPathFilter] = useState<FundingPathKey | 'ALL'>('ALL')
  const [regionFilter, setRegionFilter] = useState<'ALL' | 'LUBELSKIE'>('ALL')
  const [zeroOwnOnly, setZeroOwnOnly] = useState(false)
  const [sortBy, setSortBy] = useState<SortKey>('urgency')   // action-first by default
  const [expanded, setExpanded] = useState<string | null>(null)
  const [filtersOpen, setFiltersOpen] = useState(false)

  const activeFilters =
    (verdictFilter !== 'ALL' ? 1 : 0) +
    (regionFilter !== 'ALL' ? 1 : 0) +
    (pathFilter !== 'ALL' ? 1 : 0) +
    (zeroOwnOnly ? 1 : 0)

  // checkBy overrides. Missing table => empty map + a visible notice, never a crash.
  const [checks, setChecks] = useState<CheckMap>({})
  const [checksError, setChecksError] = useState<string | null>(null)
  useEffect(() => {
    let alive = true
    fetchFundingChecks().then(r => {
      if (!alive) return
      setChecks(r.checks)
      setChecksError(r.error)
    })
    return () => { alive = false }
  }, [])

  async function updateCheckBy(id: string, value: string | null) {
    setChecks(prev => ({ ...prev, [id]: { ...prev[id], checkBy: value } }))   // optimistic
    const res = await saveFundingCheck(id, value)
    if (!res.ok) setChecksError(res.error)
  }

  const cnt = useMemo(() => counters(FUNDING, checks, todayISO), [checks, todayISO])
  const herald = useMemo(() => hermes(FUNDING, checks, todayISO), [checks, todayISO])

  const items = useMemo(() => {
    const list = FUNDING.filter(o =>
      (verdictFilter === 'ALL' || o.verdict === verdictFilter) &&
      (pathFilter === 'ALL' || o.paths.includes(pathFilter)) &&
      (regionFilter === 'ALL' || isLubelskie(o)) &&
      (!zeroOwnOnly || zeroOwn(o)),
    )
    if (sortBy === 'amount') return sortByAmount(list)
    if (sortBy === 'deadline') return sortByDeadline(list, todayISO)
    return sortByUrgency(list, todayISO)
  }, [verdictFilter, pathFilter, regionFilter, zeroOwnOnly, sortBy, todayISO])

  return (
    <div>
      <div className="section-title section-title-gold" style={{ marginBottom: 6 }}>Funding Radar</div>

      {/* Action bar — what needs a move, not what exists. */}
      <div style={{ display: 'flex', flexWrap: 'wrap', gap: '4px 14px', fontFamily: 'var(--font-mono)', fontSize: '0.7rem', marginBottom: 12 }}>
        <span style={{ color: 'var(--emerald)' }}>okno otwarte: {cnt.openWindow}</span>
        <span style={{ color: 'var(--gold-bright)' }}>do sprawdzenia: {cnt.checkNow}</span>
        <span style={{ color: 'var(--amber)' }}>niezweryfikowane: {cnt.unverified}</span>
        <span style={{ color: 'var(--muted)' }}>po terminie: {cnt.pastDue}</span>
        <span style={{ color: 'var(--teal)' }}>bez wkładu własnego: {cnt.zeroOwn}</span>
      </div>

      <HermesPanel herald={herald} />

      {checksError && (
        <div style={{ fontFamily: 'var(--font-mono)', fontSize: '0.66rem', color: 'var(--orange)', background: 'rgba(251,146,60,0.06)', border: '1px solid rgba(251,146,60,0.25)', borderRadius: 3, padding: '6px 10px', marginBottom: 12 }}>
          Daty sprawdzenia nie są zapisywane: {checksError}
        </div>
      )}

      {/* Sort stays in the open at every width; the four filter groups collapse
          behind one button on a phone, where they filled the screen before the
          first result appeared. */}
      <div style={{ display: 'flex', flexWrap: 'wrap', alignItems: 'center', gap: 14, marginBottom: 10 }}>
        <ChipGroup label="Sortuj">
          <Chip active={sortBy === 'urgency'} onClick={() => setSortBy('urgency')}>Pilność</Chip>
          <Chip active={sortBy === 'amount'} onClick={() => setSortBy('amount')}>Kwota</Chip>
          <Chip active={sortBy === 'deadline'} onClick={() => setSortBy('deadline')}>Termin</Chip>
        </ChipGroup>
        <button
          className="funding-filters-toggle"
          onClick={() => setFiltersOpen(v => !v)}
          aria-expanded={filtersOpen}
          style={{
            fontFamily: 'var(--font-mono)', fontSize: '0.66rem', padding: '4px 10px', borderRadius: 3, cursor: 'pointer',
            border: `1px solid ${activeFilters > 0 ? 'var(--border-gold)' : 'var(--border)'}`,
            background: activeFilters > 0 ? 'var(--surface2)' : 'transparent',
            color: activeFilters > 0 ? 'var(--gold)' : 'var(--muted)',
          }}
        >
          {filtersOpen ? '▴' : '▾'} Filtry{activeFilters > 0 ? ` (${activeFilters} aktywne)` : ''}
        </button>
      </div>

      {/* display lives in CSS, not inline — an inline value would beat the media
          query and the panel would stay open on a phone regardless. */}
      <div className={`funding-filters${filtersOpen ? ' is-open' : ''}`} style={{ flexWrap: 'wrap', gap: 14, marginBottom: 14 }}>
        <ChipGroup label="Werdykt">
          <Chip active={verdictFilter === 'ALL'} onClick={() => setVerdictFilter('ALL')}>Wszystkie</Chip>
          {(['GO', 'MAYBE', 'SKIP'] as FundingVerdict[]).map(v => (
            <Chip key={v} active={verdictFilter === v} onClick={() => setVerdictFilter(v)} color={VERDICT_COLOR[v]}>{v}</Chip>
          ))}
        </ChipGroup>
        <ChipGroup label="Region">
          <Chip active={regionFilter === 'ALL'} onClick={() => setRegionFilter('ALL')}>Wszystkie</Chip>
          <Chip active={regionFilter === 'LUBELSKIE'} onClick={() => setRegionFilter('LUBELSKIE')} color="var(--teal)">
            Lublin / lubelskie
          </Chip>
        </ChipGroup>
        <ChipGroup label="Ścieżka">
          <Chip active={pathFilter === 'ALL'} onClick={() => setPathFilter('ALL')}>Wszystkie</Chip>
          {(Object.keys(FUNDING_PATHS) as FundingPathKey[]).map(p => (
            <Chip key={p} active={pathFilter === p} onClick={() => setPathFilter(p)}>{FUNDING_PATHS[p]}</Chip>
          ))}
        </ChipGroup>
        <ChipGroup label="Wkład">
          <Chip active={zeroOwnOnly} onClick={() => setZeroOwnOnly(v => !v)} color="var(--teal)">Bez wkładu własnego</Chip>
        </ChipGroup>
      </div>

      <div style={{ display: 'grid', gap: 4 }}>
        {items.map(o => (
          <FundingRow
            key={o.id}
            o={o}
            todayISO={todayISO}
            checks={checks}
            open={expanded === o.id}
            onToggle={() => setExpanded(cur => (cur === o.id ? null : o.id))}
            onCheckBy={v => updateCheckBy(o.id, v)}
          />
        ))}
        {items.length === 0 && (
          <div style={{ fontFamily: 'var(--font-mono)', fontSize: '0.8rem', color: 'var(--muted)' }}>Brak pozycji dla wybranych filtrów.</div>
        )}
      </div>
    </div>
  )
}

// ── HERMES ────────────────────────────────────────────────────────────────────
// A herald, not a commentator: counts, names, order. Nothing that does not follow
// from funding.ts + funding_checks.
const HERMES_PREVIEW = 5

function HermesPanel({ herald }: { herald: ReturnType<typeof hermes> }) {
  // A herald announces; he does not read the whole ledger aloud. Naming all twelve
  // pushed the actual list a full screen down, so the top few show by default and
  // the rest are one click away.
  const [showAll, setShowAll] = useState(false)
  const shown = showAll ? herald.items : herald.items.slice(0, HERMES_PREVIEW)
  const rest = herald.items.length - shown.length

  return (
    <div className="panel-illuminate" style={{
      border: '1px solid var(--border)', borderLeft: '3px solid var(--gold)',
      borderRadius: 4, background: 'var(--surface)', padding: '11px 14px', marginBottom: 14,
    }}>
      <div style={{ fontFamily: 'var(--font-serif)', fontSize: '0.72rem', color: 'var(--gold)', letterSpacing: '0.14em', textTransform: 'uppercase', marginBottom: 7 }}>
        Hermes
      </div>
      {herald.count === 0 ? (
        <div style={{ fontFamily: 'var(--font-mono)', fontSize: '0.74rem', color: 'var(--emerald)' }}>
          {herald.message}
        </div>
      ) : (
        <>
          <div style={{ fontFamily: 'var(--font-mono)', fontSize: '0.74rem', color: 'var(--text)', marginBottom: 6 }}>
            {herald.count} {herald.count === 1 ? 'pozycja wymaga' : herald.count < 5 ? 'pozycje wymagają' : 'pozycji wymaga'} ruchu.
          </div>
          <ol style={{ margin: 0, paddingLeft: 18, display: 'grid', gap: 1 }}>
            {shown.map(i => (
              <li key={i.id} style={{ fontFamily: 'var(--font-mono)', fontSize: '0.68rem', color: 'var(--text2)' }}>
                {i.ttl}
                <span style={{ color: VERDICT_COLOR[i.verdict] }}> · {i.verdict}</span>
                {i.statuses.map(s => (
                  <span key={s} style={{ color: STATUS_COLOR[s] }}> · {s}</span>
                ))}
              </li>
            ))}
          </ol>
          {(rest > 0 || showAll) && (
            <button
              onClick={() => setShowAll(v => !v)}
              style={{
                marginTop: 5, background: 'transparent', border: 'none', cursor: 'pointer', padding: 0,
                fontFamily: 'var(--font-mono)', fontSize: '0.66rem', color: 'var(--gold)',
              }}
            >
              {showAll ? '▴ zwiń' : `▾ pozostałe ${rest}`}
            </button>
          )}
        </>
      )}
    </div>
  )
}

// ── one row ───────────────────────────────────────────────────────────────────
// Collapsed: a single line — name, verdict, amount, own contribution, window.
// Everything else (why / entry / link / paths / fit) is behind the click.
function FundingRow({
  o, todayISO, checks, open, onToggle, onCheckBy,
}: {
  o: FundingItem
  todayISO: string
  checks: CheckMap
  open: boolean
  onToggle: () => void
  onCheckBy: (v: string | null) => void
}) {
  const statuses = statusesFor(o, checks, todayISO)
  const past = statuses.includes('PO TERMINIE') || (daysUntil(o.deadline, todayISO) ?? 0) < 0
  const win = windowText(o, todayISO)
  const free = zeroOwn(o)
  const total = o.crit.reduce((a, b) => a + b, 0)
  const cb = effectiveCheckBy(o, checks)

  return (
    <div className="funding-row" style={{
      border: '1px solid var(--border)',
      borderLeft: `3px solid ${past ? 'var(--muted2)' : VERDICT_COLOR[o.verdict]}`,
      borderRadius: 4,
      background: free ? 'var(--surface2)' : 'var(--surface)',
      opacity: past ? 0.6 : 1,
      boxShadow: free ? 'inset 3px 0 0 -1px var(--teal)' : undefined,
    }}>
      {/* Collapsed line — exactly one line at desktop width (see .funding-line). */}
      <div
        className="funding-line"
        role="button"
        tabIndex={0}
        aria-expanded={open}
        onClick={onToggle}
        onKeyDown={e => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); onToggle() } }}
      >
        <span className="fl-chev" aria-hidden="true" style={{ color: 'var(--muted2)', fontSize: '0.7rem' }}>{open ? '▾' : '▸'}</span>

        <span className="fl-name" style={{ fontFamily: 'var(--font-serif)', fontSize: '0.88rem', color: 'var(--text)', fontWeight: 600 }} title={o.ttl}>
          {o.ttl}
        </span>

        <span className="fl-verdict" style={{ fontFamily: 'var(--font-mono)', fontSize: '0.62rem', fontWeight: 700, color: VERDICT_COLOR[o.verdict], letterSpacing: '0.06em' }}>
          {o.verdict}
        </span>

        {/* display:contents on desktop, so these are grid cells of the row; a
            flex-wrapping second line on a phone. */}
        <span className="fl-meta">
          <span style={{ fontFamily: 'var(--font-mono)', fontSize: '0.66rem', color: 'var(--gold-bright)' }} title={fmtAmt(o)}>
            {fmtAmt(o)}
          </span>

          <span
            title={`wkład własny: ${o.own}`}
            style={{
              fontFamily: 'var(--font-mono)', fontSize: '0.64rem',
              color: free ? 'var(--teal)' : 'var(--text2)', fontWeight: free ? 700 : 400,
            }}
          >
            {free ? '0% wkładu' : o.own}
          </span>

          <span style={{ fontFamily: 'var(--font-mono)', fontSize: '0.64rem', color: win.color }} title={o.timing}>
            {win.text}
          </span>

          {/* Compact markers — the full wording lives in Hermes and in the expanded
              body; spelled out here they were wider than the data they annotate. */}
          <span className="fl-marks" style={{ display: 'flex', gap: 3 }}>
            {statuses.map(s => <StatusMark key={s} s={s} />)}
          </span>

          {/* Phone-only: the date as text. The picker lives in the expanded body,
              where it has room — inline it was the widest thing in the row. */}
          <span className="fl-date-text" style={{ fontFamily: 'var(--font-mono)', fontSize: '0.62rem', color: cb ? 'var(--text2)' : 'var(--muted2)' }}>
            {cb ? `spr. ${cb}` : 'spr. —'}
          </span>
        </span>

        {/* Inline checkBy — clicking the field opens the native date picker. */}
        <input
          className="fl-date"
          type="date"
          value={cb ?? ''}
          onClick={e => e.stopPropagation()}
          onKeyDown={e => e.stopPropagation()}
          onChange={e => onCheckBy(e.target.value || null)}
          title="Kiedy sprawdzić stronę programu"
          aria-label={`Data sprawdzenia: ${o.ttl}`}
          style={{
            fontFamily: 'var(--font-mono)', fontSize: '0.6rem', padding: '1px 3px',
            background: 'transparent', color: cb ? 'var(--text2)' : 'var(--muted2)',
            border: `1px solid ${cb ? 'var(--border)' : 'var(--border-gold)'}`, borderRadius: 3,
            colorScheme: 'dark light',
          }}
        />
      </div>

      {/* Expanded detail */}
      {open && (
        <div style={{ padding: '0 12px 12px 25px', borderTop: '1px solid var(--border)', paddingTop: 10 }}>
          <div style={{ fontFamily: 'var(--font-mono)', fontSize: '0.66rem', color: 'var(--muted)', marginBottom: 7 }}>
            {o.funder} · {o.region} · {o.type} · fit {total}/100
          </div>

          {/* Statuses spelled out here — the row above only carries the markers. */}
          {statuses.length > 0 && (
            <div style={{ display: 'flex', flexWrap: 'wrap', gap: 5, marginBottom: 8 }}>
              {statuses.map(s => (
                <span key={s} style={{
                  fontFamily: 'var(--font-mono)', fontSize: '0.58rem', letterSpacing: '0.05em',
                  color: STATUS_COLOR[s], border: `1px solid ${STATUS_COLOR[s]}`, borderRadius: 3, padding: '1px 6px',
                }}>{s}</span>
              ))}
            </div>
          )}

          <div style={{ display: 'flex', flexWrap: 'wrap', gap: 5, marginBottom: 8 }}>
            {o.paths.map(p => (
              <span key={p} style={{ fontFamily: 'var(--font-mono)', fontSize: '0.58rem', color: 'var(--teal)', border: '1px solid var(--border)', borderRadius: 3, padding: '1px 6px' }}>{FUNDING_PATHS[p]}</span>
            ))}
          </div>

          {/* Full window text verbatim — never re-interpreted. */}
          <div style={{ fontFamily: 'var(--font-mono)', fontSize: '0.66rem', color: 'var(--muted)', marginBottom: 8 }}>
            okno: {o.timing}
            {o.deadline && ` · twardy termin: ${o.deadline}`}
            {` · wkład własny: ${o.own}`}
          </div>

          {/* Phone-only picker: on a narrow screen the collapsed row shows the date
              as text and the control lives here, where it has room. */}
          <label className="funding-date-mobile" style={{ alignItems: 'center', gap: 7, marginBottom: 9, fontFamily: 'var(--font-mono)', fontSize: '0.66rem', color: 'var(--muted)' }}>
            sprawdzić do:
            <input
              type="date"
              value={cb ?? ''}
              onClick={e => e.stopPropagation()}
              onChange={e => onCheckBy(e.target.value || null)}
              aria-label={`Data sprawdzenia: ${o.ttl}`}
              style={{
                fontFamily: 'var(--font-mono)', fontSize: '0.68rem', padding: '3px 6px',
                background: 'transparent', color: cb ? 'var(--text2)' : 'var(--muted2)',
                border: `1px solid ${cb ? 'var(--border)' : 'var(--border-gold)'}`, borderRadius: 3,
                colorScheme: 'dark light', maxWidth: '100%',
              }}
            />
          </label>

          <div style={{ fontFamily: 'var(--font-sans)', fontSize: '0.8rem', color: 'var(--text2)', lineHeight: 1.55 }}>{o.why}</div>
          <div style={{ fontFamily: 'var(--font-sans)', fontSize: '0.76rem', color: 'var(--muted)', marginTop: 6, lineHeight: 1.5 }}>
            <span style={{ color: 'var(--gold)' }}>Wejście: </span>{o.entry}
          </div>
          {o.link && (
            <a href={o.link} target="_blank" rel="noopener noreferrer" style={{ display: 'inline-block', marginTop: 8, fontFamily: 'var(--font-mono)', fontSize: '0.68rem', color: 'var(--teal)' }}>{o.link} ↗</a>
          )}
        </div>
      )}
    </div>
  )
}

// One-glyph status marker for the collapsed line. The word itself is ~90–115px
// wide, which crowded out the data it was annotating; the full label is one hover
// (or one click) away.
const MARK: Record<FundingStatus, string> = {
  'SPRAWDŹ TERAZ': '!',
  NIEZWERYFIKOWANE: '?',
  'PO TERMINIE': '×',
}

function StatusMark({ s }: { s: FundingStatus }) {
  return (
    <span
      title={s}
      aria-label={s}
      style={{
        fontFamily: 'var(--font-mono)', fontSize: '0.62rem', fontWeight: 700, lineHeight: 1,
        width: 15, height: 15, display: 'inline-flex', alignItems: 'center', justifyContent: 'center',
        color: STATUS_COLOR[s], border: `1px solid ${STATUS_COLOR[s]}`, borderRadius: 3, flexShrink: 0,
      }}
    >{MARK[s]}</span>
  )
}

function ChipGroup({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div style={{ display: 'flex', alignItems: 'center', gap: 6, flexWrap: 'wrap' }}>
      <span style={{ fontFamily: 'var(--font-mono)', fontSize: '0.6rem', color: 'var(--muted2)', textTransform: 'uppercase', letterSpacing: '0.08em' }}>{label}:</span>
      {children}
    </div>
  )
}

function Chip({ active, onClick, children, color }: { active: boolean; onClick: () => void; children: React.ReactNode; color?: string }) {
  return (
    <button
      onClick={onClick}
      style={{
        fontFamily: 'var(--font-mono)', fontSize: '0.66rem', padding: '3px 9px', borderRadius: 3, cursor: 'pointer',
        border: `1px solid ${active ? (color ?? 'var(--border-gold)') : 'var(--border)'}`,
        background: active ? 'var(--surface2)' : 'transparent',
        color: active ? (color ?? 'var(--gold)') : 'var(--muted)',
      }}
    >{children}</button>
  )
}
