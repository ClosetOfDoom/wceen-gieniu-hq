// Tests for netlify/functions/productCatalog.js — the ONE module that defines
// prices, margins, scope and classification. The file under test is plain ESM
// JS shared with the Netlify functions; it is imported directly so the tests
// exercise exactly the code that runs in production, not a copy. Its typed
// contract is netlify/functions/productCatalog.d.ts.
import {
  PRODUCTS,
  PRICE_TO_PRODUCT,
  unitCostOf,
  isShippingLine,
  nameMatchKey,
  classifyAmount,
  aggregateOrders,
  classifyOrder,
} from '../../../netlify/functions/productCatalog.js'
import type { ProductKey } from '../../../netlify/functions/productCatalog.js'
import { describe, it, expect } from 'vitest'

// The authoritative catalog, restated here so a silent edit to a margin fails a
// test instead of quietly moving Est. Profit.
const AUTHORITATIVE: Array<[number, ProductKey, string, number | null]> = [
  [119,  'memory_pack',     'memory',   70],
  [114,  'language_3t',     'language', 55],
  [95,   'jezykozak_pack',  'language', null],
  [347,  'jzk_ai',          'language', 320],
  [549,  'jsu_course',      'memory',   500],
  [499,  'cogni_year',      'cogni',    null],
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
    expect(unitCostOf('memory_pack')).toBe(49)   // 119 − 70
    expect(unitCostOf('language_3t')).toBe(59)   // 114 − 55
    expect(unitCostOf('jzk_ai')).toBe(27)        // 347 − 320
    expect(unitCostOf('jsu_course')).toBe(49)    // 549 − 500
    expect(unitCostOf('wsztp')).toBeNull()
    expect(unitCostOf('cogni_year')).toBeNull()
  })

  it('never invents a margin for a product the catalog does not price', () => {
    for (const key of ['jezykozak_pack', 'cogni_year', 'wsztp'] as ProductKey[]) {
      expect(PRODUCTS[key].contributionMargin).toBeNull()
    }
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

describe('classifyAmount — margin-less and unmapped', () => {
  it('95 PLN Pakiet Językozaka is named but earns no margin', () => {
    const d = classifyAmount(95, 'Pakiet Językozaka')
    expect(d).toMatchObject({ productKey: 'jezykozak_pack', scope: 'language', bucket: 'UNKNOWN_MARGIN', margin: null })
    expect(d.failedField).toContain('contributionMargin')
  })

  it.each([1250, 3450])('WSZTP at %i PLN is named but earns no margin', (amount) => {
    expect(classifyAmount(amount, 'WSZTP 2026')).toMatchObject({
      productKey: 'wsztp', bucket: 'UNKNOWN_MARGIN', margin: null,
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

  it('a WSZTP name never inherits the PP margin via the broad "pamiec" pattern', () => {
    expect(nameMatchKey('Wakacyjna Szkoła Treningu Pamięci')).toBe('wsztp')
    expect(classifyAmount(2000, 'Wakacyjna Szkoła Treningu Pamięci').bucket).toBe('UNKNOWN_MARGIN')
  })

  it('a PP bundle listing "Jak się uczyć" as a bonus stays PP', () => {
    expect(classifyAmount(119, 'Pakiet Pamięciowy + bonus Jak się uczyć').productKey).toBe('memory_pack')
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
