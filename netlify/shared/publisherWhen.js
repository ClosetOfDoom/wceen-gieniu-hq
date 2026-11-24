// publisherWhen.js — turns what Filip says ("Friday 19:00", "tomorrow", "2026-12-04", "piątek o 19") into a date in
// Europe/Warsaw, deterministically. The model never computes dates: it passes Filip's words, this module resolves
// them, and anything it cannot resolve is refused (never guessed).
//
// Rules:
//   · a weekday name = the NEXT such day strictly after today (said on a Friday, "Friday" = a week from today)
//   · "today", "tomorrow", "day after tomorrow", "in N days" (and the Polish forms), ISO dates, DD.MM[.YYYY]
//   · a time is optional: 19:00, 19.30 is NOT a time (it is a date), "at 19", "o 19", "19h", "7pm", "7:30 pm"
//   · without a time the result keeps `time: null` (the Publisher then keeps the reel's own hour)

import { warsawParts } from './webinarMail.js'

const FOLD = { ą: 'a', ć: 'c', ę: 'e', ł: 'l', ń: 'n', ó: 'o', ś: 's', ź: 'z', ż: 'z' }
const normalise = (s) => String(s ?? '').toLowerCase().replace(/[ąćęłńóśźż]/g, (c) => FOLD[c]).replace(/\s+/g, ' ').trim()

// Index = JS getUTCDay() (0 = Sunday).
const WEEKDAYS = [
  ['sunday', 'sun', 'niedziela', 'niedziele', 'niedz', 'nd'],
  ['monday', 'mon', 'poniedzialek', 'poniedzialku', 'pon', 'pn'],
  ['tuesday', 'tue', 'tues', 'wtorek', 'wtorku', 'wt'],
  ['wednesday', 'wed', 'sroda', 'srode', 'sr'],
  ['thursday', 'thu', 'thur', 'thurs', 'czwartek', 'czwartku', 'cz'],
  ['friday', 'fri', 'piatek', 'piatku', 'pt'],
  ['saturday', 'sat', 'sobota', 'sobote', 'sob', 'sb'],
]
const EN_DAYS = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat']
export const weekdayName = (date) => EN_DAYS[new Date(`${date}T12:00:00Z`).getUTCDay()]

export function addDays(date, n) {
  const d = new Date(`${date}T12:00:00Z`)
  d.setUTCDate(d.getUTCDate() + n)
  return d.toISOString().slice(0, 10)
}

const isRealDate = (y, m, d) => {
  const t = new Date(Date.UTC(y, m - 1, d, 12))
  return t.getUTCFullYear() === y && t.getUTCMonth() === m - 1 && t.getUTCDate() === d
}
const pad = (n) => String(n).padStart(2, '0')

/** Time of day from the text: { time:'HH:MM'|null, rest } (rest = text without the time part), or { error }. */
function takeTime(text) {
  const patterns = [
    // 7:30 pm, 7:30pm, 19:00
    { re: /\b(\d{1,2}):(\d{2})\s*(am|pm)?\b/, h: 1, m: 2, ap: 3 },
    // 7pm, 7 pm
    { re: /\b(\d{1,2})\s*(am|pm)\b/, h: 1, m: null, ap: 2 },
    // at 19, @19, o 19, o godz. 19, godz 19, 19h
    { re: /(?:\bat\b|@|\bo\b|\bgodz(?:\.|ina|inie)?)\s*(\d{1,2})\b(?!\s*[./-]\s*\d)/, h: 1, m: null, ap: null },
    { re: /\b(\d{1,2})\s*h\b/, h: 1, m: null, ap: null },
  ]
  for (const p of patterns) {
    const m = p.re.exec(text)
    if (!m) continue
    let h = Number(m[p.h])
    const min = p.m ? Number(m[p.m]) : 0
    const ap = p.ap ? m[p.ap] : null
    if (ap) {
      if (h < 1 || h > 12) return { error: `Nieprawidłowa godzina: ${m[0]}` }
      h = (h % 12) + (ap === 'pm' ? 12 : 0)
    }
    if (h > 23 || min > 59) return { error: `Nieprawidłowa godzina: ${m[0]}` }
    return { time: `${pad(h)}:${pad(min)}`, rest: text.replace(m[0], ' ').replace(/\s+/g, ' ').trim() }
  }
  return { time: null, rest: text }
}

/**
 * @returns {{ ok:true, date:string, time:string|null, spec:string, note:string } | { ok:false, error:string }}
 *   spec = "RRRR-MM-DD GG:MM" (or just the date when no time was given): exactly what the Publisher API takes.
 */
export function parseWhen(input, now = new Date()) {
  const raw = normalise(input)
  if (!raw) return { ok: false, error: 'Brak daty.' }
  const today = warsawParts(now).date
  const t = takeTime(raw)
  if (t.error) return { ok: false, error: t.error }
  const text = t.rest.replace(/\b(on|w|we|na|do|to|the|next|this|nastepny|nastepna|nastepne|ten|ta|to|kolejny)\b/g, ' ').replace(/\s+/g, ' ').trim()
  const hadNext = /\b(next|nastepn\w*|kolejn\w*)\b/.test(raw)
  const done = (date, note) => (isRealDate(...date.split('-').map(Number))
    ? { ok: true, date, time: t.time, spec: t.time ? `${date} ${t.time}` : date, note }
    : { ok: false, error: `Nie ma takiej daty: ${date}.` })

  let m
  if ((m = /\b(\d{4})-(\d{1,2})-(\d{1,2})\b/.exec(text))) return done(`${m[1]}-${pad(m[2])}-${pad(m[3])}`, 'date')
  if ((m = /\b(\d{1,2})\.(\d{1,2})(?:\.(\d{4}))?\b/.exec(text))) {
    const year = m[3] ? Number(m[3]) : Number(today.slice(0, 4))
    let date = `${year}-${pad(m[2])}-${pad(m[1])}`
    // "4.12" with no year that already passed this year means next year only when it is clearly in the past
    if (!m[3] && isRealDate(year, Number(m[2]), Number(m[1])) && date < today) date = `${year + 1}-${pad(m[2])}-${pad(m[1])}`
    return done(date, 'date')
  }
  if (/\b(day after tomorrow|pojutrze)\b/.test(text)) return done(addDays(today, 2), 'day after tomorrow')
  if (/\b(tomorrow|jutro)\b/.test(text)) return done(addDays(today, 1), 'tomorrow')
  if (/\b(today|dzis|dzisiaj)\b/.test(text)) return done(today, 'today')
  if ((m = /\b(?:in|za)\s+(\d{1,3})\s+(?:days?|dni|dzien)\b/.exec(text))) return done(addDays(today, Number(m[1])), `in ${m[1]} days`)

  const words = text.split(' ')
  for (let wd = 0; wd < 7; wd++) {
    if (!WEBDAY_HIT(words, WEEKDAYS[wd])) continue
    const todayWd = new Date(`${today}T12:00:00Z`).getUTCDay()
    let delta = (wd - todayWd + 7) % 7
    if (delta === 0) delta = 7
    if (hadNext && delta <= 0) delta += 7
    return done(addDays(today, delta), `next ${WEEKDAYS[wd][0]}`)
  }
  return { ok: false, error: `Nie rozumiem daty „${String(input).trim()}”. Podaj dzień tygodnia, „jutro” albo datę RRRR-MM-DD.` }
}

function WEBDAY_HIT(words, names) { return words.some((w) => names.includes(w)) }

// ── ranges for the plan ──────────────────────────────────────────────────────────

export const PLAN_PERIODS = ['next_7_days', 'this_week', 'next_week', 'this_month', 'next_30_days']

/**
 * { od, do, label } in Warsaw dates for a named period. Weeks run Monday–Sunday.
 *   next_7_days (default) = today and the 6 days after; this_week = today..Sunday; next_week = next Mon..next Sun.
 */
export function periodRange(period, now = new Date()) {
  const today = warsawParts(now).date
  const wd = new Date(`${today}T12:00:00Z`).getUTCDay()
  const daysToSunday = (7 - wd) % 7
  switch (period ?? 'next_7_days') {
    case 'next_7_days': return { od: today, do: addDays(today, 6), label: 'the next 7 days' }
    case 'this_week': return { od: today, do: addDays(today, daysToSunday), label: 'this week' }
    case 'next_week': {
      const monday = addDays(today, daysToSunday + 1)
      return { od: monday, do: addDays(monday, 6), label: 'next week' }
    }
    case 'this_month': {
      const [y, mo] = today.split('-').map(Number)
      const last = new Date(Date.UTC(y, mo, 0)).getUTCDate()
      return { od: today, do: `${y}-${pad(mo)}-${pad(last)}`, label: 'this month' }
    }
    case 'next_30_days': return { od: today, do: addDays(today, 29), label: 'the next 30 days' }
    default: return null
  }
}

/** Range from the model's arguments: od/do as dates or phrases, or a named period; everything else is refused. */
export function resolveRange({ od, do: doArg, okres } = {}, now = new Date()) {
  if (od || doArg) {
    const a = od ? parseWhen(od, now) : null
    const b = doArg ? parseWhen(doArg, now) : null
    if ((a && !a.ok) || (b && !b.ok)) return { ok: false, error: (a && !a.ok ? a.error : b.error) }
    const from = a?.date ?? warsawParts(now).date
    const to = b?.date ?? addDays(from, 6)
    if (to < from) return { ok: false, error: 'Data „do” jest wcześniejsza niż „od”.' }
    return { ok: true, od: from, do: to, label: `${from} to ${to}` }
  }
  const r = periodRange(okres, now)
  return r ? { ok: true, ...r } : { ok: false, error: `Nieznany okres: ${okres}. Dostępne: ${PLAN_PERIODS.join(', ')}.` }
}
