// Types for businessDay.js — the one definition of the Warsaw business day.
export const BUSINESS_TIMEZONE: 'Europe/Warsaw'

export function businessDay(ts: string | number | Date | null | undefined): string
export function businessToday(): string
export function businessWallClock(ts: string | number | Date | null | undefined): string
export function businessOffsetMinutes(utcMs: number): number
export function businessDayRangeUtc(day: string): { startUtc: string; endUtc: string }
export function businessDaysAgo(n: number, from?: string): string
export function businessYesterday(from?: string): string
export function businessMonthStart(from?: string): string
export function businessWeekStart(from?: string): string
export function businessDaysBetween(from: string, to: string): string[]
export function businessHoursSinceMidnight(now?: Date): number
export function isBusinessToday(raw: string | number | Date | null | undefined): boolean
