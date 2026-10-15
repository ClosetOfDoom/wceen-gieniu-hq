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

  for (const date of days) {
    if (date === today && data.todayHourly) {
      orders += data.todayHourly.orders
      revenue += data.todayHourly.revenue
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
  }

  const partialDay = days.includes(today) && data.todayHourly
    ? { date: today, hour: Math.floor(businessHoursSinceMidnight()), orders: data.todayHourly.orders }
    : null

  return { from, to, days, orders, revenue, partialDay, missingDays, outOfRangeDays }
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
