// financeStanley.js — Stanley answers finance questions from the published accounting
// aggregates (bucket "ksiegowosc") through the get_finance tool.
//
// Flow: question -> (bank costs / subscriptions: fixed "nie mam tych danych" answer, no model)
//       -> read index.json -> model with get_finance (forced first call) -> answer.
// The tables, statuses, changes, anomalies and gaps are rendered by the server (renderReport) and
// put before the model's comment; the system prompt is Stanley's own plus FINANCE_RULES, which
// override the dashboard rules that do not fit finance (English only, concision, no tables).

import { businessToday } from './businessDay.js'
import { isBankCostQuestion } from './financeIntent.js'
import {
  FinanceError, getFinance, getJson, mergeViews, readFinanceConfig, renderReport,
} from './financeStore.js'
import { FINANCE_TOOL, runToolChat } from './llmTools.js'

export const FINANCE_RULES = `

━━━ TRYB FINANSOWY (Stripe, P24, PayPal, Meta) — dla pytań finansowych NADPISUJE reguły 4, 5 i 7 powyżej ━━━
Narzędzie get_finance zwraca agregaty z raportu księgowego oraz gotowy tekst w polu "report" tego wyniku.
ZASADA PODSTAWOWA: serwer SAM dołącza raport (tabela sum z miesiącem, źródłem i statusem, zmiana względem poprzedniego miesiąca, anomalie, braki danych)
PRZED Twoim tekstem. Twój tekst to KOMENTARZ do tego raportu — nie powtarzaj tabeli i nie przepisuj jej własnymi słowami.
• JĘZYK: po polsku, „sir", ton stonowany; fakty przed stylem. To wyjątek od reguły „tylko angielski".
• KOMENTARZ: 4–8 zdań, w ANSWER. Odpowiedz wprost na pytanie jedną lub dwiema liczbami z raportu (przepisz je dokładnie; nic nie przeliczaj, nie zaokrąglaj, nie dodawaj własnych sum), potem wskaż najważniejszą zmianę, anomalię lub brak z raportu.
• Zawsze wymień miesiąc, źródło i status (OK, NIEPEŁNY, UWAGA) — statusy bierz z raportu, nie zmieniaj ich.
• Brutto, zwroty, prowizje i netto podawaj osobno, nigdy jako jedną kwotę.
• META: wydatki z Insights i obciążenia przez PayPal to TEN SAM KOSZT w dwóch ujęciach: NIGDY ich nie sumuj ani nie dodawaj i nie wyprowadzaj „łącznego kosztu".
• Zaznacz, że to wpływy od operatorów płatności, a nie sprzedaż z Wix; Wix pozostaje prawdą transakcyjną.
• Miesiąc niezamknięty (gwiazdka w raporcie, closed:false) nie jest porównywalny z pełnym — powiedz to, jeśli o niego pytano; nie wyciągaj wniosków z porównań, których raport nie podaje.
• Brak danych: „nie mam tych danych: <nazwa pliku lub pola z sekcji BRAKI DANYCH>". Fraza „nie mam tych danych: brak publikacji audytu" dotyczy WYŁĄCZNIE kosztów z banku, subskrypcji, opłat bankowych i faktur — nigdy nie używaj jej do prowizji, zwrotów ani wpływów.
• FORMAT: „ANSWER:" (komentarz) i „SPEECH:" (2 krótkie zdania po polsku, bez tabel).`

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

  const views = []
  const tracedTool = async (name, args) => {
    const view = await executeTool(name, args)
    views.push(view)
    // the model gets the finished report text it will be placed under (all figures are in it)
    return { report: renderReport(mergeViews(views)), publishedMonths: view.publishedMonths }
  }
  try {
    const { text, rounds, toolCalls } = await runToolChat({
      provider: provider.name, apiKey: provider.key, model: provider.model,
      system: systemPrompt + FINANCE_RULES, user, tool: FINANCE_TOOL, executeTool: tracedTool,
      fetchFn,
    })
    const { answerText: comment, speechText } = parse(text)
    const report = views.length > 0 ? renderReport(mergeViews(views)) : ''
    return body(report ? `${report}

KOMENTARZ
${comment}` : comment, speechText, {
      llmUsed: true,
      llmProvider: provider.name,
      llm: { active: true, provider: provider.name, used: true, model: provider.model },
      finance: { rounds, toolCalls },
    })
  } catch (err) {
    const reason = String(err?.message ?? err).slice(0, 100)
    if (views.length > 0) {
      return body(`${renderReport(mergeViews(views))}

(Model niedostępny — raport bez komentarza.)`, 'Model niedostępny, pokazuję zestawienie wprost z danych.', {
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
