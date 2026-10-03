// Tests for the progress bars.
//
// These used to assert that a low PP count went red with "check technicals".
// They now assert the opposite, because that was the bug: a goal bar reports
// progress and must never report a fault. Anomalies belong to the alarm rules
// (src/lib/__tests__/alerts.test.ts), which only look at whole days.

import { describe, it, expect } from 'vitest'
import {
  ppOrdersGoal, monthlyRevenueGoal, revenueGoal, cpaGoal, roasGoal,
  daysInMonthOf, sumMonthToDate, PP_ORDERS_TARGET, MONTHLY_REVENUE_TARGET,
} from '../goalProgress'
import { cpaAlert, roasAlert } from '../alerts'

describe('the targets themselves are unchanged', () => {
  it('18 PP per full day, 30 000 PLN per month', () => {
    expect(PP_ORDERS_TARGET).toBe(18)
    expect(MONTHLY_REVENUE_TARGET).toBe(30000)
  })
})

describe('ppOrdersGoal — progress, never a fault', () => {
  it('green once the target is reached', () => {
    expect(ppOrdersGoal(18).status).toBe('green')
    expect(ppOrdersGoal(25).status).toBe('green')
    expect(ppOrdersGoal(25).pct).toBe(100)
  })

  it('short of the target is neutral, not amber and not red', () => {
    for (const n of [0, 3, 9, 13, 17]) {
      expect(ppOrdersGoal(n).status).toBe('neutral')
    }
  })

  it('never says "abnormally low" or "check technicals" about a target', () => {
    for (const n of [0, 1, 5, 9]) {
      const note = ppOrdersGoal(n).note
      expect(note).not.toMatch(/abnormally low|check technicals|attention|behind pace/i)
    }
  })

  it('states the progress plainly', () => {
    expect(ppOrdersGoal(9).note).toBe('9/18 (50% celu)')
    expect(ppOrdersGoal(18).note).toBe('cel osiągnięty — 18/18')
  })

  it('a missing count is neutral and says so', () => {
    expect(ppOrdersGoal(null).status).toBe('neutral')
    expect(ppOrdersGoal(null).note).toContain('brak danych')
  })

  it('scales to a multi-day range target', () => {
    // A week: 18 × 7. 100 of 126 is progress, not an alarm.
    const r = ppOrdersGoal(100, 18 * 7)
    expect(r.status).toBe('neutral')
    expect(r.note).toBe('100/126 (79% celu)')
  })
})

describe('revenue goals — progress', () => {
  it('green at or past the prorated expectation, neutral before it', () => {
    expect(revenueGoal(7000, 7, 30).status).toBe('green')
    expect(revenueGoal(1000, 7, 30).status).toBe('neutral')
  })

  it('never uses pace language', () => {
    expect(revenueGoal(1000, 7, 30).note).not.toMatch(/behind pace|slightly behind/i)
    expect(monthlyRevenueGoal(5000, 10, 30).note).not.toMatch(/behind pace/i)
  })

  it('monthly bar reports the share of the 30k target and the day', () => {
    const r = monthlyRevenueGoal(15000, 15, 30)
    expect(r.pct).toBe(50)
    expect(r.note).toContain('50% celu')
    expect(r.note).toContain('dzień 15/30')
  })
})

describe('cpaGoal / roasGoal — colour comes from the 7-day verdict', () => {
  it('no verdict means no colour, only the target', () => {
    const r = cpaGoal(76.21)
    expect(r.status).toBe('neutral')
    expect(r.note).toContain('cel <40')
  })

  it('a short range shows the number but stays uncoloured', () => {
    // TODAY with CPA 76.21 against a 7-day figure of 32.
    const r = cpaGoal(76.21, 40, cpaAlert(76.21, 32, 0))
    expect(r.status).toBe('green')          // 'none' severity = no finding
    expect(r.note).toContain('za krótki zakres na ocenę')
    expect(r.note).toContain('32.00 zł')
  })

  it('a bad seven-day CPA colours the bar red', () => {
    const r = cpaGoal(51, 40, cpaAlert(51, 51, 7))
    expect(r.status).toBe('red')
    expect(r.note).toContain('powyżej 50')
  })

  it('the 40-50 band is amber', () => {
    expect(cpaGoal(45, 40, cpaAlert(45, 45, 7)).status).toBe('amber')
  })

  it('ROAS keeps its bands, via the same route', () => {
    expect(roasGoal(2.5, roasAlert(2.5, 2.5, 7)).status).toBe('green')
    expect(roasGoal(1.8, roasAlert(1.8, 1.8, 7)).status).toBe('amber')
    expect(roasGoal(1.2, roasAlert(1.2, 1.2, 7)).status).toBe('red')
  })

  it('missing data is neutral and named, not red', () => {
    expect(cpaGoal(null).status).toBe('neutral')
    expect(cpaGoal(null).note).toContain('brak danych')
    expect(roasGoal(null).status).toBe('neutral')
  })
})

describe('month helpers', () => {
  it('counts days in a month', () => {
    expect(daysInMonthOf('2026-02')).toBe(28)
    expect(daysInMonthOf('2026-09')).toBe(30)
    expect(daysInMonthOf('2026-10')).toBe(31)
  })

  it('sums month-to-date revenue', () => {
    const rows = [
      { date: '2026-10-01', wix_revenue: 100 },
      { date: '2026-10-02', wix_revenue: 200 },
      { date: '2026-09-30', wix_revenue: 999 },
    ]
    expect(sumMonthToDate(rows, '2026-10')).toBe(300)
  })
})
