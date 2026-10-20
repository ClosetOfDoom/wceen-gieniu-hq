// A 1 PLN row marked Offline is a door being opened, not a sale.
//
// Somebody paid outside the shop and was let into the "Jak się uczyć" course
// by hand. 34 of those happened between June and October. They used to vanish
// under the 5 PLN test-order floor and get reported as "odcięte progiem",
// which says a sale nearly happened. Nothing nearly happened.
//
// The trap these tests exist to spring: recognising them on the AMOUNT ALONE.
// A genuine 1 PLN sale — a trial, a token upsell — would then disappear into
// the same bucket and nobody would ever see it go.

import { describe, it, expect } from 'vitest'
import {
  classifyAmount, adminAccessVerdict, ADMIN_ACCESS, aggregateOrders, classifyOrder,
} from '../../../netlify/shared/productCatalog.js'

describe('TEST 2 — the three boundary cases', () => {
  it('1 PLN + Offline is an administrative grant', () => {
    const d = classifyAmount(1, 'Jak się uczyć', 'Offline')
    expect(d.bucket).toBe('ADMIN_ACCESS')
    expect(d.adminAccess).toBe(true)
    expect(d.margin).toBeNull()
    expect(d.productKey).toBeNull()
    expect(d.matchedBy).toContain('operator Offline')
  })

  it('1 PLN + Przelewy24 is UNMAPPED, and says why', () => {
    const d = classifyAmount(1, 'Jak się uczyć', 'Przelewy24')
    expect(d.bucket).toBe('UNMAPPED')
    expect(d.failedField).toContain('Przelewy24')
    expect(d.failedField).toContain('nie Offline')
  })

  it('119 PLN + Offline is UNMAPPED, not a grant', () => {
    const d = classifyAmount(119, 'Pamięć. Trening Interaktywny: Ebook + Druk', 'Offline')
    expect(d.bucket).toBe('UNMAPPED')
    expect(d.bucket).not.toBe('ADMIN_ACCESS')
    expect(d.failedField).toContain('przekracza')
  })
})

describe('the amount alone is never enough', () => {
  it('a 1 PLN row of something else is not a grant, and the category stays quiet', () => {
    // Neither Offline nor the exact grant name: this is not the category's
    // business, so it must not hijack the ordinary message with "≤ 5 zł but
    // not a grant" — that would tell somebody about a category this row was
    // never near.
    const d = classifyAmount(1, 'zupełnie nieznany produkt', null)
    expect(d.bucket).toBe('UNMAPPED')
    expect(d.bucket).not.toBe('ADMIN_ACCESS')
    expect(d.failedField).toContain('PRICE_TO_PRODUCTS')
  })

  it('an empty 0 PLN row keeps its own message, not this category', () => {
    const d = classifyAmount(0, null)
    expect(d.bucket).toBe('UNMAPPED')
    expect(d.failedField).toContain('empty')
  })

  it('the real 549 PLN course is still the course', () => {
    const d = classifyAmount(549, 'Kurs online "Jak się uczyć" (11 modułów)', null)
    expect(d.bucket).toBe('MAPPED')
    expect(d.productKey).toBe('jsu_course')
  })

  it('the grant name is matched exactly, not as a pattern', () => {
    // "Kurs online Jak się uczyć" CONTAINS the grant name. At 1 PLN with no
    // operator it must still not be taken for a grant on the name alone.
    expect(adminAccessVerdict(1, 'Kurs online "Jak się uczyć"', null).grant).toBe(false)
    expect(adminAccessVerdict(1, 'Jak się uczyć', null).grant).toBe(true)
  })

  it('the floor is the catalog constant, not a number typed twice', () => {
    expect(ADMIN_ACCESS.maxAmount).toBe(5)
    expect(adminAccessVerdict(ADMIN_ACCESS.maxAmount, 'Jak się uczyć', 'Offline').grant).toBe(true)
    expect(adminAccessVerdict(ADMIN_ACCESS.maxAmount + 0.01, 'Jak się uczyć', 'Offline').grant).toBe(false)
  })
})

describe('while the operator column does not exist', () => {
  // orders has ten columns and none of them is the operator
  // (20261020_payment_provider.sql adds one, unapplied). Null means UNKNOWN,
  // which must not be read as "not Offline" — that would turn every grant into
  // an unexplained order and send somebody looking for a bug.
  it('an unknown operator plus the exact grant name is still recognised', () => {
    const d = classifyAmount(1, 'Jak się uczyć', null)
    expect(d.bucket).toBe('ADMIN_ACCESS')
    expect(d.matchedBy).toContain('operatora nie ma w bazie')
  })

  it('an empty string counts as unknown, not as a different operator', () => {
    expect(classifyAmount(1, 'Jak się uczyć', '   ').bucket).toBe('ADMIN_ACCESS')
  })

  it('once the operator IS there, it decides and the stand-in steps back', () => {
    // Same row, same name — the only difference is that the operator is known.
    expect(classifyAmount(1, 'Jak się uczyć', 'Stripe').bucket).toBe('UNMAPPED')
  })
})

describe('the row carries the operator through aggregation', () => {
  const rows = [{
    external_order_id: 'abc', order_created_at: '2026-10-17T18:19:01Z',
    amount: 1, product_name_raw: 'Jak się uczyć', payment_provider: 'Offline',
    source: 'wix', payment_status: 'paid',
  }]

  it('aggregateOrders reads payment_provider off the row', () => {
    const [order] = aggregateOrders(rows)
    expect(order.paymentProvider).toBe('Offline')
    expect(classifyOrder(order).bucket).toBe('ADMIN_ACCESS')
  })

  it('and a row without the column classifies on the stand-in instead', () => {
    const [order] = aggregateOrders([{ ...rows[0], payment_provider: undefined }])
    expect(order.paymentProvider).toBeNull()
    expect(classifyOrder(order).bucket).toBe('ADMIN_ACCESS')
  })
})
