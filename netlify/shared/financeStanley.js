// financeStanley.js — Stanley answers finance questions from the published accounting
// aggregates (bucket "ksiegowosc") through the get_finance tool.
//
// Flow: question -> (bank costs / subscriptions: fixed "nie mam tych danych" answer, no model)
//       -> read index.json -> model with get_finance (forced first call) -> answer.
// The system prompt is Stanley's own plus FINANCE_RULES, which override the three dashboard
// rules that do not fit finance (English only, concision, no tables).

import { businessToday } from './businessDay.js'
import { isBankCostQuestion } from './financeIntent.js'
import {
  FinanceError, SOURCE_KEYS, getFinance, getJson, readFinanceConfig,
} from './financeStore.js'
import { FINANCE_TOOL, runToolChat } from './llmTools.js'

export const FINANCE_RULES = `

━━━ TRYB FINANSOWY (Stripe, P24, PayPal, Meta) — dla pytań finansowych NADPISUJE reguły 4, 5 i 7 powyżej ━━━
Pytanie dotyczy raportu księgowego. Narzędzie get_finance zwraca agregaty opublikowane z raportu miesięcznego.
• JĘZYK I FORMA: odpowiadasz PO POLSKU, obszernie, czystym tekstem z tabelą sum (kolumny wyrównane spacjami, bez markdown, bez JSON). Zwracasz się „sir", ton stonowany; fakty przed stylem.
• ZERO WYMYŚLANIA: każda liczba pochodzi z wyniku get_finance i jest już sformatowana — przepisz ją dokładnie, niczego nie przeliczaj, nie zaokrąglaj i nie dodawaj własnych sum (wyjątek: sumy, które narzędzie podaje samo).
• BRAK DANYCH: napisz „nie mam tych danych: <nazwa pliku lub pola>", biorąc nazwę z pola missing / statusReasons (np. „nie mam tych danych: 2026-11/summary_2026-11.json → p24"). Nigdy ogólnik bez nazwy.
• ZAWSZE podaj miesiąc, źródło i status (OK, NIEPEŁNY, UWAGA) — statusy bierz z narzędzia, nie zmieniaj ich.
• BRUTTO, ZWROTY, PROWIZJE i NETTO podawaj osobno (każda pozycja w osobnej kolumnie lub wierszu), nigdy jako jedną kwotę.
• META: wydatki z Insights i obciążenia przez PayPal to TEN SAM KOSZT w dwóch ujęciach. Pokaż je osobno z podpisami, NIGDY ich nie sumuj ani nie dodawaj i nie wyprowadzaj z nich „łącznego kosztu".
• To wpływy od operatorów płatności, a nie sprzedaż z Wix. Wix pozostaje prawdą transakcyjną (zamówienia i przychód) — powiedz to wprost w odpowiedzi.
• MIESIĄC NIEZAMKNIĘTY (closed:false, pole warning) pokaż osobno z adnotacją i NIE porównuj go z pełnym miesiącem. Zmiany względem poprzedniego miesiąca podawaj wyłącznie z pola changeVsPrevious; gdy comparable=false, napisz dlaczego.
• KOSZTY Z BANKU, SUBSKRYPCJE, OPŁATY BANKOWE, FAKTURY: odpowiedz „nie mam tych danych: brak publikacji audytu".
• STRUKTURA ODPOWIEDZI: (1) tabela sum per miesiąc i źródło, (2) zmiana względem poprzedniego miesiąca, (3) anomalie (zwroty, wzrost prowizji, status UWAGA) — tylko z listy anomalies i statusów z narzędzia; gdy lista jest pusta, napisz, że anomalii nie wykryto, (4) braki danych (missing).
• FORMAT: nadal „ANSWER:" i „SPEECH:". SPEECH to 2 krótkie zdania po polsku, bez tabel.`

const OPEN_MONTHS_NOTE = 'miesiąc niezamknięty'

export function bankCostAnswer() {
  const answerText = [
    `Nie mam tych danych: brak publikacji audytu.`,
    '',
    'Koszty z banku, subskrypcje, opłaty bankowe i faktury nie są publikowane — w buckecie "ksiegowosc" są wyłącznie agregaty Stripe, P24, PayPal i Meta (index.json oraz RRRR-MM/summary_RRRR-MM.json).',
    'Wix pozostaje prawdą transakcyjną dla zamówień i przychodu.',
  ].join('\n')
  const speechText = 'Nie mam tych danych: brak publikacji audytu. Koszty z banku i subskrypcje nie są publikowane.'
  return { answerText, speechText }
}

/** Plain-text table straight from the tool view — used when the model is unavailable or fails. */
export function renderFallback(view) {
  const L = ['(Model niedostępny — zestawienie wprost z danych; bez analizy.)', '']
  for (const m of view.months) {
    if (!m.available) {
      L.push(`${m.month}: ${m.missing}`)
      continue
    }
    L.push(`${m.month} ${m.closed === false ? `[${OPEN_MONTHS_NOTE}] ` : ''}${m.warning ?? ''}`.trim())
    for (const key of SOURCE_KEYS) {
      const s = m.sources[key]
      if (!s) continue
      if (key === 'meta') {
        L.push(`  META  Insights [${s.insights.status}]: ${s.insights.total ? Object.values(s.insights.total).join(' / ') : 'brak danych'}`)
        L.push(`  META  obciążenia przez PayPal [${s.paypalCharges.status}]: ${s.paypalCharges.sum ? s.paypalCharges.sum.join(' / ') : 'brak danych'}  (ten sam koszt — nie sumować)`)
        continue
      }
      const rows = s.data ? [s.data] : (s.byCurrency ?? [])
      if (rows.length === 0) L.push(`  ${s.source} [${s.status}]: nie mam tych danych (${(s.statusReasons ?? []).join('; ')})`)
      for (const d of rows) {
        L.push(`  ${s.source} ${d.currency} [${s.status}]: brutto ${d.gross} | zwroty ${d.refunds} | prowizje ${d.fees} | netto ${d.net} | wypłaty ${d.payouts}`)
      }
    }
    for (const a of m.anomalies) L.push(`  ! ${a}`)
  }
  L.push('', 'To wpływy od operatorów płatności, a nie sprzedaż z Wix; Wix pozostaje prawdą transakcyjną.')
  return L.join('\n')
}

function pickProvider(env) {
  const provider = env.LLM_PROVIDER
  if (provider === 'openai' && env.OPENAI_API_KEY) return { name: 'openai', key: env.OPENAI_API_KEY, model: env.OPENAI_MODEL || 'gpt-4o-mini' }
  if (env.ANTHROPIC_API_KEY) return { name: 'anthropic', key: env.ANTHROPIC_API_KEY, model: env.ANTHROPIC_MODEL || 'claude-sonnet-4-6' }
  if (env.OPENAI_API_KEY) return { name: 'openai', key: env.OPENAI_API_KEY, model: env.OPENAI_MODEL || 'gpt-4o-mini' }
  return null
}

function body(answerText, speechText, extra = {}) {
  return {
    answerText,
    speechText,
    intent: 'finance',
    confidence: 1,
    language: 'pl',
    dataSourcesUsed: ['get_finance'],
    warnings: [],
    llmUsed: false,
    llm: { active: false, provider: null, used: false, model: null },
    ...extra,
  }
}

/**
 * @param {{message:string, systemPrompt:string, parse:(raw:string)=>{answerText:string,speechText:string},
 *          env?:NodeJS.ProcessEnv, fetchFn?:typeof fetch, today?:string}} args
 */
export async function answerFinance({ message, systemPrompt, parse, env = process.env, fetchFn = fetch, today = businessToday() }) {
  if (isBankCostQuestion(message)) {
    const { answerText, speechText } = bankCostAnswer()
    return body(answerText, speechText, { dataSourcesUsed: [], financeBranch: 'bank-costs-not-published' })
  }

  let config
  let index
  try {
    config = readFinanceConfig(env)
    index = await getJson(config, 'index.json', fetchFn)
  } catch (err) {
    const reason = err instanceof FinanceError ? err.message : 'błąd odczytu'
    return body(`Nie mam tych danych: index.json w buckecie "ksiegowosc" (${reason}).`, 'Nie mam tych danych: nie mogę odczytać indeksu raportów.', {
      warnings: [`finance read error: ${reason}`],
    })
  }
  if (index === null) {
    return body('Nie mam tych danych: index.json w buckecie "ksiegowosc" (brak publikacji).', 'Nie mam tych danych: brak opublikowanych raportów.', {
      warnings: ['finance: index.json missing'],
    })
  }
  const published = index
    ? (index.months ?? []).map((m) => `${m.month} (${m.closed ? 'zamknięty' : 'NIEZAMKNIĘTY'}; ${(m.sources ?? []).map((s) => `${s.name}=${s.status}`).join(', ')})`).join('\n  ')
    : 'brak index.json'
  const user = `Dzisiaj: ${today} (Europe/Warsaw).\nOpublikowane miesiące (index.json):\n  ${published}\n\nPYTANIE: ${message}`

  const executeTool = async (name, args) => {
    if (name !== 'get_finance') throw new Error(`nieznane narzędzie: ${name}`)
    return getFinance({ months: args?.months, source: args?.source }, { env, fetchFn })
  }

  const provider = pickProvider(env)
  if (!provider) {
    const view = await getFinance({ months: [] }, { env, fetchFn })
    return body('Model językowy nie jest skonfigurowany (LLM_PROVIDER i klucz API w Netlify). Opublikowane miesiące: ' + (view.publishedMonths.map((m) => m.month).join(', ') || 'brak') + '.', 'Model nie jest skonfigurowany.', {
      warnings: ['LLM not configured'],
    })
  }

  let lastView = null
  const tracedTool = async (name, args) => {
    lastView = await executeTool(name, args)
    return lastView
  }
  try {
    const { text, rounds, toolCalls } = await runToolChat({
      provider: provider.name, apiKey: provider.key, model: provider.model,
      system: systemPrompt + FINANCE_RULES, user, tool: FINANCE_TOOL, executeTool: tracedTool,
      fetchFn,
    })
    const { answerText, speechText } = parse(text)
    return body(answerText, speechText, {
      llmUsed: true,
      llmProvider: provider.name,
      llm: { active: true, provider: provider.name, used: true, model: provider.model },
      finance: { rounds, toolCalls },
    })
  } catch (err) {
    const reason = String(err?.message ?? err).slice(0, 100)
    if (lastView) {
      return body(renderFallback(lastView), 'Model niedostępny, pokazuję zestawienie wprost z danych.', {
        warnings: [`LLM error (deterministic fallback): ${reason}`],
        llm: { active: true, provider: provider.name, used: false, model: null },
      })
    }
    return body(`Nie mam tych danych: błąd połączenia z modelem lub bucketem (${reason}).`, 'Błąd połączenia.', {
      warnings: [`LLM error: ${reason}`],
      llm: { active: true, provider: provider.name, used: false, model: null },
    })
  }
}
