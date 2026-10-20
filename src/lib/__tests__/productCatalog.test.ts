// Tests for netlify/shared/productCatalog.js — the ONE module that defines
// prices, margins, scope and classification. The file under test is plain ESM
// JS shared with the Netlify functions; it is imported directly so the tests
// exercise exactly the code that runs in production, not a copy.
//
// THE PRICE DOES NOT CLASSIFY ANYTHING. That is what most of this file is
// about. There used to be a price→product map, and every bug it caused was
// the same bug wearing a different product: 499 PLN meant Cogni, so every
// Perfect Student Online sale was reported as Cogni with a 450 PLN margin it
// never earned. The catalog now holds eight products at 50 PLN, three at 95,
// two at 499 and two at 60. A price is not evidence of anything.

import { describe, it, expect } from 'vitest'
import {
  PRODUCTS,
  normalizeText,
  isShippingLine,
  nameMatch,
  nameMatchKey,
  classifyAmount,
  assertCatalogIsComplete,
  assertNoPriceOnlyProducts,
  unitCostOf,
  isExcludedFromBlended,
  isCountableOrder,
  aggregateOrders,
  classifyOrder,
} from '../../../netlify/shared/productCatalog.js'
import type { ProductKey } from '../../../netlify/shared/productCatalog.js'

// The margins that were established before this catalog grew, restated here so
// a silent edit fails a test instead of quietly moving Est. Profit.
const ESTABLISHED: Array<[ProductKey, string, number]> = [
  ['memory_pack',    'memory',   70],
  ['language_3t',    'language', 55],
  ['jezykozak_pack', 'language', 88],
  ['jzk_ai',         'language', 320],
  ['jsu_course',     'memory',   500],
]

describe('catalog', () => {
  it.each(ESTABLISHED)('%s keeps its measured margin', (key, scope, margin) => {
    expect(PRODUCTS[key].scope).toBe(scope)
    expect(PRODUCTS[key].contributionMargin).toBe(margin)
  })

  it('derives unit cost only where a margin exists', () => {
    expect(unitCostOf('memory_pack')).toBe(49)      // 119 − 70
    expect(unitCostOf('jsu_course')).toBe(49)       // 549 − 500
    expect(unitCostOf('pso')).toBeNull()
    expect(unitCostOf('wsztp')).toBeNull()
    expect(unitCostOf('book_ptaki')).toBeNull()
  })

  it('WSZTP is the only product excluded from the blended figures', () => {
    const excluded = (Object.keys(PRODUCTS) as ProductKey[]).filter(isExcludedFromBlended)
    expect(excluded).toEqual(['wsztp'])
  })

  // Cogni is sold through Stripe and only Stripe. No `orders` row can be one,
  // so an entry for it could only mislabel something else — and did.
  it('Cogni is not in the catalog, in any form', () => {
    expect(Object.keys(PRODUCTS).filter(k => /cogni/i.test(k))).toEqual([])
    expect(Object.values(PRODUCTS).filter(p => /cogni/i.test(p.displayName))).toEqual([])
    expect(Object.values(PRODUCTS).filter(p => p.scope === ('cogni' as never))).toEqual([])
  })

  it('every entry states its margin or names the gap', () => {
    for (const [key, p] of Object.entries(PRODUCTS)) {
      if (typeof p.contributionMargin === 'number') {
        expect(p.marginUnknown, `${key}: margin AND marginUnknown`).toBeFalsy()
        continue
      }
      expect(p.marginUnknown, `${key}: null margin, no marginUnknown`).toBe(true)
      expect(p.marginUnknownReason, `${key}: marginUnknown, no reason`).toBeTruthy()
    }
    expect(() => assertCatalogIsComplete()).not.toThrow()
  })
})

describe('no product can be told apart by price alone', () => {
  it('there is no price→product map left to consult', async () => {
    const mod = await import('../../../netlify/shared/productCatalog.js')
    expect('PRICE_TO_PRODUCTS' in mod).toBe(false)
    expect('soleProductAtPrice' in mod).toBe(false)
  })

  it('and the catalog proves it at load time', () => {
    expect(() => assertNoPriceOnlyProducts()).not.toThrow()
  })

  // The property that makes the above meaningful: prices are shared freely,
  // so a price could not identify a product even if something wanted it to.
  it('prices really are shared — 50 PLN alone names eight different products', () => {
    const at50 = Object.values(PRODUCTS).filter(p => p.catalogPrice === 50)
    expect(at50.length).toBeGreaterThanOrEqual(8)
    const at499 = Object.values(PRODUCTS).filter(p => p.catalogPrice === 499)
    expect(at499.length).toBe(2)
  })

  it('the same name classifies identically whatever it sold for', () => {
    // If the amount were involved anywhere, these would not agree.
    const name = 'Perfect Student Online'
    for (const amount of [499, 449, 1, 10_000]) {
      if (amount <= 5) continue   // ≤5 is the non-sale question, tested elsewhere
      expect(classifyAmount(amount, name, null).productKey).toBe('pso')
    }
  })

  it('an unknown name is UNMAPPED at any price, and says the price did not count', () => {
    for (const amount of [50, 95, 499, 137]) {
      const d = classifyAmount(amount, 'zupełnie nieznany produkt', null)
      expect(d.bucket).toBe('UNMAPPED')
      expect(d.productKey).toBeNull()
      expect(d.failedField).toContain('cena nie klasyfikuje')
    }
  })
})

describe('name matching', () => {
  it('flattens case, accents, dash width, brackets and doubled spaces', () => {
    const want = 'historie ktore zostaja'
    for (const variant of [
      'Historie, które zostają',
      'HISTORIE, KTÓRE ZOSTAJĄ',
      'Historie,   które   zostają',
      'Historie — które — zostają',
      '(Historie, które zostają)',
    ]) {
      expect(normalizeText(variant)).toContain(want)
      expect(nameMatchKey(variant)).toBe('book_historie')
    }
  })

  it('folds ł to l rather than to a space', () => {
    // NFD does not decompose ł, so the catch-all used to turn it into a space:
    // "głosy" became "g osy" and the pattern silently matched nothing.
    expect(normalizeText('Jak zapamiętywać głosy ptaków')).toBe('jak zapamietywac glosy ptakow')
    expect(normalizeText('Słowoszyt (PDF)')).toBe('slowoszyt pdf')
    expect(normalizeText('Wakacyjna Szkoła Treningu Pamięci')).toBe('wakacyjna szkola treningu pamieci')
  })

  it('survives a truncated name', () => {
    expect(nameMatchKey('Opowieść o skaczącej myszy - zbiór opowiadań dla')).toBe('book_mysz')
    expect(nameMatchKey('Opowieść o skaczącej myszy')).toBe('book_mysz')
  })

  // The variant trap: a shorter name is a substring of the longer one, so
  // plain substring matching reads every PDF sale as the print edition.
  it.each([
    ['Jak się uczyć',                                'jsu_book'],
    ['Jak się uczyć (PDF)',                          'jsu_pdf'],
    ['Pamięć. Trening interaktywny',                 'memory_training'],
    ['Pamięć. Trening interaktywny (PDF)',           'memory_training_pdf'],
    ['3 zadziwiające techniki nauki języków',        'lang_3t_single'],
    ['3 Zadziwiające Techniki Nauki Języków (PDF)',  'lang_3t_pdf'],
  ])('%s is its own product, not its sibling', (name, key) => {
    expect(nameMatchKey(name)).toBe(key)
  })

  it('longest match wins, and says which pattern won', () => {
    const m = nameMatch('Jak się uczyć (PDF)')
    expect(m.key).toBe('jsu_pdf')
    expect(m.pattern).toBe('jak sie uczyc pdf')
  })

  it('the long landing names beat the short shop listings', () => {
    // "Pamięć. Trening Interaktywny: Ebook + Druk" (119, margin 70) must not
    // be read as the shop's bare "Pamięć. Trening interaktywny" (95).
    expect(nameMatchKey('Pamięć. Trening Interaktywny: Ebook + Druk (Wartość: 158 zł)'))
      .toBe('memory_pack')
    expect(nameMatchKey('3 Zadziwiające Techniki Nauki Języków - Pakiet Językowy'))
      .toBe('language_3t')
  })

  it('a bonus mentioned inside a bundle name does not hijack the bundle', () => {
    expect(nameMatchKey('Pakiet Pamięciowy – Pamięć + bonusy (14 audycji + Jak się uczyć + 7 warunków)'))
      .toBe('memory_pack')
    expect(nameMatchKey('Kurs online "Jak się uczyć" (11 modułów, 5h+ nagrań)'))
      .toBe('jsu_course')
  })

  it('still recognises the Wix shipping line', () => {
    expect(isShippingLine('Wysyłka + Ubezpieczenie + Paczka')).toBe(true)
    expect(isShippingLine('Pakiet Pamięciowy')).toBe(false)
  })
})

describe('classification outcomes', () => {
  it('a product with a known margin earns it at the catalog price', () => {
    expect(classifyAmount(119, 'Pamięć. Trening Interaktywny: Ebook + Druk', null)).toMatchObject({
      productKey: 'memory_pack', bucket: 'MAPPED', margin: 70,
    })
  })

  it('sold below the catalog price it earns amount − unit cost, never the full margin', () => {
    const d = classifyAmount(99, 'Pamięć. Trening Interaktywny: Ebook + Druk', null)
    expect(d.bucket).toBe('MAPPED')
    expect(d.margin).toBe(50)   // 99 − 49
  })

  it('a known product with no known margin is UNKNOWN_MARGIN with a named gap', () => {
    const d = classifyAmount(499, 'Perfect Student Online', null)
    expect(d.bucket).toBe('UNKNOWN_MARGIN')
    expect(d.margin).toBeNull()
    expect(d.failedField).toBe('marża PSO nieznana — brak w briefingu')
  })

  it('a new shop product reports its own gap, not a generic one', () => {
    const d = classifyAmount(50, 'Jak zapamiętywać głosy ptaków', null)
    expect(d.productKey).toBe('book_ptaki')
    expect(d.bucket).toBe('UNKNOWN_MARGIN')
    expect(d.failedField).toContain('czeka na dane od właściciela')
  })

  it('WSZTP is excluded, which is not the same as unmapped', () => {
    const d = classifyAmount(3450, 'Wakacyjna Szkoła Treningu Pamięci', null)
    expect(d.bucket).toBe('EXCLUDED')
    expect(d.margin).toBeNull()
  })

  it('an order with no name at all is UNMAPPED', () => {
    expect(classifyAmount(137, '', null).bucket).toBe('UNMAPPED')
    expect(classifyAmount(137, null, null).bucket).toBe('UNMAPPED')
  })
})

describe('aggregation', () => {
  it('drops the shipping line from classification but keeps its money', () => {
    const [order] = aggregateOrders([
      { external_order_id: 'x', order_created_at: '2026-10-17T10:00:00Z',
        amount: 99, product_name_raw: 'Pamięć. Trening Interaktywny: Ebook + Druk',
        source: 'wix', payment_status: 'paid' },
      { external_order_id: 'x', order_created_at: '2026-10-17T10:00:00Z',
        amount: 20, product_name_raw: 'Wysyłka + Ubezpieczenie + Paczka',
        source: 'wix', payment_status: 'paid' },
    ])
    expect(order.revenue).toBe(119)
    expect(order.productAmount).toBe(99)
    expect(classifyOrder(order).productKey).toBe('memory_pack')
  })

  it('keeps the view\'s predicate for which rows count at all', () => {
    expect(isCountableOrder({ source: 'wix', payment_status: 'paid' })).toBe(true)
    expect(isCountableOrder({ source: 'wix', payment_status: 'refunded' })).toBe(false)
    expect(isCountableOrder({ source: 'wix', payment_status: 'paid', email: 'a@test.pl' })).toBe(false)
    expect(isCountableOrder({ source: 'wix', payment_status: 'paid', external_order_id: 'TEST-1' })).toBe(false)
  })
})
