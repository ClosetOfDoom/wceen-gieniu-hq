// stanleyTasks.js — Stanley's tasks and the "Dziś" list. Pure logic + a KV store passed in (createKvStore / createMemoryKv).
//
// Task: { id, tytul, filar (slug | null), godzina ('HH:MM' | null), dzien ('YYYY-MM-DD' | null), status ('otwarte' | 'zrobione'),
//         createdAt, doneAt }
// Commands understood in the Q&A (parseTaskCommand): "dodaj zadanie …", "zrobione …", "co dziś?".
// The "Dziś" list = the day rhythm (stanley-wiedza/rytm-dnia.md) for the weekday + open tasks for today or without a day,
// sorted by hour; tasks without an hour go last. Rhythm items can be ticked per day (key dzien/<date>).

import { warsawParts, warsawLocalToUtc } from './webinarMail.js'
import { normalizePl, pillarFromText, rhythmFor, pillarOfDay, PILLARS } from './stanleyPillars.js'

export const TASK_STATUS = Object.freeze({ OPEN: 'otwarte', DONE: 'zrobione' })

const WEEKDAYS = [['niedziel', 0], ['poniedzial', 1], ['wtor', 2], ['srod', 3], ['czwart', 4], ['piat', 5], ['sobot', 6]]

/** Date `n` days after a Warsaw date (YYYY-MM-DD). */
export function addDays(date, n) {
  const t = warsawLocalToUtc(date, '12:00').getTime() + n * 86400e3
  return warsawParts(new Date(t)).date
}

const strip = (s) => s.replace(/\s{2,}/g, ' ').replace(/^[\s,:;–—-]+|[\s,:;–—-]+$/g, '').trim()

/**
 * The time, day and pillar written in a task, and the title without them.
 * Day: dziś/dzisiaj, jutro, pojutrze, "w <dzień tygodnia>" (next one, today included), "DD.MM[.RRRR]". Hour: "o 14", "o 14:30", "na 9.15".
 */
export function parseTaskDetails(text, today) {
  let rest = String(text ?? '')
  let godzina = null
  let dzien = null
  const time = rest.match(/\b(?:o|na|godz\.?|at|@)\s+(\d{1,2})(?:[:.](\d{2}))?\s*(am|pm)?(?!\s*[.]\d)(?=\b|$)/i)
  if (time && Number(time[1]) <= 23 && (!time[2] || Number(time[2]) <= 59)) {
    const h = time[3] ? (Number(time[1]) % 12) + (time[3].toLowerCase() === 'pm' ? 12 : 0) : Number(time[1])
    godzina = `${String(h).padStart(2, '0')}:${time[2] ?? '00'}`
    rest = rest.replace(time[0], ' ')
  }
  const norm = () => normalizePl(rest)
  const rel = norm().match(/\b(dzis|dzisiaj|pojutrze|jutro|today|tomorrow|day after tomorrow)\b/)
  if (rel) {
    dzien = rel[1] === 'jutro' || rel[1] === 'tomorrow' ? addDays(today, 1) : rel[1] === 'pojutrze' || rel[1] === 'day after tomorrow' ? addDays(today, 2) : today
    rest = rest.replace(/(?<!\p{L})(?:na\s+)?(?:dziś|dzis|dzisiaj|jutro|pojutrze|day after tomorrow|tomorrow|today)(?!\p{L})/iu, ' ')
  } else {
    const wd = norm().match(/\b(?:w|we|na)\s+(poniedzialek|wtorek|srode|sroda|czwartek|piatek|sobote|sobota|niedziele|niedziela)\b/)
    if (wd) {
      const target = WEEKDAYS.find(([p]) => wd[1].startsWith(p))[1]
      const now = warsawParts(warsawLocalToUtc(today, '12:00')).weekday
      dzien = addDays(today, (target - now + 7) % 7)
      rest = rest.replace(/(?<!\p{L})(?:w|we|na)\s+(?:poniedziałek|wtorek|środę|środa|czwartek|piątek|sobotę|sobota|niedzielę|niedziela)(?!\p{L})/iu, ' ')
    } else {
      const d = rest.match(/\b(\d{1,2})\.(\d{1,2})(?:\.(\d{4}))?\b/)
      if (d && Number(d[2]) >= 1 && Number(d[2]) <= 12 && Number(d[1]) >= 1 && Number(d[1]) <= 31) {
        const year = d[3] ?? today.slice(0, 4)
        dzien = `${year}-${d[2].padStart(2, '0')}-${d[1].padStart(2, '0')}`
        rest = rest.replace(d[0], ' ')
      }
    }
  }
  if (!dzien) {
    const names = ['sunday', 'monday', 'tuesday', 'wednesday', 'thursday', 'friday', 'saturday']
    const en = normalizePl(rest).match(/\b(?:on\s+)?(sunday|monday|tuesday|wednesday|thursday|friday|saturday)\b/)
    if (en) {
      const target = names.indexOf(en[1])
      const nowDay = warsawParts(warsawLocalToUtc(today, '12:00')).weekday
      dzien = addDays(today, (target - nowDay + 7) % 7)
      rest = rest.replace(new RegExp('(?<!\\p{L})(?:on\\s+)?' + en[1] + '(?!\\p{L})', 'iu'), ' ')
    }
  }
  let filar = null
  const explicit = rest.match(/\b(?:filar|w filarze)\s+([^,.;]+)/i)
  if (explicit) {
    filar = pillarFromText(explicit[1]) ?? PILLARS.find((p) => normalizePl(p.name).includes(normalizePl(explicit[1]).trim()))?.slug ?? null
    if (filar) rest = rest.replace(explicit[0], ' ')
  }
  const tytul = strip(rest)
  if (!filar) filar = pillarFromText(tytul)
  return { tytul, godzina, dzien, filar }
}

/**
 * A task command of the Q&A, or null when the message is not one.
 *   { action: 'add', tytul, godzina, dzien, filar } | { action: 'done', query } | { action: 'today' }
 */
export function parseTaskCommand(message, today = warsawParts(new Date()).date) {
  const raw = String(message ?? '').trim().replace(/^stanley[,\s]+/i, '')
  const n = normalizePl(raw).replace(/[?!.]+$/, '').trim()
  if (/^(co (mam )?(na )?(dzis|dzisiaj)( do zrobienia)?|co dzisiaj|plan (dnia|na dzis|na dzisiaj)|lista na dzis)$/.test(n)) return { action: 'today' }
  if (/^(what['’ ]?s?( is)?( on| up)?( for)? today|what do i have( to do)? today|today['’]?s (plan|list|agenda)|plan for today|my plan( for today)?|agenda( for today)?|today)$/.test(n)) return { action: 'today' }
  const add = raw.match(/^(?:(?:dodaj|nowe|zapisz)\s+zadanie|(?:add|new|save)\s+(?:a\s+)?task)\b[\s:–—-]*(.*)$/i)
  if (add) {
    const d = parseTaskDetails(add[1], today)
    return d.tytul ? { action: 'add', ...d } : { action: 'add', tytul: '', godzina: null, dzien: null, filar: null }
  }
  const done = raw.match(/^(?:zrobione|zrobiłem|zrobiłam|zrobiony|zrobiona|gotowe|odhacz|wykonane|done|finished|completed|mark(?:ed)?(?:\s+as)?\s+done|tick\s+off|check\s+off)\b[\s:–—-]*(.+)$/i)
  if (done) return { action: 'done', query: strip(done[1]) }
  return null
}

export function isTaskCommand(message) {
  return parseTaskCommand(message) !== null
}

// ── store operations ───────────────────────────────────────────────────────────

export async function listTasks(kv) {
  const keys = await kv.list('zadania/')
  const rows = await Promise.all(keys.map((k) => kv.getJSON(k)))
  return rows.filter(Boolean).sort((a, b) => String(a.createdAt).localeCompare(String(b.createdAt)))
}

export async function addTask(kv, { tytul, filar = null, godzina = null, dzien = null }, now = new Date()) {
  const title = String(tytul ?? '').trim()
  if (!title) throw new Error('zadanie bez tytułu')
  if (title.length > 300) throw new Error('tytuł zadania ma więcej niż 300 znaków')
  if (godzina !== null && !/^\d{2}:\d{2}$/.test(godzina)) throw new Error('godzina w formacie HH:MM')
  if (dzien !== null && !/^\d{4}-\d{2}-\d{2}$/.test(dzien)) throw new Error('dzień w formacie RRRR-MM-DD')
  if (filar !== null && !PILLARS.some((p) => p.slug === filar)) throw new Error(`nieznany filar: ${filar}`)
  const id = `${now.getTime().toString(36)}-${Math.random().toString(36).slice(2, 8)}`
  const task = { id, tytul: title, filar, godzina, dzien, status: TASK_STATUS.OPEN, createdAt: now.toISOString(), doneAt: null }
  await kv.setJSON(`zadania/${id}`, task)
  return task
}

export async function setTaskStatus(kv, id, status, now = new Date()) {
  if (!Object.values(TASK_STATUS).includes(status)) throw new Error('status: otwarte albo zrobione')
  const cur = await kv.getJSON(`zadania/${id}`)
  if (!cur) throw new Error('nie ma takiego zadania')
  const next = { ...cur, status, doneAt: status === TASK_STATUS.DONE ? now.toISOString() : null }
  await kv.setJSON(`zadania/${id}`, next)
  return next
}

/** Open tasks whose title matches the query (contains it, or is contained in it); today's first. */
export function matchTasks(tasks, query, today) {
  const q = normalizePl(query).replace(/[^a-z0-9 ]+/g, ' ').replace(/\s+/g, ' ').trim()
  if (!q) return []
  return tasks
    .filter((t) => t.status === TASK_STATUS.OPEN)
    .filter((t) => { const n = normalizePl(t.tytul).replace(/[^a-z0-9 ]+/g, ' ').replace(/\s+/g, ' ').trim(); return n.includes(q) || q.includes(n) })
    .sort((a, b) => Number(b.dzien === today) - Number(a.dzien === today))
}

export async function getDayTicks(kv, date) {
  return (await kv.getJSON(`dzien/${date}`))?.done ?? []
}

export async function toggleRhythmTick(kv, date, id) {
  const done = new Set(await getDayTicks(kv, date))
  if (done.has(id)) done.delete(id)
  else done.add(id)
  await kv.setJSON(`dzien/${date}`, { done: [...done].sort() })
  return done.has(id)
}

// ── the "Dziś" list ────────────────────────────────────────────────────────────

/**
 * Items of one day: rhythm of the weekday + open tasks for that day or without a day + tasks done that day.
 * [{ id, kind: 'rytm' | 'zadanie', time, end, title, filar, done }] sorted by time; untimed last.
 */
export function dayPlan({ date, rhythm, tasks, ticks = [] }) {
  const weekday = warsawParts(warsawLocalToUtc(date, '12:00')).weekday
  const ticked = new Set(ticks)
  const items = rhythmFor(weekday, rhythm).map((e) => ({ id: e.id, kind: 'rytm', time: e.start, end: e.end, title: e.title, filar: null, done: ticked.has(e.id) }))
  for (const t of tasks) {
    const forToday = t.dzien === date || (t.dzien === null && t.status === TASK_STATUS.OPEN) || (t.dzien !== null && t.dzien < date && t.status === TASK_STATUS.OPEN)
    const doneToday = t.status === TASK_STATUS.DONE && t.doneAt && warsawParts(new Date(t.doneAt)).date === date
    if (!forToday && !doneToday) continue
    items.push({ id: t.id, kind: 'zadanie', time: t.godzina, end: null, title: t.tytul, filar: t.filar, done: t.status === TASK_STATUS.DONE, overdue: t.dzien !== null && t.dzien < date })
  }
  return {
    date,
    filarDnia: pillarOfDay(weekday, rhythm),
    items: items.sort((a, b) => (a.time ?? '99:99').localeCompare(b.time ?? '99:99') || a.title.localeCompare(b.title)),
  }
}

/** The "what's on today?" answer as text: one line per item. */
export function dayPlanText(plan) {
  if (!plan.items.length) return `${plan.date}: nothing on the plan.`
  const lines = plan.items.map((i) => `${i.done ? '✓' : '•'} ${i.time ? `${i.time}${i.end ? `–${i.end}` : ''} ` : '(no time) '}${i.title}${i.kind === 'zadanie' ? ' [task]' : ''}${i.overdue ? ' (overdue)' : ''}`)
  return `Plan for ${plan.date}${plan.filarDnia ? ` · pillar of the day: ${plan.filarDnia}` : ''}\n${lines.join('\n')}`
}

/** Runs a parsed command against the store and returns the Q&A answer { answerText, speechText, ... }. */
export async function runTaskCommand({ kv, command, now = new Date(), rhythm }) {
  const today = warsawParts(now).date
  const reply = (answerText, speechText = answerText, extra = {}) => ({ answerText, speechText, intent: 'tasks', confidence: 1, language: 'en', dataSourcesUsed: ['stanley-tasks'], warnings: [], llmUsed: false, ...extra })
  if (command.action === 'today') {
    const plan = dayPlan({ date: today, rhythm, tasks: await listTasks(kv), ticks: await getDayTicks(kv, today) })
    const open = plan.items.filter((i) => !i.done)
    return reply(dayPlanText(plan), open.length ? `Today: ${open.slice(0, 4).map((i) => `${i.time ? `${i.time} ` : ''}${i.title}`).join(', ')}${open.length > 4 ? ` and ${open.length - 4} more` : ''}.` : 'Everything for today is ticked off.', { plan })
  }
  if (command.action === 'add') {
    if (!command.tytul) return reply('Which task shall I add, sir? For example: "add task call the printer tomorrow at 10".')
    const t = await addTask(kv, command, now)
    const when = [t.dzien === today ? 'for today' : t.dzien ? `for ${t.dzien}` : 'no day', t.godzina ? `at ${t.godzina}` : null, t.filar ? `pillar: ${PILLARS.find((p) => p.slug === t.filar)?.name}` : null].filter(Boolean).join(', ')
    return reply(`Task added: "${t.tytul}" (${when}).`, `Added: ${t.tytul}.`, { task: t })
  }
  if (command.action === 'done') {
    const tasks = await listTasks(kv)
    const hits = matchTasks(tasks, command.query, today)
    if (hits.length === 0) {
      // maybe a rhythm item of today
      const weekday = warsawParts(now).weekday
      const q = normalizePl(command.query)
      const r = rhythmFor(weekday, rhythm).find((e) => normalizePl(e.title).includes(q) || q.includes(normalizePl(e.title)))
      if (r) {
        const ticks = await getDayTicks(kv, today)
        if (!ticks.includes(r.id)) await toggleRhythmTick(kv, today, r.id)
        return reply(`Ticked off for today: ${r.start} ${r.title}.`, `Ticked off: ${r.title}.`)
      }
      return reply(`I found no open task matching "${command.query}".`)
    }
    if (hits.length > 1 && !hits.every((h) => normalizePl(h.tytul) === normalizePl(hits[0].tytul))) {
      return reply(`Several tasks match: ${hits.slice(0, 5).map((h) => `"${h.tytul}"`).join(', ')}. Say which one.`)
    }
    const t = await setTaskStatus(kv, hits[0].id, TASK_STATUS.DONE, now)
    return reply(`Done: "${t.tytul}".`, `Done: ${t.tytul}.`, { task: t })
  }
  return reply('I did not understand that task command.')
}
