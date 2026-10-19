// Tests for the per-product breakdown and the consistency guard.
//
// 2026-10-17: Stanley reported 18 orders / 3 621 PLN with a breakdown of
// 18 × Pakiet Pamięciowy / 2 142 PLN. The truth was 13 PP + 4 JSU + 1 3T =
// 3 857 PLN. Three separate failures — a wrong revenue, an invented breakdown,
// and nothing checking that the breakdown added up to its own total.

import { describe, it, expect } from 'vitest'
import { countOrdersInWindow, checkBreakdownConsistency } from '../orderWindow'
import { buildOrdersInRangeAnswer } from '../../brain/responses'
import type { OrdersData } from '../ordersData'

/** 2026-10-17 exactly as `orders` holds it. */
const OCT17 = {
  date: '2026-10-17',
  orders: 18,
  revenue: 3857,
  missing: false,
  hourly: new Array(24).fill(0),
  products: {
    memory_pack: { orders: 13, revenue: 1547 },
    jsu_course:  { orders: 4,  revenue: 2196 },
    language_3t: { orders: 1,  revenue: 114 },
  },
  belowFloor: { orders: 2, revenue: 2 },
}

const CATALOG = {
  memory_pack: { displayName: 'Pakiet Pamięciowy', scope: 'memory' },
  jsu_course:  { displayName: 'Kurs Jak się uczyć', scope: 'memory' },
  language_3t: { displayName: 'Pakiet Językowy 3T', scope: 'language' },
  cogni_promo: { displayName: 'Cogni rocznie (promo)', scope: 'cogni' },
}

function data(over: Partial<OrdersData> = {}): OrdersData {
  return {
    ok: true, timestamp: '', today_warsaw: '2026-10-19', week_start: '2026-10-19',
    source_table: 'orders',
    totals: { all_orders: 1600, latest_order_date: '2026-10-19', today_orders: 0,
              today_revenue: 0, week_orders: 0, week_revenue: 0 },
    classified: { jsu_course: { count: 0, revenue: 0 }, jzk_language: { count: 0, revenue: 0 },
                  memory_pack: { count: 0, revenue: 0 }, unknown: { count: 0 }, price_warnings: 0 },
    today_classified: { jsu_course: { count: 0, revenue: 0 }, jzk_language: { count: 0, revenue: 0 },
                        memory_pack: { count: 0, revenue: 0 }, unknown: { count: 0 } },
    latest_20_orders: [],
    dailySeries: [OCT17],
    todayHourly: { date: '2026-10-19', orders: 0, revenue: 0, hourly: new Array(24).fill(0),
                   products: {}, belowFloor: { orders: 0, revenue: 0 } },
    productCatalog: CATALOG,
    ...over,
  }
}

// ── TEST 1 ──────────────────────────────────────────────────────────────────
describe('TEST 1: 2026-10-17 against the Wix truth table', () => {
  const w = countOrdersInWindow(data(), '2026-10-17', '2026-10-17')!

  it('totals 18 orders and 3 857 PLN', () => {
    expect(w.orders).toBe(18)
    expect(w.revenue).toBe(3857)
  })

  it.each([
    ['Pakiet Pamięciowy', 13, 1547],
    ['Kurs Jak się uczyć', 4, 2196],
    ['Pakiet Językowy 3T', 1, 114],
  ])('%s: %i pcs / %i PLN', (name, pcs, revenue) => {
    const slice = w.products.find(p => p.displayName === name)
    expect(slice).toBeDefined()
    expect(slice!.orders).toBe(pcs)
    expect(slice!.revenue).toBe(revenue)
  })

  it('the breakdown adds up to the total — the check that was missing', () => {
    expect(w.products.reduce((s, p) => s + p.orders, 0)).toBe(18)
    expect(w.products.reduce((s, p) => s + p.revenue, 0)).toBe(3857)
    expect(checkBreakdownConsistency(w).ok).toBe(true)
  })

  it('does NOT put everything in Pakiet Pamięciowy', () => {
    const pp = w.products.find(p => p.displayName === 'Pakiet Pamięciowy')!
    expect(pp.orders).not.toBe(18)
    expect(pp.revenue).not.toBe(2142)   // 18 × 119, the invented figure
  })

  it('reports the orders the test floor removed instead of losing them', () => {
    expect(w.belowFloor.orders).toBe(2)
    expect(buildOrdersInRangeAnswer(w, '17.10')).toContain('Odcięte progiem: 2 szt.')
  })

  it('prints every product in the answer, with the total restated', () => {
    const text = buildOrdersInRangeAnswer(w, '17.10')
    expect(text).toContain('Pakiet Pamięciowy: 13 szt. · 1547.00 PLN')
    expect(text).toContain('Kurs Jak się uczyć: 4 szt. · 2196.00 PLN')
    expect(text).toContain('Pakiet Językowy 3T: 1 szt. · 114.00 PLN')
    expect(text).toContain('razem: 18 szt. · 3857.00 PLN')
  })
})

// ── TEST 3 ──────────────────────────────────────────────────────────────────
describe('TEST 3: the consistency guard rejects a breakdown that does not add up', () => {
  const broken = countOrdersInWindow(data({
    dailySeries: [{ ...OCT17, products: { memory_pack: { orders: 18, revenue: 2142 } } }],
  }), '2026-10-17', '2026-10-17')!

  it('spots the mismatch', () => {
    // 18 pieces matches, but 2 142 against 3 857 does not.
    const v = checkBreakdownConsistency(broken)
    expect(v.ok).toBe(false)
    expect(v.reason).toContain('rozbicie niespójne z sumą')
    expect(v.reason).toContain('2142.00')
    expect(v.reason).toContain('3857.00')
  })

  it('refuses to show the answer and shows the raw figures instead', () => {
    const text = buildOrdersInRangeAnswer(broken, '17.10')
    expect(text).toContain('ROZBICIE ODRZUCONE')
    expect(text).toContain('rozbicie niespójne z sumą')
    expect(text).toContain('zamówień: 18')
    expect(text).toContain('przychód: 3857.00 PLN')
  })

  it('catches a piece-count mismatch too', () => {
    const w = countOrdersInWindow(data({
      dailySeries: [{ ...OCT17, products: { memory_pack: { orders: 12, revenue: 3857 } } }],
    }), '2026-10-17', '2026-10-17')!
    const v = checkBreakdownConsistency(w)
    expect(v.ok).toBe(false)
    expect(v.reason).toContain('12 szt. w rozbiciu vs 18')
  })
})

// ── unmapped ────────────────────────────────────────────────────────────────
describe('an unmatched product never disappears and is never substituted', () => {
  const w = countOrdersInWindow(data({
    dailySeries: [{
      ...OCT17,
      orders: 19, revenue: 3902,
      products: { ...OCT17.products, unmapped: { orders: 1, revenue: 45 } },
      unmappedNames: [{ name: 'Opowieść o skaczącej myszy', amount: 45, failedField: 'amount (45 PLN)' }],
    }],
  }), '2026-10-17', '2026-10-17')!

  it('lands in NIEZMAPOWANE, carrying its raw Wix name', () => {
    const u = w.products.find(p => p.key === 'unmapped')!
    expect(u.displayName).toBe('NIEZMAPOWANE')
    expect(u.orders).toBe(1)
    expect(u.revenue).toBe(45)
    expect(w.unmappedNames[0].name).toBe('Opowieść o skaczącej myszy')
  })

  it('still reconciles, because it is counted rather than dropped', () => {
    expect(checkBreakdownConsistency(w).ok).toBe(true)
    const text = buildOrdersInRangeAnswer(w, '17.10')
    expect(text).toContain('NIEZMAPOWANE')
    expect(text).toContain('Opowieść o skaczącej myszy')
  })
})

// ── no hardcoded product list ───────────────────────────────────────────────
describe('the breakdown iterates the catalog', () => {
  it('a product the template never heard of still appears', () => {
    const w = countOrdersInWindow(data({
      dailySeries: [{
        ...OCT17,
        orders: 19, revenue: 4256,
        products: { ...OCT17.products, cogni_promo: { orders: 1, revenue: 399 } },
      }],
    }), '2026-10-17', '2026-10-17')!
    expect(w.products.find(p => p.key === 'cogni_promo')?.displayName).toBe('Cogni rocznie (promo)')
    expect(buildOrdersInRangeAnswer(w, '17.10')).toContain('Cogni rocznie (promo): 1 szt.')
  })
})

// ── TEST 5 ──────────────────────────────────────────────────────────────────
describe('TEST 5: a 00:07 Warsaw order counts in that day, in BOTH the count and the revenue', () => {
  it('the same series feeds both, so they cannot use different days', async () => {
    const { businessDay } = await import('../businessDay')
    // 00:07 Warsaw on 17.10 is 22:07 UTC on the 16th — the order the view loses.
    expect(businessDay('2026-10-16T22:07:00Z')).toBe('2026-10-17')

    const w = countOrdersInWindow(data(), '2026-10-17', '2026-10-17')!
    // 13 PP includes the 00:07 and 01:57 orders: drop them and it would be 11,
    // and the revenue would be 3 619 — which is what the UTC-day view reports.
    expect(w.orders).toBe(18)
    expect(w.revenue).toBe(3857)
    expect(w.revenue).not.toBe(3621)   // the view's figure
    expect(w.revenue).not.toBe(3619)
  })
})

// ── sync health ─────────────────────────────────────────────────────────────
describe('sync health — orders arriving faster than the sync drains them', () => {
  it('knows the measured ceiling: one row per run, every 15 minutes', async () => {
    const m = await import('../orderWindow')
    expect(m.SYNC_ROWS_PER_RUN).toBe(1)
    expect(m.SYNC_RUN_INTERVAL_MIN).toBe(15)
    expect(m.SYNC_ORDERS_PER_HOUR).toBe(4)
  })

  it('flags the 2026-10-17 burst: five orders inside one 15-minute window', async () => {
    const { assessSyncHealth } = await import('../orderWindow')
    const h = assessSyncHealth([
      '2026-10-17T18:19:01Z', '2026-10-17T18:19:42Z', '2026-10-17T18:20:10Z',
      '2026-10-17T18:20:55Z', '2026-10-17T18:21:30Z',
    ])
    expect(h.backlogWindows).toHaveLength(1)
    expect(h.worst!.arrived).toBe(5)
    expect(h.worst!.window).toBe('2026-10-17T18:15:00.000Z')
  })

  it('says plainly that the shortfall cannot be computed from Supabase alone', async () => {
    const { assessSyncHealth } = await import('../orderWindow')
    const h = assessSyncHealth(['2026-10-17T18:19:01Z', '2026-10-17T18:19:42Z'])
    expect(h.note).toContain('NIE DA SIĘ policzyć')
    expect(h.note).toContain('nie ma numeru zamówienia')
    // It must never state a number of lost rows it cannot know.
    expect(h.note).not.toMatch(/przepadło \d+/)
  })

  it('a quiet day raises nothing', async () => {
    const { assessSyncHealth } = await import('../orderWindow')
    const h = assessSyncHealth([
      '2026-10-17T08:00:00Z', '2026-10-17T09:30:00Z', '2026-10-17T14:05:00Z',
    ])
    expect(h.backlogWindows).toHaveLength(0)
    expect(h.worst).toBeNull()
    expect(h.note).toContain('Brak okien z zaległością')
  })

  it('ignores rubbish timestamps instead of bucketing them', async () => {
    const { assessSyncHealth } = await import('../orderWindow')
    expect(assessSyncHealth(['', 'not a date', '2026-10-17T18:19:01Z']).backlogWindows).toHaveLength(0)
  })
})
