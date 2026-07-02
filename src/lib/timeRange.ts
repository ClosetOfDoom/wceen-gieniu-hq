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
//   today     = current day (in progress)
//   yesterday = previous full day
//   week      = last 7 days (today − 6 … today)
//   month     = current calendar month to date (1st … today) — matches the 30k goal
export function rangeDates(range: TimeRange): { from: string; to: string } {
  switch (range) {
    case 'yesterday': { const y = warsawYesterday(); return { from: y, to: y } }
    case 'week':      return { from: warsawDaysAgo(6), to: warsawToday() }
    case 'month':     return { from: warsawMonthStart(), to: warsawToday() }
    default:          return { from: warsawToday(), to: warsawToday() }
  }
}

// Human sublabel of the resolved period; today/month flagged as still in progress.
export function rangeSubLabel(range: TimeRange): string {
  const { from, to } = rangeDates(range)
  if (range === 'today')     return `${to} · w toku`
  if (range === 'yesterday') return to
  if (range === 'month')     return `${from} → ${to} · w toku`
  return `${from} → ${to}`
}
