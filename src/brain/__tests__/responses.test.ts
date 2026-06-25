import { describe, it, expect, vi, afterEach } from 'vitest'
import type { DailyPerformance } from '../../services/data'

// Stub personality before importing responses — pickPhrase calls localStorage in Node env
vi.mock('../personality', () => ({
  pickPhrase: () => 'Lifidi,',
  OPENERS:               ['Lifidi,'],
  GOOD_VERDICTS:         [],
  HIGH_CPA_VERDICTS:     [],
  SALES_WARNING_VERDICTS:[],
  NO_DATA_VERDICTS:      [],
  NEXT_MOVES:            [],
  META_NOT_LIVE_NOTES:   [],
  JSU_OPENERS:           [],
  JSU_BOTTLENECK_CLOSES: [],
  JSU_OK_CLOSES:         [],
}))

import { buildYesterdaySummary, buildPeriodComparison, buildLast7Days, buildWeekToDate } from '../responses'

// Fix system time: today = 2026-06-25, yesterday = 2026-06-24
const TODAY     = '2026-06-25'
const YESTERDAY = '2026-06-24'
const FIXED_NOW = new Date(TODAY + 'T10:00:00Z') // 10:00 UTC = 12:00 Warsaw

function makeRow(date: string, overrides: Partial<DailyPerformance> = {}): DailyPerformance {
  return {
    date,
    meta_spend:  120,
    wix_orders:  2,
    wix_revenue: 1098,
    real_cpa:    60,
    real_roas:   9.15,
    impressions: 4200,
    clicks:      150,
    link_clicks: 100,
    ads_count:   2,
    ...overrides,
  }
}

describe('buildYesterdaySummary', () => {
  afterEach(() => vi.useRealTimers())

  it('returns yesterday data by date match', () => {
    vi.useFakeTimers()
    vi.setSystemTime(FIXED_NOW)

    const trend: DailyPerformance[] = [
      makeRow(TODAY,     { wix_orders: 3, wix_revenue: 1647, meta_spend: 175 }),
      makeRow(YESTERDAY, { wix_orders: 2, wix_revenue: 1098, meta_spend: 120, real_cpa: 60, real_roas: 9.15 }),
    ]
    const result = buildYesterdaySummary(trend)

    expect(result).toContain(YESTERDAY)
    expect(result).toContain('1098.00')    // revenue (fmtPln uses toFixed, no thousands sep)
    expect(result).toContain('120.00')     // spend
    expect(result).toContain('60.00')      // CPA
    expect(result).toContain('9.15')       // ROAS
  })

  it('falls back to trend[1] when yesterday date not matched', () => {
    vi.useFakeTimers()
    vi.setSystemTime(FIXED_NOW)

    // Trend has 2026-06-23 and 2026-06-22 — neither is yesterday (2026-06-24)
    const trend: DailyPerformance[] = [
      makeRow('2026-06-23', { wix_orders: 1, wix_revenue: 549 }),
      makeRow('2026-06-22', { wix_orders: 4, wix_revenue: 2196 }),
    ]
    const result = buildYesterdaySummary(trend)
    // Falls back to trend[1] = 2026-06-22
    expect(result).toContain('2026-06-22')
    expect(result).toContain('4')
  })

  it('returns no-data message for empty trend', () => {
    vi.useFakeTimers()
    vi.setSystemTime(FIXED_NOW)
    const result = buildYesterdaySummary([])
    expect(result).toMatch(/no data|brak/i)
  })
})

describe('buildPeriodComparison today-vs-yesterday', () => {
  it('shows both dates and deltas', () => {
    // No date mocking needed — buildPeriodComparison uses sorted[0]/sorted[1], not yesterdayWaw()
    const trend: DailyPerformance[] = [
      makeRow(TODAY,     { wix_orders: 3, wix_revenue: 1647, meta_spend: 175, real_cpa: 58.33, real_roas: 9.41 }),
      makeRow(YESTERDAY, { wix_orders: 2, wix_revenue: 1098, meta_spend: 120, real_cpa: 60,    real_roas: 9.15 }),
    ]
    const result = buildPeriodComparison(trend, 'today-vs-yesterday')

    expect(result).toContain(TODAY)
    expect(result).toContain(YESTERDAY)
    // Revenue delta: 1647 - 1098 = 549 (fmtPln = toFixed(2))
    expect(result).toContain('+549.00')
    // Orders delta: 3 - 2 = +1
    expect(result).toContain('+1')
    expect(result).toContain(TODAY)
    expect(result).toContain(YESTERDAY)
    // Verdict: today ahead
    expect(result).toMatch(/ahead|better/i)
  })

  it('shows negative delta when today is behind', () => {
    const trend: DailyPerformance[] = [
      makeRow(TODAY,     { wix_orders: 1, wix_revenue: 549, meta_spend: 200 }),
      makeRow(YESTERDAY, { wix_orders: 4, wix_revenue: 2196, meta_spend: 120 }),
    ]
    const result = buildPeriodComparison(trend, 'today-vs-yesterday')
    // Revenue delta: 549 - 2196 = -1647
    expect(result).toContain('-1647.00')
    expect(result).toMatch(/behind|underperform/i)
  })

  it('handles missing yesterday gracefully', () => {
    const trend: DailyPerformance[] = [
      makeRow(TODAY, { wix_orders: 2 }),
    ]
    const result = buildPeriodComparison(trend, 'today-vs-yesterday')
    // No yesterday row — should mention "No yesterday data" or similar
    expect(result).toMatch(/yesterday|Yesterday/i)
  })
})

describe('buildLast7Days', () => {
  it('sums all rows in trend', () => {
    const trend: DailyPerformance[] = [
      makeRow('2026-06-25', { wix_orders: 3, wix_revenue: 1647, meta_spend: 175 }),
      makeRow('2026-06-24', { wix_orders: 2, wix_revenue: 1098, meta_spend: 120 }),
      makeRow('2026-06-23', { wix_orders: 1, wix_revenue: 549,  meta_spend: 80 }),
    ]
    const result = buildLast7Days(trend)
    // Total orders = 6, revenue = 3294, spend = 375
    expect(result).toContain('6')
    expect(result).toContain('3294.00')    // fmtPln = toFixed(2), no thousands sep
    expect(result).toContain('375.00')
  })
})

describe('buildWeekToDate', () => {
  afterEach(() => vi.useRealTimers())

  it('filters to current week rows only', () => {
    vi.useFakeTimers()
    // 2026-06-25 = Thursday → week started 2026-06-22 (Monday)
    vi.setSystemTime(FIXED_NOW)

    const trend: DailyPerformance[] = [
      makeRow('2026-06-25', { wix_orders: 3, wix_revenue: 1647, meta_spend: 175 }),
      makeRow('2026-06-24', { wix_orders: 2, wix_revenue: 1098, meta_spend: 120 }),
      makeRow('2026-06-23', { wix_orders: 1, wix_revenue: 549,  meta_spend: 80 }),
      makeRow('2026-06-22', { wix_orders: 4, wix_revenue: 2196, meta_spend: 150 }),
      // Before this week:
      makeRow('2026-06-21', { wix_orders: 0, wix_revenue: 0, meta_spend: 0 }),
    ]
    const result = buildWeekToDate(trend)
    // This week: Mon 22 + Tue 23 + Wed 24 + Thu 25 = 10 orders, 5490 revenue
    expect(result).toContain('10')
    expect(result).toContain('5490.00')    // fmtPln = toFixed(2)
    // Last week row NOT included
    expect(result).not.toContain('2026-06-21')
  })
})
