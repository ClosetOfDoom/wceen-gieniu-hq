// financeLlm.js — the model side of the finance path: provider / model choice, the Claude tool loop on the
// official SDK, a simple hourly limit and the per-question log line (counts and cost only, never text).
//
// Provider: FINANCE_LLM_PROVIDER = anthropic | openai (default openai), model: FINANCE_MODEL (default for
// anthropic: claude-sonnet-5-5, confirmed in platform.claude.com/docs/en/models/overview). Only the finance path
// reads these; the rest of Stanley keeps using LLM_PROVIDER.
//
// claude-sonnet-5-5 specifics (docs, 2026-11): forced tool_choice (any / tool) and non-default temperature return a
// 400, thinking cannot be disabled (adaptive, steered by effort). So: tool_choice auto (+ an instruction and a one-time
// reminder if the model skips the tool), no temperature, output_config.effort, and the assistant content (thinking
// blocks included) is replayed unchanged between rounds.
import Anthropic from '@anthropic-ai/sdk'
import { LIMIT_REACHED, MAX_TOOL_CALLS, emptyUsage, estimateCostUsd, runTool } from './llmTools.js'

export const DEFAULT_ANTHROPIC_MODEL = 'claude-sonnet-5-5'
export const DEFAULT_OPENAI_MODEL = 'gpt-4o-mini'
export const MAX_OUTPUT_TOKENS = 1800
// Netlify synchronous functions stop after 60 s (not configurable, docs.netlify.com/build/functions/configuration):
// the model loop gets 40 s, the rest is reading the bucket and assembling the answer.
export const LLM_DEADLINE_MS = 40_000
export const DEFAULT_HOURLY_LIMIT = 30

/** @returns {{ name:'anthropic'|'openai', key:string, keyVar:string, model:string, warnings:string[] }} */
export function pickFinanceProvider(env) {
  const warnings = []
  const wanted = String(env.FINANCE_LLM_PROVIDER ?? '').trim().toLowerCase()
  if (wanted !== '' && wanted !== 'anthropic' && wanted !== 'openai') warnings.push('FINANCE_LLM_PROVIDER: unknown value, openai used')
  const name = wanted === 'anthropic' ? 'anthropic' : 'openai'
  const keyVar = name === 'anthropic' ? 'ANTHROPIC_API_KEY' : 'OPENAI_API_KEY'
  const wantedModel = String(env.FINANCE_MODEL ?? '').trim()
  const fits = wantedModel !== '' && (name === 'anthropic' ? wantedModel.startsWith('claude-') : !wantedModel.startsWith('claude-'))
  if (wantedModel !== '' && !fits) warnings.push(`FINANCE_MODEL does not match provider ${name}, the default model was used`)
  const model = fits ? wantedModel : name === 'anthropic' ? DEFAULT_ANTHROPIC_MODEL : (env.OPENAI_MODEL || DEFAULT_OPENAI_MODEL)
  return { name, key: String(env[keyVar] ?? '').trim(), keyVar, model, warnings }
}

// ── hourly limit (best effort: memory of one warm function instance) ─────────────────────────────

const hits = []

/** @returns {{ ok:true } | { ok:false, retryAfterMin:number, limit:number }} */
export function checkRateLimit(env = process.env, now = Date.now(), store = hits) {
  const limit = Math.max(1, Number.parseInt(env.FINANCE_HOURLY_LIMIT ?? '', 10) || DEFAULT_HOURLY_LIMIT)
  while (store.length > 0 && now - store[0] >= 3_600_000) store.shift()
  if (store.length >= limit) return { ok: false, retryAfterMin: Math.max(1, Math.ceil((3_600_000 - (now - store[0])) / 60_000)), limit }
  store.push(now)
  return { ok: true }
}

export const resetRateLimit = (store = hits) => { store.length = 0 }

// ── Claude loop ──────────────────────────────────────────────────────────────────────────────────

function cutToLastSentence(text) {
  const i = Math.max(text.lastIndexOf('. '), text.lastIndexOf('.\n'), text.lastIndexOf('!'), text.lastIndexOf('?'))
  return i > 0 ? text.slice(0, i + 1) : text
}

/**
 * @returns {{ text:string, rounds:number, toolCalls:Array<{name:string,args:object}>, usage:{input:number,output:number,cacheRead:number,cacheWrite:number}, truncated:boolean }}
 */
export async function runAnthropicFinanceChat({
  apiKey, model, system, user, tool, executeTool, fetchFn = fetch, now = Date.now,
  maxToolCalls = MAX_TOOL_CALLS, maxTokens = MAX_OUTPUT_TOKENS, deadlineMs = LLM_DEADLINE_MS, effort = 'medium',
}) {
  const client = new Anthropic({ apiKey, fetch: fetchFn, maxRetries: 1 })
  const started = now()
  const usage = emptyUsage()
  const toolCalls = []
  const messages = [{ role: 'user', content: user }]
  const spec = { name: tool.name, description: tool.description, input_schema: tool.parameters }
  let reminded = false
  const maxRounds = maxToolCalls + 3
  for (let round = 0; round < maxRounds; round++) {
    const left = deadlineMs - (now() - started)
    if (left < 3000) throw new Error('the model response time was exceeded')
    const noMoreTools = toolCalls.length >= maxToolCalls
    const res = await client.messages.create({
      model,
      max_tokens: maxTokens,
      system,
      messages,
      tools: [spec],
      tool_choice: noMoreTools ? { type: 'none' } : { type: 'auto' },
      output_config: { effort },
    }, { timeout: left })
    usage.input += res.usage?.input_tokens ?? 0
    usage.output += res.usage?.output_tokens ?? 0
    usage.cacheRead += res.usage?.cache_read_input_tokens ?? 0
    usage.cacheWrite += res.usage?.cache_creation_input_tokens ?? 0
    if (res.stop_reason === 'refusal') throw new Error('the model refused to answer (refusal)')

    const uses = res.content.filter((b) => b.type === 'tool_use')
    if (uses.length > 0 && !noMoreTools) {
      messages.push({ role: 'assistant', content: res.content })
      const results = []
      for (const use of uses) {
        if (toolCalls.length >= maxToolCalls) {
          results.push({ type: 'tool_result', tool_use_id: use.id, is_error: true, content: LIMIT_REACHED })
          continue
        }
        toolCalls.push({ name: use.name, args: use.input ?? {} })
        results.push({ type: 'tool_result', tool_use_id: use.id, content: await runTool(executeTool, use.name, use.input ?? {}) })
      }
      messages.push({ role: 'user', content: results })
      continue
    }
    if (toolCalls.length === 0 && !reminded) {
      // forced tool_choice is rejected on this model: one reminder instead (a comment without data would have no numbers to quote)
      reminded = true
      if (res.content.length > 0) messages.push({ role: 'assistant', content: res.content })
      messages.push({ role: 'user', content: 'First call the get_finance tool, and only then write the comment.' })
      continue
    }
    const raw = res.content.filter((b) => b.type === 'text').map((b) => b.text).join('')
    const truncated = res.stop_reason === 'max_tokens'
    return { text: truncated ? cutToLastSentence(raw) : raw, rounds: round + 1, toolCalls, usage, truncated }
  }
  throw new Error('the tool loop returned no text')
}

// ── log ──────────────────────────────────────────────────────────────────────────────────────────

/** One JSON line per finance question: provider, model, counts, tokens, estimated cost. No question, no answer, no figures. */
export function logFinanceUsage(info, log = console.log) {
  const cost = estimateCostUsd(info.model, info.usage)
  log(JSON.stringify({
    event: 'finance_llm',
    provider: info.provider,
    model: info.model,
    rounds: info.rounds,
    toolCalls: info.toolCalls,
    inputTokens: info.usage.input,
    outputTokens: info.usage.output,
    cacheReadTokens: info.usage.cacheRead,
    costUsdEstimate: cost,
    numbersChecked: info.numbersChecked ?? 0,
    numbersRemoved: info.numbersRemoved ?? 0,
    scrubbed: info.scrubbed ?? 0,
    ms: info.ms ?? null,
    ok: info.ok,
  }))
  return cost
}
