// Alarm rules, for app code.
//
// Not a second implementation — the import path. The rules live in
// netlify/shared/alertRules.js because gieniu-command.js needs them too, and
// plain ESM in netlify/shared is the only sharing shape this repo has proven
// against the Netlify bundler. Same arrangement as businessDay.
export {
  GOALS,
  ALERT_RULES,
  countsAsOrder,
  dailyLowAlert,
  rolling7Alert,
  cpaAlert,
  roasAlert,
  creativeCtrAlert,
  frequencyAlert,
  clickToCheckoutAlert,
  dataGapAlerts,
  todayContext,
  evaluateAlerts,
} from '../../netlify/shared/alertRules.js'
export type {
  Severity, AlertResult, DaySeriesEntry, AdDayRow, TodayContext,
} from '../../netlify/shared/alertRules.js'
