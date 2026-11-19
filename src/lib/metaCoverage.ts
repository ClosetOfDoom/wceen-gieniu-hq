// metaCoverage.ts — what meta_ads_daily ACTUALLY holds for a range, read from its rows.
//
// Texts about the state of the database (is meta_purchases fed? is raw_payload filled?) are computed here from the
// ungrouped daily rows of the selected range (campaign-data → dailyRows), never assumed or hard-coded. Used by the
// CAMPAIGNS panel and by the COPY report, so both say the same thing about the same rows.

export interface MetaCoverageRow {
  date: string
  spend?: number | string | null
  meta_purchases?: number | string | null
  purchases?: number | string | null
  raw_payload?: unknown
}

export interface MetaCoverage {
  /** First and last date that has any row in the range. */
  from: string | null
  to: string | null
  /** First date in the range on which meta_purchases > 0 (summed over the day's rows). */
  firstPurchaseDate: string | null
  /** Days with spend > 0 … and how many of them have 0 Meta purchases. */
  spendDays: number
  zeroPurchaseSpendDays: number
  /** First date in the range on which some row carries a non-empty raw_payload. */
  firstRawPayloadDate: string | null
  /** Days with spend > 0 that carry a non-empty raw_payload. */
  rawPayloadDays: number
}

const num = (v: unknown): number => {
  const n = Number(v)
  return Number.isFinite(n) ? n : 0
}

/** Non-empty: not null/undefined, not '', not {}, not []. A JSON string is parsed shallowly by its length. */
export function hasPayload(v: unknown): boolean {
  if (v == null) return false
  if (typeof v === 'string') { const t = v.trim(); return t !== '' && t !== '{}' && t !== '[]' && t !== 'null' }
  if (Array.isArray(v)) return v.length > 0
  if (typeof v === 'object') return Object.keys(v as object).length > 0
  return true
}

export function metaCoverage(rows: readonly MetaCoverageRow[]): MetaCoverage {
  const days = new Map<string, { spend: number; purchases: number; payload: boolean }>()
  for (const r of rows) {
    if (!r?.date) continue
    const d = days.get(r.date) ?? { spend: 0, purchases: 0, payload: false }
    d.spend += num(r.spend)
    d.purchases += num(r.meta_purchases ?? r.purchases)
    d.payload = d.payload || hasPayload(r.raw_payload)
    days.set(r.date, d)
  }
  const dates = [...days.keys()].sort()
  const spendDates = dates.filter((d) => days.get(d)!.spend > 0)
  return {
    from: dates[0] ?? null,
    to: dates[dates.length - 1] ?? null,
    firstPurchaseDate: dates.find((d) => days.get(d)!.purchases > 0) ?? null,
    spendDays: spendDates.length,
    zeroPurchaseSpendDays: spendDates.filter((d) => days.get(d)!.purchases === 0).length,
    firstRawPayloadDate: dates.find((d) => days.get(d)!.payload) ?? null,
    rawPayloadDays: spendDates.filter((d) => days.get(d)!.payload).length,
  }
}

/** The three facts as Polish sentences (no markup). Empty range → one sentence saying so. */
export function metaCoverageSentences(c: MetaCoverage): string[] {
  if (!c.from) return ['Brak wierszy meta_ads_daily w wybranym zakresie — nie ma z czego liczyć pokrycia.']
  const range = c.from === c.to ? c.from : `${c.from} → ${c.to}`
  return [
    c.firstPurchaseDate
      ? `meta_purchases > 0 od ${c.firstPurchaseDate} (pierwsza taka doba w zakresie ${range}).`
      : `meta_purchases = 0 we wszystkich dobach zakresu ${range}.`,
    `Doby z wydatkiem bez zakupów Meta: ${c.zeroPurchaseSpendDays} z ${c.spendDays}.`,
    c.firstRawPayloadDate
      ? `raw_payload wypełniony od ${c.firstRawPayloadDate} (${c.rawPayloadDays} z ${c.spendDays} dób z wydatkiem).`
      : `raw_payload pusty we wszystkich dobach zakresu ${range}.`,
  ]
}

/** Shown under the Meta numbers everywhere: the pixel counts something else than Wix. */
export const META_VS_WIX =
  'Zakupy Meta (piksel) nie są porównywalne z Wix: inne okno atrybucji, view-through, brak UTM. '
  + 'Realne zamówienia i sprzedaż licz z Wix (Command Center, Real ROAS/CPA).'
