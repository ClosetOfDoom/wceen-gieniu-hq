// Tests for the one order counter and the range parser.
//
// The bug: "how many orders between 9 and 15 October" answered 6 against a
// real 80. The dates were never parsed — "how many orders" matched the
// today-orders intent by substring and the rest of the sentence was discarded.
// So these tests are mostly about the range surviving the trip.

import { describe, it, expect } from 'vitest'
import { parseDateRange, countOrdersInWindow } from '../orderWindow'
import type { OrdersData } from '../ordersData'

const TODAY = '2026-10-15'

const day = (date: string, orders: number, revenue = orders * 119, missing = false) => ({
  date, orders, revenue, missing, hourly: new Array(24).fill(0),
})

function ordersData(over: Partial<OrdersData> = {}): OrdersData {
  return {
    ok: true, timestamp: '', today_warsaw: TODAY, week_start: '2026-10-12',
    source_table: 'orders',
    totals: { all_orders: 1500, latest_order_date: TODAY, today_orders: 6,
              today_revenue: 714, week_orders: 27, week_revenue: 3000 },
    classified: { jsu_course: { count: 0, revenue: 0 }, jzk_language: { count: 0, revenue: 0 },
                  memory_pack: { count: 0, revenue: 0 }, unknown: { count: 0 }, price_warnings: 0 },
    today_classified: { jsu_course: { count: 0, revenue: 0 }, jzk_language: { count: 0, revenue: 0 },
                        memory_pack: { count: 0, revenue: 0 }, unknown: { count: 0 } },
    latest_20_orders: [],
    dailySeries: [
      day('2026-10-09', 5), day('2026-10-10', 17), day('2026-10-11', 17),
      day('2026-10-12', 14), day('2026-10-13', 11), day('2026-10-14', 10),
    ],
    todayHourly: { date: TODAY, orders: 6, revenue: 714, hourly: new Array(24).fill(0) },
    ...over,
  }
}

// ── TEST 2 ──────────────────────────────────────────────────────────────────
describe('parseDateRange — both ends inclusive', () => {
  it('TEST 2: "between 9 and 15 October" is 2026-10-09 … 2026-10-15, seven days', () => {
    const r = parseDateRange('how many orders between 9 and 15 October', TODAY)
    expect(r).toEqual({ from: '2026-10-09', to: '2026-10-15' })
    const w = countOrdersInWindow(ordersData(), r!.from, r!.to)
    expect(w!.days).toHaveLength(7)      // not 5, not 6
    expect(w!.days[0]).toBe('2026-10-09')
    expect(w!.days[6]).toBe('2026-10-15')
  })

  it.each([
    ['ile zamówień między 9 a 15 października'],
    ['ile zamowien od 9 do 15 pazdziernika'],
    ['zamówienia 9-15 października'],
    ['orders from 9 to 15 October'],
    ['between 9 October and 15 October'],
    ['od 9 października do 15 października'],
    ['2026-10-09 to 2026-10-15'],
  ])('reads the same range out of %s', (q) => {
    expect(parseDateRange(q, TODAY)).toEqual({ from: '2026-10-09', to: '2026-10-15' })
  })

  it('puts the dates in order even when the question does not', () => {
    expect(parseDateRange('between 15 and 9 October', TODAY))
      .toEqual({ from: '2026-10-09', to: '2026-10-15' })
  })

  it('takes an explicit year when given one', () => {
    expect(parseDateRange('orders between 9 and 15 October 2025', TODAY))
      .toEqual({ from: '2025-10-09', to: '2025-10-15' })
  })

  it('never infers a future year', () => {
    // Asked in October 2026 about December, the most recent December is 2025.
    expect(parseDateRange('orders between 1 and 5 December', TODAY))
      .toEqual({ from: '2025-12-01', to: '2025-12-05' })
  })

  it('returns null when no range is named, so nothing else changes', () => {
    for (const q of [
      'how many orders today', 'ile zamówień dzisiaj', 'what is our ROAS',
      'how many orders', 'show me the week',
    ]) {
      expect(parseDateRange(q, TODAY)).toBeNull()
    }
  })

  it('rejects an impossible date rather than guessing', () => {
    expect(parseDateRange('between 30 and 31 February', TODAY)).toBeNull()
  })
})

// ── TEST 1 and 4 ────────────────────────────────────────────────────────────
describe('countOrdersInWindow', () => {
  it('TEST 1: counts every day in the range, inclusive, and totals 80', () => {
    const w = countOrdersInWindow(ordersData(), '2026-10-09', '2026-10-15')!
    expect(w.orders).toBe(5 + 17 + 17 + 14 + 11 + 10 + 6)
    expect(w.orders).toBe(80)
  })

  it('TEST 4: a range ending today is flagged as in progress, with the hour', () => {
    const w = countOrdersInWindow(ordersData(), '2026-10-09', TODAY)!
    expect(w.partialDay).not.toBeNull()
    expect(w.partialDay!.date).toBe(TODAY)
    expect(w.partialDay!.orders).toBe(6)
    expect(typeof w.partialDay!.hour).toBe('number')
  })

  it('a range of finished days carries no partial flag', () => {
    const w = countOrdersInWindow(ordersData(), '2026-10-09', '2026-10-14')!
    expect(w.partialDay).toBeNull()
    expect(w.orders).toBe(74)
  })

  it('never silently drops the unfinished day — it is in the total', () => {
    const full = countOrdersInWindow(ordersData(), '2026-10-09', '2026-10-14')!
    const withToday = countOrdersInWindow(ordersData(), '2026-10-09', TODAY)!
    expect(withToday.orders - full.orders).toBe(6)
  })

  it('names days the series has no rows for instead of calling them zero', () => {
    const data = ordersData({
      dailySeries: [day('2026-10-09', 5), day('2026-10-10', 0, 0, true), day('2026-10-11', 17)],
    })
    const w = countOrdersInWindow(data, '2026-10-09', '2026-10-11')!
    expect(w.missingDays).toEqual(['2026-10-10'])
  })

  it('names days the series does not reach rather than counting them as zero', () => {
    const w = countOrdersInWindow(ordersData(), '2026-10-05', '2026-10-10')!
    expect(w.outOfRangeDays).toEqual(['2026-10-05', '2026-10-06', '2026-10-07', '2026-10-08'])
    expect(w.orders).toBe(22)   // only the days it actually has
  })

  it('returns null rather than zero when there is no series at all', () => {
    expect(countOrdersInWindow(ordersData({ dailySeries: undefined }), '2026-10-09', TODAY)).toBeNull()
    expect(countOrdersInWindow(null, '2026-10-09', TODAY)).toBeNull()
  })
})

// ── TEST 3 ──────────────────────────────────────────────────────────────────
describe('TEST 3: the day boundary is the same everywhere', () => {
  it('an order at 22:30 Warsaw belongs to that Warsaw day in every path', async () => {
    const { businessDay } = await import('../businessDay')
    // 22:30 Warsaw on 2026-10-14 is 20:30 UTC — same calendar day either way.
    expect(businessDay('2026-10-14T20:30:00Z')).toBe('2026-10-14')
    // And the one that actually moves: 00:30 Warsaw is 22:30 UTC the day before.
    expect(businessDay('2026-10-14T22:30:00Z')).toBe('2026-10-15')

    // The counter buckets by the series' own dates, which orders-data builds
    // with that same helper — so a boundary order cannot land in two places.
    const data = ordersData({
      dailySeries: [day('2026-10-14', 10)],
      todayHourly: { date: '2026-10-15', orders: 1, revenue: 119, hourly: new Array(24).fill(0) },
    })
    const beforeBoundary = countOrdersInWindow(data, '2026-10-14', '2026-10-14')!
    const afterBoundary = countOrdersInWindow(data, '2026-10-15', '2026-10-15')!
    expect(beforeBoundary.orders).toBe(10)
    expect(afterBoundary.orders).toBe(1)
    // Counted once across the pair, never twice.
    expect(countOrdersInWindow(data, '2026-10-14', '2026-10-15')!.orders).toBe(11)
  })
})
