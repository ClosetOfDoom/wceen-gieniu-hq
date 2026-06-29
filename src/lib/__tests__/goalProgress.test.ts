import { describe, it, expect } from 'vitest'
import {
  ppOrdersGoal, monthlyRevenueGoal, cpaGoal, roasGoal,
  daysInMonthOf, sumMonthToDate,
} from '../goalProgress'

describe('ppOrdersGoal (target ≥18)', () => {
  it('green at/above 18', () => {
    expect(ppOrdersGoal(18).status).toBe('green')
    expect(ppOrdersGoal(25).status).toBe('green')
    expect(ppOrdersGoal(25).pct).toBe(100)
  })
  it('amber 14–17', () => {
    expect(ppOrdersGoal(14).status).toBe('amber')
    expect(ppOrdersGoal(17).status).toBe('amber')
  })
  it('red attention 10–13', () => {
    expect(ppOrdersGoal(10).status).toBe('red')
    expect(ppOrdersGoal(13).note).toContain('attention')
  })
  it('red check-technicals below 10', () => {
    expect(ppOrdersGoal(9).status).toBe('red')
    expect(ppOrdersGoal(0).note).toContain('check technicals')
  })
  it('handles null', () => {
    expect(ppOrdersGoal(null).note).toContain('no orders')
  })
})

describe('cpaGoal (inverted, PP <40/50)', () => {
  it('green below 40', () => {
    expect(cpaGoal(32).status).toBe('green')
    expect(cpaGoal(39.9).status).toBe('green')
  })
  it('amber 40–50', () => {
    expect(cpaGoal(40).status).toBe('amber')
    expect(cpaGoal(50).status).toBe('amber')
  })
  it('red above 50', () => {
    expect(cpaGoal(51).status).toBe('red')
  })
  it('PL thresholds via params (<25/35)', () => {
    expect(cpaGoal(22, 25, 35).status).toBe('green')
    expect(cpaGoal(30, 25, 35).status).toBe('amber')
    expect(cpaGoal(40, 25, 35).status).toBe('red')
  })
  it('full bar at/below target', () => {
    expect(cpaGoal(40).pct).toBe(100)
    expect(cpaGoal(20).pct).toBe(100)
  })
})

describe('roasGoal', () => {
  it('green ≥2, amber 1.5–2, red <1.5', () => {
    expect(roasGoal(2.5).status).toBe('green')
    expect(roasGoal(1.7).status).toBe('amber')
    expect(roasGoal(1.2).status).toBe('red')
  })
})

describe('monthlyRevenueGoal (target 30k, paced)', () => {
  it('on pace → green', () => {
    // day 15/30, mtd 15k == expected 15k → pace 1.0
    const r = monthlyRevenueGoal(15000, 15, 30)
    expect(r.status).toBe('green')
    expect(r.pct).toBe(50)
    expect(r.note).toContain('50% of target')
  })
  it('behind pace → red', () => {
    const r = monthlyRevenueGoal(5000, 15, 30) // expected 15k, pace 0.33
    expect(r.status).toBe('red')
  })
  it('slightly behind → amber', () => {
    const r = monthlyRevenueGoal(12750, 15, 30) // expected 15k, pace 0.85
    expect(r.status).toBe('amber')
  })
})

describe('month helpers', () => {
  it('daysInMonthOf', () => {
    expect(daysInMonthOf('2026-02')).toBe(28)
    expect(daysInMonthOf('2026-06')).toBe(30)
    expect(daysInMonthOf('2026-01')).toBe(31)
  })
  it('sumMonthToDate filters by month prefix', () => {
    const rows = [
      { date: '2026-06-01', wix_revenue: 1000 },
      { date: '2026-06-15', wix_revenue: 2000 },
      { date: '2026-05-31', wix_revenue: 9999 },
    ]
    expect(sumMonthToDate(rows, '2026-06')).toBe(3000)
  })
})
