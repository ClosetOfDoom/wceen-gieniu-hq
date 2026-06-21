import { describe, it, expect } from 'vitest'
import { mapProfitToSummary, type ProfitData } from '../profitData'

function makeProfitData(overrides: Partial<ProfitData> = {}): ProfitData {
  return {
    ok: true,
    timestamp: '2024-06-21T12:00:00Z',
    dateWarsaw: '2024-06-21',
    ordersCount: 4,
    revenue: 1129,
    adSpend: 200,
    adSpendSource: 'meta_ads_daily',
    knownMargin: 930,
    unknownRevenue: 0,
    unknownOrdersCount: 0,
    marginBeforeAds: 930,
    estimatedProfitAfterAds: 730,  // 930 - 200
    estimatedProfitPerOrder: 182.5, // 730 / 4
    productBreakdown: [],
    unmappedOrders: [],
    sourceTable: 'wix_orders_paid',
    ...overrides,
  }
}

describe('mapProfitToSummary', () => {
  it('maps field names to canonical ProfitSummary shape', () => {
    const pd = makeProfitData()
    const s = mapProfitToSummary(pd)
    expect(s.marginBeforeAds).toBe(930)
    expect(s.estimatedProfit).toBe(730)  // = estimatedProfitAfterAds
    expect(s.profitPerOrder).toBe(182.5) // = estimatedProfitPerOrder
    expect(s.adSpend).toBe(200)
  })

  it('realCpa = adSpend / ordersCount', () => {
    const pd = makeProfitData({ adSpend: 300, ordersCount: 3 })
    expect(mapProfitToSummary(pd).realCpa).toBe(100)
  })

  it('realRoas = revenue / adSpend', () => {
    const pd = makeProfitData({ revenue: 1000, adSpend: 400 })
    expect(mapProfitToSummary(pd).realRoas).toBeCloseTo(2.5)
  })

  it('realCpa is null when ordersCount = 0', () => {
    const pd = makeProfitData({ ordersCount: 0 })
    expect(mapProfitToSummary(pd).realCpa).toBeNull()
  })

  it('realRoas is null when adSpend = 0', () => {
    const pd = makeProfitData({ adSpend: 0 })
    expect(mapProfitToSummary(pd).realRoas).toBeNull()
  })

  it('profit = margin - adSpend, NOT revenue - adSpend', () => {
    const pd = makeProfitData()
    const s = mapProfitToSummary(pd)
    // revenue = 1129, adSpend = 200, margin = 930
    // Correct profit = 930 - 200 = 730
    // Wrong (revenue-based) profit = 1129 - 200 = 929
    expect(s.estimatedProfit).toBe(730)
    expect(s.estimatedProfit).not.toBe(pd.revenue - pd.adSpend)
  })

  it('profitPerOrder = 0 when ordersCount = 0 (backend handles this)', () => {
    const pd = makeProfitData({ estimatedProfitPerOrder: 0, ordersCount: 0 })
    expect(mapProfitToSummary(pd).profitPerOrder).toBe(0)
  })
})
