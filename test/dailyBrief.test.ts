// The 09:00 brief: the hour in CET and CEST, the cron literal, every section from data only, "BRAK DANYCH" for gaps,
// the number guard on the model's introduction, the store (claim, 14 kept, dry run saves nothing).
import { describe, it, expect, vi } from 'vitest'
import { readFileSync } from 'node:fs'
import {
  BRIEF_CONFIG, isBriefHour, gatherBriefData, renderBrief, describeBrief, runDailyBrief, latestBrief, listBriefDates, zl, briefInstant,
} from '../netlify/shared/dailyBrief.js'
import { createMemoryKv, createMemoryStore } from '../netlify/shared/webinarMailStore.js'
import { parseRhythm } from '../netlify/shared/stanleyPillars.js'
import { addTask } from '../netlify/shared/stanleyTasks.js'

const RHYTHM = parseRhythm('- 07:00 | wt,czw | Mail webinarowy (automat)\n- 09:00 | codziennie | Brief dnia\n- 10:00–12:00 | śr | Filar dnia: Książki (101 drinków i Szanty)')
const KNOWLEDGE = { strategia: '', rytm: '', rhythm: RHYTHM, pillars: [{ slug: 'stowarzyszenie', name: 'Stowarzyszenie', text: '', missing: ['Jak brzmi nazwa?', 'Ile wynosi składka?', 'Ilu jest członków?'] }] }
const WED_0900_CET = new Date('2026-11-25T08:00:00Z') // Wednesday 09:00 in Warsaw

const sales = (revenue: number, orders: number, cpa: number | null, roas: number | null) => ({ ok: true, revenue, ordersCount: orders + 1, nonSaleOrdersCount: 1, adSpend: 100, realCpa: cpa, realRoas: roas })
const ROWS = [
  // ad A: spend on 22, 23, 24 with 0 purchases → flagged; ad B: a purchase on 23; ad C: unknown purchases
  ...['2026-11-22', '2026-11-23', '2026-11-24'].flatMap((date) => [
    { date, campaign_name: 'PP | zimna', ad_name: 'A', ad_id: 'a', spend: 10, meta_purchases: 0 },
    { date, campaign_name: 'PP | zimna', ad_name: 'B', ad_id: 'b', spend: 5, meta_purchases: date === '2026-11-23' ? 1 : 0 },
    { date, campaign_name: 'Cogni', ad_name: 'C', ad_id: 'c', spend: 2, meta_purchases: null },
  ]),
  { date: '2026-11-18', campaign_name: 'PP | zimna', ad_name: 'A', ad_id: 'a', spend: 7, meta_purchases: 2 },
]

function deps(over: Record<string, unknown> = {}) {
  const store = createMemoryStore({ state: { auto: true, pause: false } })
  const kv = createMemoryKv()
  return {
    sales: vi.fn(async (from: string, to: string) => (from === to ? sales(4321, 31, 32.1, 2.4) : from.endsWith('-01') ? sales(61234, 900, 30, 2.5) : sales(20000, 300, 30.5, 2.55))),
    adRows: vi.fn(async () => ROWS),
    mail: {
      store,
      wix: { getSenderName: async () => 'Marek Szurawski', countEmailSubscribers: async () => 2976, campaignStats: async () => ({ c1: { delivered: 2900, opened: 400, clicked: 20, bounced: 12 } }) },
      loadTemplates: async () => [],
    },
    kv,
    knowledge: KNOWLEDGE,
    ...over,
  } as never
}

describe('09:00 Warsaw in winter (CET) and summer (CEST)', () => {
  it('the cron has 07 and 08 UTC, the function file carries the same literal', () => {
    expect(BRIEF_CONFIG.cron).toBe('0 7,8 * * *')
    expect(readFileSync('netlify/functions/daily-brief.js', 'utf8')).toContain(`export const config = { schedule: '${BRIEF_CONFIG.cron}' }`)
  })
  it('CET: 08:00 UTC is 09:00, 07:00 UTC is not', () => {
    expect(isBriefHour(new Date('2026-12-01T08:00:00Z'))).toBe(true)
    expect(isBriefHour(new Date('2026-12-01T07:00:00Z'))).toBe(false)
  })
  it('CEST: 07:00 UTC is 09:00, 08:00 UTC is not', () => {
    expect(isBriefHour(new Date('2026-06-02T07:00:00Z'))).toBe(true)
    expect(isBriefHour(new Date('2026-06-02T08:00:00Z'))).toBe(false)
  })
  it('the switch days: 29.03 and 25.10.2026', () => {
    expect(briefInstant('2026-03-29').toISOString()).toBe('2026-03-29T07:00:00.000Z')
    expect(briefInstant('2026-10-25').toISOString()).toBe('2026-10-25T08:00:00.000Z')
  })
})

describe('sections from data only', () => {
  it('sales: yesterday, month to date vs 100 000 zł, blended CPA/ROAS with the note, thresholds', async () => {
    const d = deps()
    const r = renderBrief(await gatherBriefData({ now: WED_0900_CET, deps: d }))
    const s1 = r.sections.find((s) => s.id === 'sprzedaz')!.lines.join('\n')
    expect(s1).toContain('Yesterday (2026-11-24): 4 321,00 zł, orders: 31.')
    expect(s1).toContain('Month to date (2026-11-01 – 2026-11-24, days: 24 of 30): 61 234,00 zł = 61,2% of the 100 000,00 zł goal (pro rata to yesterday: 80 000,00 zł).')
    expect(s1).toContain('Real CPA: yesterday 32,10 zł, last 7 full days (2026-11-18 – 2026-11-24) 30,50 zł')
    expect(s1).toContain('blended')
    expect(s1).toMatch(/Thresholds \(7 full days\): OK: CPA 30\.50 zł/)
    expect((d as { sales: { mock: { calls: string[][] } } }).sales.mock.calls).toEqual(expect.arrayContaining([['2026-11-24', '2026-11-24'], ['2026-11-01', '2026-11-24'], ['2026-11-18', '2026-11-24']]))
  })

  it('Meta: spend, campaigns, pixel purchases apart, ads with spend and 0 purchases for 3 days', async () => {
    const r = renderBrief(await gatherBriefData({ now: WED_0900_CET, deps: deps() }))
    const s2 = r.sections.find((s) => s.id === 'meta')!.lines.join('\n')
    expect(s2).toContain('Spend yesterday: 17,00 zł (of which outside the blended figure, Cogni: 2,00 zł); last 7 full days: 58,00 zł.')
    expect(s2).toContain('Campaigns with spend yesterday: PP | zimna: 15,00 zł; Cogni: 2,00 zł.')
    expect(s2).toContain('Meta pixel purchases (not comparable with Wix orders): yesterday 0, 7 days 3; rows without purchase data: 3.')
    expect(s2).toContain('for 3 days (2026-11-22 – 2026-11-24): A: 30,00 zł (without purchase data: 1).')
    expect(r.gaps).toContain('NO DATA: meta_purchases (rows without a value: 3)')
  })

  it('first day of the month: no full days, no made-up month figure', async () => {
    const r = renderBrief(await gatherBriefData({ now: new Date('2026-12-01T08:00:00Z'), deps: deps() }))
    expect(r.sections[0].lines.join('\n')).toContain('the first day of the month, no full days yet')
  })

  it('a failing source is "NO DATA: <source>", listed under NEEDS ATTENTION, never a number', async () => {
    const d = deps({ sales: async () => { throw new Error('Supabase 500') }, adRows: async () => { throw new Error('timeout') } })
    const r = renderBrief(await gatherBriefData({ now: WED_0900_CET, deps: d }))
    expect(r.text).toContain('NO DATA: Wix orders (profit-data) (Supabase 500)')
    expect(r.text).toContain('NO DATA: meta_ads_daily (timeout)')
    expect(r.sections.find((s) => s.id === 'uwaga')!.lines.join('\n')).toContain('NO DATA: meta_ads_daily')
    expect(r.speech).toMatch(/^Brief for 2026-11-25./)
    expect(r.speech).not.toMatch(/sales|of the goal/) // no sales figure without sales data
  })

  it('the brief is English: no Polish template words in the text or in the spoken fallback', async () => {
    const r = renderBrief(await gatherBriefData({ now: WED_0900_CET, deps: deps() }))
    const polish = /\b(Wczoraj|Od początku|zamówień|BRAK DANYCH|Brief na|Realny|Wydatek|Kampanie z|Ostatnia wysyłka|Kolejka szablonów|Do uwagi|Pytanie do|Plan dnia|DO UWAGI|SPRZEDAŻ|REKLAMY|POCZTA|Filar dnia|zaległe)\b/
    const english = [...r.sections.map((s) => s.title), ...r.sections.flatMap((s) => s.lines.filter((l) => !/^\d{2}:\d{2}/.test(l) && !l.startsWith('Pillar of the day'))), r.speech.replace(/ Today: .*$/, '')].join('\n')   // plan titles are Filip's own (Polish) data
    expect(english).not.toMatch(polish)
    expect(r.speech.startsWith('Brief for ')).toBe(true)
  })

  it('the spoken fallback carries the day plan (not only sales): time first, at most 5 items, done ones skipped', async () => {
    const d = deps()
    await addTask((d as unknown as { kv: Parameters<typeof addTask>[0] }).kv, { tytul: 'Telefon do drukarni', godzina: '11:00', dzien: '2026-11-25' })
    const r = renderBrief(await gatherBriefData({ now: WED_0900_CET, deps: d }))
    expect(r.speech).toMatch(/Today: .*11:00 Telefon do drukarni/)
  })

  it('mail, poczta (stage 2), plan of the day with tasks, at most 2 questions', async () => {
    const d = deps()
    await addTask((d as unknown as { kv: Parameters<typeof addTask>[0] }).kv, { tytul: 'Telefon do drukarni', godzina: '11:00', dzien: '2026-11-25' })
    const r = renderBrief(await gatherBriefData({ now: WED_0900_CET, deps: d }))
    expect(r.sections.find((s) => s.id === 'maile')!.lines.join('\n')).toContain('Last send: no production sends in the log.')
    expect(r.sections.find((s) => s.id === 'poczta')!.lines[0]).toContain('Needs the Google connection (stage 2')
    expect(r.sections.find((s) => s.id === 'plan')!.lines).toEqual(['Pillar of the day: Książki (101 drinków i Szanty).', '09:00 Brief dnia', '10:00–12:00 Filar dnia: Książki (101 drinków i Szanty)', '11:00 Telefon do drukarni [task]'])
    expect(r.sections.find((s) => s.id === 'uwaga')!.lines.filter((l) => l.startsWith('Question for Filip')).length).toBe(2)
    expect(zl(1234567.891)).toBe('1 234 567,89 zł')
  })
})

describe('number guard on the model introduction (as in the Q&A)', () => {
  it('a sentence with a number outside the brief is removed; brief numbers and derived ones stay', async () => {
    const r = renderBrief(await gatherBriefData({ now: WED_0900_CET, deps: deps() }))
    const llm = async () => ({ text: 'Yesterday sales were 4 321,00 zł, sir. Month to date is 61,2% of the goal. The industry benchmark is 3,7%. By month end it will be 120 000 zł.', provider: 'test', model: 't' })
    const d = await describeBrief(r.text, llm)
    expect(d.intro).toBe('Yesterday sales were 4 321,00 zł, sir. Month to date is 61,2% of the goal.')
    expect(d.removed).toBe(2)
  })
  it('the model is asked for an ENGLISH spoken briefing that covers the plan of the day', async () => {
    const r = renderBrief(await gatherBriefData({ now: WED_0900_CET, deps: deps() }))
    let seen: { system: string; user: string } | null = null
    await describeBrief(r.text, async (system: string, user: string) => { seen = { system, user }; return { text: 'Fine, sir.' } })
    expect(seen!.system).toMatch(/in English/); expect(seen!.system).toMatch(/today's plan/); expect(seen!.system).not.toMatch(/po polsku/)
    expect(seen!.user).toContain('Write the spoken briefing in English.')
  })
  it('no model / model error → no introduction, the brief still exists', async () => {
    expect((await describeBrief('x', null)).intro).toBeNull()
    expect((await describeBrief('x', async () => { throw new Error('429') })).error).toContain('429')
  })
})

describe('run and store', () => {
  it('skips outside 09:00, claims the day once, keeps 14, dry run saves nothing, notify after save', async () => {
    const d = deps() as { kv: ReturnType<typeof createMemoryKv> }
    expect(await runDailyBrief({ now: new Date('2026-11-25T07:00:00Z'), deps: d as never })).toMatchObject({ status: 'skipped', reason: 'not-brief-hour' })
    const dry = await runDailyBrief({ now: WED_0900_CET, deps: d as never, dryRun: true })
    expect(dry.status).toBe('dry-run'); expect(await latestBrief(d.kv)).toBeNull()
    const notify = vi.fn(async () => ({ sent: 1 }))
    const first = await runDailyBrief({ now: WED_0900_CET, deps: d as never, notify })
    expect(first).toMatchObject({ status: 'saved', notified: { sent: 1 } })
    expect(notify).toHaveBeenCalledTimes(1)
    expect(await runDailyBrief({ now: new Date('2026-11-25T08:30:00Z'), deps: d as never })).toMatchObject({ status: 'skipped', reason: 'already-done' })
    for (let i = 1; i <= 20; i++) await d.kv.setJSON(`brief/2026-10-${String(i).padStart(2, '0')}`, { date: `2026-10-${i}` })
    await runDailyBrief({ now: new Date('2026-11-26T08:00:00Z'), deps: d as never })
    const dates = await listBriefDates(d.kv)
    expect(dates).toHaveLength(14)
    expect(dates[dates.length - 1]).toBe('2026-11-26')
    expect((await latestBrief(d.kv))?.date).toBe('2026-11-26')
  })
  it('a failing notification never loses the brief', async () => {
    const d = deps() as { kv: ReturnType<typeof createMemoryKv> }
    const out = await runDailyBrief({ now: WED_0900_CET, deps: d as never, notify: async () => { throw new Error('push 410') } })
    expect(out.status).toBe('saved'); expect((await latestBrief(d.kv))?.date).toBe('2026-11-25')
  })
})
