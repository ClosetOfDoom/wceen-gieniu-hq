// Counting orders in a date range — the ONE function the card, the COPY report
// and Stanley all go through.
//
// WHY THIS EXISTS
// ---------------------------------------------------------------------------
// Asked "how many orders between 9 and 15 October", Stanley answered 6. The
// real figure was 80. Not a timezone bug, not a filter, not pagination: the
// question's date range was never parsed at all. "how many orders" matched the
// today-orders intent by plain substring, the rest of the sentence was
// discarded, and the answer was today's count wearing the wrong label.
//
// So the range now has one parser and one counter. Both ends are INCLUSIVE and
// both are Warsaw calendar days — the same definition the dashboard uses
// (netlify/shared/businessDay.js). There is no second conversion anywhere.

import { businessDay, businessToday, businessDaysBetween, businessHoursSinceMidnight } from './businessDay'
import type { DailySeriesDay, OrdersData } from './ordersData'

/** One product's share of a window. Keyed by productCatalog's own product key. */
export interface ProductSlice {
  key: string
  displayName: string
  orders: number
  revenue: number
}

export interface OrderWindow {
  from: string
  to: string
  /** Every Warsaw day in [from, to], inclusive. */
  days: string[]
  /** Orders across the window, the in-progress day included. */
  orders: number
  revenue: number
  /** Set when `to` is today, i.e. the last day has not finished. */
  partialDay: { date: string; hour: number; orders: number } | null
  /** Days inside the window with no rows at all in `orders`. Never counted as 0 sales. */
  missingDays: string[]
  /** Days inside the window the series does not reach back to. */
  outOfRangeDays: string[]
  /**
   * Per product, built by iterating what the series carries — never a hardcoded
   * list. A product nothing matched lands under key 'unmapped' with its raw Wix
   * names, so it can neither vanish nor be folded into another bucket.
   */
  products: ProductSlice[]
  unmappedNames: Array<{ name: string; amount: number; failedField?: string | null }>
  /** Rows the test-order floor removed. Reported, never silently dropped. */
  belowFloor: { orders: number; revenue: number }
}

/**
 * Does the breakdown actually account for the total?
 *
 * Asked about 2026-10-17 Stanley printed 18 orders / 3 621 PLN and a breakdown
 * of 18 × Pakiet Pamięciowy / 2 142 PLN. The two did not agree — 2 142 against
 * 3 621 — and nothing noticed. This is the check that notices, and it runs on
 * the numbers about to be shown, whatever produced them.
 */
export function checkBreakdownConsistency(w: OrderWindow): { ok: boolean; reason: string | null } {
  const orders = w.products.reduce((s, p) => s + p.orders, 0)
  const revenue = w.products.reduce((s, p) => s + p.revenue, 0)
  if (orders !== w.orders) {
    return { ok: false, reason: `rozbicie niespójne z sumą: ${orders} szt. w rozbiciu vs ${w.orders} zamówień` }
  }
  if (Math.abs(revenue - w.revenue) > 0.01) {
    return { ok: false, reason: `rozbicie niespójne z sumą: ${revenue.toFixed(2)} PLN w rozbiciu vs ${w.revenue.toFixed(2)} PLN przychodu` }
  }
  return { ok: true, reason: null }
}

/**
 * Orders in [from, to] inclusive, from the per-day series orders-data already
 * provides. No query of its own: the series is the same one the alarm rules and
 * the cards read, so three surfaces cannot disagree.
 *
 * Counts EVERY order the series holds. The series itself is already restricted
 * to paid orders above the test-order floor (orders-data applies
 * ALERT_RULES.ORDER_MIN_AMOUNT_PLN); it does NOT drop unmapped products or
 * WSZTP. Anything further subtracted is reported separately by the caller, so
 * the raw figure is always the one quoted first.
 */
export function countOrdersInWindow(data: OrdersData | null, from: string, to: string): OrderWindow | null {
  if (!data?.ok || !data.dailySeries) return null

  const days = businessDaysBetween(from, to)
  const byDate = new Map<string, DailySeriesDay>(data.dailySeries.map(d => [d.date, d]))
  const today = data.todayHourly?.date ?? businessToday()

  let orders = 0
  let revenue = 0
  const missingDays: string[] = []
  const outOfRangeDays: string[] = []
  const byProduct = new Map<string, { orders: number; revenue: number }>()
  const unmappedNames: OrderWindow['unmappedNames'] = []
  const belowFloor = { orders: 0, revenue: 0 }

  const absorb = (src: Pick<DailySeriesDay, 'products' | 'unmappedNames' | 'belowFloor'>) => {
    for (const [key, slice] of Object.entries(src.products ?? {})) {
      const cur = byProduct.get(key) ?? { orders: 0, revenue: 0 }
      cur.orders += slice.orders
      cur.revenue += slice.revenue
      byProduct.set(key, cur)
    }
    unmappedNames.push(...(src.unmappedNames ?? []))
    belowFloor.orders += src.belowFloor?.orders ?? 0
    belowFloor.revenue += src.belowFloor?.revenue ?? 0
  }

  for (const date of days) {
    if (date === today && data.todayHourly) {
      orders += data.todayHourly.orders
      revenue += data.todayHourly.revenue
      absorb(data.todayHourly)
      continue
    }
    const d = byDate.get(date)
    if (!d) {
      // The series does not reach this far back — saying 0 would be a lie.
      outOfRangeDays.push(date)
      continue
    }
    if (d.missing) missingDays.push(date)
    orders += d.orders
    revenue += d.revenue
    absorb(d)
  }

  // Labels come from the catalog the endpoint shipped with the payload, so no
  // consumer keeps its own list of product names.
  const catalog = data.productCatalog ?? {}
  const products: ProductSlice[] = [...byProduct.entries()]
    .map(([key, v]) => ({
      key,
      displayName: key === 'unmapped' ? 'NIEZMAPOWANE' : (catalog[key]?.displayName ?? key),
      orders: v.orders,
      revenue: v.revenue,
    }))
    .sort((a, b) => b.revenue - a.revenue)

  const partialDay = days.includes(today) && data.todayHourly
    ? { date: today, hour: Math.floor(businessHoursSinceMidnight()), orders: data.todayHourly.orders }
    : null

  return { from, to, days, orders, revenue, partialDay, missingDays, outOfRangeDays,
           products, unmappedNames, belowFloor }
}

// ── parsing a range out of a question ───────────────────────────────────────

const MONTHS: Record<string, number> = {
  // English
  january: 1, february: 2, march: 3, april: 4, may: 5, june: 6, july: 7,
  august: 8, september: 9, october: 10, november: 11, december: 12,
  jan: 1, feb: 2, mar: 3, apr: 4, jun: 6, jul: 7, aug: 8, sep: 9, sept: 9, oct: 10, nov: 11, dec: 12,
  // Polish, nominative and genitive — "9 października", "w październiku"
  styczen: 1, stycznia: 1, luty: 2, lutego: 2, marzec: 3, marca: 3,
  kwiecien: 4, kwietnia: 4, maj: 5, maja: 5, czerwiec: 6, czerwca: 6,
  lipiec: 7, lipca: 7, sierpien: 8, sierpnia: 8, wrzesien: 9, wrzesnia: 9,
  pazdziernik: 10, pazdziernika: 10, listopad: 11, listopada: 11, grudzien: 12, grudnia: 12,
}

/** Strip Polish diacritics so one pattern set covers both spellings. */
function normalise(q: string): string {
  return q.toLowerCase()
    .normalize('NFD').replace(/[̀-ͯ]/g, '')
    .replace(/ł/g, 'l')
    .replace(/\s+/g, ' ')
    .trim()
}

const pad = (n: number) => String(n).padStart(2, '0')

/**
 * A date range from a natural-language question, or null when the question
 * does not name one.
 *
 * BOTH ENDS INCLUSIVE. "between 9 and 15 October" is 7 days, 9th through 15th
 * — not 5, and not 9th-to-14th. Anything that does not clearly name a range
 * returns null, so the caller falls through to its existing behaviour rather
 * than answering about a range nobody asked for.
 *
 * The year is only inferred when the question omits it: the most recent
 * occurrence of that month, never a future one. Asked in October 2026 about
 * "9-15 October", that is 2026; asked about "9-15 December", that is 2025.
 */
export function parseDateRange(question: string, today = businessToday()): { from: string; to: string } | null {
  const q = normalise(question)
  const [ty, tm] = today.split('-').map(Number)

  const resolveYear = (month: number, explicit?: number): number => {
    if (explicit) return explicit
    return month > tm ? ty - 1 : ty
  }

  // "between 9 and 15 October" · "od 9 do 15 pazdziernika" · "9-15 pazdziernika"
  // · "miedzy 9 a 15 pazdziernika" — one month named, at the end.
  const oneMonth = q.match(
    /(?:between|from|od|miedzy|pomiedzy)?\s*(\d{1,2})\s*(?:and|to|do|a|-|–|—)\s*(\d{1,2})\s+([a-z]+)(?:\s+(\d{4}))?/)
  if (oneMonth) {
    const [, d1, d2, monthWord, year] = oneMonth
    const m = MONTHS[monthWord]
    if (m) {
      const y = resolveYear(m, year ? Number(year) : undefined)
      const a = Number(d1), b = Number(d2)
      if (valid(y, m, a) && valid(y, m, b)) {
        const lo = Math.min(a, b), hi = Math.max(a, b)
        return { from: `${y}-${pad(m)}-${pad(lo)}`, to: `${y}-${pad(m)}-${pad(hi)}` }
      }
    }
  }

  // "between 9 October and 15 October" · "od 9 pazdziernika do 15 pazdziernika"
  const twoMonths = q.match(
    /(?:between|from|od|miedzy|pomiedzy)?\s*(\d{1,2})\s+([a-z]+)(?:\s+(\d{4}))?\s*(?:and|to|do|a|-|–|—)\s*(\d{1,2})\s+([a-z]+)(?:\s+(\d{4}))?/)
  if (twoMonths) {
    const [, d1, w1, y1, d2, w2, y2] = twoMonths
    const m1 = MONTHS[w1], m2 = MONTHS[w2]
    if (m1 && m2) {
      const yy1 = resolveYear(m1, y1 ? Number(y1) : undefined)
      const yy2 = resolveYear(m2, y2 ? Number(y2) : undefined)
      if (valid(yy1, m1, Number(d1)) && valid(yy2, m2, Number(d2))) {
        const a = `${yy1}-${pad(m1)}-${pad(Number(d1))}`
        const b = `${yy2}-${pad(m2)}-${pad(Number(d2))}`
        return a <= b ? { from: a, to: b } : { from: b, to: a }
      }
    }
  }

  // ISO: "2026-10-09 to 2026-10-15" · "od 2026-10-09 do 2026-10-15"
  const iso = q.match(/(\d{4}-\d{2}-\d{2})\s*(?:and|to|do|a|-|–|—)\s*(\d{4}-\d{2}-\d{2})/)
  if (iso) {
    const a = iso[1], b = iso[2]
    if (businessDay(a) === a && businessDay(b) === b) {
      return a <= b ? { from: a, to: b } : { from: b, to: a }
    }
  }

  return null
}

function valid(y: number, m: number, d: number): boolean {
  if (d < 1 || d > 31 || m < 1 || m > 12) return false
  const dt = new Date(Date.UTC(y, m - 1, d))
  return dt.getUTCMonth() === m - 1 && dt.getUTCDate() === d
}

// ── Sync health ─────────────────────────────────────────────────────────────
//
// The Wix→Supabase sync drops orders when several arrive at once. Measured on
// 2026-10-19 over 467 rows from 2026-09-15 to 10-18:
//
//   · every row is written at :12, :27, :42 or :57 past the hour — a cron on a
//     15-minute schedule, not a per-order webhook
//   · EVERY run writes exactly one row. 467 runs, 467 rows, maximum 1.
//   · a backlog drains one row per run: three orders created 09:17/09:21/09:23
//     on 2026-10-17 were written at 09:42/09:57/10:12
//   · the longest catch-up observed is 49 minutes, about three runs
//
// So the sync's ceiling is FOUR orders per hour. On 2026-10-17 five offline
// orders were placed between 20:19 and 20:21; two were written and three were
// never seen again. That is the ceiling, not a coincidence about 1 PLN rows.
//
// This cannot be fixed from the repo — it is the Make scenario's "maximum
// number of returned results". What the repo CAN do is notice when orders are
// arriving faster than the sync drains them, instead of the shortfall being
// invisible until someone compares a Wix export by hand.

/** How many rows the sync has ever written in a single run. Measured, not assumed. */
export const SYNC_ROWS_PER_RUN = 1
/** Minutes between sync runs, read off the inserted_at minute pattern. */
export const SYNC_RUN_INTERVAL_MIN = 15
/** Orders per hour the sync can absorb before it starts falling behind. */
export const SYNC_ORDERS_PER_HOUR = (60 / SYNC_RUN_INTERVAL_MIN) * SYNC_ROWS_PER_RUN

/**
 * Does the backlog signal appear anywhere a person looks? No — switched off
 * 2026-10-20.
 *
 * Checked against the full Wix payments export over 2026-06-11 → 2026-10-19:
 * 211 windows flagged, 2 of which had actually lost anything. Precision 0.9%.
 * An amber panel that is wrong 209 times out of 211 does not warn anybody; it
 * teaches them that amber means nothing, and then the alarm that matters gets
 * the same shrug.
 *
 * assessSyncHealth() below is kept, tested and correct — the measurement of
 * how far behind the sync runs is still true and still useful when
 * investigating by hand. What it cannot do is tell anyone that something was
 * LOST, because the rows that were lost are exactly the ones it cannot see.
 *
 * Flip this to true only with a reason that is not "it looks empty now".
 */
export const SYNC_BACKLOG_DETECTOR_ACTIVE = false

/**
 * The replacement, and why it is not on either.
 *
 * A hole in orders.wix_order_number is real evidence of a dropped row: scored
 * against the same export it found 6 of 6 real losses, with 21 flags in all.
 * It needs two things that have not happened yet — the column
 * (supabase/migrations/20261019_wix_order_number.sql, unapplied) and Make
 * writing the number on every order.
 *
 * Until then the column is empty, and a gap detector reading an empty column
 * reports "no gaps" with total confidence. That is worse than silence, so
 * there is nothing wired up and this says so by name rather than by absence.
 */
export const NUMBER_GAP_DETECTOR_ACTIVE = false

export interface SyncBacklogWindow {
  /** Start of the 15-minute window, as an ISO timestamp. */
  window: string
  /** Orders created in it that DID reach Supabase. */
  arrived: number
}

export interface SyncHealth {
  /** Windows where more orders arrived than one run can carry. */
  backlogWindows: SyncBacklogWindow[]
  /** The worst window seen. */
  worst: SyncBacklogWindow | null
  ordersPerHourCeiling: number
  /**
   * The shortfall is NOT computable from Supabase alone: a row that never
   * arrived leaves no trace, and `orders` has no sequential order number to
   * find a gap in. This says how much of the data was at risk, never how much
   * was lost — that needs the Wix export, or the order-number column from
   * supabase/migrations/20261019_wix_order_number.sql.
   */
  note: string
}

/**
 * Windows where orders arrived faster than the sync drains them.
 *
 * A window holding more than one order proves the sync was in backlog during
 * it. It does NOT prove anything was lost — the backlog may have drained over
 * the following runs, as it did on 2026-10-17 at 09:17.
 *
 * MEASURED AGAINST THE FULL WIX EXPORT, 2026-10-19
 * (scripts/reconcile-wix-export.mjs, 2026-06-11 → 2026-10-19):
 *
 *   211 windows flagged · 2 of them had a loss · 209 false alarms
 *   precision 0.9% · recall 50%
 *
 * So the earlier claim that "every known loss happened inside such a window"
 * is false: half of them happened in windows holding a single order. This
 * cannot be fixed by moving the threshold, because the input is wrong — the
 * function counts orders that ARRIVED, and an order that never arrived leaves
 * nothing behind to count. A window with one arrival and three losses is
 * indistinguishable, from Supabase, from a quiet window.
 *
 * The replacement is orders.wix_order_number
 * (supabase/migrations/20261019_wix_order_number.sql, still unapplied), which
 * scored 100% recall on the same data. Until Make writes that column this
 * function is the only signal there is, so it stays — but it is a hint about
 * load, not evidence of loss, and nothing should treat it as the latter.
 *
 * @param createdAt ISO creation timestamps of orders that reached Supabase
 */
export function assessSyncHealth(createdAt: string[]): SyncHealth {
  const buckets = new Map<string, number>()
  for (const ts of createdAt) {
    if (!ts) continue
    const d = new Date(ts)
    if (Number.isNaN(d.getTime())) continue
    d.setUTCMinutes(Math.floor(d.getUTCMinutes() / SYNC_RUN_INTERVAL_MIN) * SYNC_RUN_INTERVAL_MIN, 0, 0)
    const key = d.toISOString()
    buckets.set(key, (buckets.get(key) ?? 0) + 1)
  }

  const backlogWindows = [...buckets.entries()]
    .filter(([, n]) => n > SYNC_ROWS_PER_RUN)
    .map(([window, arrived]) => ({ window, arrived }))
    .sort((a, b) => b.arrived - a.arrived || a.window.localeCompare(b.window))

  return {
    backlogWindows,
    worst: backlogWindows[0] ?? null,
    ordersPerHourCeiling: SYNC_ORDERS_PER_HOUR,
    note: backlogWindows.length === 0
      ? `Brak okien z zaległością. Sufit synchronizacji to ${SYNC_ORDERS_PER_HOUR} zamówienia/h.`
      : `${backlogWindows.length} okien 15-min, w których zamówienia wpływały szybciej, niż sync `
        + `je zapisuje (sufit: ${SYNC_ROWS_PER_RUN} wiersz na przebieg co ${SYNC_RUN_INTERVAL_MIN} min `
        + `= ${SYNC_ORDERS_PER_HOUR} zam./h). Ile wierszy przepadło, NIE DA SIĘ policzyć z samej bazy: `
        + 'niezapisany wiersz nie zostawia śladu, a orders nie ma numeru zamówienia, w którym '
        + 'można by szukać luki. Porównaj te okna z eksportem Wix.',
  }
}
