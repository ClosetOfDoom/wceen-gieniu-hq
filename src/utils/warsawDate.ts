// Warsaw-timezone date utilities. DST-safe — always derive offset at runtime.

export function warsawToday(): string {
  return new Date().toLocaleDateString('en-CA', { timeZone: 'Europe/Warsaw' })
}

// N full Warsaw calendar days ago (YYYY-MM-DD). Computed by date-string
// arithmetic (noon UTC anchor) so it's stable across DST — no offset drift.
export function warsawDaysAgo(n: number): string {
  const d = new Date(warsawToday() + 'T12:00:00Z')
  d.setUTCDate(d.getUTCDate() - n)
  return d.toISOString().slice(0, 10)
}

// The previous full Warsaw calendar day.
export function warsawYesterday(): string {
  return warsawDaysAgo(1)
}

// First day of the current Warsaw calendar month (YYYY-MM-01).
export function warsawMonthStart(): string {
  return warsawToday().slice(0, 7) + '-01'
}

// Fractional hours elapsed since Warsaw midnight (0–24). Used to pace daily targets
// for the in-progress day (e.g. expected PP orders by now = 18 × hours/24).
export function warsawHoursSinceMidnight(): number {
  const parts = new Intl.DateTimeFormat('en-GB', {
    timeZone: 'Europe/Warsaw', hour: '2-digit', minute: '2-digit', second: '2-digit', hour12: false,
  }).formatToParts(new Date())
  const get = (t: string) => Number(parts.find(p => p.type === t)?.value ?? 0)
  const h = get('hour') % 24   // some engines emit 24 at midnight
  return h + get('minute') / 60 + get('second') / 3600
}

// Convert any ISO timestamp to a Warsaw calendar date string (YYYY-MM-DD).
// DST-safe: uses the Intl API which applies the correct offset for each instant.
export function toWarsawDate(isoOrUnix: string | number | null | undefined): string {
  if (isoOrUnix == null) return ''
  try {
    return new Date(isoOrUnix).toLocaleDateString('en-CA', { timeZone: 'Europe/Warsaw' })
  } catch { return '' }
}

// Whether a raw order date/timestamp field is on today's Warsaw date.
export function isToday(rawDate: string | null | undefined): boolean {
  if (!rawDate) return false
  const dateStr = rawDate.length === 10 ? rawDate : toWarsawDate(rawDate)
  return dateStr === warsawToday()
}
