// All dates in Europe/Warsaw business timezone, returned as YYYY-MM-DD strings.

export function todayWaw(): string {
  return new Date().toLocaleDateString('en-CA', { timeZone: 'Europe/Warsaw' })
}

export function yesterdayWaw(): string {
  const d = new Date()
  d.setDate(d.getDate() - 1)
  return d.toLocaleDateString('en-CA', { timeZone: 'Europe/Warsaw' })
}

export function thisWeekStartWaw(): string {
  const todayStr = new Date().toLocaleDateString('en-CA', { timeZone: 'Europe/Warsaw' })
  const d = new Date(todayStr)              // parsed as UTC midnight — safe for day arithmetic
  const dow = d.getUTCDay()                 // 0=Sun, 1=Mon … 6=Sat
  const daysBack = dow === 0 ? 6 : dow - 1 // days since Monday
  d.setUTCDate(d.getUTCDate() - daysBack)
  return d.toLocaleDateString('en-CA', { timeZone: 'UTC' })
}

export function lastWeekStartWaw(): string {
  const thisMon = new Date(thisWeekStartWaw())
  thisMon.setUTCDate(thisMon.getUTCDate() - 7)
  return thisMon.toLocaleDateString('en-CA', { timeZone: 'UTC' })
}

export function lastWeekEndWaw(): string {
  const thisMon = new Date(thisWeekStartWaw())
  thisMon.setUTCDate(thisMon.getUTCDate() - 1)
  return thisMon.toLocaleDateString('en-CA', { timeZone: 'UTC' })
}
