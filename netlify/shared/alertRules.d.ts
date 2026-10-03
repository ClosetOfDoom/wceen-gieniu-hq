// Types for alertRules.js — the one place that decides what is red.

export type Severity = 'red' | 'amber' | 'none'

export interface AlertResult {
  severity: Severity
  /** Rule name, e.g. 'DOBOWY', 'KROCZĄCY_7', 'CPA', 'LUKA_W_DANYCH'. */
  rule: string
  message: string
  values?: Record<string, unknown> & { refusal?: boolean; uncoloured?: boolean }
}

/** One FULL Warsaw day. `missing` = `orders` had no rows at all — never a zero. */
export interface DaySeriesEntry {
  date: string
  orders: number
  missing: boolean
}

export interface AdDayRow {
  date: string
  ad_name?: string | null
  ad_id?: string | null
  spend?: number | null
  impressions?: number | null
  clicks?: number | null
  link_clicks?: number | null
  /** NULL until the ingest fills it. NOT additive across days. */
  reach?: number | null
  /** Meta's own pixel count — trend only, never attribution. NULL until filled. */
  initiate_checkout?: number | null
}

export interface TodayContext {
  ordersSoFar: number
  hour: number
  comparableDays: number
  percentile: number | null
  medianFinal: number | null
  note: string
}

export const GOALS: { PP_ORDERS_PER_DAY: number; MONTHLY_REVENUE: number }
export const ALERT_RULES: {
  ORDER_MIN_AMOUNT_PLN: number
  DAILY_LOW: { maxOrders: number; consecutiveDays: number }
  ROLLING_7: { windowDays: number; amberBelow: number; redBelow: number; redStreakDays: number }
  CPA: { windowDays: number; green: number; amber: number; doNotScale: number }
  ROAS: { windowDays: number; healthy: number; watch: number }
  CREATIVE_CTR: { windowDays: number; consecutiveDays: number; linkClickPct: number; allClickPct: number }
  FREQUENCY: { max: number }
  CLICK_TO_CHECKOUT: { minPct: number; consecutiveDays: number }
  TODAY_PERCENTILE_WINDOW_DAYS: number
}

export function countsAsOrder(amount: unknown): boolean
export function dailyLowAlert(series: DaySeriesEntry[]): AlertResult
export function rolling7Alert(series: DaySeriesEntry[]): AlertResult
export function cpaAlert(value: number | null, rolling7: number | null, fullDays: number): AlertResult
export function roasAlert(value: number | null, rolling7: number | null, fullDays: number): AlertResult
export function creativeCtrAlert(adDays: AdDayRow[]): AlertResult
export function frequencyAlert(adDays?: AdDayRow[]): AlertResult
export function clickToCheckoutAlert(adDays?: AdDayRow[]): AlertResult
export function dataGapAlerts(series: DaySeriesEntry[], recordStartsOn?: string | null): AlertResult[]
export function todayContext(
  ordersSoFar: number, hour: number,
  history: Array<{ date: string; hourly: number[] }>,
): TodayContext
export function evaluateAlerts(input: {
  series?: DaySeriesEntry[]
  cpa?: number | null
  cpaRolling7?: number | null
  roas?: number | null
  roasRolling7?: number | null
  fullDays?: number
  adDays?: AdDayRow[]
  /** First day `orders` has any row for. Days before it are prehistory. */
  recordStartsOn?: string | null
}): { all: AlertResult[]; active: AlertResult[]; refusals: AlertResult[]; worst: Severity }
