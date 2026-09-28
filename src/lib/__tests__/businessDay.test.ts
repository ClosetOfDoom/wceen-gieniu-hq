// Tests for the business day.
//
// The bug these exist to prevent: an order placed at 00:30 Warsaw time carries
// the previous day's UTC date, so it gets counted on the day before it
// happened. On 2026-09-28 that moved three of four orders onto the 27th.
//
// The DST cases are the ones that matter most. Poland leaves CEST (UTC+2) for
// CET (UTC+1) on Sunday 2026-10-25, and any implementation with a hardcoded
// offset passes every test above and fails silently from that Sunday on.

import { describe, it, expect } from 'vitest'
import {
  businessDay, businessToday, businessWallClock, businessOffsetMinutes,
  businessDayRangeUtc, businessDaysAgo, businessYesterday, businessWeekStart,
  businessMonthStart, businessDaysBetween, isBusinessToday,
} from '../businessDay'

describe('businessDay — the Warsaw calendar day of an instant', () => {
  // The exact boundary cases from the bug report.
  const CASES: Array<[string, string, string]> = [
    ['2026-09-27T21:59:59Z', '2026-09-27', 'CEST, 23:59:59 local — still the 27th'],
    ['2026-09-27T22:00:00Z', '2026-09-28', 'CEST, 00:00:00 local — already the 28th'],
    ['2026-09-28T09:00:00Z', '2026-09-28', 'CEST, mid-morning'],
    ['2026-10-24T22:30:00Z', '2026-10-25', 'still CEST: 00:30 local on the 25th'],
    ['2026-10-25T22:30:00Z', '2026-10-25', 'now CET: 23:30 local, still the 25th'],
    ['2026-10-25T23:00:00Z', '2026-10-26', 'CET: 00:00 local on the 26th'],
  ]

  it.each(CASES)('%s → %s (%s)', (ts, expected) => {
    expect(businessDay(ts)).toBe(expected)
  })

  it('reads the offset from the instant, so the DST switch is not hardcoded', () => {
    expect(businessOffsetMinutes(Date.parse('2026-09-28T12:00:00Z'))).toBe(120) // CEST
    expect(businessOffsetMinutes(Date.parse('2026-11-01T12:00:00Z'))).toBe(60)  // CET
  })

  it('shows the local wall clock behind each verdict', () => {
    expect(businessWallClock('2026-09-27T22:00:00Z')).toBe('2026-09-28 00:00:00')
    expect(businessWallClock('2026-10-25T22:30:00Z')).toBe('2026-10-25 23:30:00')
  })

  it('accepts a Date, epoch millis and an offset-bearing string alike', () => {
    expect(businessDay(new Date('2026-09-27T22:00:00Z'))).toBe('2026-09-28')
    expect(businessDay(Date.parse('2026-09-27T22:00:00Z'))).toBe('2026-09-28')
    // This is the shape the REST API actually returns for order_created_at.
    expect(businessDay('2026-09-25T13:35:12.005+00:00')).toBe('2026-09-25')
  })

  it('passes a bare calendar day straight through', () => {
    // Re-reading 'YYYY-MM-DD' as midnight UTC would shift it a day backwards
    // for anyone west of Warsaw. A calendar day is already a calendar day.
    expect(businessDay('2026-09-28')).toBe('2026-09-28')
  })

  it('returns an empty string for nothing, rather than today', () => {
    for (const v of [null, undefined, '', 'not a date']) {
      expect(businessDay(v as string)).toBe('')
    }
  })
})

describe('businessDayRangeUtc — the UTC window of a Warsaw day', () => {
  it('spans 22:00Z to 22:00Z in summer', () => {
    expect(businessDayRangeUtc('2026-09-28')).toEqual({
      startUtc: '2026-09-27T22:00:00.000Z',
      endUtc:   '2026-09-28T22:00:00.000Z',
    })
  })

  it('spans 23:00Z to 23:00Z in winter', () => {
    expect(businessDayRangeUtc('2026-10-26')).toEqual({
      startUtc: '2026-10-25T23:00:00.000Z',
      endUtc:   '2026-10-26T23:00:00.000Z',
    })
  })

  it('handles the switch-over day itself, which is 25 hours long', () => {
    // 2026-10-25 starts in CEST (22:00Z the day before) and ends in CET
    // (23:00Z), so it spans 25 hours. A fixed offset cannot express this.
    const { startUtc, endUtc } = businessDayRangeUtc('2026-10-25')
    expect(startUtc).toBe('2026-10-24T22:00:00.000Z')
    expect(endUtc).toBe('2026-10-25T23:00:00.000Z')
    expect((Date.parse(endUtc) - Date.parse(startUtc)) / 3600000).toBe(25)
  })

  it('every instant inside the window belongs to that day, and none outside it', () => {
    for (const day of ['2026-09-28', '2026-10-25', '2026-10-26', '2026-03-29']) {
      const { startUtc, endUtc } = businessDayRangeUtc(day)
      expect(businessDay(startUtc)).toBe(day)
      expect(businessDay(new Date(Date.parse(endUtc) - 1).toISOString())).toBe(day)
      expect(businessDay(new Date(Date.parse(startUtc) - 1).toISOString())).not.toBe(day)
      expect(businessDay(endUtc)).not.toBe(day)
    }
  })
})

describe('calendar arithmetic', () => {
  it('steps whole days without drifting across a DST switch', () => {
    expect(businessDaysAgo(1, '2026-10-26')).toBe('2026-10-25')
    expect(businessDaysAgo(2, '2026-10-26')).toBe('2026-10-24')
    expect(businessDaysAgo(-1, '2026-10-25')).toBe('2026-10-26')
    expect(businessYesterday('2026-09-28')).toBe('2026-09-27')
  })

  it('finds Monday of the ISO week', () => {
    expect(businessWeekStart('2026-09-28')).toBe('2026-09-28') // a Monday
    expect(businessWeekStart('2026-09-27')).toBe('2026-09-21') // a Sunday
    expect(businessWeekStart('2026-09-24')).toBe('2026-09-21')
  })

  it('finds the first of the month', () => {
    expect(businessMonthStart('2026-09-28')).toBe('2026-09-01')
  })

  it('lists every day in a range, inclusive, across a DST switch', () => {
    expect(businessDaysBetween('2026-10-24', '2026-10-27'))
      .toEqual(['2026-10-24', '2026-10-25', '2026-10-26', '2026-10-27'])
  })
})

describe('today', () => {
  it('agrees with businessDay of now', () => {
    expect(businessToday()).toBe(businessDay(new Date()))
    expect(businessToday()).toMatch(/^\d{4}-\d{2}-\d{2}$/)
  })

  it('isBusinessToday matches a raw timestamp against the Warsaw day', () => {
    expect(isBusinessToday(new Date())).toBe(true)
    expect(isBusinessToday(businessToday())).toBe(true)
    expect(isBusinessToday('2020-01-01T00:00:00Z')).toBe(false)
    expect(isBusinessToday(null)).toBe(false)
  })
})

describe('no fixed offset anywhere', () => {
  it('a +2h assumption would fail these, so the implementation cannot contain one', () => {
    // If the code did `ts + 2h` it would answer 2026-10-26 here. It answers
    // 2026-10-25, because it asks Intl what the offset was at that instant.
    expect(businessDay('2026-10-25T22:30:00Z')).toBe('2026-10-25')
    // And a +1h assumption would fail this one.
    expect(businessDay('2026-09-27T22:00:00Z')).toBe('2026-09-28')
  })
})
