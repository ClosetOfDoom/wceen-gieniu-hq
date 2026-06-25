import { describe, it, expect } from 'vitest'
import {
  PRODUCT_MARGINS,
  matchMarginByAmount,
  matchMarginByName,
  matchMargin,
  computeMargin,
  summarizeProfit,
  UNKNOWN_MARGIN,
} from '../productMargins'

describe('PRODUCT_MARGINS', () => {
  it('has four products with all margins filled', () => {
    expect(PRODUCT_MARGINS).toHaveLength(4)
    for (const p of PRODUCT_MARGINS) {
      expect(typeof p.contributionMargin).toBe('number')
      expect(p.contributionMargin).toBeGreaterThan(0)
    }
  })

  it('has Językozak (jzk_ai) before Pakiet Językowy (language_pack)', () => {
    const keys = PRODUCT_MARGINS.map(p => p.productKey)
    expect(keys.indexOf('jzk_ai')).toBeLessThan(keys.indexOf('language_pack'))
  })

  it('has correct price→margin mapping', () => {
    const m = Object.fromEntries(PRODUCT_MARGINS.map(p => [p.priceExpected, p.contributionMargin]))
    expect(m[549]).toBe(500)   // JSU
    expect(m[347]).toBe(320)   // Językozak
    expect(m[119]).toBe(70)    // Pakiet Pamięciowy
    expect(m[114]).toBe(40)    // Pakiet Językowy
  })
})

describe('matchMarginByAmount', () => {
  it('matches 549 → jsu_course', () => {
    expect(matchMarginByAmount(549)?.productKey).toBe('jsu_course')
  })
  it('matches 347 → jzk_ai', () => {
    expect(matchMarginByAmount(347)?.productKey).toBe('jzk_ai')
  })
  it('matches 119 → memory_pack', () => {
    expect(matchMarginByAmount(119)?.productKey).toBe('memory_pack')
  })
  it('matches 114 → language_pack', () => {
    expect(matchMarginByAmount(114)?.productKey).toBe('language_pack')
  })
  it('returns null for unknown price 99', () => {
    expect(matchMarginByAmount(99)).toBeNull()
  })
})

describe('matchMarginByName', () => {
  it('matches "Kurs Jak się uczyć" → jsu_course', () => {
    expect(matchMarginByName('Kurs Jak się uczyć')?.productKey).toBe('jsu_course')
  })
  it('matches "Językozak AI" → jzk_ai (before language_pack)', () => {
    expect(matchMarginByName('Językozak AI')?.productKey).toBe('jzk_ai')
  })
  it('matches "Pakiet Pamięciowy" → memory_pack', () => {
    expect(matchMarginByName('Pakiet Pamięciowy')?.productKey).toBe('memory_pack')
  })
  it('matches "Pakiet Językowy" → language_pack (not jzk)', () => {
    expect(matchMarginByName('Pakiet Językowy')?.productKey).toBe('language_pack')
  })
  it('returns null for garbage name', () => {
    expect(matchMarginByName('Produkt Nieznany ABC')).toBeNull()
  })
  it('returns null for null input', () => {
    expect(matchMarginByName(null)).toBeNull()
  })
})

describe('matchMargin (combined)', () => {
  it('price wins over name', () => {
    // amount 549 = jsu_course, even if name says something else
    expect(matchMargin('Pakiet Pamięciowy', 549)?.productKey).toBe('jsu_course')
  })
  it('falls back to name when price unknown', () => {
    expect(matchMargin('Językozak AI', 0)?.productKey).toBe('jzk_ai')
  })
  it('returns null for both unknown', () => {
    expect(matchMargin('Garbage product', 99)).toBeNull()
  })
})

describe('computeMargin', () => {
  it('sums margins for four paid products', () => {
    const orders = [
      { amount: 119, product_name_raw: 'Pakiet Pamięciowy' },  // PP: 70
      { amount: 114, product_name_raw: 'Pakiet Językowy' },     // PL: 40
      { amount: 549, product_name_raw: 'Kurs Jak się uczyć' },  // JSU: 500
      { amount: 347, product_name_raw: 'Językozak AI' },        // JZK: 320
    ]
    const result = computeMargin(orders)
    expect(result.revenue).toBe(119 + 114 + 549 + 347)          // 1129
    expect(result.contributionMargin).toBe(70 + 40 + 500 + 320) // 930
    expect(result.unmappedRevenue).toBe(0)
    expect(result.unmappedCount).toBe(0)
  })

  it('separates unmapped product', () => {
    const orders = [
      { amount: 119 },    // PP
      { amount: 99,  product_name_raw: 'Garbage ABC' },  // unmapped
    ]
    const result = computeMargin(orders)
    expect(result.contributionMargin).toBe(70)
    expect(result.unmappedRevenue).toBe(99)
    expect(result.unmappedCount).toBe(1)
  })

  it('byProduct accumulates correctly for multiple same product', () => {
    const orders = [
      { amount: 119 },
      { amount: 119 },
    ]
    const result = computeMargin(orders)
    expect(result.byProduct['memory_pack'].orders).toBe(2)
    expect(result.byProduct['memory_pack'].marginTotal).toBe(140)
  })
})

describe('summarizeProfit', () => {
  it('profit = margin - adSpend, NOT revenue - adSpend', () => {
    const breakdown = computeMargin([
      { amount: 119 },  // PP: margin 70
      { amount: 119 },  // PP: margin 70
    ])
    const summary = summarizeProfit(breakdown, 100, 2)
    // margin = 140, adSpend = 100 → profit = 40
    expect(summary.marginBeforeAds).toBe(140)
    expect(summary.estimatedProfit).toBe(40)
    // NOT 238 - 100 = 138 (revenue - spend)
    expect(summary.estimatedProfit).not.toBe(breakdown.revenue - 100)
  })

  it('profitPerOrder = estimatedProfit / paidCount', () => {
    const breakdown = computeMargin([{ amount: 549 }, { amount: 347 }])  // JSU + JZK
    const summary = summarizeProfit(breakdown, 200, 2)
    // margin = 820, adSpend = 200, profit = 620
    expect(summary.estimatedProfit).toBe(620)
    expect(summary.profitPerOrder).toBe(310)
  })

  it('realCpa = adSpend / paidCount', () => {
    const breakdown = computeMargin([{ amount: 549 }])
    const summary = summarizeProfit(breakdown, 300, 3)
    expect(summary.realCpa).toBe(100)
  })

  it('realRoas = revenue / adSpend', () => {
    const breakdown = computeMargin([{ amount: 549 }])
    const summary = summarizeProfit(breakdown, 200, 1)
    expect(summary.realRoas).toBeCloseTo(549 / 200)
  })

  it('realCpa is null when paidCount = 0', () => {
    const breakdown = computeMargin([])
    const summary = summarizeProfit(breakdown, 100, 0)
    expect(summary.realCpa).toBeNull()
    expect(summary.profitPerOrder).toBe(0)
  })

  it('realRoas is null when adSpend = 0', () => {
    const breakdown = computeMargin([{ amount: 119 }])
    const summary = summarizeProfit(breakdown, 0, 1)
    expect(summary.realRoas).toBeNull()
  })
})

describe('UNKNOWN_MARGIN sentinel', () => {
  it('exists and has contributionMargin null', () => {
    expect(UNKNOWN_MARGIN.productKey).toBe('unknown')
    expect(UNKNOWN_MARGIN.contributionMargin).toBeNull()
    expect(UNKNOWN_MARGIN.needsMapping).toBe(true)
  })
})

describe('JSU/PP collision guard', () => {
  // "Jak się uczyć" appears as a *bonus item* inside the PP bundle name.
  // It must NOT be classified as JSU — it's PP at 119 PLN / margin 70 PLN.
  const PP_BUNDLE_NAME = 'Pakiet Pamięciowy – Pamięć + bonusy (14 audycji + Jak się uczyć + 7 warunków)'
  const PP_TRENING_NAME = 'Pamięć. Trening Interaktywny: Ebook + Druk'
  const JSU_REAL_NAME = 'Kurs online Jak się uczyć'
  const JSU_SHORT = 'Kurs Jak się uczyć'

  it('PP bundle name (contains "Jak się uczyć" as bonus) → memory_pack by name', () => {
    expect(matchMarginByName(PP_BUNDLE_NAME)?.productKey).toBe('memory_pack')
  })

  it('PP bundle name does NOT match jsu_course by name', () => {
    expect(matchMarginByName(PP_BUNDLE_NAME)?.productKey).not.toBe('jsu_course')
  })

  it('PP Trening Interaktywny variant → memory_pack by name', () => {
    expect(matchMarginByName(PP_TRENING_NAME)?.productKey).toBe('memory_pack')
  })

  it('"Kurs online Jak się uczyć" → jsu_course by name', () => {
    expect(matchMarginByName(JSU_REAL_NAME)?.productKey).toBe('jsu_course')
  })

  it('"Kurs Jak się uczyć" → jsu_course by name', () => {
    expect(matchMarginByName(JSU_SHORT)?.productKey).toBe('jsu_course')
  })

  it('price 119 always wins over any name → memory_pack', () => {
    expect(matchMargin(PP_BUNDLE_NAME, 119)?.productKey).toBe('memory_pack')
    expect(matchMargin(JSU_REAL_NAME, 119)?.productKey).toBe('memory_pack')
  })

  it('price 549 always wins → jsu_course', () => {
    expect(matchMargin(PP_BUNDLE_NAME, 549)?.productKey).toBe('jsu_course')
  })
})
