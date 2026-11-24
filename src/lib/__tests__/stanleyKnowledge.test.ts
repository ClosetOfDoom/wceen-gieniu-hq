// Stanley's knowledge (stanley-wiedza/): files present and well-formed, product → pillar map equal to the strategy table,
// the day rhythm parsed, the pillar of each weekday, at most two missing-data questions a day.
import { describe, it, expect, beforeAll } from 'vitest'
import {
  loadKnowledge, parseRhythm, rhythmFor, pillarOfDay, missingDataOf, questionsForDay, PRODUCT_PILLARS, PILLARS,
  pillarOfProduct, pillarFromText, knowledgeContext, allMissingQuestions, STRATEGIC_MONTHLY_GOAL,
} from '../../../netlify/shared/stanleyKnowledge.js'
import { PRODUCTS } from '../../../netlify/shared/productCatalog.js'
import { GOALS } from '../../../netlify/shared/alertRules.js'

describe('stanley-wiedza files', () => {
  it('strategy, rhythm and one file per pillar, each with the five sections', async () => {
    const k = await loadKnowledge()
    expect(k.strategia).toContain('100 000 zł')
    expect(k.pillars.map((p) => p.slug)).toEqual(PILLARS.map((p) => p.slug))
    for (const p of k.pillars) {
      for (const h of ['## Opis', '## Model przychodu', '## KPI', '## Stan', '## Brakujące dane']) expect(p.text, `${p.slug}: ${h}`).toContain(h)
      expect(p.missing.length, p.slug).toBeGreaterThan(0)
    }
    expect(knowledgeContext(k)).toContain('BRAK DANYCH')
    expect(allMissingQuestions(k).length).toBeGreaterThan(6)
  })

  it('the strategic goal is the monthly revenue goal (a goal, not an alarm)', () => {
    expect(STRATEGIC_MONTHLY_GOAL).toBe(100000)
    expect(GOALS.MONTHLY_REVENUE).toBe(STRATEGIC_MONTHLY_GOAL)
  })

  it('no number in the pillar files that Filip did not give (only the catalog price of WSZTP)', async () => {
    const k = await loadKnowledge()
    for (const p of k.pillars) {
      const nums = (p.text.match(/\d[\d\s]*(?:zł|%)/g) ?? []).map((s) => s.trim())
      if (p.slug === 'wsztp') expect(nums).toEqual(['3450 zł'])
      else expect(nums, p.slug).toEqual([])
    }
  })
})

describe('product → pillar', () => {
  it('only certain assignments, every key exists in the catalog, the strategy table says the same', async () => {
    for (const key of Object.keys(PRODUCT_PILLARS)) expect(PRODUCTS).toHaveProperty(key)
    for (const slug of Object.values(PRODUCT_PILLARS)) expect(PILLARS.map((p) => p.slug)).toContain(slug)
    const md = (await loadKnowledge()).strategia
    const table = Object.fromEntries([...md.matchAll(/^\|\s*([a-z0-9_]+)\s*\|[^|]+\|\s*([a-z0-9-]+)\s*\|$/gm)].map((m) => [m[1], m[2]]))
    expect(table).toEqual({ ...PRODUCT_PILLARS })
    // every other catalog product is listed as unassigned
    for (const key of Object.keys(PRODUCTS).filter((k) => !(k in PRODUCT_PILLARS))) {
      expect(pillarOfProduct(key)).toBe('nieprzypisane')
      expect(md, key).toContain(key)
    }
  })

  it('free text → pillar', () => {
    expect(pillarFromText('zadzwonić do drukarni w sprawie Szant')).toBe('szanty')
    expect(pillarFromText('poprawić kampanię Google Ad Grants')).toBe('google-ad-grants')
    expect(pillarFromText('lista członków stowarzyszenia')).toBe('stowarzyszenie')
    expect(pillarFromText('opis WSZTP na stronę')).toBe('wsztp')
    expect(pillarFromText('nagranie do Językozaka')).toBe('jezyki')
    expect(pillarFromText('kupić mleko')).toBeNull()
  })
})

describe('day rhythm', () => {
  let rhythm: ReturnType<typeof parseRhythm> = []
  beforeAll(async () => { rhythm = parseRhythm((await loadKnowledge()).rytm) })

  it('Tuesday: mail 07:00, brief 09:00, poczta, filar Języki, reklamy, webinar 18:00, ClickMeeting 20:30', () => {
    expect(rhythmFor(2, rhythm).map((e) => `${e.start} ${e.title}`)).toEqual([
      '07:00 Mail webinarowy (automat)', '09:00 Brief dnia', '09:15 Poczta i odpowiedzi', '10:00 Filar dnia: Języki',
      '13:00 Przegląd reklam', '18:00 Webinar', '20:30 Wpis rejestracji z ClickMeeting',
    ])
    expect(rhythmFor(2, rhythm).find((e) => e.start === '09:15')?.end).toBe('10:00')
  })

  it('pillar of the day: Mon–Fri, none at the weekend', () => {
    expect([1, 2, 3, 4, 5].map((d) => pillarOfDay(d, rhythm))).toEqual([
      'Stowarzyszenie', 'Języki', 'Książki (101 drinków i Szanty)', 'WSZTP', 'Google Ad Grants i reklamy',
    ])
    expect(pillarOfDay(0, rhythm)).toBeNull(); expect(pillarOfDay(6, rhythm)).toBeNull()
  })

  it('a malformed day is an error, unique ids', () => {
    expect(() => parseRhythm('- 10:00 | xyz | Coś')).toThrow(/nieznany dzień/)
    expect(new Set(rhythm.map((e) => e.id)).size).toBe(rhythm.length)
  })
})

describe('missing-data questions', () => {
  it('reads the bullets of "Brakujące dane", at most two a day, the same for one date', () => {
    expect(missingDataOf('# X\n## Stan\n- nie\n## Brakujące dane\n- A?\n- B?\n## Inne\n- C')).toEqual(['A?', 'B?'])
    const qs = ['1', '2', '3', '4', '5']
    expect(questionsForDay(qs, '2026-11-25')).toHaveLength(2)
    expect(questionsForDay(qs, '2026-11-25')).toEqual(questionsForDay(qs, '2026-11-25'))
    expect(questionsForDay(qs, '2026-11-25')).not.toEqual(questionsForDay(qs, '2026-11-26'))
    expect(questionsForDay([], '2026-11-25')).toEqual([])
  })
})
