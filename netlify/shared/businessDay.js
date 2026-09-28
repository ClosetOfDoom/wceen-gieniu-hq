// ═══════════════════════════════════════════════════════════════════════════════
// businessDay — the ONE definition of "which day did this happen on".
//
// The business day is the Europe/Warsaw calendar day. Nothing else. Wix, the
// dashboard, Stanley and the SQL view must all cut the day in the same place,
// or a night order shows up twice: once where it happened and once where it
// did not.
//
// THE BUG THIS EXISTS TO END
// ---------------------------------------------------------------------------
// `orders.order_created_at` is a timestamptz stored in UTC. Warsaw is UTC+2 in
// summer, so an order placed between 00:00 and 01:59 local time carries the
// PREVIOUS day's UTC date. On 2026-09-28 that put three of the day's four
// orders on the 27th: the view reported 15 and 1, Wix reported 12 and 4.
//
// NEVER a fixed offset. Not +2h, not 7200, not getTimezoneOffset() — that last
// one reads the machine the code happens to run on, which for a browser is the
// user's laptop. Poland returns to CET (UTC+1) on 2026-10-25; anything with a
// hardcoded offset is wrong from that Sunday onward. Every function here asks
// Intl for the offset that applied at that particular instant.
// ═══════════════════════════════════════════════════════════════════════════════

export const BUSINESS_TIMEZONE = 'Europe/Warsaw'

// sv-SE formats as YYYY-MM-DD, which is the shape every date string in this
// project uses, and it does so without the locale-specific punctuation other
// locales add.
const DAY_FMT = new Intl.DateTimeFormat('sv-SE', {
  timeZone: BUSINESS_TIMEZONE,
  year: 'numeric', month: '2-digit', day: '2-digit',
})

const WALL_CLOCK_FMT = new Intl.DateTimeFormat('sv-SE', {
  timeZone: BUSINESS_TIMEZONE,
  year: 'numeric', month: '2-digit', day: '2-digit',
  hour: '2-digit', minute: '2-digit', second: '2-digit',
  hour12: false,
})

/**
 * The Warsaw calendar day an instant falls on, as 'YYYY-MM-DD'.
 *
 * Accepts anything Date accepts: an ISO string with or without an offset, a
 * Date, or epoch millis. A bare 'YYYY-MM-DD' is returned unchanged — it is
 * already a calendar day, and re-interpreting it as midnight UTC would shift it
 * backwards for anyone west of Warsaw.
 */
export function businessDay(ts) {
  if (ts == null || ts === '') return ''
  if (typeof ts === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(ts)) return ts
  const d = ts instanceof Date ? ts : new Date(ts)
  if (Number.isNaN(d.getTime())) return ''
  return DAY_FMT.format(d)
}

/** Today's Warsaw calendar day. */
export function businessToday() {
  return DAY_FMT.format(new Date())
}

/** The Warsaw wall-clock time of an instant, as 'YYYY-MM-DD HH:MM:SS'. */
export function businessWallClock(ts) {
  if (ts == null || ts === '') return ''
  const d = ts instanceof Date ? ts : new Date(ts)
  if (Number.isNaN(d.getTime())) return ''
  return WALL_CLOCK_FMT.format(d).replace('T', ' ')
}

/** Warsaw's UTC offset, in minutes, AT a given instant. +120 in CEST, +60 in CET. */
export function businessOffsetMinutes(utcMs) {
  // Format the instant as Warsaw wall-clock, then read that wall-clock back as
  // if it were UTC. The difference is the offset that applied at that instant —
  // which is how you get DST right without a table of switch-over dates.
  const asWarsawWallClock = WALL_CLOCK_FMT.format(new Date(utcMs)).replace(' ', 'T') + 'Z'
  return (Date.parse(asWarsawWallClock) - utcMs) / 60000
}

/**
 * The UTC instants bounding a Warsaw calendar day: [startUtc, endUtc).
 * Use these for `order_created_at` filters — comparing a timestamptz against a
 * bare date string compares it against midnight UTC, which is the bug.
 *
 *   businessDayRangeUtc('2026-09-28')
 *     → { startUtc: '2026-09-27T22:00:00.000Z', endUtc: '2026-09-28T22:00:00.000Z' }
 */
export function businessDayRangeUtc(day) {
  const boundary = (naiveMs) => {
    // First guess using the offset at the naive instant, then re-read the offset
    // at that guess. They differ only across a DST switch, and the second read
    // is the one that actually applies to the boundary.
    const firstOffset = businessOffsetMinutes(naiveMs)
    const firstGuess = naiveMs - firstOffset * 60000
    const secondOffset = businessOffsetMinutes(firstGuess)
    return secondOffset === firstOffset ? firstGuess : naiveMs - secondOffset * 60000
  }
  const midnight = Date.parse(`${day}T00:00:00Z`)
  return {
    startUtc: new Date(boundary(midnight)).toISOString(),
    endUtc:   new Date(boundary(midnight + 86400000)).toISOString(),
  }
}

/**
 * A Warsaw calendar day shifted by whole days, as 'YYYY-MM-DD'.
 * Date-string arithmetic anchored at noon UTC: noon is never within 12 hours of
 * a DST switch, so adding 86 400 000 ms always lands on the next calendar day.
 */
export function businessDaysAgo(n, from = businessToday()) {
  const d = new Date(`${from}T12:00:00Z`)
  d.setUTCDate(d.getUTCDate() - n)
  return d.toISOString().slice(0, 10)
}

/** The previous Warsaw calendar day. */
export function businessYesterday(from = businessToday()) {
  return businessDaysAgo(1, from)
}

/** First day of a Warsaw calendar month. */
export function businessMonthStart(from = businessToday()) {
  return from.slice(0, 7) + '-01'
}

/** Monday of the ISO week containing a Warsaw calendar day. */
export function businessWeekStart(from = businessToday()) {
  const d = new Date(`${from}T12:00:00Z`)
  d.setUTCDate(d.getUTCDate() - ((d.getUTCDay() + 6) % 7))
  return d.toISOString().slice(0, 10)
}

/** Every Warsaw calendar day in [from, to], inclusive. */
export function businessDaysBetween(from, to) {
  const out = []
  for (let t = Date.parse(`${from}T12:00:00Z`); t <= Date.parse(`${to}T12:00:00Z`); t += 86400000) {
    out.push(new Date(t).toISOString().slice(0, 10))
  }
  return out
}

/** Fractional hours since Warsaw midnight (0–24) — paces the in-progress day. */
export function businessHoursSinceMidnight(now = new Date()) {
  const parts = new Intl.DateTimeFormat('en-GB', {
    timeZone: BUSINESS_TIMEZONE, hour: '2-digit', minute: '2-digit', second: '2-digit', hour12: false,
  }).formatToParts(now)
  const get = (t) => Number(parts.find(p => p.type === t)?.value ?? 0)
  return (get('hour') % 24) + get('minute') / 60 + get('second') / 3600
}

/** Whether a raw date or timestamp falls on today's Warsaw day. */
export function isBusinessToday(raw) {
  if (!raw) return false
  return businessDay(raw) === businessToday()
}
