// llmTools.js — the OpenAI tool-calling loop of the finance path (the default provider) and the pieces both
// providers share (the get_finance tool, safe tool execution, token / cost accounting). The Anthropic loop
// lives in financeLlm.js (official SDK). Used only by the finance path; the single-shot callOpenAI /
// callAnthropic in gieniu-command.js are untouched.
//
// OpenAI: round 1 FORCES the tool (a finance question must not be answered from memory); later rounds let the
// model ask again (e.g. one more month) up to MAX_TOOL_CALLS calls per question; the last round withholds the
// tools so the loop always ends in text.

export const MAX_TOOL_CALLS = 6

export const FINANCE_TOOL = {
  name: 'get_finance',
  description:
    'Aggregates from the monthly accounting report (Stripe, Przelewy24, PayPal, Meta) for the given months: gross, refunds, fees, net, payouts, ' +
    'status per source (OK / INCOMPLETE / WARNING), change vs previous month, anomalies, and what is missing (file or field). ' +
    'Payment-operator inflows, NOT Wix sales. Does not contain bank costs, subscriptions, ZUS, PIT-4 or VAT.',
  parameters: {
    type: 'object',
    properties: {
      months: {
        type: 'array',
        items: { type: 'string', description: 'Month as YYYY-MM, e.g. 2026-09' },
        description: 'Months to read (max 6). Empty array = only the list of published months.',
      },
      source: {
        type: 'string',
        enum: ['stripe', 'p24', 'paypal', 'meta'],
        description: 'Optional: one source only. Omit for all sources.',
      },
    },
    required: ['months'],
  },
}

async function post(url, headers, body, timeoutMs, fetchFn) {
  const res = await fetchFn(url, { method: 'POST', headers, body: JSON.stringify(body), signal: AbortSignal.timeout(timeoutMs) })
  const data = await res.json().catch(() => ({}))
  return { res, data }
}

export function parseArgs(raw) {
  if (raw && typeof raw === 'object') return raw
  try {
    return JSON.parse(raw || '{}')
  } catch {
    return {}
  }
}

/** Tool result as a JSON string; a failure is returned to the model as { error } (message cut to 300 characters). */
export async function runTool(executeTool, name, args) {
  try {
    return JSON.stringify(await executeTool(name, args))
  } catch (err) {
    return JSON.stringify({ error: String(err?.message ?? err).slice(0, 300) })
  }
}

export const LIMIT_REACHED = `The limit of ${MAX_TOOL_CALLS} get_finance calls for one question was exceeded — write the comment from the data you already have.`

export const emptyUsage = () => ({ input: 0, output: 0, cacheRead: 0, cacheWrite: 0 })

// USD per 1M tokens. Claude: platform.claude.com/docs/en/models/overview (checked 2026-11-16; cache read = 5% of input for
// Sonnet 5.5 / Opus 5.5, 2.5% for Fable 5.2, 10% for Haiku 5.5). gpt-4o-mini: public list price, NOT re-verified here.
export const PRICES = {
  'claude-sonnet-5-5': { input: 2, output: 10, cacheRead: 0.1 },
  'claude-opus-5-5': { input: 4, output: 20, cacheRead: 0.2 },
  'claude-fable-5-2': { input: 8, output: 40, cacheRead: 0.2 },
  'claude-haiku-5-5': { input: 0.1, output: 0.5, cacheRead: 0.01 },
  'gpt-4o-mini': { input: 0.15, output: 0.6, cacheRead: 0.075 },
}

/** Estimated cost in USD (6 decimals) or null when the model is not in the price table. Cache writes are billed like 1.25× input. */
export function estimateCostUsd(model, usage) {
  const p = PRICES[model]
  if (!p) return null
  const usd = (usage.input * p.input + usage.output * p.output + usage.cacheRead * p.cacheRead + usage.cacheWrite * p.input * 1.25) / 1_000_000
  return Math.round(usd * 1e6) / 1e6
}

/**
 * OpenAI chat-completions loop.
 * @returns {{ text: string, rounds: number, toolCalls: Array<{name:string,args:object}>, usage: ReturnType<typeof emptyUsage> }}
 */
export async function runToolChat({
  apiKey, model, system, user, tool, executeTool,
  maxTokens = 1400, temperature = 0.2, deadlineMs = 40000, maxToolCalls = MAX_TOOL_CALLS, fetchFn = fetch, now = Date.now,
}) {
  const toolCalls = []
  const usage = emptyUsage()
  const started = now()
  const messages = [{ role: 'system', content: system }, { role: 'user', content: user }]
  const fn = { type: 'function', function: { name: tool.name, description: tool.description, parameters: tool.parameters } }
  const maxRounds = maxToolCalls + 1
  for (let round = 0; round < maxRounds; round++) {
    const left = deadlineMs - (now() - started)
    if (left < 2000) throw new Error('the model response time was exceeded')
    const last = round === maxRounds - 1 || toolCalls.length >= maxToolCalls
    const body = {
      model, messages, max_tokens: maxTokens, temperature,
      ...(last ? {} : { tools: [fn], tool_choice: round === 0 ? { type: 'function', function: { name: tool.name } } : 'auto' }),
    }
    const { res, data } = await post('https://api.openai.com/v1/chat/completions',
      { 'Content-Type': 'application/json', Authorization: `Bearer ${apiKey}` }, body, Math.min(left, 25000), fetchFn)
    if (!res.ok) throw new Error(`OpenAI ${res.status}: ${data.error?.message ?? 'unknown'}`)
    usage.input += data.usage?.prompt_tokens ?? 0
    usage.output += data.usage?.completion_tokens ?? 0
    usage.cacheRead += data.usage?.prompt_tokens_details?.cached_tokens ?? 0
    const msg = data.choices?.[0]?.message ?? {}
    if (msg.tool_calls?.length && !last) {
      messages.push(msg)
      for (const call of msg.tool_calls) {
        if (toolCalls.length >= maxToolCalls) {
          messages.push({ role: 'tool', tool_call_id: call.id, content: JSON.stringify({ error: LIMIT_REACHED }) })
          continue
        }
        const args = parseArgs(call.function?.arguments)
        toolCalls.push({ name: call.function?.name, args })
        messages.push({ role: 'tool', tool_call_id: call.id, content: await runTool(executeTool, call.function?.name, args) })
      }
      continue
    }
    return { text: msg.content ?? '', rounds: round + 1, toolCalls, usage }
  }
  throw new Error('the tool loop returned no text')
}
