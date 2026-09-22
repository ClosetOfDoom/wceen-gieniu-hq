// Tests for the clipboard report.
//
// The report's whole value is that another analyst can trust it without
// re-deriving anything. So these tests are mostly about what it must NOT do:
// never print a zero where a number is missing, never merge a deliberate
// exclusion into a gap, never silently drop a day.

import { describe, it, expect } from 'vitest'
import { buildReport, type ReportInput } from '../exportReport'
import type { DailyPerformance, MetaAdDaily } from '../../services/data'
import type { ProfitData } from '../profitData'

const day = (date: string, o: number, rev: number, spend: number): DailyPerformance => ({
  date,
  wix_orders: o,
  wix_revenue: rev,
  meta_spend: spend,
  real_cpa: o > 0 ? spend / o : null,
  real_roas: spend > 0 ? rev / spend : null,
  impressions: 1000, clicks: 50, link_clicks: 20, ads_count: 2,
})

const profit = (over: Partial<ProfitData> = {}): ProfitData => ({
  ok: true,
  timestamp: '2026-09-22T10:00:00.000Z',
  dateWarsaw: '2026-09-22',
  ordersCount: 10,
  revenue: 1190,
  adSpend: 400,
  adSpendSource: 'v_daily_wix_meta_performance',
  knownMargin: 700,
  unknownRevenue: 0,
  unknownOrdersCount: 0,
  marginBeforeAds: 700,
  estimatedProfitAfterAds: 300,
  estimatedProfitPerOrder: 30,
  productBreakdown: [
    { productKey: 'memory_pack', displayName: 'Pakiet Pamięciowy', scope: 'memory',
      catalogPrice: 119, orders: 10, units: 10, revenue: 1190, contributionMargin: 70, marginTotal: 700 },
  ],
  unmappedOrders: [],
  sourceTable: 'orders',
  ...over,
})

const GOALS: ReportInput['goals'] = {
  pp:      { pct: 100, status: 'green', note: 'on pace — 10/10 ✓' },
  revenue: { pct: 90,  status: 'amber', note: '1 000 PLN oczek. · slightly behind' },
  cpa:     { pct: 100, status: 'green', note: 'in range — target <40' },
  roas:    { pct: 99,  status: 'green', note: 'healthy — ≥2.0x' },
  ppOrders: 10,
  ppTarget: 10,
  revenueTarget: 1000,
}

function input(over: Partial<ReportInput> = {}): ReportInput {
  return {
    range: 'today',
    from: '2026-09-22',
    to: '2026-09-22',
    rangeSub: '2026-09-22 · w toku',
    buildHash: 'abc1234',
    generatedAt: '2026-09-22T10:00:00.000Z',
    perf: day('2026-09-22', 10, 1190, 400),
    prevPerf: day('2026-09-21', 8, 952, 380),
    dailyRows: [day('2026-09-22', 10, 1190, 400)],
    profit: profit(),
    cpa: 40,
    roas: 2.975,
    campaignRows: [
      { date: '2026-09-22', campaign_name: 'PP-KONWERSJE', ad_name: 'PP-ad-1', spend: 300 },
      { date: '2026-09-22', campaign_name: '3T-TRIPWIRE',  ad_name: '3T-ad-1', spend: 100 },
    ] as MetaAdDaily[],
    campaignError: null,
    goals: GOALS,
    ...over,
  }
}

describe('header', () => {
  it('names the range, the span, whether it is closed, and the build', () => {
    const r = buildReport(input())
    expect(r).toContain('# STANLEY HQ — RAPORT DZIŚ')
    expect(r).toContain('Zakres: 2026-09-22 – 2026-09-22 (1 dzień, w toku)')
    expect(r).toContain('Wygenerowano: 2026-09-22T10:00:00.000Z')
    expect(r).toContain('Build: abc1234')
  })

  it('marks a closed range as pełny and an accumulating one as w toku', () => {
    expect(buildReport(input({ range: 'yesterday', from: '2026-09-21', to: '2026-09-21' })))
      .toContain('(1 dzień, pełny)')
    expect(buildReport(input({ range: 'week', from: '2026-09-15', to: '2026-09-21' })))
      .toContain('(7 dni, pełny)')
    expect(buildReport(input({ range: 'month', from: '2026-09-01', to: '2026-09-22' })))
      .toContain('(22 dni, w toku)')
  })

  it('always carries the data rules and the targets', () => {
    const r = buildReport(input())
    expect(r).toContain('## ZASADY DANYCH')
    expect(r).toContain('atrybucja per reklama jest NIEMOŻLIWA')
    expect(r).toContain('## PROGI I CELE')
    expect(r).toContain('ROAS: ≥2,0x zdrowy')
  })
})

describe('day-by-day', () => {
  it('is omitted for a single day', () => {
    expect(buildReport(input({ range: 'today' }))).not.toContain('## DZIEŃ PO DNIU')
    expect(buildReport(input({ range: 'yesterday' }))).not.toContain('## DZIEŃ PO DNIU')
  })

  it('is present for WEEK with one line per day', () => {
    const rows = ['2026-09-15', '2026-09-16', '2026-09-17'].map((d, k) => day(d, 10 + k, 1000 + k, 400))
    const r = buildReport(input({ range: 'week', from: '2026-09-15', to: '2026-09-17', dailyRows: rows }))
    expect(r).toContain('## DZIEŃ PO DNIU')
    for (const d of ['2026-09-15', '2026-09-16', '2026-09-17']) expect(r).toContain(`| ${d} |`)
  })

  it('names a missing day instead of skipping it or printing zeros', () => {
    // 16th absent from the view entirely.
    const rows = [day('2026-09-15', 10, 1000, 400), day('2026-09-17', 12, 1200, 420)]
    const r = buildReport(input({ range: 'week', from: '2026-09-15', to: '2026-09-17', dailyRows: rows }))
    expect(r).toContain('| 2026-09-16 | BRAK DANYCH: v_daily_wix_meta_performance |')
    expect(r).toContain('- brak wiersza w v_daily_wix_meta_performance: 2026-09-16')
  })
})

describe('products — a gap and a decision are different states', () => {
  it('prints the product table with price, units, margin and scope', () => {
    const r = buildReport(input())
    expect(r).toContain('| produkt | cena | szt. | przychód | marża/szt. | marża razem | scope |')
    expect(r).toContain('| Pakiet Pamięciowy | 119.00 PLN | 10 | 1,190.00 PLN | 70.00 PLN | 700.00 PLN | memory |')
  })

  it('prints the REALISED per-unit margin so szt. × marża/szt. = marża razem', () => {
    // One Językozak AI sold at 312.30 instead of the catalog 347: the margin is
    // 312.30 − 27 unit cost = 285.30, not the catalog 320. A reader multiplying
    // the printed per-unit figure must land on the printed total.
    const r = buildReport(input({
      profit: profit({
        productBreakdown: [
          { productKey: 'jzk_ai', displayName: 'Językozak AI', scope: 'language',
            catalogPrice: 347, orders: 1, units: 1, revenue: 312.3,
            contributionMargin: 320, marginTotal: 285.3 },
        ],
      }),
    }))
    expect(r).toContain('| Językozak AI | 347.00 PLN | 1 | 312.30 PLN | 285.30 PLN | 285.30 PLN | language |')
    // …and the catalog figure is stated rather than dropped.
    expect(r).toContain('Marża zrealizowana ≠ katalogowa:')
    expect(r).toContain('Językozak AI: zrealizowana 285.30 PLN/szt. vs katalogowa 320.00 PLN/szt.')
  })

  it('reports unmapped orders WITH the field the match broke on', () => {
    const r = buildReport(input({
      profit: profit({
        noMarginOrdersCount: 2, noMarginRevenue: 274,
        noMarginFields: ['amount (137 PLN not in PRICE_TO_PRODUCT)'],
      }),
    }))
    expect(r).toContain('- NIEZMAPOWANE: 2 zamówień, 274.00 PLN, marża pominięta, '
      + 'brakujące pole: amount (137 PLN not in PRICE_TO_PRODUCT)')
  })

  it('puts a WSZTP order in WYKLUCZONE, not in NIEZMAPOWANE', () => {
    const r = buildReport(input({
      profit: profit({
        excludedOrdersCount: 1, excludedRevenue: 3450,
        noMarginOrdersCount: 0, noMarginRevenue: 0, noMarginFields: [],
      }),
      // CPA and ROAS are handed in already blended, i.e. computed without WSZTP.
      cpa: 40, roas: 2.975,
    }))
    expect(r).toContain('- WYKLUCZONE (WSZTP, poza blended): 1 zamówień, 3,450.00 PLN')
    expect(r).toContain('- NIEZMAPOWANE: brak')
    // The excluded revenue must not leak into the blended figures.
    expect(r).not.toContain('3,450.00 PLN |')
    expect(r).toContain('| real ROAS | 2.98x |')
  })

  it('says the endpoint is missing rather than printing an empty product table', () => {
    const r = buildReport(input({ profit: null }))
    expect(r).toContain('BRAK DANYCH: /.netlify/functions/profit-data')
    expect(r).toContain('- profit-data niedostępne')
  })
})

describe('campaigns', () => {
  it('rolls ads up to campaigns with spend share and scope', () => {
    const r = buildReport(input())
    expect(r).toContain('| PP-KONWERSJE | 300.00 PLN | 75.0% | PP- |')
    expect(r).toContain('| 3T-TRIPWIRE | 100.00 PLN | 25.0% | 3T- |')
    expect(r).toContain('Razem: 400.00 PLN w 2 kampaniach.')
  })

  it('prints BRAK DANYCH rather than zeros when there are no Meta rows', () => {
    const r = buildReport(input({ campaignRows: [] }))
    expect(r).toContain('## KAMPANIE META')
    expect(r).toContain('BRAK DANYCH: meta_ads_daily (campaign_name, spend) dla zakresu 2026-09-22 → 2026-09-22')
    // The section exists and is honest — it is not silently dropped, and it
    // does not report 0,00 zł as if that were a measurement.
    expect(r).not.toContain('| kampania | wydatek |')
    expect(r).toContain('- brak wierszy per kampania (meta_ads_daily) w tym zakresie')
  })

  it('quotes the fetch error when campaign-data itself failed', () => {
    const r = buildReport(input({ campaignRows: [], campaignError: 'HTTP 500' }))
    expect(r).toContain('BRAK DANYCH: meta_ads_daily — campaign-data zwróciło błąd: HTTP 500')
  })

  it('classifies an unrecognised campaign as unknown, never as a funnel', () => {
    const r = buildReport(input({
      campaignRows: [{ date: '2026-09-22', campaign_name: 'Brand awareness', ad_name: 'x', spend: 50 }] as MetaAdDaily[],
    }))
    expect(r).toContain('| Brand awareness | 50.00 PLN | 100.0% | unknown |')
  })
})

describe('summary and goals', () => {
  it('compares against the previous period and marks what is not comparable', () => {
    const r = buildReport(input())
    expect(r).toContain('| zamówienia | 10 | +2 (+25%) |')
    expect(r).toContain('| przychód | 1,190.00 PLN | +238.00 PLN (+25%) |')
    // Profit for the previous period is never fetched, so it is NOT compared.
    expect(r).toContain('| est. profit | 300.00 PLN | BRAK DANYCH: profit-data dla poprzedniego zakresu |')
  })

  it('computes AOV only when both revenue and orders exist', () => {
    expect(buildReport(input())).toContain('| AOV | 119.00 PLN |')
    const noPerf = buildReport(input({ perf: null, prevPerf: null }))
    expect(noPerf).toContain('| AOV | BRAK |')
    expect(noPerf).toContain('| zamówienia | BRAK |')
  })

  it('states every goal with its value, target and status', () => {
    const r = buildReport(input())
    expect(r).toContain('- PP orders: 10 / 10 (green — on pace — 10/10 ✓)')
    expect(r).toContain('- przychód: 1,190.00 PLN / 1,000.00 PLN (amber')
    expect(r).toContain('- CPA: 40.00 PLN (green')
    expect(r).toContain('- ROAS: 2.98x (green')
  })
})

describe('known gaps', () => {
  it('says "brak" when there is nothing missing', () => {
    const r = buildReport(input())
    expect(r).toContain('## ZNANE DZIURY W DANYCH')
    expect(r).toMatch(/## ZNANE DZIURY W DANYCH\n\nbrak\n?$/)
  })

  it('flags days with no Meta spend', () => {
    const r = buildReport(input({
      range: 'week', from: '2026-09-15', to: '2026-09-16',
      dailyRows: [day('2026-09-15', 10, 1000, 0), day('2026-09-16', 11, 1100, 400)],
    }))
    expect(r).toContain('- meta_spend = 0 (reklamy wyłączone albo ingest Meta nie zadziałał): 2026-09-15')
  })

  it('flags the UTC-vs-Warsaw day boundary so the report and the view can be compared', () => {
    const r = buildReport(input({ profit: profit({ dayBoundaryOrders: 2 }) }))
    expect(r).toContain('- 2 zamówień w oknie 22:00–24:00 UTC')
  })
})

describe('no invented numbers', () => {
  it('never prints a bare 0 for a metric that has no data at all', () => {
    const r = buildReport(input({
      perf: null, prevPerf: null, profit: null, campaignRows: [], cpa: null, roas: null,
      dailyRows: [],
    }))
    // Every missing figure is named, not zeroed.
    expect(r).toContain('| zamówienia | BRAK |')
    expect(r).toContain('| przychód | BRAK |')
    expect(r).toContain('| ad spend | BRAK |')
    expect(r).toContain('| real CPA | BRAK |')
    expect(r).toContain('| real ROAS | BRAK |')
    expect(r).not.toMatch(/\| (zamówienia|przychód|ad spend) \| 0/)
  })

  it('ends with a newline so the clipboard paste is clean', () => {
    expect(buildReport(input()).endsWith('\n')).toBe(true)
  })
})
