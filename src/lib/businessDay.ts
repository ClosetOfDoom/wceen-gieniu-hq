// The business day, for app code.
//
// This is NOT a second implementation — it is the import path. The one
// implementation lives in netlify/shared/businessDay.js, because the Netlify
// Functions need it too and plain ESM JS in netlify/shared is the only sharing
// shape this repo has proven against the Netlify bundler (a .d.ts inside
// netlify/functions once broke three deploys; TS imported from a function is
// the same class of gamble). App code imports from here so nothing in src/
// reaches across into netlify/.
export {
  BUSINESS_TIMEZONE,
  businessDay,
  businessToday,
  businessWallClock,
  businessOffsetMinutes,
  businessDayRangeUtc,
  businessDaysAgo,
  businessYesterday,
  businessMonthStart,
  businessWeekStart,
  businessDaysBetween,
  businessHoursSinceMidnight,
  isBusinessToday,
} from '../../netlify/shared/businessDay.js'
