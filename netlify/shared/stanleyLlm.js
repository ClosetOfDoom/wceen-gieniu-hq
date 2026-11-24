// stanleyLlm.js — Stanley's model call (the path gieniu-command has always used, moved here so the daily brief shares it).
//
// Env: LLM_PROVIDER (openai | anthropic), OPENAI_API_KEY / OPENAI_MODEL, ANTHROPIC_API_KEY / ANTHROPIC_MODEL.
// Same choice as gieniu-command: provider "openai" with an OpenAI key → OpenAI; else an Anthropic key → Anthropic; else OpenAI.
// Keys are never logged or returned.

export async function callOpenAI(system, userMessage, apiKey, { temperature = 0.3, max_tokens = 600, timeoutMs = 8000 } = {}, env = process.env) {
  const controller = new AbortController()
  const timer = setTimeout(() => controller.abort(), timeoutMs)
  try {
    const res = await fetch('https://api.openai.com/v1/chat/completions', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${apiKey}` },
      body: JSON.stringify({
        model: env.OPENAI_MODEL || 'gpt-4o-mini',
        messages: [{ role: 'system', content: system }, { role: 'user', content: userMessage }],
        max_tokens,
        temperature,
      }),
      signal: controller.signal,
    })
    const data = await res.json()
    if (!res.ok) throw new Error(`OpenAI ${res.status}: ${data.error?.message ?? 'unknown'}`)
    return data.choices?.[0]?.message?.content ?? ''
  } finally {
    clearTimeout(timer)
  }
}

export async function callAnthropic(system, userMessage, apiKey, { temperature = 0.3, max_tokens = 600, timeoutMs = 8000 } = {}, env = process.env) {
  const controller = new AbortController()
  const timer = setTimeout(() => controller.abort(), timeoutMs)
  try {
    const res = await fetch('https://api.anthropic.com/v1/messages', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'x-api-key': apiKey, 'anthropic-version': '2023-06-01' },
      body: JSON.stringify({
        model: env.ANTHROPIC_MODEL || 'claude-sonnet-4-6',
        max_tokens,
        temperature,
        system,
        messages: [{ role: 'user', content: userMessage }],
      }),
      signal: controller.signal,
    })
    const data = await res.json()
    if (!res.ok) throw new Error(`Anthropic ${res.status}: ${data.error?.message ?? 'unknown'}`)
    return data.content?.[0]?.text ?? ''
  } finally {
    clearTimeout(timer)
  }
}

/** { provider, model } that a call would use, or null when no model is configured. */
export function llmChoice(env = process.env) {
  if (!env.LLM_PROVIDER || (!env.OPENAI_API_KEY && !env.ANTHROPIC_API_KEY)) return null
  if (env.LLM_PROVIDER === 'openai' && env.OPENAI_API_KEY) return { provider: 'openai', model: env.OPENAI_MODEL || 'gpt-4o-mini' }
  if (env.ANTHROPIC_API_KEY) return { provider: 'anthropic', model: env.ANTHROPIC_MODEL || 'claude-sonnet-4-6' }
  return { provider: 'openai', model: env.OPENAI_MODEL || 'gpt-4o-mini' }
}

/** One call through the configured provider: { text, provider, model }. Throws when no model is configured. */
export async function callLlm(system, userMessage, opts = {}, env = process.env) {
  const choice = llmChoice(env)
  if (!choice) throw new Error('LLM not configured')
  const text = choice.provider === 'anthropic'
    ? await callAnthropic(system, userMessage, env.ANTHROPIC_API_KEY, opts, env)
    : await callOpenAI(system, userMessage, env.OPENAI_API_KEY, opts, env)
  return { text, ...choice }
}
