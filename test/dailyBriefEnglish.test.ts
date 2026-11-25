// The brief is English: Filip's own Polish lines (the plan of the day, the questions) are translated before the brief is
// built, every brief says lang "en", and today's old Polish brief can be written again over itself, once, with no
// second push.
import { describe, it, expect, vi } from 'vitest'
import { toEnglish, englishData, runDailyBrief, briefInstant, TRANSLATE_SYSTEM } from '../netlify/shared/dailyBrief.js'
import { createMemoryKv } from '../netlify/shared/webinarMailStore.js'

const fails = async () => { throw new Error('offline') }
const brokenDeps = () => ({
  sales: fails, adRows: fails, mail: { store: { getState: fails, getLog: fails }, wix: {}, loadTemplates: fails },
  kv: createMemoryKv(), knowledge: null,
})

describe('toEnglish', () => {
  it('translates the lines with one model call, same order', async () => {
    const llm = vi.fn(async () => ({ text: '["Call the printer", "Pillar of the day: Books"]' }))
    const r = await toEnglish(['Telefon do drukarni', 'Filar dnia: Książki'], llm)
    expect(r.lines).toEqual(['Call the printer', 'Pillar of the day: Books']); expect(r.translated).toBe(2); expect(llm).toHaveBeenCalledTimes(1)
    expect(String((llm.mock.calls[0] as unknown[])[0])).toBe(TRANSLATE_SYSTEM)
  })
  it('a fenced or chatty reply still parses; a line the model leaves alone counts as not translated', async () => {
    const r = await toEnglish(['Brief'], async () => ({ text: 'Here you go:\n```json\n["Brief"]\n```' }))
    expect(r.lines).toEqual(['Brief']); expect(r.translated).toBe(0)
  })
  it('model off, error, wrong length or wrong type → the lines come back unchanged', async () => {
    const lines = ['Telefon do drukarni', 'Książki']
    expect((await toEnglish(lines, null)).lines).toEqual(lines)
    expect((await toEnglish(lines, async () => { throw new Error('429') })).lines).toEqual(lines)
    expect((await toEnglish(lines, async () => ({ text: '["only one"]' }))).lines).toEqual(lines)
    expect((await toEnglish(lines, async () => ({ text: '[1, 2]' }))).lines).toEqual(lines)
    expect((await toEnglish(lines, async () => ({ text: 'not json at all' }))).lines).toEqual(lines)
  })
  it('an empty answer for a line keeps the original line', async () => {
    const r = await toEnglish(['Telefon', 'Książki'], async () => ({ text: '["Phone", "  "]' }))
    expect(r.lines).toEqual(['Phone', 'Książki'])
  })
})

describe('englishData', () => {
  const data = () => ({
    today: '2026-11-25',
    plan: { filarDnia: 'Książki', items: [{ time: '11:00', title: 'Telefon do drukarni', kind: 'zadanie', done: false }, { time: '18:00', title: 'Webinar', kind: 'rytm', done: false }] },
    questions: ['Ile osób jest na liście?'],
  })
  it('titles, the pillar and the questions become English; times, kinds and the rest stay', async () => {
    const r = await englishData(data(), async () => ({ text: '["Call the printer", "Webinar", "Books", "How many people are on the list?"]' }))
    expect(r.data.plan.items.map((i: { title: string }) => i.title)).toEqual(['Call the printer', 'Webinar'])
    expect(r.data.plan.items.map((i: { time: string; kind: string }) => `${i.time}/${i.kind}`)).toEqual(['11:00/zadanie', '18:00/rytm'])
    expect(r.data.plan.filarDnia).toBe('Books'); expect(r.data.questions).toEqual(['How many people are on the list?']); expect(r.data.today).toBe('2026-11-25')
    expect(r.translated).toBe(3)
  })
  it('no translation → the very same data object', async () => {
    const d = data()
    expect((await englishData(d, null)).data).toBe(d)
  })
  it('no plan, no questions → nothing is sent to the model', async () => {
    const llm = vi.fn(async () => ({ text: '[]' }))
    await englishData({ today: 'x', plan: null, questions: [] }, llm)
    expect(llm).not.toHaveBeenCalled()
  })
})

describe('runDailyBrief: English, and rewritable once', () => {
  const NOW = briefInstant('2026-11-25')
  const run = (over: Record<string, unknown> = {}, deps = brokenDeps()) => runDailyBrief({ now: NOW, deps, llm: null, ...over } as Parameters<typeof runDailyBrief>[0])

  it('every brief says lang en, even with every source down', async () => {
    const out = await run()
    expect(out.status).toBe('saved'); expect(out.brief!.lang).toBe('en')
    expect(out.brief!.speech).toMatch(/^Brief for 2026-11-25\./)
    expect(out.brief!.title).toBe('Daily brief 2026-11-25')
  })
  it('the normal run happens once a day; "overwrite" writes today over itself without a second push', async () => {
    const deps = brokenDeps()
    const notify = vi.fn(async () => ({ sent: 1 }))
    expect((await run({ notify }, deps)).status).toBe('saved')
    expect((await run({ notify }, deps)).reason).toBe('already-done')
    expect(notify).toHaveBeenCalledTimes(1)
    const again = await run({ overwrite: true, notify }, deps)
    expect(again.status).toBe('saved'); expect(notify).toHaveBeenCalledTimes(1)   // no second push
    expect((await deps.kv.getJSON('brief/2026-11-25') as { lang: string }).lang).toBe('en')
  })
  it('"overwrite" works at any hour (the app asks when the user opens it, not at 09:00)', async () => {
    const out = await runDailyBrief({ now: new Date('2026-11-25T16:30:00Z'), deps: brokenDeps(), llm: null, overwrite: true })
    expect(out.status).toBe('saved')
    expect((await runDailyBrief({ now: new Date('2026-11-25T16:30:00Z'), deps: brokenDeps(), llm: null })).reason).toBe('not-brief-hour')
  })
  it('a dry run saves nothing', async () => {
    const deps = brokenDeps()
    expect((await run({ dryRun: true }, deps)).status).toBe('dry-run')
    expect(await deps.kv.getJSON('brief/2026-11-25')).toBeNull()
  })
})
