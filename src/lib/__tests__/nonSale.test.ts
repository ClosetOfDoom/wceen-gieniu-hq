// Rows that nobody bought, and the one rule that recognises all of them.
//
// Three things arrive in `orders` that are not sales, and each was mishandled
// in its own way before this existed:
//
//   · 0 PLN emptied carts were matched to Pakiet Pamięciowy ON THE NAME and
//     then charged 49 PLN of unit cost against zero revenue — two of them
//     were quietly removing 98 PLN from Est. Profit.
//   · 0 PLN "GRATIS:" lead magnets sat in UNMAPPED, asking somebody to go and
//     map a product that does not exist.
//   · 1 PLN manual grants vanished under the 5 PLN test-order floor and were
//     reported as "odcięte progiem", which says a sale nearly happened.
//
// The trap all three share: recognising them on the AMOUNT ALONE. A genuine
// sale at a token price would then disappear the same way, and nobody would
// see it go.

import { describe, it, expect } from 'vitest'
import {
  classifyAmount, nonSaleVerdict, NON_SALE, NON_SALE_LABELS,
  aggregateOrders, classifyOrder, PRODUCTS,
} from '../../../netlify/shared/productCatalog.js'

describe('0 PLN is never a sale, and never a cost', () => {
  it('an emptied cart is a cart, not a discounted Pakiet Pamięciowy', () => {
    const d = classifyAmount(0, 'Pamięć. Trening Interaktywny: Ebook + Druk', null)
    expect(d.bucket).toBe('NON_SALE')
    expect(d.nonSaleCategory).toBe('empty_cart')
    expect(d.productKey).toBeNull()
  })

  it('and it carries NO margin — not zero-as-earned, and certainly not −49', () => {
    const d = classifyAmount(0, 'Pamięć. Trening Interaktywny: Ebook + Druk', null)
    expect(d.margin).toBeNull()
    // The number that used to come out of here, so the regression is named:
    // 0 revenue − 49 unit cost. A cart that was emptied consumed no book.
    expect(d.margin).not.toBe(-49)
  })

  it('a GRATIS download is its own category, not an emptied cart', () => {
    const d = classifyAmount(0, 'GRATIS: Jak poprawić koncentrację + Co nas motywuje? (wartość: 50 zł)', null)
    expect(d.bucket).toBe('NON_SALE')
    expect(d.nonSaleCategory).toBe('lead_magnet')
  })

  it('neither of them is UNMAPPED — there is nothing for anyone to fix', () => {
    expect(classifyAmount(0, 'Pamięć. Trening Interaktywny', null).bucket).not.toBe('UNMAPPED')
    expect(classifyAmount(0, 'GRATIS: cokolwiek', null).bucket).not.toBe('UNMAPPED')
  })

  it('0 PLN beats the grant rules, because a grant is recorded at 1 PLN', () => {
    // 0 is also ≤ 5, so order of checks is what keeps these apart.
    expect(classifyAmount(0, 'Jak się uczyć', 'Offline').nonSaleCategory).toBe('empty_cart')
    expect(classifyAmount(1, 'Jak się uczyć', 'Offline').nonSaleCategory).toBe('admin_access')
  })
})

describe('manual grants need two conditions, never the amount alone', () => {
  it('1 PLN + Offline is a grant', () => {
    const d = classifyAmount(1, 'Jak się uczyć', 'Offline')
    expect(d.nonSaleCategory).toBe('admin_access')
    expect(d.matchedBy).toContain('operator Offline')
  })

  it('1 PLN + Przelewy24 is UNMAPPED, and says why', () => {
    const d = classifyAmount(1, 'Jak się uczyć', 'Przelewy24')
    expect(d.bucket).toBe('UNMAPPED')
    expect(d.failedField).toContain('Przelewy24')
  })

  it('119 PLN + Offline is UNMAPPED, not a grant', () => {
    const d = classifyAmount(119, 'Pamięć. Trening Interaktywny: Ebook + Druk', 'Offline')
    expect(d.bucket).toBe('UNMAPPED')
    expect(d.failedField).toContain('przekracza')
  })

  it('the grant name is matched exactly, so the real course is safe', () => {
    expect(nonSaleVerdict(1, 'Kurs online "Jak się uczyć"', null).category).toBeNull()
    expect(nonSaleVerdict(1, 'Jak się uczyć', null).category).toBe('admin_access')
  })

  it('while the operator column is missing, null means unknown — not "not Offline"', () => {
    expect(classifyAmount(1, 'Jak się uczyć', null).nonSaleCategory).toBe('admin_access')
    expect(classifyAmount(1, 'Jak się uczyć', '   ').nonSaleCategory).toBe('admin_access')
    // Once it IS known, it decides and the stand-in steps back.
    expect(classifyAmount(1, 'Jak się uczyć', 'Stripe').bucket).toBe('UNMAPPED')
  })

  it('the threshold is the catalog constant, not a number typed twice', () => {
    expect(NON_SALE.adminMaxAmount).toBe(5)
    expect(nonSaleVerdict(5, 'Jak się uczyć', 'Offline').category).toBe('admin_access')
    expect(nonSaleVerdict(5.01, 'Jak się uczyć', 'Offline').category).toBeNull()
  })
})

describe('THE INVARIANT — nothing is both unexplained and costing money', () => {
  // A row in UNMAPPED is a row nobody has classified. If such a row also
  // moved the margin, Est. Profit would be shifted by something the dashboard
  // openly admits it does not understand. That must be impossible, not
  // merely absent today.
  const sample: Array<[number, string, string | null]> = [
    [0, 'Pamięć. Trening Interaktywny: Ebook + Druk', null],
    [0, 'GRATIS: Szkolenie online', null],
    [0, '', null],
    [1, 'Jak się uczyć', 'Offline'],
    [1, 'Jak się uczyć', 'Przelewy24'],
    [1, 'zupełnie nieznany produkt', null],
    [45, 'Jak zapamiętywać głosy ptaków', null],
    [119, 'Pamięć. Trening Interaktywny: Ebook + Druk', null],
    [119, 'Pamięć. Trening Interaktywny: Ebook + Druk', 'Offline'],
    [137, 'Zestaw niespodzianka', null],
    [499, 'Perfect Student Online', null],
    [499, 'zupełnie nieznany produkt', null],
    [549, 'Kurs online "Jak się uczyć"', null],
    [3450, 'Wakacyjna Szkoła Treningu Pamięci', null],
  ]

  it.each(sample)('%i PLN %s: UNMAPPED implies no margin', (amount, name, provider) => {
    const d = classifyAmount(amount, name, provider)
    if (d.bucket === 'UNMAPPED') {
      expect(d.margin, `${name} is UNMAPPED but carries a margin`).toBeNull()
      expect(d.productKey).toBeNull()
    }
  })

  it('and NON_SALE never carries one either, in either direction', () => {
    for (const [amount, name, provider] of sample) {
      const d = classifyAmount(amount, name, provider)
      if (d.bucket === 'NON_SALE') {
        expect(d.margin, `${name} is a non-sale but carries a margin`).toBeNull()
      }
    }
  })

  it('a margin exists only where a product was actually identified', () => {
    for (const [amount, name, provider] of sample) {
      const d = classifyAmount(amount, name, provider)
      if (d.margin != null) {
        expect(d.productKey, `margin with no product for "${name}"`).not.toBeNull()
        expect(PRODUCTS[d.productKey!]).toBeDefined()
      }
    }
  })
})

describe('one count, carried to the card, the report and Q&A', () => {
  it('the labels live in the catalog, not in three components', () => {
    expect(NON_SALE_LABELS.empty_cart).toBe('Koszyki 0 zł')
    expect(NON_SALE_LABELS.lead_magnet).toBe('Lead magnety')
    expect(NON_SALE_LABELS.admin_access).toBe('Dostęp administracyjny')
  })

  it('countOrdersInWindow sums the per-day categories', async () => {
    const { countOrdersInWindow } = await import('../orderWindow')
    const day = (date: string, orders: number, nonSale: Record<string, number>) => ({
      date, orders, revenue: orders * 119, missing: false,
      hourly: new Array(24).fill(0),
      products: { memory_pack: { orders, revenue: orders * 119 } },
      unmappedNames: [], belowFloor: { orders: 0, revenue: 0 }, nonSale,
    })
    const w = countOrdersInWindow(
      { ok: true, dailySeries: [
        day('2026-10-16', 9, { empty_cart: 1 }),
        day('2026-10-17', 18, { admin_access: 2, empty_cart: 1 }),
      ] } as never,
      '2026-10-16', '2026-10-17',
    )
    expect(w?.orders).toBe(27)
    expect(w?.nonSale).toEqual({ empty_cart: 2, admin_access: 2 })
    // Non-sales carry no money, so the window's revenue must not move.
    expect(w?.revenue).toBe(27 * 119)
  })

  it('a day with none reports an empty map, not undefined', async () => {
    const { countOrdersInWindow } = await import('../orderWindow')
    const w = countOrdersInWindow(
      { ok: true, dailySeries: [{
        date: '2026-10-16', orders: 9, revenue: 1071, missing: false,
        hourly: new Array(24).fill(0), products: {}, unmappedNames: [],
        belowFloor: { orders: 0, revenue: 0 },
      }] } as never,
      '2026-10-16', '2026-10-16',
    )
    expect(w?.nonSale).toEqual({})
  })

  it('the row carries the operator through aggregation', () => {
    const [order] = aggregateOrders([{
      external_order_id: 'abc', order_created_at: '2026-10-17T18:19:01Z',
      amount: 1, product_name_raw: 'Jak się uczyć', payment_provider: 'Offline',
      source: 'wix', payment_status: 'paid',
    }])
    expect(order.paymentProvider).toBe('Offline')
    expect(classifyOrder(order).nonSaleCategory).toBe('admin_access')
  })
})
