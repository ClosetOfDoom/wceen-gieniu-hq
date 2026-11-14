// llmTools.js — one tool-calling loop for both providers Stanley can run on (OpenAI today,
// Anthropic when its key is set). Used only by the finance path; the existing single-shot
// callOpenAI / callAnthropic in gieniu-command.js are untouched.
//
// Round 1 FORCES the tool: a finance question must not be answered from memory, so the model
// cannot skip get_finance. Later rounds let it ask again (e.g. one more month); the last round
// withholds the tools so the loop always ends in text.

export const FINANCE_TOOL = {
  name: 'get_finance',
  description:
    'Aggregates from the monthly accounting report (Stripe, Przelewy24, PayPal, Meta) for the given months: gross, refunds, fees, net, payouts, ' +
    'status per source (OK / NIEPEŁNY / UWAGA), change vs previous month, anomalies, and what is missing (file or field). ' +
    'Payment-operator inflows, NOT Wix sales. Does not contain bank costs or subscriptions.',
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

function parseArgs(raw) {
  if (raw && typeof raw === 'object') return raw
  try {
    return JSON.parse(raw || '{}')
  } catch {
    return {}
  }
}

async function runTool(executeTool, name, args) {
  try {
    return JSON.stringify(await executeTool(name, args))
  } catch (err) {
    return JSON.stringify({ error: String(err?.message ?? err).slice(0, 300) })
  }
}

/**
 * @returns {{ text: string, rounds: number, toolCalls: Array<{name:string,args:object}> }}
 */
export async function runToolChat({
  provider, apiKey, model, system, user, tool, executeTool,
  maxTokens = 1400, temperature = 0.2, callTimeoutMs = 20000, maxRounds = 3, fetchFn = fetch,
}) {
  const toolCalls = []
  if (provider === 'openai') {
    const messages = [{ role: 'system', content: system }, { role: 'user', content: user }]
    const fn = { type: 'function', function: { name: tool.name, description: tool.description, parameters: tool.parameters } }
    for (let round = 0; round < maxRounds; round++) {
      const last = round === maxRounds - 1
      const body = {
        model, messages, max_tokens: maxTokens, temperature,
        ...(last ? {} : { tools: [fn], tool_choice: round === 0 ? { type: 'function', function: { name: tool.name } } : 'auto' }),
      }
      const { res, data } = await post('https://api.openai.com/v1/chat/completions',
        { 'Content-Type': 'application/json', Authorization: `Bearer ${apiKey}` }, body, callTimeoutMs, fetchFn)
      if (!res.ok) throw new Error(`OpenAI ${res.status}: ${data.error?.message ?? 'unknown'}`)
      const msg = data.choices?.[0]?.message ?? {}
      if (msg.tool_calls?.length && !last) {
        messages.push(msg)
        for (const call of msg.tool_calls) {
          const args = parseArgs(call.function?.arguments)
          toolCalls.push({ name: call.function?.name, args })
          messages.push({ role: 'tool', tool_call_id: call.id, content: await runTool(executeTool, call.function?.name, args) })
        }
        continue
      }
      return { text: msg.content ?? '', rounds: round + 1, toolCalls }
    }
  } else {
    const messages = [{ role: 'user', content: user }]
    const spec = { name: tool.name, description: tool.description, input_schema: tool.parameters }
    for (let round = 0; round < maxRounds; round++) {
      const last = round === maxRounds - 1
      const body = {
        model, max_tokens: maxTokens, temperature, system, messages,
        ...(last ? {} : { tools: [spec], tool_choice: round === 0 ? { type: 'tool', name: tool.name } : { type: 'auto' } }),
      }
      const { res, data } = await post('https://api.anthropic.com/v1/messages',
        { 'Content-Type': 'application/json', 'x-api-key': apiKey, 'anthropic-version': '2023-06-01' }, body, callTimeoutMs, fetchFn)
      if (!res.ok) throw new Error(`Anthropic ${res.status}: ${data.error?.message ?? 'unknown'}`)
      const uses = (data.content ?? []).filter((b) => b.type === 'tool_use')
      if (uses.length && !last) {
        messages.push({ role: 'assistant', content: data.content })
        const results = []
        for (const use of uses) {
          toolCalls.push({ name: use.name, args: use.input ?? {} })
          results.push({ type: 'tool_result', tool_use_id: use.id, content: await runTool(executeTool, use.name, use.input ?? {}) })
        }
        messages.push({ role: 'user', content: results })
        continue
      }
      const text = (data.content ?? []).filter((b) => b.type === 'text').map((b) => b.text).join('')
      return { text, rounds: round + 1, toolCalls }
    }
  }
  throw new Error('pętla narzędzi nie zwróciła tekstu')
}
