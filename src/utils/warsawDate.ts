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
