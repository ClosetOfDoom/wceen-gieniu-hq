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

// ── Daily PP (Pakiet Pamięciowy) orders — target ≥18/day ──────────────────────
// ≥18 green "on target" · 14–17 amber "watch" · 10–13 red "attention" ·
// <10 red "check technicals" (likely a sync/landing problem, not just a slow day).
export const PP_ORDERS_TARGET = 18

export function ppOrdersGoal(count: number | null): GoalResult {
  if (count == null) return { pct: 0, status: 'red', note: 'no orders data' }
  const pct = clamp((count / PP_ORDERS_TARGET) * 100)
  if (count >= PP_ORDERS_TARGET) return { pct, status: 'green', note: `on target — ${count}/${PP_ORDERS_TARGET} ✓` }
  if (count >= 14)               return { pct, status: 'amber', note: `watch — ${count}/${PP_ORDERS_TARGET}` }
  if (count >= 10)               return { pct, status: 'red',   note: `attention — below ${PP_ORDERS_TARGET}` }
  return { pct, status: 'red', note: 'check technicals — abnormally low' }
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
