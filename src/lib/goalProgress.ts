// Goal/threshold logic for the Command Center progress bars.
// Pure functions — thresholds come straight from WCEEN business rules, so they
// stay testable and in one place. Colour (status) is decided by threshold, not
// by fill %, so inverted metrics (CPA: lower = better) colour correctly.

export type GoalStatus = 'green' | 'amber' | 'red'

export interface GoalResult {
  pct: number          // 0–100 bar fill
  status: GoalStatus
  note: string
}

const clamp = (n: number, lo = 0, hi = 100) => Math.max(lo, Math.min(hi, n))

// ── PP (Pakiet Pamięciowy) orders — target 18 per FULL day, paced ─────────────
// 18/day is a 24-hour target, so for the in-progress day it must be prorated by
// hours elapsed (like the monthly-revenue bar is prorated by days) — otherwise a
// perfectly normal mid-day count reads as "abnormally low". `expected` carries the
// paced target: for TODAY = 18 × hoursElapsed/24; for a full day/week/month it is
// 18 × (full days in range). Colour compares actual vs that paced expectation.
//   pace ≥ 1 green · ≥ 14/18 amber · ≥ 10/18 red attention · below red check-technicals
// (the same 18/14/10 bands as before, now relative to the paced target). `expected`
// defaults to 18 so a single completed day behaves exactly as it used to.
export const PP_ORDERS_TARGET = 18
const PP_AMBER_PACE = 14 / PP_ORDERS_TARGET
const PP_ATTN_PACE  = 10 / PP_ORDERS_TARGET

export function ppOrdersGoal(count: number | null, expected: number = PP_ORDERS_TARGET): GoalResult {
  if (count == null) return { pct: 0, status: 'red', note: 'no orders data' }
  const exp  = Math.max(expected, 0)
  const tgt  = Math.max(1, Math.round(exp))
  const pace = exp > 0 ? count / exp : (count > 0 ? 1 : 0)
  const pct  = clamp(exp > 0 ? (count / exp) * 100 : 0)
  if (pace >= 1)             return { pct, status: 'green', note: `on pace — ${count}/${tgt} ✓` }
  if (pace >= PP_AMBER_PACE) return { pct, status: 'amber', note: `watch — ${count}/${tgt}` }
  if (pace >= PP_ATTN_PACE)  return { pct, status: 'red',   note: `attention — below pace (${count}/${tgt})` }
  return { pct, status: 'red', note: `check technicals — abnormally low (${count}/${tgt})` }
}

// ── Monthly revenue — target 30 000 PLN, paced by days elapsed ────────────────
// % shown is % of the full 30k target; colour compares month-to-date against the
// prorated "expected by now" (30k × daysElapsed/daysInMonth).
export const MONTHLY_REVENUE_TARGET = 30000

export function monthlyRevenueGoal(mtd: number, daysElapsed: number, daysInMonth: number): GoalResult {
  const pct = clamp((mtd / MONTHLY_REVENUE_TARGET) * 100)
  const expected = daysInMonth > 0 ? MONTHLY_REVENUE_TARGET * (daysElapsed / daysInMonth) : 0
  const pace = expected > 0 ? mtd / expected : 1
  const pctOfTarget = Math.round((mtd / MONTHLY_REVENUE_TARGET) * 100)
  const dayStr = `day ${daysElapsed}/${daysInMonth}`
  if (pace >= 0.95) return { pct, status: 'green', note: `${pctOfTarget}% of target · ${dayStr} · on pace` }
  if (pace >= 0.80) return { pct, status: 'amber', note: `${pctOfTarget}% of target · ${dayStr} · slightly behind` }
  return { pct, status: 'red', note: `${pctOfTarget}% of target · ${dayStr} · behind pace` }
}

// Range-aware revenue goal — the selected range's revenue vs the 30 000 PLN monthly
// target, prorated to the range's day-equivalent (`paceDays`: TODAY = hours/24,
// YESTERDAY = 1, WEEK = 7, MONTH = days elapsed). Same pace colouring as the monthly
// bar, so the whole Goal Progress block can follow ONE range coherently.
export function revenueGoal(revenue: number, paceDays: number, daysInMonth: number): GoalResult {
  const expected = daysInMonth > 0 ? MONTHLY_REVENUE_TARGET * (paceDays / daysInMonth) : 0
  const pace = expected > 0 ? revenue / expected : (revenue > 0 ? 1 : 0)
  const pct  = clamp(expected > 0 ? (revenue / expected) * 100 : 0)
  const expStr = `${Math.round(expected).toLocaleString('en-US')} PLN oczek.`
  if (pace >= 0.95) return { pct, status: 'green', note: `${expStr} · on pace` }
  if (pace >= 0.80) return { pct, status: 'amber', note: `${expStr} · slightly behind` }
  return { pct, status: 'red', note: `${expStr} · behind pace` }
}

// ── Real CPA (inverted: lower = better) ───────────────────────────────────────
// Defaults to PP thresholds (<40 green / 40–50 amber / >50 red). Fill = how close
// we are to the green target (at/below target = full bar).
export function cpaGoal(cpa: number | null, greenBelow = 40, amberBelow = 50): GoalResult {
  if (cpa == null) return { pct: 0, status: 'red', note: 'no CPA data' }
  const fill = clamp((greenBelow / cpa) * 100)
  if (cpa < greenBelow) return { pct: fill, status: 'green', note: `in range — target <${greenBelow}` }
  if (cpa <= amberBelow) return { pct: fill, status: 'amber', note: `watch — ${greenBelow}–${amberBelow} band` }
  return { pct: fill, status: 'red', note: `above ${amberBelow} alarm` }
}

// ── Real ROAS — healthy ≥2, watch 1.5–2, weak <1.5 ────────────────────────────
export function roasGoal(roas: number | null): GoalResult {
  if (roas == null) return { pct: 0, status: 'red', note: 'no ROAS data' }
  const fill = clamp((roas / 3) * 100)  // 3x = a full bar
  if (roas >= 2)   return { pct: fill, status: 'green', note: 'healthy — ≥2.0x' }
  if (roas >= 1.5) return { pct: fill, status: 'amber', note: 'watch — 1.5–2.0x' }
  return { pct: fill, status: 'red', note: 'weak — below 1.5x' }
}

// ── Month helpers (Warsaw-safe via passed-in YYYY-MM-DD strings) ──────────────
export function daysInMonthOf(yyyymm: string): number {
  const [y, m] = yyyymm.split('-').map(Number)
  return new Date(y, m, 0).getDate()  // m is 1-based; day 0 of next month = last day
}

export function sumMonthToDate(rows: { date: string; wix_revenue: number }[], yyyymm: string): number {
  return rows.filter(r => typeof r.date === 'string' && r.date.startsWith(yyyymm))
    .reduce((s, r) => s + (r.wix_revenue ?? 0), 0)
}
