// Date helpers for Stanley's answers. Every date is a Europe/Warsaw business
// day, 'YYYY-MM-DD' — see netlify/shared/businessDay.js for why that is the one
// definition and why no offset is ever hardcoded.
//
// These used to compute the day themselves. yesterdayWaw() in particular did
// `d.setDate(d.getDate() - 1)`, which steps a day in the MACHINE's timezone —
// the user's laptop, in a browser — and only then formatted in Warsaw. Near
// midnight, or on a machine set to another zone, that lands on the wrong day.

import {
  businessToday, businessYesterday, businessWeekStart, businessDaysAgo,
} from '../lib/businessDay'

export function todayWaw(): string {
  return businessToday()
}

export function yesterdayWaw(): string {
  return businessYesterday()
}

export function thisWeekStartWaw(): string {
  return businessWeekStart()
}

export function lastWeekStartWaw(): string {
  return businessDaysAgo(7, thisWeekStartWaw())
}

export function lastWeekEndWaw(): string {
  return businessDaysAgo(1, thisWeekStartWaw())
}
