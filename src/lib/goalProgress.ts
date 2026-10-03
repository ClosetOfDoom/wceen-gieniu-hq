// Progress bars for the Command Center.
//
// GOALS live here; ALARMS live in netlify/shared/alertRules.js. The split is
// the point: a goal bar reports how far through a target we are and is never
// red, while an alarm reports that something is wrong and is the only thing
// allowed to be. The thresholds themselves (18 PP/day, 30 000 PLN/month, the
// CPA and ROAS bands) are unchanged — they moved, they did not move the needle.
//
// CPA and ROAS bars take their colour from the 7-full-day alarm verdict rather
// than grading whatever range happens to be on screen, because a single day's
// CPA is noise: 2026-10-03 alone read 76.21 PLN against a 7-day figure of 32.
import { GOALS, ALERT_RULES, type AlertResult, type Severity } from './alerts' 

export type GoalStatus = 'green' | 'amber' | 'red' | 'neutral'

export interface GoalResult {
  pct: number          // 0–100 bar fill
  status: GoalStatus
  note: string
}

const clamp = (n: number, lo = 0, hi = 100) => Math.max(lo, Math.min(hi, n))

// ── PP (Pakiet Pamięciowy) orders — PROGRESS, never an alarm ─────────────────
//
// 18 a day is a target, and this bar says how far through it we are. It no
// longer grades that progress, because the grading was the bug: the target was
// prorated by hours elapsed (18 × hours/24) and the result coloured, so at
// 09:00 with three orders in the bar read "check technicals — abnormally low".
// That is not a finding about the business, it is the arithmetic of a day that
// has not happened yet.
//
// Anomalies are now the alarm rules' job (netlify/shared/alertRules.js), which
// only ever look at WHOLE Warsaw days. This bar fills up and says nothing else.
// The target itself is unchanged — see GOALS.PP_ORDERS_PER_DAY.
export const PP_ORDERS_TARGET = GOALS.PP_ORDERS_PER_DAY

/**
 * @param count     PP orders counted in the range
 * @param expected  the range's target: 18 × full days. For the in-progress day
 *                  pass 18 — the bar shows progress through today's target, it
 *                  does not pretend the day is over.
 */
export function ppOrdersGoal(count: number | null, expected: number = PP_ORDERS_TARGET): GoalResult {
  if (count == null) {
    return { pct: 0, status: 'neutral', note: 'brak danych o zamówieniach' }
  }
  const tgt = Math.max(1, Math.round(Math.max(expected, 0)))
  const pct = clamp((count / tgt) * 100)
  return {
    pct,
    status: count >= tgt ? 'green' : 'neutral',
    note: count >= tgt ? `cel osiągnięty — ${count}/${tgt}` : `${count}/${tgt} (${Math.round(pct)}% celu)`,
  }
}

// ── Monthly revenue — target 30 000 PLN, paced by days elapsed ────────────────
// % shown is % of the full 30k target; colour compares month-to-date against the
// prorated "expected by now" (30k × daysElapsed/daysInMonth).
export const MONTHLY_REVENUE_TARGET = 30000

export function monthlyRevenueGoal(mtd: number, daysElapsed: number, daysInMonth: number): GoalResult {
  const pct = clamp((mtd / MONTHLY_REVENUE_TARGET) * 100)
  const pctOfTarget = Math.round((mtd / MONTHLY_REVENUE_TARGET) * 100)
  const expected = daysInMonth > 0 ? MONTHLY_REVENUE_TARGET * (daysElapsed / daysInMonth) : 0
  return {
    pct,
    status: mtd >= expected ? 'green' : 'neutral',
    note: `${pctOfTarget}% celu · dzień ${daysElapsed}/${daysInMonth} · prorata ${Math.round(expected).toLocaleString('en-US')} PLN`,
  }
}

// Range-aware revenue goal — the selected range's revenue vs the 30 000 PLN monthly
// target, prorated to the range's length in days (`paceDays`: TODAY = 1,
// YESTERDAY = 1, WEEK = 7, MONTH = days elapsed). The in-progress day counts as
// a whole day of target — the bar is simply not full yet, which is the truth.
export function revenueGoal(revenue: number, paceDays: number, daysInMonth: number): GoalResult {
  const expected = daysInMonth > 0 ? MONTHLY_REVENUE_TARGET * (paceDays / daysInMonth) : 0
  const pct  = clamp(expected > 0 ? (revenue / expected) * 100 : 0)
  const expStr = `${Math.round(expected).toLocaleString('en-US')} PLN oczek.`
  return {
    pct,
    status: revenue >= expected ? 'green' : 'neutral',
    note: `${expStr} · ${Math.round(pct)}% prorata`,
  }
}

// ── Real CPA (inverted: lower = better) ───────────────────────────────────────
// Defaults to PP thresholds (<40 green / 40–50 amber / >50 red). Fill = how close
// we are to the green target (at/below target = full bar).
export function cpaGoal(
  cpa: number | null,
  greenBelow = ALERT_RULES.CPA.green,
  /** The 7-full-day verdict. Colour comes from here, never from one range. */
  verdict?: AlertResult,
): GoalResult {
  if (cpa == null) return { pct: 0, status: 'neutral', note: 'brak danych o CPA' }
  const fill = clamp((greenBelow / cpa) * 100)
  if (!verdict) return { pct: fill, status: 'neutral', note: `cel <${greenBelow}` }
  return { pct: fill, status: severityToStatus(verdict.severity), note: verdict.message }
}

// ── Real ROAS — healthy ≥2, watch 1.5–2, weak <1.5 ────────────────────────────
export function roasGoal(roas: number | null, verdict?: AlertResult): GoalResult {
  if (roas == null) return { pct: 0, status: 'neutral', note: 'brak danych o ROAS' }
  const fill = clamp((roas / 3) * 100)  // 3x = a full bar
  if (!verdict) return { pct: fill, status: 'neutral', note: `cel ≥${ALERT_RULES.ROAS.healthy}x` }
  return { pct: fill, status: severityToStatus(verdict.severity), note: verdict.message }
}

/** An alarm severity, as a bar colour. 'none' is not green — it is "no finding". */
function severityToStatus(s: Severity): GoalStatus {
  return s === 'red' ? 'red' : s === 'amber' ? 'amber' : 'green'
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
