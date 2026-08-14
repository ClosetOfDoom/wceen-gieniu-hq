// Funding radar — action status, urgency ordering and the Hermes herald message.
//
// Pure functions over data/funding.ts plus the checkBy overrides stored in
// Supabase. Everything here is derived; nothing is invented. `today` is always
// passed in (never read from the clock inside) so the whole module is testable
// and so the UI, the tests and the LLM context all grade against one date.

import type { FundingItem, FundingVerdict } from '../data/funding'

export type FundingStatus = 'SPRAWDŹ TERAZ' | 'NIEZWERYFIKOWANE' | 'PO TERMINIE'

export const STATUS_COLOR: Record<FundingStatus, string> = {
  'SPRAWDŹ TERAZ': 'var(--gold-bright)',
  NIEZWERYFIKOWANE: 'var(--amber)',
  'PO TERMINIE': 'var(--muted)',
}

/** checkBy overrides loaded from the funding_checks table, keyed by funding id. */
export type CheckMap = Record<string, { checkBy: string | null; note?: string | null }>

// ── date helpers ────────────────────────────────────────────────────────────
// Only hard ISO dates are ever parsed. The `timing` field is descriptive prose
// and is never converted to a date — see openWindow() for how it is read.

export function daysUntil(iso: string | null | undefined, todayISO: string): number | null {
  if (!iso) return null
  const d = Date.parse(iso + 'T00:00:00Z')
  const t = Date.parse(todayISO + 'T00:00:00Z')
  if (!Number.isFinite(d) || !Number.isFinite(t)) return null
  return Math.ceil((d - t) / 86_400_000)
}

const isPast = (iso: string | null | undefined, todayISO: string) => {
  const d = daysUntil(iso, todayISO)
  return d != null && d < 0
}

/** The checkBy actually in force: the Supabase override, else the item's own value. */
export function effectiveCheckBy(o: FundingItem, checks: CheckMap): string | null {
  const override = checks[o.id]
  if (override && override.checkBy !== undefined) return override.checkBy
  return o.checkBy ?? null
}

// ── open window ─────────────────────────────────────────────────────────────
// Classified from `timing` by KEYWORD only — "is intake currently running" — and
// never by parsing a date out of the prose. "otwarcie naboru ~listopad 2026" is a
// future opening, not an open window, so the pattern matches the adjective forms
// (otwarty / otwarta / otwarte) rather than the noun stem.
const OPEN_RE = /\botwart[yaeię]\b|nab[oó]r\s+ciągły|ciągły|całorocz/i

export function openWindow(o: FundingItem, todayISO: string): boolean {
  if (isPast(o.deadline, todayISO)) return false
  return OPEN_RE.test(o.timing)
}

// ── statuses ────────────────────────────────────────────────────────────────
// SKIP items never produce a status — they are not work, so they must not show
// up as work.
export function statusesFor(o: FundingItem, checks: CheckMap, todayISO: string): FundingStatus[] {
  if (o.verdict === 'SKIP') return []
  const out: FundingStatus[] = []

  const cb = effectiveCheckBy(o, checks)
  if (cb == null || isPast(cb, todayISO)) out.push('SPRAWDŹ TERAZ')
  if (o.verify) out.push('NIEZWERYFIKOWANE')
  if (isPast(o.deadline, todayISO)) out.push('PO TERMINIE')

  return out
}

/** True when the item requires no own financial contribution at all. */
export function zeroOwn(o: FundingItem): boolean {
  return /(^|[^\d])0\s*%/.test(o.own) || /brak wymaganego wkładu/i.test(o.own)
}

/** Voivodeship- or city-scoped to Lublin / Lubelskie. */
export function isLubelskie(o: FundingItem): boolean {
  return /lubel|lublin/i.test(o.region) || /lublin/i.test(o.funder)
}

// ── urgency ordering ────────────────────────────────────────────────────────
// Verdict first (GO before MAYBE before SKIP), then how soon the item can
// actually be acted on. Sorting by amount put a 2 mln zł horizon project above a
// grant closing this month, which is the opposite of a work queue.
const VERDICT_RANK: Record<FundingVerdict, number> = { GO: 0, MAYBE: 1, SKIP: 2 }

//  0 — a hard deadline still ahead (soonest first)
//  1 — intake open right now
//  2 — everything else: future window, horizon, long process
//  3 — deadline already gone
export function urgencyTier(o: FundingItem, todayISO: string): number {
  if (isPast(o.deadline, todayISO)) return 3
  if (o.deadline) return 0
  if (openWindow(o, todayISO)) return 1
  return 2
}

const amountOf = (o: FundingItem) => o.amtMax ?? o.amtMin ?? 0

/**
 * Default ordering: urgency of action. Within a tier of dated items the nearest
 * deadline wins; otherwise the larger amount breaks the tie so the order is
 * deterministic rather than dependent on array position.
 */
export function sortByUrgency(list: FundingItem[], todayISO: string): FundingItem[] {
  return [...list].sort((a, b) => {
    const v = VERDICT_RANK[a.verdict] - VERDICT_RANK[b.verdict]
    if (v !== 0) return v

    const ta = urgencyTier(a, todayISO)
    const tb = urgencyTier(b, todayISO)
    if (ta !== tb) return ta - tb

    if (ta === 0) {
      const da = daysUntil(a.deadline, todayISO) ?? Number.MAX_SAFE_INTEGER
      const db = daysUntil(b.deadline, todayISO) ?? Number.MAX_SAFE_INTEGER
      if (da !== db) return da - db
    }
    return amountOf(b) - amountOf(a)
  })
}

export function sortByAmount(list: FundingItem[]): FundingItem[] {
  return [...list].sort((a, b) => amountOf(b) - amountOf(a))
}

export function sortByDeadline(list: FundingItem[], todayISO: string): FundingItem[] {
  return [...list].sort((a, b) => {
    const da = daysUntil(a.deadline, todayISO)
    const db = daysUntil(b.deadline, todayISO)
    if (da == null && db == null) return 0
    if (da == null) return 1
    if (db == null) return -1
    return da - db
  })
}

// ── counters for the action bar ─────────────────────────────────────────────
export interface FundingCounters {
  openWindow: number
  checkNow: number
  unverified: number
  pastDue: number
  zeroOwn: number
}

export function counters(list: FundingItem[], checks: CheckMap, todayISO: string): FundingCounters {
  let c: FundingCounters = { openWindow: 0, checkNow: 0, unverified: 0, pastDue: 0, zeroOwn: 0 }
  for (const o of list) {
    const st = statusesFor(o, checks, todayISO)
    if (openWindow(o, todayISO) && o.verdict !== 'SKIP') c.openWindow++
    if (st.includes('SPRAWDŹ TERAZ')) c.checkNow++
    if (st.includes('NIEZWERYFIKOWANE')) c.unverified++
    if (st.includes('PO TERMINIE')) c.pastDue++
    if (zeroOwn(o)) c.zeroOwn++
  }
  return c
}

// ── HERMES ──────────────────────────────────────────────────────────────────
export interface HermesItem {
  id: string
  ttl: string
  verdict: FundingVerdict
  statuses: FundingStatus[]
}

export interface HermesReport {
  count: number
  items: HermesItem[]
  /** The full herald message, ready to render or hand to the LLM. */
  message: string
}

/**
 * Hermes reports only what follows from funding.ts plus funding_checks: how many
 * items need a move, named, most urgent first. When nothing needs a move he says
 * that in one sentence instead of manufacturing content.
 */
export function hermes(list: FundingItem[], checks: CheckMap, todayISO: string): HermesReport {
  const ordered = sortByUrgency(list, todayISO)
  const items: HermesItem[] = []

  for (const o of ordered) {
    const statuses = statusesFor(o, checks, todayISO)
    if (statuses.length) items.push({ id: o.id, ttl: o.ttl, verdict: o.verdict, statuses })
  }

  if (items.length === 0) {
    return { count: 0, items, message: 'Nic nie wymaga ruchu — wszystkie pozycje sprawdzone i w terminie.' }
  }

  const noun = items.length === 1 ? 'pozycja wymaga' : items.length < 5 ? 'pozycje wymagają' : 'pozycji wymaga'
  const head = `${items.length} ${noun} ruchu.`
  const lines = items.map((i, n) => `${n + 1}. ${i.ttl} — ${i.verdict} · ${i.statuses.join(' · ')}`)

  return { count: items.length, items, message: [head, ...lines].join('\n') }
}
