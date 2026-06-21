import { describe, it, expect } from 'vitest'
import ordersFixture  from './fixtures/orders.json'
import metaFixture    from './fixtures/meta_ads.json'
import emptyFixture   from './fixtures/empty.json'
import apiErrFixture  from './fixtures/api_error.json'

describe('fixtures smoke', () => {
  it('orders fixture has both paid and unpaid rows', () => {
    const paid   = ordersFixture.filter(o => o.payment_status === 'paid')
    const unpaid = ordersFixture.filter(o => o.payment_status === 'unpaid')
    expect(paid.length).toBeGreaterThan(0)
    expect(unpaid.length).toBeGreaterThan(0)
  })

  it('orders fixture has all four known products', () => {
    const paid   = ordersFixture.filter(o => o.payment_status === 'paid')
    const amounts = paid.map(o => o.amount)
    expect(amounts).toContain(119)  // Pakiet Pamięciowy
    expect(amounts).toContain(114)  // Pakiet Językowy
    expect(amounts).toContain(549)  // Kurs Jak się uczyć
    expect(amounts).toContain(347)  // Językozak AI
  })

  it('orders fixture has one garbage/unknown product', () => {
    const paid = ordersFixture.filter(o => o.payment_status === 'paid')
    const amounts = paid.map(o => o.amount)
    // 99 PLN doesn't match any known product price
    expect(amounts).toContain(99)
    expect([119, 114, 549, 347]).not.toContain(99)
  })

  it('meta fixture has 4 campaigns with dominant one >70% spend', () => {
    expect(metaFixture.length).toBe(4)
    const total = metaFixture.reduce((s, r) => s + r.spend, 0)
    const max   = Math.max(...metaFixture.map(r => r.spend))
    expect(max / total).toBeGreaterThan(0.70)
  })

  it('empty fixture is an empty array', () => {
    expect(emptyFixture).toEqual([])
  })

  it('api_error fixture has error.code 401', () => {
    expect(apiErrFixture.error.code).toBe(401)
  })
})
