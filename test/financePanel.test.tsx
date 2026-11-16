// @vitest-environment jsdom
// Panel odpowiedzi finansowych i jakość komentarza: renderer bloków (tabela HTML, komentarz, bezpieczeństwo), metryki pochodne,
// reguła małej próby, kontrola liczb, mowa. Dane syntetyczne, bez sieci.
import { act } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { afterEach, describe, expect, it } from 'vitest'
import { FinanceAnswer, STATUS_COLOR, keepFigures } from '../src/components/FinanceAnswer'
import { safeFinanceSpeech, textToSpeak } from '../src/lib/financeSpeech'
import { blocksToText, inlineParts } from '../netlify/shared/financeBlocks.js'
import { buildReportBlocks, buildFinanceView, renderReport } from '../netlify/shared/financeStore.js'
import { buildAllowed, refineSections, smallSampleRules, speechFrom, sectionsFrom, limitWords } from '../netlify/shared/financeVerify.js'

;(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true

// ── fixture: Stripe wrzesień i październik z przykładu (160 → 138 płatności, brutto +6,5%, jeden zwrot w każdym miesiącu) ─────────

const flow = (gross: number, payments: number, refunds: number, extra: Record<string, unknown> = {}) => ({
  currency: 'PLN', paymentsCount: payments, gross, refunds, disputes: 0, fees: 52_000, otherFees: 0, climate: 0, other: 0, outgoing: 0, topUps: 0,
  net: gross - refunds - 52_000, payoutsSum: 0, payoutsCount: 0, opening: null, closing: null, otherCurrencies: [], ...extra,
})
const summaryOf = (month: string, stripe: unknown) => ({
  schemaVersion: 1, month, generatedAt: `${month}-28T10:00:00.000Z`, closed: true, amountsUnit: 'grosze',
  sources: [{ name: 'STRIPE', status: 'OK', reason: null }], stripe, p24: null, paypal: null,
  meta: { insightsSpendByScope: [], paypalCharges: [], paypalChargesSum: [] }, checks: [], notes: [],
})
const viewOf = (sep: ReturnType<typeof flow>, oct: ReturnType<typeof flow>) => {
  const s = summaryOf('2026-09', sep)
  const o = summaryOf('2026-10', oct)
  const index = { months: [s, o].map((x) => ({ month: x.month, closed: true, generatedAt: x.generatedAt, sources: [{ name: 'STRIPE', status: 'OK' }] })) }
  return buildFinanceView({ index, summaries: new Map<string, unknown>([['2026-08', null], ['2026-09', s], ['2026-10', o]]), months: ['2026-10'], source: 'stripe' })
}
// 2 061 300 / 160 = 128,83 zł;  2 196 200 / 138 = 159,14 zł;  brutto +6,5%;  zwroty 119,00 zł → 60,00 zł (−49,6%)
const SEP = flow(2_061_300, 160, 11_900)
const OCT = flow(2_196_200, 138, 6_000)

describe('metryki pochodne (serwer)', () => {
  const text = renderReport(viewOf(SEP, OCT))

  it('160 i 138 płatności daje średnią 128,83 i 159,14 zł; w raporcie tabela metryk i linia zmiany', () => {
    expect(text).toContain('METRYKI POCHODNE (liczone na serwerze z danych raportu)')
    const row = text.split('\n').find((l) => l.startsWith('2026-10') && l.includes('138'))!
    expect(row.split(/ {2,}/).slice(0, 4)).toEqual(['2026-10', 'STRIPE', '138', '159,14 zł'])
    expect(text).toContain('płatności 160 → 138; śr. płatność 128,83 zł → 159,14 zł')
    expect(text).toContain('brutto 20 613,00 zł → 21 962,00 zł (+1 349,00 zł, +6,5%)')
  })

  it('prowizja jako % brutto z danych; liczba zwrotów i udział: „brak w pliku”, gdy summary nie ma refundsCount', () => {
    const row = text.split('\n').find((l) => l.startsWith('2026-10') && l.includes('138'))!
    expect(row).toContain('2,4%') // 520,00 zł z 21 962,00 zł
    expect(row.split(/ {2,}/).slice(4)).toEqual(['brak w pliku', 'brak', '2,4%'])
    expect(text).toContain('Liczba zwrotów nie jest w pliku summary (brak pola refundsCount)')
  })

  it('Stripe zawiera też płatności spoza Wix: raport mówi to wprost i nie przypisuje wzrostu sprzedaży Wix', () => {
    expect(text).toContain('Stripe obejmuje także płatności spoza Wix (np. Cogni)')
    expect(text).toContain('nie ma rozbicia brutto na produkty ani źródła sprzedaży')
  })

  it('znane liczby zwrotów: udział zwrotów w liczbie płatności', () => {
    const t = renderReport(viewOf(flow(2_061_300, 160, 11_900, { refundsCount: 8 }), flow(2_196_200, 138, 60_000, { refundsCount: 9 })))
    const row = t.split('\n').find((l) => l.startsWith('2026-10') && l.includes('138'))!
    expect(row.split(/ {2,}/).slice(4, 6)).toEqual(['9', '6,5%']) // 9 z 138 płatności
  })
})

describe('reguła małej próby', () => {
  it('1 zwrot vs 1 zwrot: bez procentu i bez trendu (zmiana kwoty jest w danych, procent nie)', () => {
    const view = viewOf(flow(2_061_300, 160, 11_900, { refundsCount: 1 }), flow(2_196_200, 138, 6_000, { refundsCount: 1 }))
    const t = renderReport(view)
    expect(t).toContain('zwroty 119,00 zł → 60,00 zł (-59,00 zł); zbyt mało zdarzeń (zwroty 1 → 1) — bez zmiany procentowej i bez trendu')
    expect(t).not.toContain('-49,6%')
    expect(smallSampleRules(view)).toEqual([{ id: 'zwroty', gen: 'zwrotów', pattern: expect.any(RegExp), n: '1 → 1' }])
  })

  it('nieznana liczba zwrotów (obecny summary) też nie daje procentu', () => {
    const view = viewOf(SEP, OCT)
    const t = renderReport(view)
    expect(t).toContain('liczba zwrotów nieznana (brak pola refundsCount w pliku) — bez zmiany procentowej, to nie jest trend')
    expect(t).not.toContain('-49,6%')
    expect(smallSampleRules(view)[0]).toMatchObject({ id: 'zwroty', n: null })
  })

  it('co najmniej 5 zdarzeń w obu okresach: procent jest, reguła nie działa', () => {
    const view = viewOf(flow(2_061_300, 160, 11_900, { refundsCount: 6 }), flow(2_196_200, 138, 6_000, { refundsCount: 5 }))
    expect(renderReport(view)).toContain('zwroty 119,00 zł → 60,00 zł (-59,00 zł, -49,6%)')
    expect(smallSampleRules(view)).toEqual([])
  })

  it('komentarz modelu o trendzie zwrotów jest zastąpiony „zbyt mało zdarzeń (n)”, poziom (udział w brutto) zostaje', () => {
    const view = viewOf(flow(2_061_300, 160, 11_900, { refundsCount: 1 }), flow(2_196_200, 138, 6_000, { refundsCount: 1 }))
    const allowed = buildAllowed({ reportText: renderReport(view), data: [view] })
    const raw = ['WNIOSKI', 'Zwroty spadły o 49,6% (z 119,00 zł do 60,00 zł), co jest wyraźnym trendem.', 'Zwroty stanowią 0,3% brutto w październiku (60,00 zł z 21 962,00 zł).'].join('\n')
    const { sections, counts } = refineSections(raw, allowed, { smallSample: smallSampleRules(view) })
    const items = sections[0]!.items
    expect(items[0]).toBe('Zwroty: zbyt mało zdarzeń (1 → 1) — bez trendu i bez zmiany procentowej.')
    expect(items.join(' ')).not.toContain('49,6')
    expect(items.join(' ')).toContain('Zwroty stanowią 0,3% brutto') // poziom, nie trend
    expect(counts.smallSample).toBe(1)
  })
})

describe('kontrola liczb i reguły komentarza', () => {
  const view = viewOf(SEP, OCT)
  const report = renderReport(view)
  const allowed = buildAllowed({ reportText: report, data: [view] })
  const refine = (raw: string) => refineSections(raw, allowed, { smallSample: smallSampleRules(view) })

  it('metryki pochodne może cytować model; liczba spoza danych jest usuwana', () => {
    const { sections, counts } = refine([
      'WNIOSKI',
      'Stripe, 2026-10, status OK: liczba płatności spadła z 160 do 138, a średnia płatność wzrosła z 128,83 zł do 159,14 zł.',
      'Płatności było 777 w październiku.',
    ].join('\n'))
    const text = sections[0]!.items.join(' ')
    expect(text).toContain('z 160 do 138')
    expect(text).toContain('159,14 zł')
    expect(text).not.toContain('777')
    expect(counts.removed).toBe(1)
  })

  it('ogólniki są usuwane (monitorować, rozważyć działania marketingowe, warto przeanalizować)', () => {
    const { sections, counts } = refine([
      'WNIOSKI', 'Brutto Stripe w październiku wynosi 21 962,00 zł.',
      'CO SPRAWDZIĆ LUB ZROBIĆ', 'Warto monitorować płatności.', 'Rozważyć działania marketingowe.', 'Warto przeanalizować dane.',
      'Porównaj liczbę płatności z 160 i 138 w panelu Stripe, filtr Opłacone.',
    ].join('\n'))
    const actions = sections.find((s) => s.id === 'CO SPRAWDZIĆ LUB ZROBIĆ')!.items
    expect(actions).toEqual(['Porównaj liczbę płatności z 160 i 138 w panelu Stripe, filtr Opłacone.'])
    expect(counts.generic).toBe(3)
  })

  it('hipoteza bez „Sprawdź”, „Potwierdzi” i „Obali” odpada; kompletna zostaje', () => {
    const good = 'Hipoteza: wzrost brutto to wyższa średnia płatność. Sprawdź: liczbę płatności w panelu Stripe. Potwierdzi, jeśli płatności spadły; obali, jeśli wzrosły.'
    const { sections, counts } = refine(['WNIOSKI', 'Brutto 21 962,00 zł.', 'DLACZEGO', 'Pewnie to sezon.', good].join('\n'))
    expect(sections.find((s) => s.id === 'DLACZEGO')!.items).toEqual([good])
    expect(counts.hypotheses).toBe(1)
  })

  it('komentarz do 150 słów: nadmiar odpada od końca, pierwszy wniosek zostaje', () => {
    const long = Array.from({ length: 40 }, (_v, i) => `słowo${i}`).join(' ')
    const sections = sectionsFrom(['WNIOSKI', `Wniosek: ${long}.`, 'POMYSŁY', `Propozycja: ${long} ${long}.`, `Propozycja: ${long}.`].join('\n'))
    const { sections: out, trimmed } = limitWords(sections, 150)
    expect(out.flatMap((s) => s.items).join(' ').split(/\s+/).length).toBeLessThanOrEqual(150)
    expect(out[0]!.id).toBe('WNIOSKI')
    expect(trimmed).toBeGreaterThan(0)
  })
})

describe('mowa (Auto-speak) — nie czyta tabeli ani listy liczb', () => {
  const view = viewOf(SEP, OCT)
  const blocks = buildReportBlocks(view)
  const tableText = blocksToText(blocks)

  it('speechFrom: jedno–dwa zdania wniosku, bez Markdownu i bez zdań z listą liczb', () => {
    const sections = sectionsFrom(['WNIOSKI', '**Brutto Stripe** w październiku wzrosło o 6,5%, mimo spadku liczby płatności. Średnia płatność wzrosła do 159,14 zł. Trzecie zdanie nie jest czytane.', 'POMYSŁY', 'Propozycja: coś'].join('\n'))
    expect(speechFrom(sections)).toBe('Brutto Stripe w październiku wzrosło o 6,5%, mimo spadku liczby płatności. Średnia płatność wzrosła do 159,14 zł.')
    const listy = sectionsFrom(['WNIOSKI', 'Brutto wzrosło o 6,5%, a wartości to 1 111 zł, 2 222 zł, 3 333 zł, 4 444 zł.'].join('\n'))
    expect(speechFrom(listy)).toBe('Brutto wzrosło o 6,5%, a wartości to 1 111 zł.') // ogon z listą liczb obcięty
  })

  it('safeFinanceSpeech odrzuca wiersze tabeli, kreski i punktory; textToSpeak dla odpowiedzi finansowej nie wraca do pełnego tekstu', () => {
    const fromTable = safeFinanceSpeech(tableText) // pełny tekst raportu: ani wiersze, ani nagłówki tabel, ani kwoty, najwyżej dwa zdania prozy
    expect(fromTable).not.toMatch(/2026-1|STRIPE|SUMY|METRYKI|Miesiąc|---|\d{2} \d{3},\d{2}/)
    expect(fromTable.split(/(?<=[.!?…])\s+/).length).toBeLessThanOrEqual(2)
    expect(safeFinanceSpeech('Brutto wzrosło o 6,5%. Średnia płatność wzrosła.\n- punkt\n2026-10  STRIPE  OK  21 962,00 zł')).toBe('Brutto wzrosło o 6,5%. Średnia płatność wzrosła.')
    expect(textToSpeak('', tableText, blocks)).toBe('') // pusta mowa = cisza, nie czytanie tabeli
    expect(textToSpeak('Krótki wniosek.', tableText, blocks)).toBe('Krótki wniosek.')
    expect(textToSpeak('', 'zwykła odpowiedź pulpitu')).toBe('zwykła odpowiedź pulpitu') // inne odpowiedzi bez zmian
  })
})

describe('FinanceAnswer — renderer (jsdom)', () => {
  let root: Root | null = null
  let host: HTMLElement | null = null
  afterEach(() => {
    act(() => root?.unmount())
    host?.remove()
    root = null
    host = null
  })

  function mount(blocks: ReturnType<typeof buildReportBlocks>, width = 380) {
    host = document.createElement('div')
    host.style.width = `${width}px`
    document.body.appendChild(host)
    root = createRoot(host)
    act(() => root!.render(<FinanceAnswer blocks={blocks} />))
    return host
  }

  const comment = {
    type: 'comment' as const,
    sections: [
      { id: 'WNIOSKI', title: 'WNIOSKI', items: ['**Brutto** wzrosło o 6,5%, a płatności spadły.', 'Druga linia listy.'] },
      { id: 'DLACZEGO', title: 'DLACZEGO', items: ['Hipoteza: <script>window.__pwned = 1</script> **ważne**'] },
    ],
  }

  it('tabela z danych: prawdziwy <table>, kolumny w kolejności, liczby wyrównane do prawej i bez zawijania, przewijanie poziome', () => {
    const el = mount([...buildReportBlocks(viewOf(SEP, OCT)), comment])
    const table = el.querySelector('table')!
    expect([...table.querySelectorAll('thead th')].map((th) => th.textContent)).toEqual(['Miesiąc', 'Źródło', 'Status', 'Brutto', 'Zwroty', 'Prowizje', 'Netto'])
    const row = [...table.querySelectorAll('tbody tr')].find((tr) => tr.textContent?.includes('2026-10'))!
    const cells = [...row.querySelectorAll('td')] as HTMLElement[]
    expect(cells.map((c) => c.textContent).slice(0, 2)).toEqual(['2026-10', 'STRIPE'])
    for (const c of cells) expect(c.style.whiteSpace).toBe('nowrap') // żadna komórka (liczba też) się nie zawija
    for (const c of cells.slice(3)) expect(c.style.textAlign).toBe('right') // brutto, zwroty, prowizje, netto
    expect(cells[3]!.textContent).toBe('21 962,00 zł')
    const scroll = el.querySelector('[data-testid="finance-table-scroll"]') as HTMLElement
    expect(scroll.style.overflowX).toBe('auto') // w wąskim panelu tabela przewija się, a nie łamie liczb
    expect(table.style.minWidth).toBe('max-content')
  })

  it('kwoty i procenty w komentarzu nie łamią się w linii (twarde spacje, tylko w wyświetlaniu)', () => {
    expect(keepFigures('z 20 613,00 zł do 6,5% i 160 płatności')).toBe('z 20 613,00 zł do 6,5% i 160 płatności')
    const el = mount([{ type: 'comment' as const, sections: [{ id: 'WNIOSKI', title: 'WNIOSKI', items: ['Brutto 21 962,00 zł'] }] }])
    expect(el.querySelector('li')!.textContent).toBe('Brutto 21 962,00 zł')
    expect(blocksToText([{ type: 'comment', sections: [{ id: 'WNIOSKI', title: 'WNIOSKI', items: ['Brutto 21 962,00 zł'] }] }])).toContain('- Brutto 21 962,00 zł') // kopia: zwykłe spacje
  })

  it('status kolorem: OK zielony, NIEPEŁNY żółty, UWAGA czerwony', () => {
    expect(STATUS_COLOR).toEqual({ OK: 'var(--green)', NIEPEŁNY: 'var(--amber)', UWAGA: 'var(--red)' })
    const table = { type: 'table' as const, title: 'T', columns: [{ key: 'status', label: 'Status', align: 'left' as const }], rows: ['OK', 'NIEPEŁNY', 'UWAGA'].map((s) => ({ cells: [s], status: s })) }
    const el = mount([table])
    const colors = [...el.querySelectorAll('td')].map((td) => (td as HTMLElement).style.color)
    expect(colors).toEqual(['var(--green)', 'var(--amber)', 'var(--red)'])
  })

  it('komentarz: **pogrubienie** jako <strong>, sekcje i lista; surowych gwiazdek nie ma', () => {
    const el = mount([comment])
    const c = el.querySelector('[data-testid="finance-comment"]')!
    expect([...c.querySelectorAll('h4')].map((h) => h.textContent)).toEqual(['WNIOSKI', 'DLACZEGO'])
    expect(c.querySelectorAll('ul')).toHaveLength(2)
    expect(c.querySelectorAll('li')).toHaveLength(3)
    expect(c.querySelector('li strong')!.textContent).toBe('Brutto')
    expect(c.textContent).not.toContain('**')
  })

  it('<script> w komentarzu nie wykonuje się: jest tekstem, bez elementu <script> i bez efektu', () => {
    const el = mount([comment])
    expect(el.querySelector('script')).toBeNull()
    expect(el.innerHTML).toContain('&lt;script&gt;window.__pwned = 1&lt;/script&gt;')
    expect((window as { __pwned?: number }).__pwned).toBeUndefined()
    expect(el.innerHTML).not.toMatch(/<script/i)
    const bolds = [...el.querySelectorAll('li strong')]
    expect(bolds[bolds.length - 1]!.textContent).toBe('ważne')
  })

  it('tekst do kopiowania pochodzi z tych samych bloków: bez znaczników, te same liczby co w tabeli', () => {
    const blocks = [...buildReportBlocks(viewOf(SEP, OCT)), comment]
    const text = blocksToText(blocks)
    expect(text).not.toContain('**')
    expect(text).toContain('KOMENTARZ\nWNIOSKI\n- Brutto wzrosło o 6,5%, a płatności spadły.')
    expect(text.startsWith(renderReport(viewOf(SEP, OCT)))).toBe(true) // raport = ten sam tekst co renderReport (jedna ścieżka)
    expect(inlineParts('a **b** c')).toEqual([{ text: 'a ', bold: false }, { text: 'b', bold: true }, { text: ' c', bold: false }])
    expect(inlineParts('**<img src=x onerror=alert(1)>**')).toEqual([{ text: '<img src=x onerror=alert(1)>', bold: true }]) // tylko tekst
  })
})
