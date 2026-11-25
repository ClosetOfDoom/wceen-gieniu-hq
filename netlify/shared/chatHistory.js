// chatHistory.js — the short memory of one conversation with Stanley.
//
// The gateway is stateless: every chat turn is one HTTP request. The browser keeps the last few messages and sends
// them with each turn (context.history); the server uses them (a) to continue a reel-plan conversation ("To which
// date, sir?" → "Friday 19:00") and (b) as prior turns for the model. Nothing is stored on the server.
//
//   item: { role: 'user' | 'assistant', content: string, intent?: string, at?: epoch ms }
// Pure, no imports (the browser and the server both use it).

export const HISTORY_MAX_MESSAGES = 8
export const HISTORY_MAX_CHARS = 1200
/** Older messages are dropped (a new day is a new conversation). */
export const HISTORY_WINDOW_MS = 30 * 60 * 1000
/** A reel-plan conversation stays "open" this long after Stanley's last reel answer. */
export const PUBLISHER_FOLLOWUP_MS = 15 * 60 * 1000

/** Safe copy of what the browser sent: right shape, bounded, recent, starting with a user message. */
export function sanitizeHistory(raw, nowMs = Date.now()) {
  if (!Array.isArray(raw)) return []
  const out = []
  for (const m of raw.slice(-HISTORY_MAX_MESSAGES)) {
    if (!m || (m.role !== 'user' && m.role !== 'assistant')) continue
    const content = String(m.content ?? '').trim().slice(0, HISTORY_MAX_CHARS)
    if (!content) continue
    const at = Number.isFinite(m.at) ? Number(m.at) : null
    if (at !== null && nowMs - at > HISTORY_WINDOW_MS) continue
    out.push({ role: m.role, content, intent: typeof m.intent === 'string' ? m.intent.slice(0, 32) : null, at })
  }
  while (out.length && out[0].role !== 'user') out.shift()
  return out
}

/** Plain text block for single-shot prompts. */
export function formatHistory(history) {
  return history.map((m) => `${m.role === 'user' ? 'Filip' : 'Stanley'}: ${m.content}`).join('\n')
}

/**
 * Chat messages for the model: history + the new user message, strictly alternating (consecutive messages of one
 * role are merged), starting with the user.
 */
export function toMessages(history, userMessage) {
  const msgs = []
  for (const m of [...history, { role: 'user', content: userMessage }]) {
    const last = msgs[msgs.length - 1]
    if (last && last.role === m.role) last.content += `\n\n${m.content}`
    else msgs.push({ role: m.role, content: m.content })
  }
  return msgs
}

/** Was Stanley's last answer a reel-plan answer, recently? Then a short follow-up belongs to that conversation. */
export function inPublisherConversation(history, nowMs = Date.now()) {
  for (let i = history.length - 1; i >= 0; i--) {
    const m = history[i]
    if (m.role !== 'assistant') continue
    return m.intent === 'publisher' && (m.at === null || nowMs - m.at <= PUBLISHER_FOLLOWUP_MS)
  }
  return false
}
