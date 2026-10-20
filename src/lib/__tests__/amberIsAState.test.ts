// Amber colours a tile. Red interrupts a person. The difference is the point.
//
// amberBelow is p25 of the rolling-7 distribution, so it is true about a
// quarter of the time BY CONSTRUCTION — measured 23.1% over the 130 days to
// 2026-10-19. An entry in the day's summary that appears on 30 days out of 130
// is not news about the business, it is a description of where the business
// normally sits. Put it in the summary and people stop reading the summary;
// then the red that matters arrives into a habit of ignoring it.
//
// These tests pin that amber never reaches anything that interrupts, over a
// series the size of the real one.

import { describe, it, expect } from 'vitest'
import {
  ALERT_RULES, evaluateAlerts, isNotifying, NOTIFYING_SEVERITIES,
  type DaySeriesEntry,
} from '../alerts'

/** N full days ending on `to`, each with `counts[i]` orders. */
function series(counts: number[], to = '2026-10-19'): DaySeriesEntry[] {
  const end = Date.parse(`${to}T12:00:00Z`)
  return counts.map((n, i) => ({
    date: new Date(end - (counts.length - 1 - i) * 86400000).toISOString().slice(0, 10),
    orders: n,
    missing: false,
  }))
}

/** What the dashboard would do on each day, evaluated day by day as it happened. */
function walk(counts: number[]) {
  const full = series(counts)
  const out = { amberDays: 0, redDays: 0, notifyingEntries: 0, amberEntries: 0 }
  for (let i = 1; i <= full.length; i++) {
    const a = evaluateAlerts({ series: full.slice(0, i) })
    if (a.worst === 'red') out.redDays++
    else if (a.worst === 'amber') out.amberDays++
    out.notifyingEntries += a.notifying.length
    out.amberEntries += a.notifying.filter(x => x.severity === 'amber').length
  }
  return out
}

describe('the split lives in one place', () => {
  it('only red interrupts', () => {
    expect(NOTIFYING_SEVERITIES).toEqual(['red'])
  })

  it('isNotifying agrees with it, and survives a missing alert', () => {
    expect(isNotifying({ severity: 'red' } as never)).toBe(true)
    expect(isNotifying({ severity: 'amber' } as never)).toBe(false)
    expect(isNotifying({ severity: 'none' } as never)).toBe(false)
    expect(isNotifying(null)).toBe(false)
  })

  it('thresholds are untouched — this change is about consequences, not lines', () => {
    expect(ALERT_RULES.ROLLING_7.amberBelow).toBe(75)
    expect(ALERT_RULES.ROLLING_7.redBelow).toBe(66)
    expect(ALERT_RULES.DAILY_LOW.maxOrders).toBe(5)
  })
})

describe('TEST 3 — a day under p25 but over p10', () => {
  // 7 × 10 = 70 orders: under amberBelow 75, over redBelow 66.
  const a = evaluateAlerts({ series: series([10, 10, 10, 10, 10, 10, 10]) })

  it('colours the tile amber', () => {
    expect(a.worst).toBe('amber')
    expect(a.active.some(x => x.rule === 'KROCZĄCY_7' && x.severity === 'amber')).toBe(true)
  })

  it('writes nothing into the day summary and gives Stanley nothing to say', () => {
    expect(a.notifying).toHaveLength(0)
  })
})

describe('TEST 4 — a day under p10', () => {
  // Three consecutive windows of 63, all under redBelow 66 — the streak the
  // rolling rule needs before it goes red.
  const a = evaluateAlerts({ series: series([9, 9, 9, 9, 9, 9, 9, 9, 9]) })

  it('is the full signal: colour, summary entry, Stanley speaks', () => {
    expect(a.worst).toBe('red')
    expect(a.notifying).toHaveLength(1)
    expect(a.notifying[0].rule).toBe('KROCZĄCY_7')
    expect(a.notifying[0].severity).toBe('red')
  })
})

describe('TEST 4b — DAILY_LOW is an event too', () => {
  const a = evaluateAlerts({ series: series([30, 30, 30, 30, 30, 4, 4]) })

  it('two consecutive days at or under 5 interrupt', () => {
    expect(a.notifying.some(x => x.rule === 'DOBOWY' && x.severity === 'red')).toBe(true)
  })
})

describe('over a series the size of the real one', () => {
  // 130 days that spend most of their time in the amber band and dip into red
  // at the end — the shape that would drown a summary if amber were an event.
  const counts = [
    ...Array.from({ length: 100 }, (_, i) => (i % 3 === 0 ? 11 : 10)),  // ~70-74 per window
    ...Array.from({ length: 20 }, () => 13),                            // 91 — clear
    ...Array.from({ length: 10 }, () => 9),                             // 63 — red
  ]
  const r = walk(counts)

  it('has plenty of amber to suppress, or the test proves nothing', () => {
    expect(r.amberDays).toBeGreaterThan(50)
  })

  it('amber produces ZERO entries in the day summary across all 130 days', () => {
    expect(r.amberEntries).toBe(0)
  })

  it('red produces exactly as many entries as there are red days', () => {
    expect(r.redDays).toBeGreaterThan(0)
    expect(r.notifyingEntries).toBe(r.redDays)
  })
})
