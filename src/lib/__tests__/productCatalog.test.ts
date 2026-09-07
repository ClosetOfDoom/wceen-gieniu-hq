// Tests for netlify/shared/productCatalog.js — the ONE module that defines
// prices, margins, scope and classification. The file under test is plain ESM
// JS shared with the Netlify functions; it is imported directly so the tests
// exercise exactly the code that runs in production, not a copy. Its typed
// contract is netlify/shared/productCatalog.d.ts.
import {
  PRODUCTS,
  PRICE_TO_PRODUCT,
  unitCostOf,
  isExcludedFromBlended,
  isCountableOrder,
  isShippingLine,
  nameMatchKey,
  classifyAmount,
  aggregateOrders,
  classifyOrder,
} from '../../../netlify/shared/productCatalog.js'
import type { ProductKey } from '../../../netlify/shared/productCatalog.js'
import { describe, it, expect } from 'vitest'

// The authoritative catalog, restated here so a silent edit to a margin fails a
// test instead of quietly moving Est. Profit.
const AUTHORITATIVE: Array<[number, ProductKey, string, number | null]> = [
  [119,  'memory_pack',     'memory',   70],
  [114,  'language_3t',     'language', 55],
  [95,   'jezykozak_pack',  'language', 88],
  [347,  'jzk_ai',          'language', 320],
  [549,  'jsu_course',      'memory',   500],
  [399,  'cogni_promo',     'cogni',    355],
  [499,  'cogni_regular',   'cogni',    450],
  // WSZTP's margin is genuinely unknown — and it is ALSO excluded from every
  // blended figure, which is a separate decision (see the EXCLUDED block).
  [1250, 'wsztp',           'memory',   null],
  [3450, 'wsztp',           'memory',   null],
]

describe('catalog', () => {
  it.each(AUTHORITATIVE)('%i PLN → %s, scope %s, margin %s', (price, key, scope, margin) => {
    expect(PRICE_TO_PRODUCT[price]).toBe(key)
    expect(PRODUCTS[key].scope).toBe(scope)
    expect(PRODUCTS[key].contributionMargin).toBe(margin)
  })

  it('derives unit cost from the authoritative margin, and only when it exists', () => {
    expect(unitCostOf('memory_pack')).toBe(49)      // 119 − 70
    expect(unitCostOf('language_3t')).toBe(59)      // 114 − 55
    expect(unitCostOf('jezykozak_pack')).toBe(7)    // 95 − 88
    expect(unitCostOf('jzk_ai')).toBe(27)           // 347 − 320
    expect(unitCostOf('jsu_course')).toBe(49)       // 549 − 500
    expect(unitCostOf('cogni_promo')).toBe(44)      // 399 − 355
    expect(unitCostOf('cogni_regular')).toBe(49)    // 499 − 450
    expect(unitCostOf('wsztp')).toBeNull()          // margin unknown -> no cost
  })

  it('never invents a margin for a product whose margin is unknown', () => {
    expect(PRODUCTS.wsztp.contributionMargin).toBeNull()
  })

  it('Cogni is two entries because two prices carry two different margins', () => {
    // One entry cannot hold two margins without deriving - i.e. inventing - one.
    expect(PRODUCTS.cogni_promo.catalogPrice).toBe(399)
    expect(PRODUCTS.cogni_regular.catalogPrice).toBe(499)
    expect(PRODUCTS.cogni_promo.contributionMargin).toBe(355)
    expect(PRODUCTS.cogni_regular.contributionMargin).toBe(450)
  })

  it('WSZTP is the only product excluded from the blended figures', () => {
    const excluded = (Object.keys(PRODUCTS) as ProductKey[]).filter(isExcludedFromBlended)
    expect(excluded).toEqual(['wsztp'])
  })
})

describe('shipping line', () => {
  it('recognises the Wix shipping line', () => {
    expect(isShippingLine('Wysyłka + Ubezpieczenie + Paczka')).toBe(true)
    expect(isShippingLine('wysylka')).toBe(true)
    expect(isShippingLine('Dostawa kurierem')).toBe(true)
  })

  it('does not treat a product as shipping', () => {
    expect(isShippingLine('Pamięć. Trening Interaktywny: Ebook + Druk')).toBe(false)
    expect(isShippingLine('Językozak AI')).toBe(false)
    expect(isShippingLine('')).toBe(false)
    expect(isShippingLine(null)).toBe(false)
  })
})

describe('classifyAmount — price beats name', () => {
  it('119 PLN → Pakiet Pamięciowy, margin 70', () => {
    const d = classifyAmount(119, 'Pamięć. Trening Interaktywny: Ebook + Druk')
    expect(d).toMatchObject({ productKey: 'memory_pack', scope: 'memory', bucket: 'MAPPED', qty: 1, margin: 70 })
  })

  it('347 PLN → Językozak AI, margin 320', () => {
    const d = classifyAmount(347, 'Językozak AI — dostęp roczny')
    expect(d).toMatchObject({ productKey: 'jzk_ai', scope: 'language', bucket: 'MAPPED', margin: 320 })
  })

  it('549 PLN → kurs JSU, margin 500', () => {
    expect(classifyAmount(549, 'Kurs online "Jak się uczyć"')).toMatchObject({
      productKey: 'jsu_course', bucket: 'MAPPED', margin: 500,
    })
  })

  it('114 PLN → pakiet językowy 3T, margin 55', () => {
    expect(classifyAmount(114, '3 Zadziwiające Techniki Nauki Języków')).toMatchObject({
      productKey: 'language_3t', scope: 'language', bucket: 'MAPPED', margin: 55,
    })
  })

  it('a discounted PP at 99 PLN earns 50, not the full 70', () => {
    // 99 = PP sold without the 20 PLN shipping line. Margin = 99 − unit cost 49.
    expect(classifyAmount(99, 'Pamięć. Trening Interaktywny')).toMatchObject({
      productKey: 'memory_pack', bucket: 'MAPPED', margin: 50,
    })
  })

  it('records a conflict when the name disagrees with the price, and maps by price', () => {
    const d = classifyAmount(119, 'Językozak AI')
    expect(d.productKey).toBe('memory_pack')
    expect(d.conflict).toMatchObject({ priceProduct: 'memory_pack', nameProduct: 'jzk_ai' })
  })
})

describe('classifyAmount — EXCLUDED is not UNMAPPED', () => {
  it.each([1250, 3450])('WSZTP at %i PLN is EXCLUDED, named, with no margin', (amount) => {
    const d = classifyAmount(amount, 'WSZTP 2026')
    expect(d.productKey).toBe('wsztp')
    expect(d.bucket).toBe('EXCLUDED')
    expect(d.margin).toBeNull()
    // Nothing is missing from the catalog, so there is no field to go and fix.
    expect(d.failedField).toBeNull()
    expect(d.excludedReason).toContain('ad funnel')
  })

  it('a WSZTP order contributes nothing to margin and nothing to blended revenue', () => {
    const orders = aggregateOrders([
      { external_order_id: 'W1', order_created_at: '2026-09-07T09:00:00Z', amount: 3450, product_name_raw: 'WSZTP 2026 — całość' },
      { external_order_id: 'W2', order_created_at: '2026-09-07T10:00:00Z', amount: 119,  product_name_raw: 'Pamięć. Trening Interaktywny' },
    ])
    const decisions = orders.map(classifyOrder)
    const margin    = decisions.reduce((s, d) => s + (d.margin ?? 0), 0)
    const excluded  = decisions.filter(d => d.bucket === 'EXCLUDED')
    const blendedRevenue = orders
      .filter((_, i) => decisions[i].bucket !== 'EXCLUDED')
      .reduce((s, o) => s + o.revenue, 0)

    expect(margin).toBe(70)                 // only the PP earns
    expect(excluded).toHaveLength(1)
    expect(blendedRevenue).toBe(119)        // ROAS never sees the 3450
    // …and it is NOT reported as a gap that needs a catalog entry.
    expect(decisions.filter(d => d.bucket === 'UNMAPPED')).toHaveLength(0)
    expect(decisions.filter(d => d.bucket === 'UNKNOWN_MARGIN')).toHaveLength(0)
  })

  it('a WSZTP name never inherits the PP margin via the broad pamiec pattern', () => {
    expect(nameMatchKey('Wakacyjna Szkoła Treningu Pamięci')).toBe('wsztp')
    expect(classifyAmount(2000, 'Wakacyjna Szkoła Treningu Pamięci').bucket).toBe('EXCLUDED')
  })

  it('95 PLN Pakiet Językozaka is mapped with margin 88', () => {
    expect(classifyAmount(95, 'Pakiet Językozaka')).toMatchObject({
      productKey: 'jezykozak_pack', scope: 'language', bucket: 'MAPPED', margin: 88,
    })
  })

  it.each([[399, 'cogni_promo', 355], [499, 'cogni_regular', 450]] as const)(
    'Cogni at %i PLN maps to %s with margin %i',
    (amount, key, margin) => {
      expect(classifyAmount(amount, 'Cogni — dostęp roczny')).toMatchObject({
        productKey: key, scope: 'cogni', bucket: 'MAPPED', margin,
      })
    })

  it('an unknown amount with no name match is UNMAPPED, never PP', () => {
    const d = classifyAmount(137, 'Zestaw niespodzianka')
    expect(d.bucket).toBe('UNMAPPED')
    expect(d.productKey).toBeNull()
    expect(d.margin).toBeNull()
    expect(d.failedField).toContain('137 PLN not in PRICE_TO_PRODUCT')
    expect(d.failedField).toContain('product_name_raw')
  })

  it('an unknown amount with no name at all is UNMAPPED and says the name was empty', () => {
    const d = classifyAmount(0, null)
    expect(d.bucket).toBe('UNMAPPED')
    expect(d.failedField).toContain('empty')
  })

  it('a PP bundle listing Jak sie uczyc as a bonus stays PP', () => {
    expect(classifyAmount(119, 'Pakiet Pamięciowy + bonus Jak się uczyć').productKey).toBe('memory_pack')
  })
})

// The daily view counts orders WHERE source='wix' AND payment_status='paid' AND
// the id/email are not test rows. profit-data must apply the same predicate or
// its order count can never match the Wix card beside it.
describe('isCountableOrder — the same predicate as the daily view', () => {
  const paid = { source: 'wix', payment_status: 'PAID', external_order_id: 'abc', email: 'x@gmail.com' }

  it('counts a paid wix order', () => {
    expect(isCountableOrder(paid)).toBe(true)
  })
  it('drops a non-wix source', () => {
    expect(isCountableOrder({ ...paid, source: 'stripe' })).toBe(false)
  })
  it('drops an unpaid order', () => {
    expect(isCountableOrder({ ...paid, payment_status: 'pending' })).toBe(false)
  })
  it('drops a TEST- order id and a test e-mail', () => {
    expect(isCountableOrder({ ...paid, external_order_id: 'TEST-123' })).toBe(false)
    expect(isCountableOrder({ ...paid, email: 'filip+test@gmail.com' })).toBe(false)
  })
  it('cannot judge a column the row does not have, so it keeps the row', () => {
    // The `wix_orders` fallback table has a different shape — a row without
    // payment_status is not evidence that it is unpaid.
    expect(isCountableOrder({ external_order_id: 'abc', amount: 119 })).toBe(true)
  })
})

describe('aggregateOrders — classification runs on the whole order', () => {
  it('99 PLN product + 20 PLN shipping in one order → one PP at 119, margin 70', () => {
    const rows = [
      { external_order_id: 'A1', order_created_at: '2026-09-07T09:00:00Z', amount: 99,
        product_name_raw: 'Pamięć. Trening Interaktywny: Ebook + Druk' },
      { external_order_id: 'A1', order_created_at: '2026-09-07T09:00:00Z', amount: 20,
        product_name_raw: 'Wysyłka + Ubezpieczenie + Paczka' },
    ]
    const orders = aggregateOrders(rows)
    expect(orders).toHaveLength(1)
    expect(orders[0]).toMatchObject({ revenue: 119, productAmount: 99, shippingAmount: 20, lineCount: 2 })
    // The shipping line is out of the classification, so the product amount is 99
    // → PP at a discount. The 20 PLN is still in revenue but earns nothing.
    const d = classifyOrder(orders[0])
    expect(d.productKey).toBe('memory_pack')
    expect(d.bucket).toBe('MAPPED')
  })

  it('one row per order (the shape the orders table actually has) is left alone', () => {
    const rows = [
      { external_order_id: 'B1', order_created_at: '2026-09-07T09:00:00Z', amount: 119, product_name_raw: 'Pamięć. Trening Interaktywny: Ebook + Druk' },
      { external_order_id: 'B2', order_created_at: '2026-09-07T10:00:00Z', amount: 119, product_name_raw: 'Pamięć. Trening Interaktywny: Ebook + Druk' },
    ]
    const orders = aggregateOrders(rows)
    expect(orders).toHaveLength(2)
    expect(orders.map(o => o.revenue)).toEqual([119, 119])
    for (const o of orders) {
      expect(classifyOrder(o)).toMatchObject({ productKey: 'memory_pack', margin: 70 })
    }
  })

  it('an order whose only line looks like shipping is kept, not deleted', () => {
    const orders = aggregateOrders([
      { external_order_id: 'C1', order_created_at: '2026-09-07T09:00:00Z', amount: 20, product_name_raw: 'Wysyłka + Ubezpieczenie + Paczka' },
    ])
    expect(orders).toHaveLength(1)
    expect(orders[0].revenue).toBe(20)
    expect(classifyOrder(orders[0]).bucket).toBe('UNMAPPED')
  })

  it('rows with no order id are never merged into one order', () => {
    const orders = aggregateOrders([
      { amount: 119, product_name_raw: 'Pamięć. Trening Interaktywny' },
      { amount: 119, product_name_raw: 'Pamięć. Trening Interaktywny' },
    ])
    expect(orders).toHaveLength(2)
  })
})

describe('profit arithmetic over a whole day', () => {
  it('ten PP orders at 119 → margin 700; profit against 311.11 ad spend is +388.89', () => {
    const rows = Array.from({ length: 10 }, (_, i) => ({
      external_order_id: `D${i}`,
      order_created_at: '2026-09-07T09:00:00Z',
      amount: 119,
      product_name_raw: 'Pamięć. Trening Interaktywny: Ebook + Druk',
    }))
    const orders = aggregateOrders(rows)
    const decisions = orders.map(classifyOrder)

    expect(orders).toHaveLength(10)
    expect(orders.reduce((s, o) => s + o.revenue, 0)).toBe(1190)
    expect(decisions.filter(d => d.productKey === 'memory_pack')).toHaveLength(10)

    const margin = decisions.reduce((s, d) => s + (d.margin ?? 0), 0)
    expect(margin).toBe(700)
    expect(Number((margin - 311.11).toFixed(2))).toBe(388.89)
  })

  it('an unmapped order lowers nothing and hides nothing', () => {
    const orders = aggregateOrders([
      { external_order_id: 'E1', order_created_at: '2026-09-07T09:00:00Z', amount: 119, product_name_raw: 'Pamięć. Trening Interaktywny' },
      { external_order_id: 'E2', order_created_at: '2026-09-07T10:00:00Z', amount: 137, product_name_raw: 'Zestaw niespodzianka' },
    ])
    const decisions = orders.map(classifyOrder)
    const margin = decisions.reduce((s, d) => s + (d.margin ?? 0), 0)
    const noMargin = decisions.filter(d => d.margin == null)

    expect(margin).toBe(70)                  // the unmapped order contributes nothing
    expect(noMargin).toHaveLength(1)          // and is counted, not swallowed
    expect(noMargin[0].failedField).toBeTruthy()
  })
})
