import { useMemo, useState } from 'react'
import { FUNDING, FUNDING_PATHS, type FundingItem, type FundingVerdict, type FundingPathKey } from '../data/funding'

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

// Days to a HARD deadline (YYYY-MM-DD) — the only field we count from. `timing` is
// descriptive text and is NEVER parsed. Returns null when there is no hard deadline.
function deadlineDays(deadline: string | null, todayISO: string): number | null {
  if (!deadline) return null
  const d = Date.parse(deadline + 'T00:00:00Z')
  const t = Date.parse(todayISO + 'T00:00:00Z')
  if (!Number.isFinite(d) || !Number.isFinite(t)) return null
  return Math.ceil((d - t) / 86_400_000)
}

const VERDICT_COLOR: Record<FundingVerdict, string> = {
  GO: 'var(--emerald)', MAYBE: 'var(--amber)', SKIP: 'var(--muted)',
}
const VERDICT_LABEL: Record<FundingVerdict, string> = {
  GO: 'GO — rób wniosek', MAYBE: 'MAYBE — sprawdź', SKIP: 'SKIP — pomiń',
}

const warsawTodayISO = () => new Date().toLocaleDateString('en-CA', { timeZone: 'Europe/Warsaw' })

type SortKey = 'amount' | 'deadline'

export function FundingPanel() {
  const todayISO = warsawTodayISO()
  const [verdictFilter, setVerdictFilter] = useState<FundingVerdict | 'ALL'>('ALL')
  const [pathFilter, setPathFilter] = useState<FundingPathKey | 'ALL'>('ALL')
  const [sortBy, setSortBy] = useState<SortKey>('amount')

  const counts = useMemo(() => ({
    GO:    FUNDING.filter(o => o.verdict === 'GO').length,
    MAYBE: FUNDING.filter(o => o.verdict === 'MAYBE').length,
    SKIP:  FUNDING.filter(o => o.verdict === 'SKIP').length,
  }), [])

  const items = useMemo(() => {
    let list = FUNDING.filter(o =>
      (verdictFilter === 'ALL' || o.verdict === verdictFilter) &&
      (pathFilter === 'ALL' || o.paths.includes(pathFilter)),
    )
    list = [...list].sort((a, b) => {
      if (sortBy === 'amount') return (b.amtMax ?? b.amtMin ?? 0) - (a.amtMax ?? a.amtMin ?? 0)
      // deadline: hard deadlines first (soonest → latest), then items without one.
      const da = deadlineDays(a.deadline, todayISO)
      const db = deadlineDays(b.deadline, todayISO)
      if (da == null && db == null) return 0
      if (da == null) return 1
      if (db == null) return -1
      return da - db
    })
    return list
  }, [verdictFilter, pathFilter, sortBy, todayISO])

  return (
    <div>
      <div className="section-title section-title-gold" style={{ marginBottom: 6 }}>Funding Radar</div>
      <div style={{ fontFamily: 'var(--font-mono)', fontSize: '0.7rem', color: 'var(--muted2)', marginBottom: 14 }}>
        {FUNDING.length} pozycji · GO {counts.GO} · MAYBE {counts.MAYBE} · SKIP {counts.SKIP} · zrzut radaru (edukacja · ekologia · Cogni · baza)
      </div>

      {/* Filters + sort */}
      <div style={{ display: 'flex', flexWrap: 'wrap', gap: 14, marginBottom: 16 }}>
        <ChipGroup label="Werdykt">
          <Chip active={verdictFilter === 'ALL'} onClick={() => setVerdictFilter('ALL')}>Wszystkie</Chip>
          {(['GO', 'MAYBE', 'SKIP'] as FundingVerdict[]).map(v => (
            <Chip key={v} active={verdictFilter === v} onClick={() => setVerdictFilter(v)} color={VERDICT_COLOR[v]}>{v}</Chip>
          ))}
        </ChipGroup>
        <ChipGroup label="Ścieżka">
          <Chip active={pathFilter === 'ALL'} onClick={() => setPathFilter('ALL')}>Wszystkie</Chip>
          {(Object.keys(FUNDING_PATHS) as FundingPathKey[]).map(p => (
            <Chip key={p} active={pathFilter === p} onClick={() => setPathFilter(p)}>{FUNDING_PATHS[p]}</Chip>
          ))}
        </ChipGroup>
        <ChipGroup label="Sortuj">
          <Chip active={sortBy === 'amount'} onClick={() => setSortBy('amount')}>Kwota</Chip>
          <Chip active={sortBy === 'deadline'} onClick={() => setSortBy('deadline')}>Termin</Chip>
        </ChipGroup>
      </div>

      <div style={{ display: 'grid', gap: 12 }}>
        {items.map(o => <FundingCard key={o.id} o={o} todayISO={todayISO} />)}
        {items.length === 0 && (
          <div style={{ fontFamily: 'var(--font-mono)', fontSize: '0.8rem', color: 'var(--muted)' }}>Brak pozycji dla wybranych filtrów.</div>
        )}
      </div>
    </div>
  )
}

function FundingCard({ o, todayISO }: { o: FundingItem; todayISO: string }) {
  const days = deadlineDays(o.deadline, todayISO)
  const past = days != null && days < 0
  const total = o.crit.reduce((a, b) => a + b, 0)

  return (
    <div className="panel-illuminate" style={{
      border: `1px solid ${past ? 'var(--border)' : 'var(--border)'}`,
      borderLeft: `3px solid ${past ? 'var(--muted2)' : VERDICT_COLOR[o.verdict]}`,
      borderRadius: 6, padding: '13px 15px', background: 'var(--surface)',
      opacity: past ? 0.55 : 1,   // PO TERMINIE → wyszarzone, ale NIE usuwane
    }}>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', gap: 12, flexWrap: 'wrap' }}>
        <div style={{ minWidth: 0 }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 8, flexWrap: 'wrap' }}>
            <span style={{ fontFamily: 'var(--font-serif)', fontSize: '1.05rem', color: 'var(--text)', fontWeight: 600 }}>{o.ttl}</span>
            {o.verify && (
              <span title="Pozycja niezweryfikowana — sprawdź źródło przed aplikacją" style={{ fontFamily: 'var(--font-mono)', fontSize: '0.58rem', color: 'var(--amber)', border: '1px solid var(--amber)', borderRadius: 3, padding: '1px 5px', letterSpacing: '0.05em' }}>NIEZWERYFIKOWANE</span>
            )}
            {past && (
              <span style={{ fontFamily: 'var(--font-mono)', fontSize: '0.58rem', color: 'var(--muted)', border: '1px solid var(--muted2)', borderRadius: 3, padding: '1px 5px', letterSpacing: '0.05em' }}>PO TERMINIE</span>
            )}
          </div>
          <div style={{ fontFamily: 'var(--font-mono)', fontSize: '0.68rem', color: 'var(--muted)', marginTop: 3 }}>
            {o.funder} · {o.region} · {o.type}
          </div>
        </div>
        <div style={{ textAlign: 'right', flexShrink: 0 }}>
          <div style={{ fontFamily: 'var(--font-mono)', fontSize: '0.62rem', fontWeight: 700, color: VERDICT_COLOR[o.verdict], letterSpacing: '0.06em' }}>{VERDICT_LABEL[o.verdict]}</div>
          <div style={{ fontFamily: 'var(--font-mono)', fontSize: '0.62rem', color: 'var(--muted2)', marginTop: 2 }}>fit {total}/100</div>
        </div>
      </div>

      <div style={{ display: 'flex', flexWrap: 'wrap', gap: '4px 16px', marginTop: 8, fontFamily: 'var(--font-mono)', fontSize: '0.7rem' }}>
        <span style={{ color: 'var(--gold-bright)' }}>{fmtAmt(o)}</span>
        <span style={{ color: 'var(--text2)' }}>wkład: {o.own}</span>
        {/* Countdown ONLY from a hard deadline. `timing` is shown literally, never parsed. */}
        {o.deadline
          ? <span style={{ color: past ? 'var(--muted)' : days != null && days <= 30 ? 'var(--orange)' : 'var(--text2)' }}>
              termin: {new Date(o.deadline).toLocaleDateString('pl-PL', { day: 'numeric', month: 'long', year: 'numeric' })} {past ? '(minął)' : `(za ${days} dni)`}
            </span>
          : <span style={{ color: 'var(--muted)' }}>okno: {o.timing}</span>}
      </div>

      <div style={{ display: 'flex', flexWrap: 'wrap', gap: 5, marginTop: 8 }}>
        {o.paths.map(p => (
          <span key={p} style={{ fontFamily: 'var(--font-mono)', fontSize: '0.58rem', color: 'var(--teal)', border: '1px solid var(--border)', borderRadius: 3, padding: '1px 6px' }}>{FUNDING_PATHS[p]}</span>
        ))}
      </div>

      <div style={{ fontFamily: 'var(--font-sans)', fontSize: '0.8rem', color: 'var(--text2)', marginTop: 9, lineHeight: 1.55 }}>{o.why}</div>
      <div style={{ fontFamily: 'var(--font-sans)', fontSize: '0.76rem', color: 'var(--muted)', marginTop: 6, lineHeight: 1.5 }}>
        <span style={{ color: 'var(--gold)' }}>Wejście: </span>{o.entry}
      </div>
      {o.link && (
        <a href={o.link} target="_blank" rel="noopener noreferrer" style={{ display: 'inline-block', marginTop: 8, fontFamily: 'var(--font-mono)', fontSize: '0.68rem', color: 'var(--teal)' }}>{o.link} ↗</a>
      )}
    </div>
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
