// Stanley's tasks: command parser ("dodaj zadanie …", "zrobione …", "co dziś?"), store operations, the "Dziś" list.
import { describe, it, expect } from 'vitest'
import {
  parseTaskCommand, parseTaskDetails, isTaskCommand, addTask, listTasks, setTaskStatus, runTaskCommand, dayPlan, dayPlanText,
  toggleRhythmTick, getDayTicks, addDays, TASK_STATUS,
} from '../../../netlify/shared/stanleyTasks.js'
import { parseRhythm } from '../../../netlify/shared/stanleyPillars.js'
import { createMemoryKv } from '../../../netlify/shared/webinarMailStore.js'

const TUE = '2026-11-24' // a Tuesday
const RHYTHM = parseRhythm([
  '- 07:00 | wt,czw | Mail webinarowy (automat)',
  '- 09:00 | codziennie | Brief dnia',
  '- 10:00–12:00 | wt | Filar dnia: Języki',
  '- 18:00 | wt,czw | Webinar',
].join('\n'))
const at = (iso: string) => new Date(iso)

describe('task command parser', () => {
  it('add: title, hour, relative day, weekday, date, pillar', () => {
    expect(parseTaskCommand('dodaj zadanie zadzwonić do drukarni jutro o 10', TUE)).toEqual({ action: 'add', tytul: 'zadzwonić do drukarni', godzina: '10:00', dzien: '2026-11-25', filar: null })
    expect(parseTaskCommand('Dodaj zadanie: korekta Szant dziś o 14:30', TUE)).toMatchObject({ tytul: 'korekta Szant', godzina: '14:30', dzien: TUE, filar: 'szanty' })
    expect(parseTaskCommand('dodaj zadanie lista członków w piątek', TUE)).toMatchObject({ tytul: 'lista członków', dzien: '2026-11-27', filar: 'stowarzyszenie' })
    expect(parseTaskCommand('dodaj zadanie raport we wtorek', TUE)).toMatchObject({ dzien: TUE }) // today counts
    expect(parseTaskCommand('dodaj zadanie wysłać umowę 3.12', TUE)).toMatchObject({ tytul: 'wysłać umowę', dzien: '2026-12-03', godzina: null })
    expect(parseTaskCommand('dodaj zadanie naprawić konto filar Google Ad Grants', TUE)).toMatchObject({ filar: 'google-ad-grants', tytul: 'naprawić konto' })
    expect(parseTaskCommand('Stanley, dodaj zadanie przegląd', TUE)).toMatchObject({ action: 'add', tytul: 'przegląd', dzien: null, godzina: null })
  })

  it('done and today', () => {
    expect(parseTaskCommand('zrobione: zadzwonić do drukarni', TUE)).toEqual({ action: 'done', query: 'zadzwonić do drukarni' })
    expect(parseTaskCommand('Zrobiłem przegląd', TUE)).toEqual({ action: 'done', query: 'przegląd' })
    for (const q of ['co dziś?', 'Co mam na dziś?', 'co dzisiaj', 'plan dnia', 'Stanley, co dziś do zrobienia?']) expect(parseTaskCommand(q, TUE), q).toEqual({ action: 'today' })
  })

  it('other questions are not task commands (they go to gieniu-command)', () => {
    for (const q of ['how much revenue today', 'ile sprzedaliśmy dziś?', 'co dziś sprzedaliśmy?', 'zadanie domowe', 'pokaż prowizje Stripe']) expect(isTaskCommand(q), q).toBe(false)
  })

  it('hours out of range are not hours; dates across the month', () => {
    expect(parseTaskDetails('coś o 25', TUE).godzina).toBeNull()
    expect(addDays('2026-11-30', 1)).toBe('2026-12-01')
    expect(addDays('2026-03-28', 1)).toBe('2026-03-29') // DST change in Warsaw
  })
})

describe('task store', () => {
  it('add, list, done; validation', async () => {
    const kv = createMemoryKv()
    const t = await addTask(kv, { tytul: 'A', godzina: '09:30', dzien: TUE, filar: 'jezyki' }, at('2026-11-24T08:00:00Z'))
    expect(t).toMatchObject({ tytul: 'A', status: TASK_STATUS.OPEN, filar: 'jezyki' })
    expect((await listTasks(kv)).map((x) => x.id)).toEqual([t.id])
    expect((await setTaskStatus(kv, t.id, TASK_STATUS.DONE, at('2026-11-24T09:00:00Z'))).doneAt).toBe('2026-11-24T09:00:00.000Z')
    await expect(addTask(kv, { tytul: '' })).rejects.toThrow(/bez tytułu/)
    await expect(addTask(kv, { tytul: 'x', godzina: '9' })).rejects.toThrow(/HH:MM/)
    await expect(addTask(kv, { tytul: 'x', filar: 'nieznany' })).rejects.toThrow(/filar/)
  })

  it('rhythm ticks per day', async () => {
    const kv = createMemoryKv()
    expect(await toggleRhythmTick(kv, TUE, RHYTHM[0].id)).toBe(true)
    expect(await getDayTicks(kv, TUE)).toEqual([RHYTHM[0].id])
    expect(await toggleRhythmTick(kv, TUE, RHYTHM[0].id)).toBe(false)
    expect(await getDayTicks(kv, '2026-11-25')).toEqual([])
  })
})

describe('"Dziś" list', () => {
  it('rhythm of the weekday + tasks of today / without a day / overdue, sorted by hour, untimed last', async () => {
    const kv = createMemoryKv()
    const now = at('2026-11-24T08:00:00Z')
    await addTask(kv, { tytul: 'Telefon', godzina: '11:00', dzien: TUE }, now)
    await addTask(kv, { tytul: 'Bez dnia' }, now)
    await addTask(kv, { tytul: 'Zaległe', dzien: '2026-11-20' }, now)
    await addTask(kv, { tytul: 'Jutro', dzien: '2026-11-25' }, now)
    const plan = dayPlan({ date: TUE, rhythm: RHYTHM, tasks: await listTasks(kv), ticks: [RHYTHM[0].id] })
    expect(plan.filarDnia).toBe('Języki')
    expect(plan.items.map((i) => `${i.time ?? '—'} ${i.title}`)).toEqual([
      '07:00 Mail webinarowy (automat)', '09:00 Brief dnia', '10:00 Filar dnia: Języki', '11:00 Telefon', '18:00 Webinar', '— Bez dnia', '— Zaległe',
    ])
    expect(plan.items[0].done).toBe(true)
    expect(plan.items.find((i) => i.title === 'Zaległe')?.overdue).toBe(true)
    expect(dayPlanText(plan)).toContain('filar dnia: Języki')
  })

  it('Q&A commands end to end: add → co dziś? → zrobione', async () => {
    const kv = createMemoryKv()
    const now = at('2026-11-24T08:00:00Z')
    const add = await runTaskCommand({ kv, command: parseTaskCommand('dodaj zadanie zadzwonić do drukarni dziś o 11', TUE)!, now, rhythm: RHYTHM })
    expect(add.answerText).toContain('Dodane zadanie: „zadzwonić do drukarni” (na dziś, o 11:00)')
    const today = await runTaskCommand({ kv, command: { action: 'today' }, now, rhythm: RHYTHM })
    expect(today.answerText).toContain('11:00 zadzwonić do drukarni [zadanie]')
    const done = await runTaskCommand({ kv, command: parseTaskCommand('zrobione drukarni', TUE)!, now, rhythm: RHYTHM })
    expect(done.answerText).toBe('Zrobione: „zadzwonić do drukarni”.')
    expect((await listTasks(kv))[0].status).toBe(TASK_STATUS.DONE)
    const rhythmDone = await runTaskCommand({ kv, command: parseTaskCommand('zrobione brief dnia', TUE)!, now, rhythm: RHYTHM })
    expect(rhythmDone.answerText).toContain('Odhaczone na dziś: 09:00 Brief dnia')
    const none = await runTaskCommand({ kv, command: parseTaskCommand('zrobione nieistniejące', TUE)!, now, rhythm: RHYTHM })
    expect(none.answerText).toContain('Nie znalazłem')
  })

  it('ambiguous "zrobione" asks which one', async () => {
    const kv = createMemoryKv()
    await addTask(kv, { tytul: 'mail do drukarni' }); await addTask(kv, { tytul: 'mail do autora' })
    const r = await runTaskCommand({ kv, command: { action: 'done', query: 'mail' }, now: at('2026-11-24T08:00:00Z'), rhythm: RHYTHM })
    expect(r.answerText).toMatch(/Pasuje kilka zadań/)
    expect((await listTasks(kv)).every((t) => t.status === TASK_STATUS.OPEN)).toBe(true)
  })
})
