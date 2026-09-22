// Live harness for the clipboard export.
//
// It loads the SAME endpoints Command Center loads, runs the SAME functions
// App.tsx runs to derive each KPI (resolveRangePerf, the goal helpers, the
// format helpers), and then prints two things:
//
//   1. the exported Markdown report, verbatim
//   2. a card-vs-report column pair, so the two can be compared by eye as well
//      as by the equality check at the bottom
//
// It exists because "the numbers match" is a claim that has to be shown, not
// asserted. Nothing here re-implements a calculation: if a figure is wrong on
// the dashboard it is wrong here too, which is the point.
//
// Run it through scripts/print-report.mjs, which bundles this with esbuild.

import { buildReport } from '../src/lib/exportReport'
import { resolveRangePerf, aggregatePerf } from '../src/lib/rangePerf'
import { rangeDates, rangeSubLabel, RANGE_LABELS, type TimeRange } from '../src/lib/timeRange'
import {
  ppOrdersGoal, revenueGoal, cpaGoal, roasGoal,
  PP_ORDERS_TARGET, MONTHLY_REVENUE_TARGET, daysInMonthOf,
} from '../src/lib/goalProgress'
import { fmtPln, fmtNum, fmtRoas } from '../src/utils/format'
import type { DailyPerformance, MetaAdDaily } from '../src/services/data'
import type { ProfitData } from '../src/lib/profitData'

const SITE = process.env.STANLEY_SITE_URL ?? 'https://elegant-kelpie-6fdfc8.netlify.app'
const SUPA_URL = process.env.VITE_SUPABASE_URL!
const SUPA_KEY = process.env.VITE_SUPABASE_ANON_KEY!

const warsawToday = () => new Date().toLocaleDateString('en-CA', { timeZone: 'Europe/Warsaw' })

/** Hours elapsed today in Warsaw — App.tsx paces the TODAY targets by this. */
function warsawHoursSinceMidnight(): number {
  const parts = new Intl.DateTimeFormat('en-GB', {
    timeZone: 'Europe/Warsaw', hour: '2-digit', minute: '2-digit', hour12: false,
  }).formatToParts(new Date())
  const h = Number(parts.find(p => p.type === 'hour')?.value ?? 0)
  const m = Number(parts.find(p => p.type === 'minute')?.value ?? 0)
  return h + m / 60
}

async function json<T>(url: string, init?: RequestInit): Promise<T> {
  const res = await fetch(url, init)
  if (!res.ok) throw new Error(`HTTP ${res.status} on ${url}`)
  return res.json() as Promise<T>
}

const viewRows = (from: string, to: string) =>
  json<DailyPerformance[]>(
    `${SUPA_URL}/rest/v1/v_daily_wix_meta_performance`
    + `?select=*&date=gte.${from}&date=lte.${to}&order=date.asc&limit=400`,
    { headers: { apikey: SUPA_KEY, Authorization: `Bearer ${SUPA_KEY}` } },
  )

export async function runForRange(range: TimeRange): Promise<{ report: string; comparison: string }> {
  const { from, to } = rangeDates(range)
  const today = warsawToday()

  // Previous period of the same length — App.tsx computes these bounds the same way.
  const span = Math.max(1, Math.round((Date.parse(to + 'T12:00:00Z') - Date.parse(from + 'T12:00:00Z')) / 86400000) + 1)
  const prevTo = new Date(Date.parse(from + 'T12:00:00Z') - 86400000).toISOString().slice(0, 10)
  const prevFrom = new Date(Date.parse(prevTo + 'T12:00:00Z') - (span - 1) * 86400000).toISOString().slice(0, 10)

  // monthTrend is what App.tsx feeds resolveRangePerf for week/month.
  const monthFrom = today.slice(0, 8) + '01'

  const [dailyRows, prevRows, monthRows, profit, campaign] = await Promise.all([
    viewRows(from, to),
    viewRows(prevFrom, prevTo),
    viewRows(monthFrom < from ? monthFrom : from, today),
    json<ProfitData>(`${SITE}/.netlify/functions/profit-data?from=${from}&to=${to}`).catch(() => null),
    json<{ rows: MetaAdDaily[]; fetchError: string | null }>(
      `${SITE}/.netlify/functions/campaign-data?from=${from}&to=${to}`,
    ).catch(e => ({ rows: [] as MetaAdDaily[], fetchError: String(e?.message ?? e) })),
  ])

  const todayRow = monthRows.find(r => r.date === today) ?? null
  // App.tsx sorts its trend rows newest-first; resolveRangePerf relies on [0]
  // being the latest for the TODAY fallback.
  const rangeRows = [...monthRows].sort((a, b) => b.date.localeCompare(a.date))
  const displayPerf = resolveRangePerf(range, todayRow, rangeRows)

  // The blended CPA/ROAS the cards show come from profit-data, not the view.
  const cpaBlended = profit?.ok ? (profit.realCpa ?? null) : (displayPerf?.real_cpa ?? null)
  const roasBlended = profit?.ok ? (profit.realRoas ?? null) : (displayPerf?.real_roas ?? null)

  // Goal pacing, exactly as App.tsx paces it.
  const goalDaysIn = daysInMonthOf(today.slice(0, 7))
  const goalDayNum = parseInt(today.slice(8, 10), 10)
  const rangePaceDays = range === 'today' ? warsawHoursSinceMidnight() / 24
    : range === 'yesterday' ? 1
    : range === 'week' ? 7
    : goalDayNum
  const ppOrdersRange = profit?.ok
    ? (profit.productBreakdown?.find(p => p.productKey === 'memory_pack')?.orders ?? 0)
    : null
  const ppExpected = PP_ORDERS_TARGET * rangePaceDays
  const rangeRevenue = displayPerf?.wix_revenue ?? 0

  const ppGoal = ppOrdersGoal(ppOrdersRange, ppExpected)
  const revGoal = revenueGoal(rangeRevenue, rangePaceDays, goalDaysIn)
  const cpaGoalRes = cpaGoal(cpaBlended)
  const roasGoalRes = roasGoal(roasBlended)

  const report = buildReport({
    range, from, to,
    rangeSub: rangeSubLabel(range),
    buildHash: process.env.BUILD_HASH ?? 'harness',
    generatedAt: new Date().toISOString(),
    perf: displayPerf,
    prevPerf: aggregatePerf(prevRows),
    dailyRows,
    profit,
    cpa: cpaBlended,
    roas: roasBlended,
    campaignRows: campaign.rows ?? [],
    campaignError: campaign.fetchError ?? null,
    goals: {
      pp: ppGoal, revenue: revGoal, cpa: cpaGoalRes, roas: roasGoalRes,
      ppOrders: ppOrdersRange,
      ppTarget: Math.max(1, Math.round(ppExpected)),
      revenueTarget: MONTHLY_REVENUE_TARGET * (rangePaceDays / goalDaysIn),
    },
  })

  // ── card column vs report column ──────────────────────────────────────────
  // The left column is rendered with the same fmt* helpers the KPI cards use,
  // from the same variables. The right column is pulled back out of the report
  // text, so a mismatch means the report really does print something else.
  const cards: Array<[string, string]> = [
    ['Wix Orders',   fmtNum(displayPerf?.wix_orders)],
    ['Wix Revenue',  fmtPln(displayPerf?.wix_revenue)],
    ['Ad Spend',     fmtPln(displayPerf?.meta_spend)],
    ['Est. Profit',  profit?.ok ? fmtPln(profit.estimatedProfitAfterAds) : '—'],
    ['Real CPA',     fmtPln(cpaBlended)],
    ['Real ROAS',    fmtRoas(roasBlended)],
    ['PP orders',    `${ppOrdersRange ?? '—'} / ${Math.max(1, Math.round(ppExpected))}`],
  ]
  const reportCell = (metric: string): string => {
    const row = report.split('\n').find(l => l.startsWith(`| ${metric} |`))
    return row ? row.split('|')[2].trim() : '(brak wiersza)'
  }
  const REPORT_KEY: Record<string, string> = {
    'Wix Orders': 'zamówienia', 'Wix Revenue': 'przychód', 'Ad Spend': 'ad spend',
    'Est. Profit': 'est. profit', 'Real CPA': 'real CPA', 'Real ROAS': 'real ROAS',
  }

  const lines = [
    `KARTA                | NA EKRANIE (karta)      | W RAPORCIE              | zgodne`,
    '-'.repeat(86),
  ]
  let allMatch = true
  for (const [label, cardValue] of cards) {
    const key = REPORT_KEY[label]
    let inReport: string
    if (key) {
      inReport = reportCell(key)
    } else {
      // PP orders lives in REALIZACJA CELÓW, not in the summary table.
      const l = report.split('\n').find(x => x.startsWith('- PP orders:')) ?? ''
      inReport = l.replace('- PP orders: ', '').replace(/\s*\(.*$/, '').trim()
    }
    const ok = cardValue === inReport
    if (!ok) allMatch = false
    lines.push(`${label.padEnd(20)} | ${cardValue.padEnd(23)} | ${inReport.padEnd(23)} | ${ok ? 'TAK' : 'NIE'}`)
  }
  lines.push('-'.repeat(86))
  lines.push(allMatch
    ? 'WSZYSTKIE POZYCJE ZGODNE co do grosza.'
    : 'ROZBIEŻNOŚĆ — raport drukuje inną liczbę niż karta. To bug.')

  return { report, comparison: `${RANGE_LABELS[range]} (${from} → ${to})\n${lines.join('\n')}` }
}
