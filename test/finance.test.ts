// get_finance: widok danych (czysta funkcja), odczyt z bucketu (podstawiony fetch), funkcja finance-data,
// rozpoznawanie pytań i ścieżka Stanleya z narzędziem (podstawiony fetch modelu). Dane syntetyczne, bez sieci.
import { describe, expect, it, vi } from 'vitest'
import { handler as financeDataHandler } from '../netlify/functions/finance-data.js'
import { answerFinance, bankCostAnswer, FINANCE_RULES } from '../netlify/shared/financeStanley.js'
import { isBankCostQuestion, isFinanceQuestion } from '../netlify/shared/financeIntent.js'
import {
  buildFinanceView, fmt, getFinance, mergeViews, pct, previousMonth, renderReport, RequestError, validateRequest,
} from '../netlify/shared/financeStore.js'
import { enforceRefusal } from '../src/lib/refusalGuard'

// ── fixture: trzy miesiące w kształcie summary.json (kwoty w groszach) ───────────────────────

type Flow = Record<string, unknown>
const flow = (o: Partial<Flow> & { gross: number }): Flow => ({
  currency: 'PLN', paymentsCount: 10, refunds: 0, disputes: 0, fees: 0, otherFees: 0, climate: 0, other: 0, outgoing: 0, topUps: 0,
  net: o.gross, payoutsSum: 0, payoutsCount: 0, opening: null, closing: null, ...o,
})
const checks = (names: string[], ok = true) => names.map((name) => ({ name, ok, diff: ok ? 0 : 1234 }))
const src = (name: string, status = 'OK', reason: string | null = null) => ({ name, status, reason })

function summary(month: string, extra: Record<string, unknown>) {
  return {
    schemaVersion: 1, month, generatedAt: `${month}-28T10:00:00.000Z`, closed: true, amountsUnit: 'grosze',
    sources: [src('STRIPE'), src('PAYPAL'), src('PRZELEWY24'), src('META_ADS')],
    stripe: null, p24: null, paypal: null,
    meta: { insightsSpendByScope: [], paypalCharges: [], paypalChargesSum: [] },
    checks: [], notes: [], ...extra,
  }
}

const SEP = summary('2026-09', {
  stripe: { ...flow({ gross: 1_800_000, paymentsCount: 120, refunds: 40_000, fees: 40_000, otherFees: 3_000, climate: 2_000, net: 1_715_000, payoutsSum: 1_700_000, payoutsCount: 20 }), otherCurrencies: [] },
  p24: { ...flow({ gross: 3_000_000, paymentsCount: 200, fees: 12_000, net: 2_988_000, payoutsSum: 2_950_000, payoutsCount: 25 }), otherCurrencies: [] },
  paypal: { byCurrency: [flow({ gross: 100_000, paymentsCount: 8, fees: 4_000, net: -20_000, opening: 50_000, closing: 30_000 })] },
  meta: {
    insightsSpendByScope: [{ scope: 'PP', currency: 'PLN', rows: 30, spend: 1_000_000 }],
    paypalCharges: [{ date: '2026-09-02', currency: 'PLN', amount: 200_000 }, { date: '2026-09-09', currency: 'PLN', amount: 150_000 }],
    paypalChargesSum: [{ currency: 'PLN', amount: 350_000, count: 2 }],
  },
  checks: checks(['STRIPE PLN: netto = składniki', 'PAYPAL PLN: uzgodnienie salda']),
})

const OCT = summary('2026-10', {
  stripe: { ...flow({ gross: 2_196_200, paymentsCount: 138, refunds: 5_999, fees: 60_000, otherFees: 3_486, climate: 2_367, net: 2_124_348, payoutsSum: 2_100_641, payoutsCount: 22 }), otherCurrencies: [] },
  p24: { ...flow({ gross: 3_526_240, paymentsCount: 265, fees: 15_900, net: 3_510_340, payoutsSum: 3_466_740, payoutsCount: 30 }), otherCurrencies: [] },
  paypal: { byCurrency: [flow({ gross: 164_990, paymentsCount: 11, fees: 6_269, net: -45_680, opening: 45_680, closing: 0 })] },
  meta: {
    insightsSpendByScope: [{ scope: 'PP', currency: 'PLN', rows: 31, spend: 1_452_706 }],
    paypalCharges: [{ date: '2026-10-02', currency: 'PLN', amount: 200_000 }, { date: '2026-10-03', currency: 'PLN', amount: 29_214 }],
    paypalChargesSum: [{ currency: 'PLN', amount: 229_214, count: 2 }],
  },
  checks: checks(['STRIPE PLN: netto = składniki']),
})

const NOV = summary('2026-11', {
  closed: false,
  sources: [src('STRIPE'), src('PAYPAL'), src('PRZELEWY24', 'BRAK_DANYCH', 'brak pliku P24 za okres'), src('META_ADS')],
  stripe: { ...flow({ gross: 816_638, paymentsCount: 54, fees: 17_811, otherFees: 1_666, net: 797_161, payoutsSum: 735_066, payoutsCount: 8 }), otherCurrencies: [] },
  paypal: { byCurrency: [flow({ gross: 59_500, paymentsCount: 5, fees: 2_400, net: 0 })] },
  meta: {
    insightsSpendByScope: [{ scope: 'PP', currency: 'PLN', rows: 13, spend: 639_575 }],
    paypalCharges: [{ date: '2026-11-01', currency: 'PLN', amount: 200_000 }],
    paypalChargesSum: [{ currency: 'PLN', amount: 200_000, count: 1 }],
  },
  notes: ['MIESIĄC NIEZAMKNIĘTY — dane do 2026-11-13 14:02'],
  checks: checks(['STRIPE PLN: netto = składniki']),
})

const entry = (s: ReturnType<typeof summary>) => ({ month: s.month, closed: s.closed, generatedAt: s.generatedAt, sources: s.sources.map((x) => ({ name: x.name, status: x.status })) })
const INDEX = { schemaVersion: 1, updatedAt: '2026-11-13T13:00:00.000Z', months: [entry(SEP), entry(OCT), entry(NOV)] }
const FILES: Record<string, unknown> = { 'index.json': INDEX, '2026-09/summary_2026-09.json': SEP, '2026-10/summary_2026-10.json': OCT, '2026-11/summary_2026-11.json': NOV }

const KEY = 'klucz-serwisowy-NIE-WYCIEKAJ'
const ENV = { SUPABASE_URL: 'https://abc.supabase.co', SUPABASE_SERVICE_ROLE_KEY: KEY }

/** fetch podstawiony: Storage (GET authenticated/ksiegowosc/<ścieżka>) z FILES; opcjonalnie handler modelu. */
function stubFetch(files: Record<string, unknown> = FILES, model?: (url: string, body: any) => unknown) {
  const calls: { url: string; init: RequestInit; body?: any }[] = []
  const fn = vi.fn(async (url: string, init: RequestInit = {}) => {
    const body = typeof init.body === 'string' ? JSON.parse(init.body) : undefined
    calls.push({ url, init, body })
    const m = /\/storage\/v1\/object\/authenticated\/ksiegowosc\/(.+)$/.exec(url)
    if (m) {
      const file = files[m[1]!]
      return file === undefined
        ? new Response(JSON.stringify({ statusCode: '404', error: 'not_found' }), { status: 400 })
        : new Response(JSON.stringify(file), { status: 200 })
    }
    if (model) return new Response(JSON.stringify(model(url, body)), { status: 200 })
    throw new Error(`nieoczekiwane wywołanie ${url}`)
  })
  return { fn: fn as unknown as typeof fetch, calls }
}

const view = (months: string[], source?: string) =>
  buildFinanceView({ index: INDEX, summaries: new Map(Object.entries({ '2026-09': SEP, '2026-10': OCT, '2026-11': NOV, '2026-08': null })), months, source })

// ── helpers ──────────────────────────────────────────────────────────────────────────────

describe('formatowanie na liczbach całkowitych', () => {
  it('fmt i pct', () => {
    expect(fmt(1_234_567)).toBe('12 345,67')
    expect(fmt(-5)).toBe('-0,05')
    expect(pct(40_000, 1_800_000)).toBe('2,2%')
    expect(pct(30, 100, true)).toBe('+30,0%')
    expect(pct(-5, 100, true)).toBe('-5,0%')
    expect(pct(1, 0)).toBeNull()
    expect(previousMonth('2026-01')).toBe('2025-12')
    expect(previousMonth('2026-10')).toBe('2026-09')
  })
})

// ── widok ────────────────────────────────────────────────────────────────────────────────

describe('buildFinanceView', () => {
  const v = view(['2026-09', '2026-10', '2026-11'])
  const [sep, oct, nov] = v.months

  it('wrzesień: brutto, zwroty, prowizje i netto osobno, status OK, wypłaty', () => {
    expect(sep.sources.stripe).toMatchObject({ source: 'STRIPE', month: '2026-09', status: 'OK' })
    expect(sep.sources.stripe.data).toMatchObject({
      payments: 120, gross: '18 000,00 zł', refunds: '400,00 zł', fees: '400,00 zł', otherFees: '30,00 zł', stripeClimate: '20,00 zł', net: '17 150,00 zł',
      payouts: '17 000,00 zł (20 wypłat)', refundsPctOfGross: '2,2%', feesPctOfGross: '2,2%',
    })
    expect(sep.sources.p24.data).toMatchObject({ gross: '30 000,00 zł', fees: '120,00 zł', net: '29 880,00 zł', payouts: '29 500,00 zł (25 wypłat)' })
    expect(sep.sources.paypal.byCurrency[0]).toMatchObject({ gross: '1 000,00 zł', balance: '500,00 zł → 300,00 zł' })
  })

  it('październik: prowizje i zmiana względem września tylko z pełnych miesięcy', () => {
    expect(oct.sources.stripe.data.fees).toBe('600,00 zł')
    expect(oct.sources.stripe.changeVsPrevious).toMatchObject({
      comparable: true, vs: '2026-09',
      gross: '18 000,00 zł → 21 962,00 zł (+3 962,00 zł, +22,0%)',
      fees: '400,00 zł → 600,00 zł (+200,00 zł, +50,0%)',
      feesPctOfGross: '2,2% → 2,7%',
    })
  })

  it('anomalie: zwroty ≥ 2%, wzrost prowizji ≥ 0,3 pp, brak anomalii gdy nic nie przekroczyło progu', () => {
    expect(sep.anomalies.some((a: string) => a.includes('2026-09 STRIPE: zwroty 400,00 zł = 2,2% brutto'))).toBe(true)
    expect(oct.anomalies.some((a: string) => a.includes('2026-10 STRIPE: wzrost prowizji w brutto 2,2% → 2,7%'))).toBe(true)
    expect(oct.anomalies.some((a: string) => a.includes('zwroty'))).toBe(false)
  })

  it('miesiąc niezamknięty: ostrzeżenie, status NIEPEŁNY, bez porównania z pełnym miesiącem', () => {
    expect(nov.closed).toBe(false)
    expect(nov.warning).toContain('MIESIĄC NIEZAMKNIĘTY — dane do 2026-11-13 14:02')
    expect(nov.sources.stripe.status).toBe('NIEPEŁNY')
    expect(nov.sources.stripe.changeVsPrevious).toMatchObject({ comparable: false })
    expect(nov.sources.stripe.changeVsPrevious.reason).toContain('niezamknięty')
    expect(nov.sources.meta.insights.changeVsPrevious).toContain('niezamknięty')
  })

  it('brakujące źródło: nazwa pliku i pola, status NIEPEŁNY z powodem', () => {
    expect(nov.sources.p24.data).toBeNull()
    expect(nov.sources.p24.status).toBe('NIEPEŁNY')
    expect(nov.missing).toContain('2026-11/summary_2026-11.json → p24 (PRZELEWY24): nie mam tych danych — PRZELEWY24: BRAK_DANYCH — brak pliku P24 za okres')
  })

  it('miesiąc bez pliku: „nie mam tych danych” z nazwą pliku', () => {
    const missing = view(['2026-08']).months[0]
    expect(missing.available).toBe(false)
    expect(missing.missing).toBe('ksiegowosc/2026-08/summary_2026-08.json — nie mam tych danych: miesiąc nie jest opublikowany')
  })

  it('Meta: Insights i obciążenia przez PayPal osobno, bez żadnej łącznej kwoty', () => {
    const meta = oct.sources.meta
    expect(meta.insights.total).toEqual({ PLN: '14 527,06 zł' })
    expect(meta.insights.byScope).toEqual([{ scope: 'PP (pamięć)', rows: 31, spend: '14 527,06 zł' }])
    expect(meta.paypalCharges.sum).toEqual(['2 292,14 zł (2 płatności)'])
    expect(meta.paypalCharges.list).toEqual(['2026-10-02  2 000,00 zł', '2026-10-03  292,14 zł'])
    expect(meta.rule).toContain('NIGDY nie sumuj')
    const json = JSON.stringify(meta)
    expect(json).not.toContain('16 819,20') // 14 527,06 + 2 292,14 — suma, której nie wolno podać
    expect(Object.keys(meta).sort()).toEqual(['insights', 'paypalCharges', 'rule', 'status'])
  })

  it('status UWAGA, gdy kontrola źródła nie przeszła', () => {
    const bad = { ...SEP, checks: checks(['STRIPE PLN: netto = składniki'], false) }
    const r = buildFinanceView({ index: INDEX, summaries: new Map([['2026-09', bad]]), months: ['2026-09'], source: 'stripe' })
    expect(r.months[0].sources.stripe.status).toBe('UWAGA')
    expect(r.months[0].sources.stripe.statusReasons[0]).toContain('kontrola nie przeszła: STRIPE PLN: netto = składniki')
    expect(r.months[0].anomalies.some((a: string) => a.includes('status UWAGA'))).toBe(true)
    expect(Object.keys(r.months[0].sources)).toEqual(['stripe']) // filtr źródła
  })

  it('wynik niesie ograniczenia: Wix prawdą, koszty z banku niepublikowane', () => {
    expect(v.limits.join(' ')).toContain('Wix pozostaje prawdą transakcyjną')
    expect(v.notPublished).toContain('nie mam tych danych: brak publikacji audytu')
    expect(v.publishedMonths.map((m: { month: string }) => m.month)).toEqual(['2026-09', '2026-10', '2026-11'])
  })

  it('walidacja żądania', () => {
    expect(validateRequest({ months: ['2026-10', '2026-09', '2026-10'], source: 'STRIPE' })).toEqual({ months: ['2026-09', '2026-10'], source: 'stripe' })
    expect(() => validateRequest({ months: ['2026-13'] })).toThrow(RequestError)
    expect(() => validateRequest({ months: ['2026-01', '2026-02', '2026-03', '2026-04', '2026-05', '2026-06', '2026-07'] })).toThrow('najwyżej 6')
    expect(() => validateRequest({ months: [], source: 'wix' })).toThrow('nieznane źródło')
  })
})

// ── odczyt z bucketu ─────────────────────────────────────────────────────────────────────

describe('getFinance (podstawiony Storage)', () => {
  it('czyta index.json oraz wskazany i poprzedni miesiąc, kluczem tylko w nagłówku', async () => {
    const { fn, calls } = stubFetch()
    const result = await getFinance({ months: ['2026-10'] }, { env: ENV, fetchFn: fn })
    const paths = calls.map((c) => c.url.replace('https://abc.supabase.co/storage/v1/object/authenticated/ksiegowosc/', '')).sort()
    expect(paths).toEqual(['2026-09/summary_2026-09.json', '2026-10/summary_2026-10.json', 'index.json'])
    expect(calls.every((c) => (c.init.headers as Record<string, string>).Authorization === `Bearer ${KEY}`)).toBe(true)
    expect(JSON.stringify(result)).not.toContain(KEY)
    expect(result.months[0].sources.stripe.changeVsPrevious.comparable).toBe(true)
  })

  it('brak pliku miesiąca → missing, nie błąd; brak konfiguracji → komunikat bez klucza', async () => {
    const { fn } = stubFetch()
    const r = await getFinance({ months: ['2026-08'] }, { env: ENV, fetchFn: fn })
    expect(r.months[0].available).toBe(false)
    await expect(getFinance({ months: ['2026-10'] }, { env: { SUPABASE_URL: 'https://abc.supabase.co' }, fetchFn: fn })).rejects.toThrow('brak SUPABASE_URL lub SUPABASE_SERVICE_ROLE_KEY')
  })

  it('błąd serwera Storage nie ujawnia klucza', async () => {
    const failing = (async () => new Response(`boom ${KEY}`, { status: 500 })) as unknown as typeof fetch
    await expect(getFinance({ months: ['2026-10'] }, { env: ENV, fetchFn: failing })).rejects.toThrow(/HTTP 500$/)
    await getFinance({ months: ['2026-10'] }, { env: ENV, fetchFn: failing }).catch((e) => expect(String(e.message)).not.toContain(KEY))
  })
})

describe('funkcja finance-data', () => {
  const call = async (event: Record<string, unknown>, files = FILES) => {
    const { fn } = stubFetch(files)
    vi.stubGlobal('fetch', fn)
    vi.stubEnv('SUPABASE_URL', ENV.SUPABASE_URL)
    vi.stubEnv('SUPABASE_SERVICE_ROLE_KEY', KEY)
    try {
      return await financeDataHandler(event)
    } finally {
      vi.unstubAllGlobals()
      vi.unstubAllEnvs()
    }
  }

  it('GET zwraca wskazane miesiące; odpowiedź bez klucza', async () => {
    const res = await call({ httpMethod: 'GET', queryStringParameters: { months: '2026-09,2026-10', source: 'p24' } })
    expect(res.statusCode).toBe(200)
    const body = JSON.parse(res.body)
    expect(body.months.map((m: { month: string }) => m.month)).toEqual(['2026-09', '2026-10'])
    expect(Object.keys(body.months[1].sources)).toEqual(['p24'])
    expect(res.body).not.toContain(KEY)
    expect(res.headers['Cache-Control']).toBe('no-store')
  })

  it('zły miesiąc → 400, metoda inna niż GET → 405', async () => {
    expect((await call({ httpMethod: 'GET', queryStringParameters: { months: '2026-99' } })).statusCode).toBe(400)
    expect((await call({ httpMethod: 'POST' })).statusCode).toBe(405)
  })
})

// ── rozpoznawanie pytań ──────────────────────────────────────────────────────────────────

describe('rozpoznawanie pytań finansowych', () => {
  it.each([
    'Jakie były przychody Stripe i P24 za wrzesień?',
    'Jakie prowizje zapłaciliśmy za październik?',
    'Ile wydaliśmy na Meta za październik?',
    'Ile płacimy za subskrypcje?',
    'What were Stripe fees last month?',
    'netto z PayPal za 2026-09',
  ])('„%s” → ścieżka finansowa', (q) => expect(isFinanceQuestion(q)).toBe(true))

  it.each([
    'How are we doing today?',
    'Revenue today',
    'What is our profit today?',
    'Which campaign is best?',
    'Is Meta updating?',
    'Who bought the JSU course?',
  ])('„%s” → zwykły pulpit', (q) => expect(isFinanceQuestion(q)).toBe(false))

  it('koszty z banku i subskrypcje (bez operatora) → stała odpowiedź; z operatorem → pełna ścieżka', () => {
    expect(isBankCostQuestion('Ile płacimy za subskrypcje?')).toBe(true)
    expect(isBankCostQuestion('Jakie mamy koszty z banku w październiku?')).toBe(true)
    expect(isBankCostQuestion('Prowizje Stripe za październik')).toBe(false)
    expect(isBankCostQuestion('Ile Meta za październik?')).toBe(false)
  })
})

describe('renderReport — deterministyczny raport', () => {
  const text = renderReport(view(['2026-09', '2026-10', '2026-11']))
  const lines = text.split('\n')

  it('tabela: miesiąc, źródło, status, brutto, zwroty, prowizje i netto w osobnych kolumnach', () => {
    expect(lines.find((l) => l.startsWith('Miesiąc'))!.split(/ {2,}/)).toEqual(['Miesiąc', 'Źródło', 'Status', 'Brutto', 'Zwroty', 'Prowizje', 'Netto'])
    const row = lines.find((l) => /^2026-10 +STRIPE /.test(l))!
    expect(row.split(/ {2,}/)).toEqual(['2026-10', 'STRIPE', 'OK', '21 962,00 zł', '59,99 zł', '600,00 zł', '21 243,48 zł'])
    expect(lines.find((l) => /^2026-11\* +STRIPE /.test(l))).toContain('NIEPEŁNY')
  })

  it('niezamknięty miesiąc ma gwiazdkę i adnotację; źródło bez danych ma status i nazwę pliku', () => {
    expect(text).toContain('* MIESIĄC NIEZAMKNIĘTY — dane do 2026-11-13 14:02')
    expect(lines.find((l) => l.startsWith('2026-11*  PRZELEWY24'))).toContain('NIEPEŁNY')
    expect(text).toContain('2026-11/summary_2026-11.json → p24 (PRZELEWY24): nie mam tych danych')
  })

  it('zmiana względem poprzedniego miesiąca: porównanie dla zamkniętych, powód braku porównania dla niezamkniętego i wrześniowego bez sierpnia', () => {
    expect(text).toContain('2026-10 STRIPE vs 2026-09: brutto 18 000,00 zł → 21 962,00 zł (+3 962,00 zł, +22,0%)')
    expect(text).toContain('2026-11 STRIPE: brak porównania — 2026-11 jest niezamknięty — nie porównuję z pełnym miesiącem')
    expect(text).toContain('2026-09 STRIPE: brak porównania — brak pliku 2026-08/summary_2026-08.json')
  })

  it('Meta: dwa ujęcia osobno, bez łącznej kwoty', () => {
    expect(text).toContain('META 2026-10 — status OK (dwa ujęcia TEGO SAMEGO kosztu — nie sumować)')
    expect(text).toContain('wydatki wg Insights (panel Meta) [OK]: 14 527,06 zł')
    expect(text).toContain('obciążenia przez PayPal [OK]: 2 292,14 zł (2 płatności)')
    expect(text).not.toContain('16 819,20')
  })

  it('anomalie, braki i zasada Wix w każdym raporcie; PayPal z wyjaśnieniem netto', () => {
    expect(text).toContain('! 2026-10 STRIPE: wzrost prowizji w brutto 2,2% → 2,7%')
    expect(text).toContain('ANOMALIE')
    expect(text).toContain('BRAKI DANYCH')
    expect(lines.at(-1)).toBe('Wix pozostaje prawdą transakcyjną dla zamówień i przychodu; powyższe to wpływy od operatorów płatności.')
    expect(renderReport(view(['2026-10'], 'stripe'))).not.toContain('META')
  })

  it('brak anomalii i braków → jawne „nie wykryto” / „brak w żądanym zakresie”; mergeViews łączy źródła tego samego miesiąca', () => {
    const merged = mergeViews([view(['2026-10'], 'stripe'), view(['2026-10'], 'p24')])
    const t = renderReport(merged)
    expect(t).toContain('2026-10  STRIPE')
    expect(t).toContain('2026-10  PRZELEWY24')
    expect(t.split('\n').filter((l) => l.startsWith('Miesiąc'))).toHaveLength(1)
  })
})

// ── Stanley z narzędziem get_finance ─────────────────────────────────────────────────────

const parse = (raw: string) => {
  const a = /ANSWER:\s*([\s\S]*?)(?=\nSPEECH:|$)/i.exec(raw)
  const s = /SPEECH:\s*([\s\S]*)$/i.exec(raw)
  return { answerText: a?.[1]?.trim() ?? raw.trim(), speechText: s?.[1]?.trim() ?? '' }
}

const OPENAI_ENV = { ...ENV, LLM_PROVIDER: 'openai', OPENAI_API_KEY: 'sk-test-openai', OPENAI_MODEL: 'gpt-test' }
const FINAL = 'ANSWER:\nWrzesień, STRIPE, status OK: brutto 18 000,00 zł.\n\nSPEECH:\nWrzesień: Stripe 18 tysięcy.'

function openaiModel(callsLog: { body: any }[]) {
  let round = 0
  return (_url: string, body: any) => {
    callsLog.push({ body })
    round++
    if (round === 1) {
      return { choices: [{ message: { role: 'assistant', content: null, tool_calls: [{ id: 'call_1', type: 'function', function: { name: 'get_finance', arguments: JSON.stringify({ months: ['2026-09'], source: 'stripe' }) } }] } }] }
    }
    return { choices: [{ message: { role: 'assistant', content: FINAL } }] }
  }
}

describe('Stanley: get_finance (OpenAI, podstawiony fetch)', () => {
  it('pierwsze wywołanie wymusza narzędzie; wynik narzędzia trafia do drugiego; prompt zawiera reguły finansowe', async () => {
    const log: { body: any }[] = []
    const { fn } = stubFetch(FILES, openaiModel(log))
    const out = await answerFinance({ message: 'Przychody Stripe za wrzesień?', systemPrompt: 'STANLEY-PROMPT', parse, env: OPENAI_ENV, fetchFn: fn, today: '2026-11-14' })
    expect(log).toHaveLength(2)
    const [first, second] = log.map((l) => l.body)
    expect(first.tool_choice).toEqual({ type: 'function', function: { name: 'get_finance' } })
    expect(first.tools[0].function.name).toBe('get_finance')
    expect(first.messages[0].content).toBe('STANLEY-PROMPT' + FINANCE_RULES)
    expect(first.messages[1].content).toContain('Dzisiaj: 2026-11-14')
    expect(first.messages[1].content).toContain('2026-11 (NIEZAMKNIĘTY;')
    expect(first.messages[1].content).toContain('PYTANIE: Przychody Stripe za wrzesień?')
    const toolMessage = second.messages.find((m: { role: string }) => m.role === 'tool')
    expect(toolMessage.tool_call_id).toBe('call_1')
    expect(toolMessage.content).toContain('18 000,00 zł')
    expect(toolMessage.content).not.toContain(KEY)
    expect(second.tool_choice).toBe('auto') // dalsza runda: model może poprosić o kolejne miesiące
    expect(out).toMatchObject({ intent: 'finance', language: 'pl', llmUsed: true })
    // odpowiedź = raport z serwera + komentarz modelu
    expect(out.answerText).toContain('SUMY (wpływy od operatorów płatności, nie sprzedaż z Wix)')
    expect(out.answerText).toContain('2026-09  STRIPE  OK ')
    expect(out.answerText.endsWith('KOMENTARZ\nWrzesień, STRIPE, status OK: brutto 18 000,00 zł.')).toBe(true)
    expect(out.finance.toolCalls).toEqual([{ name: 'get_finance', args: { months: ['2026-09'], source: 'stripe' } }])
  })

  it('subskrypcje: stała odpowiedź „nie mam tych danych: brak publikacji audytu”, bez modelu i bez odczytu bucketu', async () => {
    const { fn, calls } = stubFetch(FILES, () => {
      throw new Error('model nie powinien być wołany')
    })
    const out = await answerFinance({ message: 'Ile płacimy za subskrypcje?', systemPrompt: 'X', parse, env: OPENAI_ENV, fetchFn: fn })
    expect(calls).toHaveLength(0)
    expect(out.answerText.toLowerCase()).toContain('nie mam tych danych: brak publikacji audytu')
    expect(out).toMatchObject({ intent: 'finance', llmUsed: false })
    expect(bankCostAnswer().speechText).toContain('brak publikacji audytu')
  })

  it('model niedostępny po pobraniu danych → zestawienie wprost z danych (te same liczby)', async () => {
    let round = 0
    const { fn } = stubFetch(FILES, (_u, body) => {
      round++
      if (round === 1) return openaiModel([])(_u, body)
      throw new Error('boom')
    })
    // druga odpowiedź modelu to błąd HTTP
    const failing = (async (url: string, init: RequestInit) => {
      if (String(url).includes('openai.com') && round >= 1) return new Response('{"error":{"message":"overloaded"}}', { status: 503 })
      return fn(url, init)
    }) as unknown as typeof fetch
    const out = await answerFinance({ message: 'Przychody Stripe za wrzesień?', systemPrompt: 'X', parse, env: OPENAI_ENV, fetchFn: failing })
    expect(out.llmUsed).toBe(false)
    expect(out.warnings[0]).toContain('LLM error')
    expect(out.answerText).toContain('18 000,00 zł') // te same liczby co w danych
    expect(out.answerText).toContain('Model niedostępny — raport bez komentarza')
  })

  it('brak index.json → „nie mam tych danych: index.json”', async () => {
    const { fn } = stubFetch({})
    const out = await answerFinance({ message: 'Stripe za wrzesień', systemPrompt: 'X', parse, env: OPENAI_ENV, fetchFn: fn })
    expect(out.answerText).toContain('Nie mam tych danych: index.json')
  })
})

describe('Stanley: get_finance (Anthropic, podstawiony fetch)', () => {
  it('tool_use → tool_result → tekst', async () => {
    const log: { body: any }[] = []
    let round = 0
    const { fn } = stubFetch(FILES, (_u, body) => {
      log.push({ body })
      round++
      return round === 1
        ? { content: [{ type: 'tool_use', id: 'tu_1', name: 'get_finance', input: { months: ['2026-10'] } }] }
        : { content: [{ type: 'text', text: FINAL }] }
    })
    const out = await answerFinance({
      message: 'Prowizje za październik', systemPrompt: 'STANLEY-PROMPT', parse, fetchFn: fn,
      env: { ...ENV, LLM_PROVIDER: 'anthropic', ANTHROPIC_API_KEY: 'ak-test' },
    })
    expect(log[0]!.body.tool_choice).toEqual({ type: 'tool', name: 'get_finance' })
    const toolResult = log[1]!.body.messages.at(-1).content[0]
    expect(toolResult).toMatchObject({ type: 'tool_result', tool_use_id: 'tu_1' })
    expect(toolResult.content).toContain('600,00 zł')
    expect(out).toMatchObject({ intent: 'finance', llmUsed: true, llmProvider: 'anthropic' })
  })
})

describe('refusalGuard a odpowiedzi finansowe', () => {
  it('dlaczego odpowiedź finansowa omija angielski guard: polskie „zwroty” zostałyby przepisane na „field is not in the database”', () => {
    const answer = 'Zwroty Stripe za wrzesień: 400,00 zł (2,2% brutto).'
    expect(enforceRefusal(answer, 'zwroty Stripe za wrzesień')).toContain('That field is not in the database')
  })
})
