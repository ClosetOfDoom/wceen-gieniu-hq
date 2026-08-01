// Shared panel-wide time range — used identically by Command Center and Campaigns
// so both always speak the same period. All bounds are Europe/Warsaw calendar days.

import { warsawToday, warsawYesterday, warsawDaysAgo, warsawMonthStart } from '../utils/warsawDate'

export type TimeRange = 'today' | 'yesterday' | 'week' | 'month'

export const RANGE_ORDER: TimeRange[] = ['today', 'yesterday', 'week', 'month']

// Short chip labels.
export const RANGE_LABELS: Record<TimeRange, string> = {
  today: 'DZIŚ', yesterday: 'WCZORAJ', week: 'TYDZIEŃ', month: 'MIESIĄC',
}

// Warsaw date bounds [from, to] inclusive for a range.
//   today     = current day (in progress — partial)
//   yesterday = previous full day
//   week      = last 7 FULL days, ending yesterday (today is partial, so excluded).
//               This matches how you compare against Meta Ads Manager (full days).
//   month     = current calendar month to date (1st … today) — matches the 30k goal
export function rangeDates(range: TimeRange): { from: string; to: string } {
  switch (range) {
    case 'yesterday': { const y = warsawYesterday(); return { from: y, to: y } }
    case 'week':      return { from: warsawDaysAgo(7), to: warsawYesterday() }
    case 'month':     return { from: warsawMonthStart(), to: warsawToday() }
    default:          return { from: warsawToday(), to: warsawToday() }
  }
}

// Human sublabel of the resolved period; today/month flagged as still in progress.
// MONTH is calendar-to-date, so on the 1st it legitimately spans a single day — we
// surface "miesiąc do dziś: dzień D/N" so that isn't mistaken for a bug.
export function rangeSubLabel(range: TimeRange): string {
  const { from, to } = rangeDates(range)
  if (range === 'today')     return `${to} · w toku`
  if (range === 'yesterday') return to
  if (range === 'week')      return `${from} → ${to} · 7 pełnych dni`
  if (range === 'month') {
    const day  = parseInt(warsawToday().slice(8, 10), 10)
    const days = daysInWarsawMonth()
    return `${from} → ${to} · miesiąc do dziś: dzień ${day}/${days}`
  }
  return `${from} → ${to}`
}

// Number of days in the current Warsaw calendar month (28/29/30/31).
function daysInWarsawMonth(): number {
  const [y, m] = warsawToday().split('-').map(Number)
  return new Date(Date.UTC(y, m, 0)).getUTCDate()   // day 0 of next month = last day of this
}
