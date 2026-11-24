// publisherStanley.js — Stanley knows and changes the reel publication plan of Językozak.
//
// ONE source of truth: the Publisher (/api/zewn, see publisherClient.js). Stanley keeps no copy of the queue.
//
// Who does what in one chat turn
//   · Claude (official SDK, tool loop) picks the tool and writes the voice: plan_publikacji, status_publikacji,
//     przesun_rolke, zamien_rolki, wstrzymaj_rolke, wznow_rolke. It never computes a date: the date words go to
//     publisherWhen.js, which resolves them in Europe/Warsaw or refuses.
//   · The server prints every FACT itself (the plan table, "Before / After", the Publisher's refusal, the queue end),
//     before Claude's text, so a date or a word can never come from the model's memory.
//   · Write tools only PREVIEW (dry_run=true). The change is made after Filip says "yes": the preview travels to the
//     browser as a signed, expiring token (HMAC with the shared password), comes back with the "yes", is verified,
//     and only then runs for real. Afterwards the plan is read again and shown.
//   · The Publisher unreachable / refusing authentication → "I don't have that data — Publisher API returned <code>",
//     written by the server; nothing is guessed.

import { createHmac, timingSafeEqual } from 'node:crypto'
import Anthropic from '@anthropic-ai/sdk'
import { PublisherError, createPublisherClient, publisherConfigFromEnv } from './publisherClient.js'
import { PLAN_PERIODS, addDays, parseWhen, resolveRange, weekdayName } from './publisherWhen.js'
import { warsawParts } from './webinarMail.js'
import { DEFAULT_ANTHROPIC_MODEL, checkRateLimit } from './financeLlm.js'
import { emptyUsage } from './llmTools.js'
import { hasPublisherKeyword, isAffirmation, isNegation, norm, startsWithPublisherVerb } from './publisherIntent.js'

export const PENDING_TTL_MS = 10 * 60 * 1000
export const MAX_TOOL_CALLS = 8
export const MAX_ACTIONS_PER_CONFIRMATION = 3
const DEADLINE_MS = 40_000
const MAX_TOKENS = 1200

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i

// ── Which turns are ours ────────────────────────────────────────────────────────

export { isAffirmation, isNegation }

let wordsCache = { at: 0, words: null }

/** Known reel words (from the Publisher), for commands without the word "reel" ("pause mettere"). Cached 60 s. */
async function knownWords(client, now) {
  if (wordsCache.words && Date.now() - wordsCache.at < 60_000) return wordsCache.words
  const today = warsawParts(now).date
  const plan = await client.plan({ od: addDays(today, -30), do: addDays(today, 400) })
  const words = new Set(plan.wpisy.flatMap((w) => [norm(w.slowo), norm(w.post)]))
  wordsCache = { at: Date.now(), words }
  return words
}
export const resetWordsCache = () => { wordsCache = { at: 0, words: null } }

/**
 * 'confirm' | 'cancel' | 'question' | null.  "yes" / "no" are ours only while a preview is waiting.
 * A command that does not say "reel" is ours only when it names a word that is in the queue.
 */
export async function publisherTurn(message, { pending = null, env = process.env, now = new Date(), deps = {} } = {}) {
  if (pending && isAffirmation(message)) return 'confirm'
  if (pending && isNegation(message)) return 'cancel'
  const m = norm(message)
  if (hasPublisherKeyword(message)) return 'question'
  if (startsWithPublisherVerb(message)) {
    try {
      const client = deps.client ?? createPublisherClient(publisherConfigFromEnv(env))
      const words = await knownWords(client, now)
      if (m.split(/[^a-z0-9-]+/).some((t) => t.length >= 3 && words.has(t))) return 'question'
    } catch { /* cannot read the queue: not ours */ }
  }
  return null
}

// ── Signed confirmation token ───────────────────────────────────────────────────

const b64 = (buf) => Buffer.from(buf).toString('base64url')

export function signPending(payload, secret, now = Date.now()) {
  const body = b64(JSON.stringify({ ...payload, t: now }))
  return `v1.${body}.${createHmac('sha256', secret).update(body).digest('base64url')}`
}

/** payload | null (wrong signature, malformed, or older than PENDING_TTL_MS). */
export function verifyPending(token, secret, now = Date.now()) {
  const m = /^v1\.([A-Za-z0-9_-]+)\.([A-Za-z0-9_-]+)$/.exec(String(token ?? ''))
  if (!m || !secret) return null
  const want = createHmac('sha256', secret).update(m[1]).digest()
  const got = Buffer.from(m[2], 'base64url')
  if (got.length !== want.length || !timingSafeEqual(got, want)) return null
  try {
    const p = JSON.parse(Buffer.from(m[1], 'base64url').toString('utf8'))
    if (!Array.isArray(p.actions) || typeof p.t !== 'number' || now - p.t > PENDING_TTL_MS || now < p.t - 60_000) return null
    return p
  } catch { return null }
}

// ── Tools ───────────────────────────────────────────────────────────────────────

export const PUBLISHER_TOOLS = [
  {
    name: 'plan_publikacji',
    description:
      'The reel publication plan from the Publisher: per reel the Warsaw date and time, the word, the language and the status per platform. ' +
      'Use `okres` for named periods ("next week" = next_week, "this week" = this_week); default is the next 7 days. Or give od/do as dates or phrases ("2026-12-01", "Monday").',
    input_schema: {
      type: 'object',
      properties: {
        okres: { type: 'string', enum: PLAN_PERIODS, description: 'Named period. Default next_7_days.' },
        od: { type: 'string', description: 'From (date or phrase). Optional.' },
        do: { type: 'string', description: 'To, inclusive (date or phrase). Optional.' },
      },
    },
  },
  {
    name: 'status_publikacji',
    description: 'Publisher status: running (START) or paused (PAUZA), how far the queue runs, number in the queue, warnings and errors.',
    input_schema: { type: 'object', properties: {} },
  },
  {
    name: 'przesun_rolke',
    description:
      'PREVIEW of moving one reel to a new date/time (nothing changes until Filip says "yes"). `rolka` = its word (e.g. "capello") or id. ' +
      '`nowa_data` = Filip\'s own words for the date ("Friday 19:00", "tomorrow", "2026-12-04 18:00"): pass them as they are, do not compute dates.',
    input_schema: {
      type: 'object',
      properties: { rolka: { type: 'string' }, nowa_data: { type: 'string' } },
      required: ['rolka', 'nowa_data'],
    },
  },
  {
    name: 'zamien_rolki',
    description: 'PREVIEW of swapping the dates of two reels (nothing changes until Filip says "yes"). a and b are their words or ids.',
    input_schema: { type: 'object', properties: { a: { type: 'string' }, b: { type: 'string' } }, required: ['a', 'b'] },
  },
  {
    name: 'wstrzymaj_rolke',
    description: 'PREVIEW of pausing a reel: it gives up its slot and does not go out (nothing changes until Filip says "yes").',
    input_schema: { type: 'object', properties: { rolka: { type: 'string' } }, required: ['rolka'] },
  },
  {
    name: 'wznow_rolke',
    description: 'PREVIEW of resuming a paused reel: it goes to the next free slot (nothing changes until Filip says "yes").',
    input_schema: { type: 'object', properties: { rolka: { type: 'string' } }, required: ['rolka'] },
  },
]

const PLATFORM_SHORT = { facebook: 'FB', instagram: 'IG', youtube: 'YT' }

// The Publisher speaks Polish (ASCII keys); Stanley's table is in English. Unknown values pass through unchanged.
const STATUS_EN = {
  brak_konfiguracji: 'not configured', brak_opisu: 'no description', zaplanowany: 'scheduled', wysylanie: 'sending',
  przetwarzanie: 'processing', opublikowany: 'published', opublikowany_recznie: 'published manually', blad: 'error',
  recznie: 'manual (upload in Studio)', wgrany: 'uploaded (goes live on time)',
}
const LANGUAGE_EN = {
  wloski: 'Italian', hiszpanski: 'Spanish', grecki: 'Greek', angielski: 'English', niemiecki: 'German', francuski: 'French',
  portugalski: 'Portuguese', rosyjski: 'Russian', ukrainski: 'Ukrainian', japonski: 'Japanese', chinski: 'Chinese', turecki: 'Turkish',
  szwedzki: 'Swedish', norweski: 'Norwegian', czeski: 'Czech', polski: 'Polish', lacina: 'Latin', arabski: 'Arabic', koreanski: 'Korean',
}
const statusEn = (v) => STATUS_EN[v?.status] ?? v?.etykieta ?? String(v?.status ?? '?')
const languageEn = (j) => LANGUAGE_EN[String(j ?? '').toLowerCase()] ?? j

/** Compact entry for the model (and for rendering). */
const entryView = (w) => ({
  post: w.post, when: `${weekdayName(w.data_warszawa.slice(0, 10))} ${w.data_warszawa}`, word: w.slowo, language: languageEn(w.jezyk),
  paused: Boolean(w.wstrzymany),
  platforms: Object.fromEntries(Object.entries(w.platformy ?? {}).map(([p, v]) => [PLATFORM_SHORT[p] ?? p, v.blad ? `${statusEn(v)} (${v.blad})` : statusEn(v)])),
})

/** Resolves a word / slug / id to one post. Several matches or none is an answer, not a guess. */
export async function resolvePost(client, ref, now) {
  const q = String(ref ?? '').trim()
  if (!q) return { error: 'No reel given: pass its word or id.' }
  if (UUID.test(q)) return { post: q, label: q }
  const today = warsawParts(now).date
  const plan = await client.plan({ od: addDays(today, -30), do: addDays(today, 400) })
  const n = norm(q)
  const hits = plan.wpisy.filter((w) => norm(w.slowo) === n || norm(w.post) === n)
  if (hits.length === 1) return { post: hits[0].post, label: `${hits[0].slowo} (${languageEn(hits[0].jezyk)})`, entry: hits[0] }
  if (hits.length === 0) return { error: `No reel with the word "${q}" in the queue (checked ${addDays(today, -30)} to ${addDays(today, 400)}).` }
  return { error: `"${q}" matches ${hits.length} reels, ask which one: ${hits.map((h) => `${h.slowo} [${languageEn(h.jezyk)}] ${h.data_warszawa} (id ${h.post})`).join('; ')}.` }
}

/**
 * Tool executor for one chat turn. `state` collects what the server prints itself:
 * plan, status, proposals (dry runs, to be confirmed), refusals (the Publisher's reasons), apiFailure (code).
 */
export function makeExecutor({ client, now, state }) {
  const failure = (e) => {
    if (e instanceof PublisherError && e.validation) {
      state.refusals.push(e.message)
      return { error: e.message, refused_by_publisher: true }
    }
    const code = e instanceof PublisherError ? e.code : 'unreachable'
    state.apiFailure ??= { code }
    return { error: `Publisher API unavailable (${code}). Do not guess; the server reports it.` }
  }

  async function propose(action, params, label) {
    if (state.proposals.length >= MAX_ACTIONS_PER_CONFIRMATION) return { error: `At most ${MAX_ACTIONS_PER_CONFIRMATION} changes per confirmation.` }
    const r = await client.change(action, params, { dryRun: true })   // a preview ALWAYS: the model cannot write
    state.proposals.push({ action, params, labels: label, result: r })
    return { preview: true, changes: r.zmiany, warnings: r.ostrzezenia, nothing_changes_until_yes: true }
  }

  return async function execute(name, args) {
    try {
      switch (name) {
        case 'plan_publikacji': {
          const range = resolveRange(args ?? {}, now)
          if (!range.ok) return { error: range.error }
          const plan = await client.plan({ od: range.od, do: range.do })
          state.plan = { range, plan }
          return { od: plan.od, do: plan.do, count: plan.liczba, reels: plan.wpisy.map(entryView) }
        }
        case 'status_publikacji': {
          const s = await client.status()
          state.status = s
          return { mode: s.tryb, queue_runs_until: s.zapasDoWarszawa, queued: s.wKolejce, warnings: s.ostrzezenia, errors: s.bledy, now: s.teraz }
        }
        case 'przesun_rolke': {
          const p = await resolvePost(client, args?.rolka, now)
          if (p.error) return { error: p.error }
          const when = parseWhen(args?.nowa_data, now)
          if (!when.ok) return { error: when.error }
          return await propose('przesun', { post: p.post, nowa_data: when.spec }, { [p.post]: p.label })
        }
        case 'zamien_rolki': {
          const [a, b] = [await resolvePost(client, args?.a, now), await resolvePost(client, args?.b, now)]
          if (a.error || b.error) return { error: a.error ?? b.error }
          return await propose('zamien', { post_a: a.post, post_b: b.post }, { [a.post]: a.label, [b.post]: b.label })
        }
        case 'wstrzymaj_rolke':
        case 'wznow_rolke': {
          const p = await resolvePost(client, args?.rolka, now)
          if (p.error) return { error: p.error }
          return await propose(name === 'wstrzymaj_rolke' ? 'wstrzymaj' : 'wznow', { post: p.post }, { [p.post]: p.label })
        }
        default:
          return { error: `Unknown tool: ${name}` }
      }
    } catch (e) {
      return failure(e)
    }
  }
}

// ── Facts printed by the server ─────────────────────────────────────────────────

const platformsText = (w) => Object.entries(w.platformy ?? {}).map(([p, v]) => `${PLATFORM_SHORT[p] ?? p}: ${statusEn(v)}${v.blad ? ` (${v.blad})` : ''}`).join(', ')

export function renderPlan({ range, plan }) {
  if (plan.liczba === 0) return `No reels are scheduled between ${plan.od} and ${plan.do}.`
  const lines = plan.wpisy.map((w) => `• ${weekdayName(w.data_warszawa.slice(0, 10))} ${w.data_warszawa} · ${w.slowo} (${languageEn(w.jezyk)})${w.wstrzymany ? ' · PAUSED' : ''} · ${platformsText(w)}`)
  return [`Reel plan, ${range.label} (${plan.od} to ${plan.do}, Warsaw time), ${plan.liczba} ${plan.liczba === 1 ? 'reel' : 'reels'}:`, ...lines].join('\n')
}

export const queueEndLine = (status) => (status?.zapasDoWarszawa ? `Queue runs until ${status.zapasDoWarszawa}.` : null)

/** "Before / After" lines of one preview or one executed change. */
export function renderChange(item, { executed = false } = {}) {
  const r = item.result
  const name = (slug) => item.labels?.[slug] ?? slug
  const lines = []
  for (const z of r.zmiany ?? []) {
    const from = z.z ?? '(no slot)'
    const to = z.na ?? '(no slot, paused)'
    lines.push(`${name(z.post)}: ${from} → ${to}`)
  }
  const head = executed ? (r.zmieniono ? 'Changed:' : 'Nothing changed:') : 'Before → After:'
  return [head, ...lines.map((l) => `  ${l}`), ...(r.ostrzezenia ?? []).map((w) => `  Warning: ${w}`)].join('\n')
}

const apiFailureLine = (code) => `I don't have that data — Publisher API returned ${code}.`

// ── The Claude tool loop (official SDK) ─────────────────────────────────────────

export const PUBLISHER_RULES = `

━━━ REEL PUBLISHER MODE — for questions about reels, the publication plan and moving / swapping / pausing / resuming reels ━━━
You read and change the Językozak reel queue ONLY through the tools. The Publisher is the single source of truth: you hold no copy of the queue.
• Read questions ("reel plan", "what is scheduled", "publication plan"): call plan_publikacji (default: next_7_days; "next week" = next_week; "this week" = this_week). The SERVER prints the plan table itself, right before your text: never repeat it or list the reels again. Your text is 1-3 sentences of substance in persona: what stands out (a gap, a paused reel, a platform in error, a reel that is not scheduled), nothing the table already says line by line.
• Change commands ("move capello to Friday 19:00", "swap casa and scopo", "pause mettere", "resume X"): call przesun_rolke / zamien_rolki / wstrzymaj_rolke / wznow_rolke. They only PREVIEW: nothing changes until Filip answers "yes"; the server asks him and does it. Pass his words for the date exactly as he said them ("Friday 19:00", "tomorrow"); never compute or convert dates yourself. The SERVER prints Before → After; your text says in one sentence what will change.
• NEVER write a date, time, word, language or status that is not in a tool result. Never guess. If a tool returned an error: say plainly, in your own words, why it did not work (for a Publisher refusal use its reason). If the Publisher API is unavailable the server writes that message itself: you write nothing about it.
• If several reels match a word, ask which one (language or date). If the request is unclear, ask one short question.
• Persona and format unchanged: English, "sir", the first sentence carries information, ANSWER: and SPEECH: blocks. SPEECH is one or two sentences and never reads out a list of reels.`

/** @returns {Promise<{ text:string, toolCalls:Array<{name:string,args:object}>, usage:object, rounds:number }>} */
export async function runPublisherChat({ system, user, tools, execute, createMessage, model, maxToolCalls = MAX_TOOL_CALLS, deadlineMs = DEADLINE_MS, nowMs = Date.now }) {
  const started = nowMs()
  const usage = emptyUsage()
  const toolCalls = []
  const messages = [{ role: 'user', content: user }]
  for (let round = 0; round < maxToolCalls + 3; round++) {
    const left = deadlineMs - (nowMs() - started)
    if (left < 3000) throw new Error('model deadline exceeded')
    const noMoreTools = toolCalls.length >= maxToolCalls
    const res = await createMessage({
      model, max_tokens: MAX_TOKENS, system, messages, tools,
      tool_choice: noMoreTools ? { type: 'none' } : { type: 'auto' },
      output_config: { effort: 'low' },
    }, { timeout: left })
    usage.input += res.usage?.input_tokens ?? 0
    usage.output += res.usage?.output_tokens ?? 0
    if (res.stop_reason === 'refusal') throw new Error('model refused')
    const uses = res.content.filter((b) => b.type === 'tool_use')
    if (uses.length > 0 && !noMoreTools) {
      messages.push({ role: 'assistant', content: res.content })
      const results = []
      for (const use of uses) {
        if (toolCalls.length >= maxToolCalls) { results.push({ type: 'tool_result', tool_use_id: use.id, is_error: true, content: 'Tool limit reached.' }); continue }
        toolCalls.push({ name: use.name, args: use.input ?? {} })
        const out = await execute(use.name, use.input ?? {})
        results.push({ type: 'tool_result', tool_use_id: use.id, content: JSON.stringify(out), ...(out?.error ? { is_error: true } : {}) })
      }
      messages.push({ role: 'user', content: results })
      continue
    }
    return { text: res.content.filter((b) => b.type === 'text').map((b) => b.text).join(''), toolCalls, usage, rounds: round + 1 }
  }
  throw new Error('tool loop returned no text')
}

const publisherHits = []

function defaultCreateMessage(env) {
  const client = new Anthropic({ apiKey: env.ANTHROPIC_API_KEY, maxRetries: 1 })
  return (body, opts) => client.messages.create(body, opts)
}

const modelFor = (env) => {
  const wanted = String(env.PUBLISHER_MODEL ?? env.FINANCE_MODEL ?? '').trim()
  return wanted.startsWith('claude-') ? wanted : DEFAULT_ANTHROPIC_MODEL
}

// ── Answers ─────────────────────────────────────────────────────────────────────

const body = (text, speech, extra = {}) => ({
  answerText: text, speechText: speech, intent: 'publisher', confidence: 1,
  dataSourcesUsed: ['publisher'], warnings: [], llmUsed: Boolean(extra.llmUsed), llmProvider: extra.llmUsed ? 'anthropic' : null,
  pendingPublisher: extra.pending ?? null,
})

const clip = (s, n) => (s.length > n ? `${s.slice(0, n - 1).trimEnd()}…` : s)

/** Joins the server's facts and the model's words; the facts always come first. */
function join(parts) { return parts.filter(Boolean).join('\n\n') }

async function confirmTurn({ message, pendingToken, env, now, deps, parse, systemPrompt }) {
  const secret = env.STANLEY_ACCESS_TOKEN
  const pending = verifyPending(pendingToken, secret, now.getTime())
  if (isNegation(message)) return body('Understood, sir. Nothing was changed.', 'Understood, sir. Nothing was changed.')
  if (!pending) {
    const t = 'That confirmation has expired, sir. Ask again and I will show you the change once more.'
    return body(t, t)
  }
  let client
  try { client = deps.client ?? createPublisherClient(publisherConfigFromEnv(env)) } catch (e) { const t = apiFailureLine(e.code ?? 'not-configured'); return body(t, t) }

  const done = []
  let stopped = null
  for (const act of pending.actions) {
    try {
      const r = await client.change(act.action, act.params, { dryRun: false })
      done.push({ ...act, result: r })
    } catch (e) {
      stopped = e instanceof PublisherError && e.validation ? `Publisher refused: ${e.message}` : apiFailureLine(e instanceof PublisherError ? e.code : 'unreachable')
      break
    }
  }
  const changeText = done.map((d) => renderChange(d, { executed: true })).join('\n')

  // read the plan again (the Publisher is the truth, not the answer to the write)
  let planText = null
  let queueEnd = null
  let reread = null
  try {
    const dates = done.flatMap((d) => (d.result.zmiany ?? []).flatMap((z) => [z.z, z.na])).filter((x) => typeof x === 'string' && /^\d{4}-\d{2}-\d{2}/.test(x)).map((x) => x.slice(0, 10)).sort()
    const od = dates[0] ?? warsawParts(now).date
    const to = dates.length ? (dates[dates.length - 1] > addDays(od, 6) ? dates[dates.length - 1] : addDays(od, 6)) : addDays(od, 6)
    const [plan, status] = await Promise.all([client.plan({ od, do: to }), client.status().catch(() => null)])
    planText = `Plan now:\n${renderPlan({ range: { label: 'after the change' }, plan })}`
    queueEnd = queueEndLine(status)
    reread = { plan }
  } catch (e) {
    planText = apiFailureLine(e instanceof PublisherError ? e.code : 'unreachable')
  }

  let voice = ''
  let llmUsed = false
  if (!stopped && done.length && env.ANTHROPIC_API_KEY) {
    try {
      const create = deps.createMessage ?? defaultCreateMessage(env)
      const res = await create({
        model: modelFor(env), max_tokens: 300, output_config: { effort: 'low' },
        system: `${systemPrompt}\n\nFilip confirmed a reel schedule change and it has been made. Write ANSWER: one or two sentences in persona saying it is done and what the plan looks like now. Use ONLY the facts below; the server prints the change and the plan itself, so do not list them. Then SPEECH: one sentence.`,
        messages: [{ role: 'user', content: JSON.stringify({ changed: done.map((d) => d.result.zmiany), warnings: done.flatMap((d) => d.result.ostrzezenia ?? []), plan_after: reread?.plan?.wpisy?.map(entryView) ?? null }) }],
      }, { timeout: 15000 })
      voice = parse(res.content.filter((b) => b.type === 'text').map((b) => b.text).join('')).answerText
      llmUsed = voice.length > 0
    } catch { /* the server's facts are enough */ }
  }
  if (!voice && !stopped) voice = 'Done, sir.'
  const text = join([stopped, changeText, planText, queueEnd, voice])
  return body(text, clip(stopped ? stopped : voice, 220), { llmUsed })
}

/**
 * One publisher turn. turn = 'confirm' | 'cancel' | 'question' (from publisherTurn).
 * deps (tests): { client, createMessage }. Never throws: every failure is an answer.
 */
export async function answerPublisher({ turn, message, systemPrompt, parse, pendingToken = null, env = process.env, now = new Date(), deps = {} }) {
  if (turn === 'confirm' || turn === 'cancel') return confirmTurn({ message, pendingToken, env, now, deps, parse, systemPrompt })

  let client
  try {
    client = deps.client ?? createPublisherClient(publisherConfigFromEnv(env))
  } catch (e) {
    const t = apiFailureLine(e.code ?? 'not-configured')
    return body(t, t)
  }

  const limit = checkRateLimit({ FINANCE_HOURLY_LIMIT: env.PUBLISHER_HOURLY_LIMIT || 60 }, Date.now(), publisherHits)
  if (!limit.ok) {
    const t = `That is enough for this hour, sir. Ask me again in about ${limit.retryAfterMin} minutes.`
    return body(t, t)
  }

  const state = { plan: null, status: null, proposals: [], refusals: [], apiFailure: null }
  const execute = makeExecutor({ client, now, state })
  const today = warsawParts(now).date
  let text = ''
  let used = false
  try {
    if (!env.ANTHROPIC_API_KEY && !deps.createMessage) throw new Error('no Claude key')
    const out = await runPublisherChat({
      system: `${systemPrompt}${PUBLISHER_RULES}\n\nToday is ${today} (${weekdayName(today)}), Warsaw time.`,
      user: message,
      tools: PUBLISHER_TOOLS,
      execute,
      createMessage: deps.createMessage ?? defaultCreateMessage(env),
      model: modelFor(env),
    })
    text = out.text
    used = true
    console.log(JSON.stringify({ publisher: true, model: modelFor(env), rounds: out.rounds, tools: out.toolCalls.map((c) => c.name), tokens: out.usage }))
  } catch (e) {
    console.log(JSON.stringify({ publisher: true, error: String(e.message).slice(0, 120) }))
    // Model unavailable: a plain plan question is still answered, from the Publisher alone. Changes are not.
    if (!state.plan && !state.apiFailure && !state.proposals.length && hasPublisherKeyword(message)) await execute('plan_publikacji', {})
    if (!state.plan && !state.proposals.length && !state.apiFailure) {
      const t = 'My language model is not answering, sir, so I will not guess what you meant. Nothing was changed.'
      return body(t, t)
    }
    text = ''
  }

  if (state.apiFailure) {
    const t = apiFailureLine(state.apiFailure.code)
    return body(t, t)
  }

  const parsed = text ? parse(text) : { answerText: '', speechText: '' }
  const facts = []
  if (state.plan) {
    // the queue end comes from the Publisher status, read here when the model did not ask for it
    if (!state.status) { try { state.status = await client.status() } catch { /* the line is optional */ } }
    facts.push(renderPlan(state.plan), queueEndLine(state.status))
  } else if (state.status) {
    facts.push(`Publisher is ${state.status.tryb === 'START' ? 'running' : 'paused'}. ${queueEndLine(state.status) ?? ''}`.trim())
  }
  for (const p of state.proposals) facts.push(renderChange(p))
  for (const r of state.refusals) facts.push(`Publisher refused: ${r}`)

  let pending = null
  if (state.proposals.length) {
    const secret = env.STANLEY_ACCESS_TOKEN
    if (secret) {
      pending = signPending({ actions: state.proposals.map((p) => ({ action: p.action, params: p.params, labels: p.labels })) }, secret, now.getTime())
      facts.push('Say "yes" to make this change, or "no" to leave it.')
    }
  }
  const answerText = join([...facts, parsed.answerText])
  const speech = parsed.speechText || (state.plan ? `Plan for ${state.plan.range.label}: ${state.plan.plan.liczba} reels.` : 'Checked, sir.')
  return body(answerText, clip(speech, 260), { llmUsed: used, pending })
}
