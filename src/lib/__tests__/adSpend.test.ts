// Cogni spend is not a denominator for Wix orders.
//
// The numbers below are the real week 2026-11-06…12: PP-22.06.2026 spent
// 3 754,50 zł against 87 Wix orders (43,16 zł, amber); COGNI-TEST-09.11 spent
// another 953,91 zł, and counted together they read 54,12 zł (red).
import { describe, it, expect } from 'vitest'
import {
  adScopeOf, EXCLUDED_FROM_WIX_BLENDED, isExcludedFromWixBlended,
  splitAdSpend, splitAdSpendByDay, applySpendSplit, totalSpendOf,
  excludedSpendLines, excludedSpendSentence, formatZl,
} from '../adSpend'
import { aggregatePerf } from '../rangePerf'
import { cpaAlert } from '../alerts'
import type { DailyPerformance } from '../../services/data'

describe('adScopeOf', () => {
  it.each([
    ['COGNI-TEST-09.11', 'cogni'],
    ['cogni-test', 'cogni'],
    ['Cogni ', 'cogni'],
    ['COGNI', 'cogni'],
    ['PP-22.06.2026', 'memory'],
    ['3T-TRIPWIRE', 'language'],
    ['XYZ', 'unknown'],
    ['PPC-test', 'unknown'],
    ['COGNITIVE-1', 'unknown'],
    ['', 'unknown'],
    [null, 'unknown'],
  ])('%s → %s', (name, scope) => {
    expect(adScopeOf(name as string | null)).toBe(scope)
  })

  it('falls back to the ad name only when the campaign name is empty', () => {
    expect(adScopeOf('', 'COGNI-reel')).toBe('cogni')
    expect(adScopeOf('PP-1', 'COGNI-reel')).toBe('memory')
  })
})

describe('what is excluded', () => {
  it('is exactly cogni — unknown stays blended', () => {
    expect(EXCLUDED_FROM_WIX_BLENDED).toEqual(['cogni'])
    expect(isExcludedFromWixBlended('cogni')).toBe(true)
    for (const s of ['memory', 'language', 'unknown']) expect(isExcludedFromWixBlended(s)).toBe(false)
  })
})

const day = (n: number) => `2026-11-${String(n).padStart(2, '0')}`

// 7 days of PP, and Cogni on the last four — the shape of 6–12.11.
const ROWS = [
  ...[500.5, 520, 540, 560, 540, 550, 544].map((spend, i) => ({
    date: day(6 + i), campaign_name: 'PP-22.06.2026', ad_name: 'a', spend,
  })),
  ...[200, 250.91, 250, 253].map((spend, i) => ({
    date: day(9 + i), campaign_name: 'COGNI-TEST-09.11', ad_name: 'c', spend,
  })),
]

describe('splitAdSpend', () => {
  const s = splitAdSpend(ROWS)
  it('keeps Cogni out of blended and adds up to the total, to the grosz', () => {
    expect(s.blended).toBe(3754.5)
    expect(s.excluded).toBe(953.91)
    expect(s.total).toBe(4708.41)
  })
  it('names the excluded campaign once, summed over days', () => {
    expect(s.excludedCampaigns).toEqual([{ campaign: 'COGNI-TEST-09.11', scope: 'cogni', spend: 953.91 }])
  })
  it('gives 43,16 zł blended and 54,12 zł if Cogni were counted', () => {
    expect(Math.round((s.blended / 87) * 100) / 100).toBe(43.16)
    expect(Math.round((s.total / 87) * 100) / 100).toBe(54.12)
  })
  it('is float-noise proof', () => {
    const noisy = [0.1, 0.2, 130.98000000000002].map(spend => ({ campaign_name: 'PP-1', spend }))
    expect(splitAdSpend(noisy).blended).toBe(131.28)
  })
  it('a range without Cogni excludes nothing and says nothing', () => {
    const r = splitAdSpend(ROWS.filter(x => x.campaign_name.startsWith('PP')))
    expect(r.excluded).toBe(0)
    expect(r.excludedCampaigns).toEqual([])
    expect(excludedSpendLines(r)).toEqual([])
    expect(excludedSpendSentence(r)).toBe('')
  })
  it('handles null / empty input', () => {
    expect(splitAdSpend(null).total).toBe(0)
    expect(splitAdSpend([]).blended).toBe(0)
  })
})

describe('report line and Stanley sentence', () => {
  const s = splitAdSpend(ROWS)
  it('prints the WYKLUCZONE line with the amount', () => {
    expect(excludedSpendLines(s)).toEqual([
      `WYKLUCZONE z blended: COGNI-TEST-09.11 — ${formatZl(953.91)} (przychód Cogni w Stripe, poza Stanleyem)`,
    ])
    expect(excludedSpendLines(s)[0]).toContain('953,91')
  })
  it('names the gap', () => {
    expect(excludedSpendSentence(s)).toContain('COGNI-TEST-09.11')
    expect(excludedSpendSentence(s)).toContain('brak przychodu Stripe w bazie')
    expect(excludedSpendSentence({ excluded: 953.91 } as never)).toContain('brak przychodu Stripe w bazie')
  })
})

describe('applySpendSplit + aggregatePerf → the weekly CPA', () => {
  // One view row per day: the VIEW's spend is the TOTAL (what made it red).
  const orders = [12, 13, 12, 12, 13, 12, 13] // 87
  const viewRows = orders.map((wix_orders, i) => {
    const date = day(6 + i)
    const total = ROWS.filter(r => r.date === date).reduce((t, r) => t + r.spend, 0)
    return {
      date, wix_orders, wix_revenue: wix_orders * 200, meta_spend: total,
      real_cpa: total / wix_orders, real_roas: (wix_orders * 200) / total,
    } as unknown as DailyPerformance
  })
  const days = new Map(splitAdSpendByDay(ROWS).map(d => [d.date, d]))

  it('before: the view total gives 54,12 and a red alarm', () => {
    const p = aggregatePerf(viewRows)!
    expect(Math.round((p.meta_spend / 87) * 100) / 100).toBe(54.12)
    expect(cpaAlert(54.12, 54.12, 7).severity).toBe('red')
  })

  it('after: 43,16 (±0,01) and amber, Cogni reported on its own', () => {
    const p = aggregatePerf(applySpendSplit(viewRows, days))!
    expect(p.wix_orders).toBe(87)
    expect(p.meta_spend).toBeCloseTo(3754.5, 2)
    expect(Math.abs((p.real_cpa ?? 0) - 43.16)).toBeLessThanOrEqual(0.01)
    expect(cpaAlert(p.real_cpa, p.real_cpa, 7).severity).toBe('amber')
    expect(p.meta_spend_excluded).toBeCloseTo(953.91, 2)
    expect(p.meta_spend_excluded_campaigns).toEqual([
      { campaign: 'COGNI-TEST-09.11', scope: 'cogni', spend: 953.91 },
    ])
    expect(p.spend_split).toBe('applied')
    expect(totalSpendOf(p)).toBeCloseTo(4708.41, 2)
  })

  it('a week with no Cogni is untouched by the split', () => {
    const pp = viewRows.map(r => ({ ...r, meta_spend: 500, real_cpa: 500 / r.wix_orders }))
    const ppDays = new Map(splitAdSpendByDay(
      pp.map(r => ({ date: r.date, campaign_name: 'PP-22.06.2026', spend: 500 })),
    ).map(d => [d.date, d]))
    const before = aggregatePerf(pp)!
    const after = aggregatePerf(applySpendSplit(pp, ppDays))!
    expect(after.meta_spend).toBe(before.meta_spend)
    expect(after.real_cpa).toBe(before.real_cpa)
    expect(after.meta_spend_excluded ?? 0).toBe(0)
  })

  it('an unavailable split is reported, not passed off as "nothing excluded"', () => {
    const rows = applySpendSplit(viewRows, null)
    expect(rows.every(r => r.spend_split === 'unavailable')).toBe(true)
    expect(rows[0].meta_spend).toBe(viewRows[0].meta_spend) // the view total, untouched
    expect(aggregatePerf(rows)!.spend_split).toBe('unavailable')
  })

  it('a day with no ad rows is a day with no blended spend', () => {
    const [r] = applySpendSplit([{ ...viewRows[0], date: '2026-12-01' }], days)
    expect(r.meta_spend).toBe(0)
    expect(r.spend_split).toBe('applied')
  })
})
