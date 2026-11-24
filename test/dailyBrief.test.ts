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
    expect(s1).toContain('Wczoraj (2026-11-24): 4 321,00 zł, zamówień: 31.')
    expect(s1).toContain('Od początku miesiąca (2026-11-01 – 2026-11-24, dni: 24 z 30): 61 234,00 zł = 61,2% celu 100 000,00 zł (prorata na wczoraj: 80 000,00 zł).')
    expect(s1).toContain('Realny CPA: wczoraj 32,10 zł, 7 pełnych dób (2026-11-18 – 2026-11-24) 30,50 zł')
    expect(s1).toContain('blended')
    expect(s1).toMatch(/Progi \(7 pełnych dób\): OK: CPA 30\.50 zł/)
    expect((d as { sales: { mock: { calls: string[][] } } }).sales.mock.calls).toEqual(expect.arrayContaining([['2026-11-24', '2026-11-24'], ['2026-11-01', '2026-11-24'], ['2026-11-18', '2026-11-24']]))
  })

  it('Meta: spend, campaigns, pixel purchases apart, ads with spend and 0 purchases for 3 days', async () => {
    const r = renderBrief(await gatherBriefData({ now: WED_0900_CET, deps: deps() }))
    const s2 = r.sections.find((s) => s.id === 'meta')!.lines.join('\n')
    expect(s2).toContain('Wydatek wczoraj: 17,00 zł (w tym poza blended, Cogni: 2,00 zł); 7 pełnych dób: 58,00 zł.')
    expect(s2).toContain('Kampanie z wydatkiem wczoraj: PP | zimna: 15,00 zł; Cogni: 2,00 zł.')
    expect(s2).toContain('Zakupy piksela Meta (nieporównywalne z zamówieniami Wix): wczoraj 0, 7 dób 3; bez danych o zakupach w wierszach: 3.')
    expect(s2).toContain('przez 3 dni (2026-11-22 – 2026-11-24): A: 30,00 zł (bez danych o zakupach: 1).')
    expect(r.gaps).toContain('BRAK DANYCH: meta_purchases (wiersze bez wartości: 3)')
  })

  it('first day of the month: no full days, no made-up month figure', async () => {
    const r = renderBrief(await gatherBriefData({ now: new Date('2026-12-01T08:00:00Z'), deps: deps() }))
    expect(r.sections[0].lines.join('\n')).toContain('pierwszy dzień miesiąca, brak pełnych dni')
  })

  it('a failing source is "BRAK DANYCH: <źródło>", listed under DO UWAGI, never a number', async () => {
    const d = deps({ sales: async () => { throw new Error('Supabase 500') }, adRows: async () => { throw new Error('timeout') } })
    const r = renderBrief(await gatherBriefData({ now: WED_0900_CET, deps: d }))
    expect(r.text).toContain('BRAK DANYCH: zamówienia Wix (profit-data) (Supabase 500)')
    expect(r.text).toContain('BRAK DANYCH: meta_ads_daily (timeout)')
    expect(r.sections.find((s) => s.id === 'uwaga')!.lines.join('\n')).toContain('BRAK DANYCH: meta_ads_daily')
    expect(r.speech).toMatch(/^Brief na 2026-11-25./)
    expect(r.speech).not.toMatch(/sprzedaż|celu/) // no sales figure without sales data
  })

  it('mail, poczta (stage 2), plan of the day with tasks, at most 2 questions', async () => {
    const d = deps()
    await addTask((d as unknown as { kv: Parameters<typeof addTask>[0] }).kv, { tytul: 'Telefon do drukarni', godzina: '11:00', dzien: '2026-11-25' })
    const r = renderBrief(await gatherBriefData({ now: WED_0900_CET, deps: d }))
    expect(r.sections.find((s) => s.id === 'maile')!.lines.join('\n')).toContain('Ostatnia wysyłka: brak wysyłek produkcyjnych w logu.')
    expect(r.sections.find((s) => s.id === 'poczta')!.lines[0]).toContain('Wymaga połączenia Google (etap 2')
    expect(r.sections.find((s) => s.id === 'plan')!.lines).toEqual(['Filar dnia: Książki (101 drinków i Szanty).', '09:00 Brief dnia', '10:00–12:00 Filar dnia: Książki (101 drinków i Szanty)', '11:00 Telefon do drukarni [zadanie]'])
    expect(r.sections.find((s) => s.id === 'uwaga')!.lines.filter((l) => l.startsWith('Pytanie do Filipa')).length).toBe(2)
    expect(zl(1234567.891)).toBe('1 234 567,89 zł')
  })
})

describe('number guard on the model introduction (as in the Q&A)', () => {
  it('a sentence with a number outside the brief is removed; brief numbers and derived ones stay', async () => {
    const r = renderBrief(await gatherBriefData({ now: WED_0900_CET, deps: deps() }))
    const llm = async () => ({ text: 'Wczoraj sprzedaż 4 321,00 zł, sir. Od początku miesiąca 61,2% celu. Benchmark branży to 3,7%. Do końca miesiąca będzie 120 000 zł.', provider: 'test', model: 't' })
    const d = await describeBrief(r.text, llm)
    expect(d.intro).toBe('Wczoraj sprzedaż 4 321,00 zł, sir. Od początku miesiąca 61,2% celu.')
    expect(d.removed).toBe(2)
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
