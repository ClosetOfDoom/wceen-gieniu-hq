// Warsaw-timezone date utilities. DST-safe — always derive offset at runtime.

export function warsawToday(): string {
  return new Date().toLocaleDateString('en-CA', { timeZone: 'Europe/Warsaw' })
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
