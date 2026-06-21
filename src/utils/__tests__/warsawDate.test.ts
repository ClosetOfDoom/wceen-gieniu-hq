import { describe, it, expect } from 'vitest'
import { toWarsawDate, isToday, warsawToday } from '../warsawDate'

describe('toWarsawDate', () => {
  it('converts mid-day UTC to the correct Warsaw date', () => {
    // 2024-06-21 12:00 UTC = 14:00 CEST → still June 21
    expect(toWarsawDate('2024-06-21T12:00:00Z')).toBe('2024-06-21')
  })

  it('DST summer: 22:30 UTC → next day in Warsaw (00:30 CEST)', () => {
    // June 20 22:30 UTC = June 21 00:30 CEST (UTC+2)
    expect(toWarsawDate('2024-06-20T22:30:00Z')).toBe('2024-06-21')
  })

  it('DST winter: 23:30 UTC → next day in Warsaw (00:30 CET)', () => {
    // Dec 21 23:30 UTC = Dec 22 00:30 CET (UTC+1)
    expect(toWarsawDate('2024-12-21T23:30:00Z')).toBe('2024-12-22')
  })

  it('summer midnight UTC stays previous day in Warsaw (CEST is UTC+2)', () => {
    // June 21 00:00 UTC = June 21 02:00 CEST → still June 21
    expect(toWarsawDate('2024-06-21T00:00:00Z')).toBe('2024-06-21')
  })

  it('returns empty string for null', () => {
    expect(toWarsawDate(null)).toBe('')
  })

  it('returns empty string for undefined', () => {
    expect(toWarsawDate(undefined)).toBe('')
  })
})

describe('warsawToday', () => {
  it('returns YYYY-MM-DD format', () => {
    expect(warsawToday()).toMatch(/^\d{4}-\d{2}-\d{2}$/)
  })
})

describe('isToday', () => {
  it('returns false for null', () => {
    expect(isToday(null)).toBe(false)
  })

  it('passes for a date string equal to warsawToday()', () => {
    const today = warsawToday()
    expect(isToday(today)).toBe(true)
  })

  it('returns false for a past date', () => {
    expect(isToday('2020-01-01')).toBe(false)
  })
})
