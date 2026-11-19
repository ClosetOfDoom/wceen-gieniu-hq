// The CAMPAIGNS note about meta_purchases / raw_payload is computed from the rows, never hard-coded.
import { describe, it, expect } from 'vitest'
import { metaCoverage, metaCoverageSentences, hasPayload, META_VS_WIX } from '../metaCoverage'

const row = (date: string, spend: number, purchases: number, raw_payload: unknown = null) => ({ date, spend, meta_purchases: purchases, raw_payload })

describe('metaCoverage', () => {
  it('old state (no purchases, empty payload): says so with the real counts', () => {
    const rows = [row('2026-11-01', 50, 0), row('2026-11-01', 20, 0, {}), row('2026-11-02', 40, 0, ''), row('2026-11-03', 0, 0)]
    const c = metaCoverage(rows)
    expect(c).toEqual({ from: '2026-11-01', to: '2026-11-03', firstPurchaseDate: null, spendDays: 2, zeroPurchaseSpendDays: 2, firstRawPayloadDate: null, rawPayloadDays: 0 })
    const t = metaCoverageSentences(c).join(' ')
    expect(t).toContain('meta_purchases = 0 we wszystkich dobach zakresu 2026-11-01 → 2026-11-03')
    expect(t).toContain('2 z 2')
    expect(t).toContain('raw_payload pusty')
  })

  it('new state (purchases from 18.11, payload from 19.11): the text follows the data', () => {
    const rows = [
      row('2026-11-16', 80, 0), row('2026-11-17', 90, 0),
      row('2026-11-18', 70, 2), row('2026-11-18', 30, 0),       // summed per day: 2 > 0
      row('2026-11-19', 60, 0, '{"actions":[]}'), row('2026-11-20', 75, 4, { a: 1 }),
    ]
    const c = metaCoverage(rows)
    expect(c.firstPurchaseDate).toBe('2026-11-18')
    expect([c.zeroPurchaseSpendDays, c.spendDays]).toEqual([3, 5])
    expect(c.firstRawPayloadDate).toBe('2026-11-19')
    expect(c.rawPayloadDays).toBe(2)
    const t = metaCoverageSentences(c).join(' ')
    expect(t).toContain('meta_purchases > 0 od 2026-11-18')
    expect(t).toContain('Doby z wydatkiem bez zakupów Meta: 3 z 5.')
    expect(t).toContain('raw_payload wypełniony od 2026-11-19 (2 z 5 dób z wydatkiem)')
    expect(t).not.toMatch(/95%|nie jest zasilane/)
  })

  it('a different range of the same data gives a different text', () => {
    const late = metaCoverageSentences(metaCoverage([row('2026-11-19', 60, 1, { a: 1 }), row('2026-11-20', 75, 4, { a: 1 })])).join(' ')
    expect(late).toContain('meta_purchases > 0 od 2026-11-19')
    expect(late).toContain('0 z 2')
  })

  it('empty range, legacy "purchases" column, payload emptiness rules, the Meta vs Wix sentence', () => {
    expect(metaCoverageSentences(metaCoverage([]))[0]).toContain('Brak wierszy')
    expect(metaCoverage([{ date: '2026-11-01', spend: 5, purchases: 1 }]).firstPurchaseDate).toBe('2026-11-01')
    for (const v of [null, undefined, '', ' ', '{}', '[]', 'null', {}, []]) expect(hasPayload(v)).toBe(false)
    for (const v of ['{"a":1}', { a: 1 }, [1]]) expect(hasPayload(v)).toBe(true)
    expect(META_VS_WIX).toMatch(/nie są porównywalne z Wix/)
  })
})
