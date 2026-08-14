import { describe, it, expect } from 'vitest'
import { FUNDING } from '../../data/funding'
import {
  sortByUrgency, statusesFor, zeroOwn, isLubelskie, openWindow, counters, hermes,
  effectiveCheckBy, urgencyTier,
} from '../fundingStatus'

// Fixed date so the suite never depends on the wall clock.
const TODAY = '2026-08-14'
const NO_CHECKS = {}

describe('open window (keyword, never a parsed date)', () => {
  it('reads rolling / year-round intake as open', () => {
    expect(openWindow(FUNDING.find(o => o.id === 'pes')!, TODAY)).toBe(true)       // "nabór ciągły"
    expect(openWindow(FUNDING.find(o => o.id === 'googlead')!, TODAY)).toBe(true)  // "nabór całoroczny"
    expect(openWindow(FUNDING.find(o => o.id === 'niwmrw')!, TODAY)).toBe(true)    // "otwarty"
  })
  it('a FUTURE opening is not an open window', () => {
    // "otwarcie naboru ~listopad 2026" — the noun, not the adjective.
    expect(openWindow(FUNDING.find(o => o.id === 'nowefio')!, TODAY)).toBe(false)
    expect(openWindow(FUNDING.find(o => o.id === 'wfos')!, TODAY)).toBe(false)
    expect(openWindow(FUNDING.find(o => o.id === 'felu')!, TODAY)).toBe(false)
  })
  it('a passed deadline closes the window regardless of prose', () => {
    // seniorzy15: "otwarty — termin 6 lipca 2026", already past on TODAY.
    expect(openWindow(FUNDING.find(o => o.id === 'seniorzy15')!, TODAY)).toBe(false)
  })
})

describe('statuses', () => {
  it('every GO/MAYBE item with no checkBy is SPRAWDŹ TERAZ', () => {
    const go = FUNDING.find(o => o.id === 'sektor30')!
    expect(statusesFor(go, NO_CHECKS, TODAY)).toContain('SPRAWDŹ TERAZ')
  })
  it('a checkBy in the future clears SPRAWDŹ TERAZ', () => {
    const checks = { sektor30: { checkBy: '2026-09-01' } }
    expect(statusesFor(FUNDING.find(o => o.id === 'sektor30')!, checks, TODAY)).toEqual([])
  })
  it('a checkBy in the past re-raises SPRAWDŹ TERAZ', () => {
    const checks = { sektor30: { checkBy: '2026-08-01' } }
    expect(statusesFor(FUNDING.find(o => o.id === 'sektor30')!, checks, TODAY)).toContain('SPRAWDŹ TERAZ')
  })
  it('verify:true adds NIEZWERYFIKOWANE', () => {
    expect(statusesFor(FUNDING.find(o => o.id === 'orlen')!, NO_CHECKS, TODAY)).toContain('NIEZWERYFIKOWANE')
  })
  it('SKIP items generate no statuses at all', () => {
    const skip = FUNDING.find(o => o.id === 'seniorzy15')!
    expect(skip.verdict).toBe('SKIP')
    expect(statusesFor(skip, NO_CHECKS, TODAY)).toEqual([])
  })
  it('checkBy defaults to null for all 13 items', () => {
    expect(FUNDING).toHaveLength(13)
    for (const o of FUNDING) expect(effectiveCheckBy(o, NO_CHECKS)).toBeNull()
  })
})

describe('zero own contribution', () => {
  it('flags the items WCEEN can take without committing funds', () => {
    const ids = FUNDING.filter(zeroOwn).map(o => o.id).sort()
    expect(ids).toEqual(['erasmus', 'googlead', 'nowefio', 'oppmech', 'pes', 'sektor30'])
  })
  it('does not flag items with a real own contribution', () => {
    expect(zeroOwn(FUNDING.find(o => o.id === 'felu')!)).toBe(false)   // "znaczny (15–20%+…)"
    expect(zeroOwn(FUNDING.find(o => o.id === 'wfos')!)).toBe(false)
  })
})

describe('Lublin / lubelskie scope', () => {
  it('groups voivodeship- and city-scoped items', () => {
    const ids = FUNDING.filter(isLubelskie).map(o => o.id).sort()
    expect(ids).toEqual(['felu', 'pes', 'seniorzy15', 'wfos'])
  })
})

describe('default sort — urgency of action, not amount', () => {
  const ordered = sortByUrgency(FUNDING, TODAY)

  it('GO before MAYBE before SKIP', () => {
    const rank = { GO: 0, MAYBE: 1, SKIP: 2 } as const
    const seq = ordered.map(o => rank[o.verdict])
    expect(seq).toEqual([...seq].sort((a, b) => a - b))
  })

  it('within GO, a dated item leads, then open windows, then the rest', () => {
    const go = ordered.filter(o => o.verdict === 'GO')
    expect(go[0].id).toBe('oppmech')                       // only GO with a hard future deadline
    expect(urgencyTier(go[0], TODAY)).toBe(0)
    expect(go.slice(1, 3).map(o => o.id).sort()).toEqual(['googlead', 'pes'])   // open windows
  })

  it('a 2 mln zł horizon project does not outrank an actionable one', () => {
    const idx = (id: string) => ordered.findIndex(o => o.id === id)
    expect(idx('felu')).toBeGreaterThan(idx('pes'))
    expect(idx('felu')).toBeGreaterThan(idx('techedu'))
  })

  it('past-deadline items sink to the bottom of their group', () => {
    expect(ordered[ordered.length - 1].id).toBe('seniorzy15')
  })
})

describe('counters', () => {
  it('counts what needs a move, on first run', () => {
    const c = counters(FUNDING, NO_CHECKS, TODAY)
    expect(c.checkNow).toBe(12)      // 7 GO + 5 MAYBE, none scheduled yet
    expect(c.unverified).toBe(4)     // verify:true, SKIP excluded
    expect(c.pastDue).toBe(0)        // the only past deadline is on a SKIP item
    expect(c.zeroOwn).toBe(6)
  })
})

describe('Hermes', () => {
  it('names every item needing a move, most urgent first', () => {
    const h = hermes(FUNDING, NO_CHECKS, TODAY)
    expect(h.count).toBe(12)
    expect(h.items[0].ttl).toBe(FUNDING.find(o => o.id === 'oppmech')!.ttl)
    expect(h.message).toContain('12 pozycji wymaga ruchu.')
  })

  it('says so in one sentence when nothing needs a move', () => {
    // Everything scheduled forward, and the two unverified/past cases removed.
    const clean = FUNDING.filter(o => !o.verify && o.verdict !== 'SKIP')
    const checks = Object.fromEntries(clean.map(o => [o.id, { checkBy: '2027-01-01' }]))
    const h = hermes(clean, checks, TODAY)
    expect(h.count).toBe(0)
    expect(h.message).toBe('Nic nie wymaga ruchu — wszystkie pozycje sprawdzone i w terminie.')
    expect(h.message.split('\n')).toHaveLength(1)
  })
})
