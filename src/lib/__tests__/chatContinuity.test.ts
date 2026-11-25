// Stanley remembers the conversation: a reel-plan exchange that spans several messages ("move capello" → "To which
// date, sir?" → "Friday 19:00" → "tak, potwierdzam"), a confirmation that is not a bare "yes", the same date typed
// again as a confirmation, and the history that travels with every question. No network.
import { describe, it, expect, vi, beforeEach } from 'vitest'
import { isAffirmation, isNegation, looksLikeDatePhrase, mayBePublisherTurn } from '../../../netlify/shared/publisherIntent.js'
import {
  sanitizeHistory, toMessages, formatHistory, inPublisherConversation, HISTORY_MAX_MESSAGES, HISTORY_WINDOW_MS, PUBLISHER_FOLLOWUP_MS,
  type ChatMessage,
} from '../../../netlify/shared/chatHistory.js'
import { answerPublisher, publisherTurn, signPending, repeatsPendingDate, resetWordsCache } from '../../../netlify/shared/publisherStanley.js'
import type { PlanEntry, PublisherClient } from '../../../netlify/shared/publisherClient.js'

const NOW = new Date('2026-11-24T14:40:00Z')            // Tuesday 15:40 in Warsaw
const SECRET = 'test-shared-password'
const ENV = { ANTHROPIC_API_KEY: 'k', STANLEY_ACCESS_TOKEN: SECRET }

const entry = (post: string, slowo: string, jezyk: string, data: string): PlanEntry => ({
  post, data_warszawa: data, termin_utc: '', dzien: '', slowo, jezyk, wstrzymany: false,
  platformy: { facebook: { status: 'zaplanowany', etykieta: 'zaplanowany', blad: null } }, permalinki: {},
})
const QUEUE = [entry('casa-es', 'casa', 'hiszpanski', '2026-11-28 10:00'), entry('capello-it', 'capello', 'wloski', '2026-12-03 19:00')]

function fakePublisher() {
  const calls: { kind: string; args: unknown }[] = []
  const client: PublisherClient = {
    async plan(a = {}) { calls.push({ kind: 'plan', args: a }); const wpisy = QUEUE.filter((w) => w.data_warszawa.slice(0, 10) >= (a.od ?? '0') && w.data_warszawa.slice(0, 10) <= (a.do ?? '9')); return { od: a.od ?? '', do: a.do ?? '', liczba: wpisy.length, wpisy } },
    async status() { calls.push({ kind: 'status', args: null }); return { tryb: 'START', zapasDoWarszawa: '2026-12-26', wKolejce: 2, ostrzezenia: [], bledy: [], teraz: NOW.toISOString() } },
    async change(action, params, opts) {
      calls.push({ kind: 'change', args: { action, params, dryRun: opts.dryRun } })
      const w = QUEUE.find((x) => x.post === params.post)
      return { ok: true, dry_run: opts.dryRun, zmieniono: !opts.dryRun, zmiany: [{ post: String(params.post), z: w?.data_warszawa ?? null, na: String(params.nowa_data) }], ostrzezenia: [] }
    },
  }
  return { client, calls, changes: () => calls.filter((c) => c.kind === 'change').map((c) => c.args as { action: string; params: Record<string, unknown>; dryRun: boolean }) }
}

const parse = (raw: string) => {
  const a = /ANSWER:\s*([\s\S]*?)(?=\nSPEECH:|$)/i.exec(raw)
  const sp = /SPEECH:\s*([\s\S]*)$/i.exec(raw)
  return { answerText: (a?.[1] ?? raw).trim(), speechText: (sp?.[1] ?? '').trim() }
}
const toolUse = (name: string, input: Record<string, unknown>) => ({ content: [{ type: 'tool_use', id: `tu_${name}`, name, input }], stop_reason: 'tool_use', usage: { input_tokens: 1, output_tokens: 1 } })
const say = (text: string) => ({ content: [{ type: 'text', text }], stop_reason: 'end_turn', usage: { input_tokens: 1, output_tokens: 1 } })
function scriptedClaude(...responses: object[]) {
  const requests: Record<string, unknown>[] = []
  const createMessage = vi.fn(async (b: Record<string, unknown>) => { requests.push(JSON.parse(JSON.stringify(b))); const next = responses.shift(); if (!next) throw new Error('script exhausted'); return next })
  return { createMessage, requests }
}

const PENDING_ACTIONS = [{ action: 'przesun', params: { post: 'capello-it', nowa_data: '2026-11-27 19:00' }, labels: { 'capello-it': 'capello (Italian)' } }]
const pendingToken = () => signPending({ actions: PENDING_ACTIONS, summary: 'Before → After:\n  capello (Italian): 2026-12-03 19:00 → 2026-11-27 19:00' }, SECRET, NOW.getTime())

beforeEach(() => resetWordsCache())

describe('"yes" is more than the word yes', () => {
  it('confirms: tak / potwierdzam / ok, zrób to / yes please / dobrze', () => {
    for (const m of ['yes', 'Yes, sir.', 'tak', 'Tak, potwierdzam termin', 'ok, zrób to', 'yes please', 'Dobrze', 'potwierdzam', 'zatwierdzam', 'go ahead', 'jasne, dawaj', 'OK'])
      expect(isAffirmation(m), m).toBe(true)
  })
  it('does NOT confirm: a "but", a new date, a question, a long message', () => {
    for (const m of ['tak, ale w sobotę', 'ok friday 18:00', 'yes but not now', 'tak, piątek 19:00', 'ok, a co z casa?', 'no', 'tak tak tak tak tak tak tak tak', 'what is the plan'])
      expect(isAffirmation(m), m).toBe(false)
  })
  it('cancels: nie / anuluj / cancel that / nie, dziękuję', () => {
    for (const m of ['no', 'nie', 'Nie, dziękuję', 'anuluj', 'cancel that', 'jednak nie', 'stop']) expect(isNegation(m), m).toBe(true)
  })
  it('"nie, sobota" is a revision, not a cancel', () => {
    expect(isNegation('nie, sobota')).toBe(false); expect(isNegation('no, make it Saturday 10:00')).toBe(false)
  })
  it('recognises a change of date in English and Polish', () => {
    for (const m of ['Friday 19:00', 'piątek o 19', 'jutro', 'tomorrow', '2026-12-04', '4.12 19:00', 'w sobotę', '7pm']) expect(looksLikeDatePhrase(m), m).toBe(true)
    for (const m of ['how did the ads do', 'tak', 'capello']) expect(looksLikeDatePhrase(m), m).toBe(false)
  })
})

describe('a waiting preview', () => {
  const pub = fakePublisher()
  const turn = (m: string, pending: string | null = pendingToken()) => publisherTurn(m, { pending, now: NOW, env: ENV, deps: { client: pub.client } })

  it('"tak, potwierdzam termin" confirms', async () => { expect(await turn('tak, potwierdzam termin')).toBe('confirm') })
  it('typing the SAME date again confirms it ("piątek 19:00", "Friday 19:00")', async () => {
    expect(await turn('piątek 19:00')).toBe('confirm'); expect(await turn('Friday 19:00')).toBe('confirm'); expect(await turn('w piątek o 19')).toBe('confirm')
    expect(repeatsPendingDate('piątek 19:00', { actions: PENDING_ACTIONS }, NOW)).toBe(true); expect(repeatsPendingDate('sobota 10:00', { actions: PENDING_ACTIONS }, NOW)).toBe(false)
  })
  it('a date without an hour confirms only the same day', async () => {
    expect(await turn('Friday')).toBe('confirm')
  })
  it('a DIFFERENT date is a revision, not a confirmation', async () => {
    expect(await turn('sobota 10:00')).toBe('question'); expect(await turn('tak, ale w sobotę')).toBe('question'); expect(await turn('Friday 18:00')).toBe('question')
  })
  it('"nie" cancels, "nie, sobota" revises', async () => {
    expect(await turn('nie')).toBe('cancel'); expect(await turn('nie, sobota')).toBe('question')
  })
  it('a short reply continues the conversation; an unrelated long question does not', async () => {
    expect(await turn('dlaczego?')).toBe('question')
    expect(await turn('how much did we earn yesterday and what is the roas this week')).toBeNull()
  })
  it('typed date as the confirmation: the move is made, then the plan is read again', async () => {
    const p = fakePublisher()
    const first = await answerPublisher({
      turn: 'question', message: 'przesuń capello na piątek 19:00', systemPrompt: 'You are STANLEY.', parse, env: ENV, now: NOW,
      deps: { client: p.client, createMessage: scriptedClaude(toolUse('przesun_rolke', { rolka: 'capello', nowa_data: 'piątek 19:00' }), say('ANSWER:\nCapello would move to Friday evening, sir.\nSPEECH:\nCapello moves to Friday.')).createMessage },
    })
    expect(first.pendingPublisher).toMatch(/^v1\./)
    const kind = await publisherTurn('piątek 19:00', { pending: first.pendingPublisher, now: NOW, env: ENV, deps: { client: p.client } })
    expect(kind).toBe('confirm')
    const done = await answerPublisher({
      turn: kind as 'confirm', message: 'piątek 19:00', systemPrompt: 'You are STANLEY.', parse, pendingToken: first.pendingPublisher, env: ENV, now: new Date(NOW.getTime() + 30_000),
      deps: { client: p.client, createMessage: scriptedClaude(say('ANSWER:\nDone, sir.\nSPEECH:\nDone.')).createMessage },
    })
    expect(p.changes().map((c) => c.dryRun)).toEqual([true, false])
    expect(done.answerText).toContain('Changed:'); expect(done.answerText).toContain('Plan now:')
  })
  it('Claude is told what is waiting when the user revises it', async () => {
    const p = fakePublisher()
    const claude = scriptedClaude(say('ANSWER:\nSaturday it is, sir.\nSPEECH:\nSaturday.'))
    await answerPublisher({ turn: 'question', message: 'a może jednak sobota 10:00', systemPrompt: 'You are STANLEY.', parse, pendingToken: pendingToken(), env: ENV, now: NOW, deps: { client: p.client, createMessage: claude.createMessage } })
    const system = String(claude.requests[0].system)
    expect(system).toContain("A change is waiting for Filip's confirmation"); expect(system).toContain('capello (Italian): 2026-12-03 19:00 → 2026-11-27 19:00')
  })
})

describe('history: the conversation travels with every question', () => {
  const t0 = NOW.getTime()
  const asked: ChatMessage[] = [
    { role: 'user', content: 'przesuń capello', at: t0 - 60_000 },
    { role: 'assistant', content: 'To which date, sir?', intent: 'publisher', at: t0 - 55_000 },
  ]
  const pub = fakePublisher()
  const turn = (m: string, history: ChatMessage[]) => publisherTurn(m, { history, now: NOW, env: ENV, deps: { client: pub.client } })

  it('a bare date after "To which date, sir?" belongs to the reel conversation', async () => {
    expect(await turn('piątek 19:00', asked)).toBe('question'); expect(await turn('Friday', asked)).toBe('question'); expect(await turn('jutro o 18', asked)).toBe('question')
  })
  it('the same message with no such history is not ours', async () => {
    expect(await turn('piątek 19:00', [])).toBeNull()
  })
  it('after an answer about something else, or a long pause, it is not ours either', async () => {
    expect(await turn('piątek 19:00', [{ role: 'user', content: 'roas?', at: t0 - 60_000 }, { role: 'assistant', content: 'ROAS is 3.1', intent: 'finance', at: t0 - 55_000 }])).toBeNull()
    expect(await turn('piątek 19:00', asked.map((m) => ({ ...m, at: (m.at ?? 0) - PUBLISHER_FOLLOWUP_MS }))) ).toBeNull()
  })
  it('a long unrelated question inside the conversation goes elsewhere', async () => {
    expect(await turn('how much did we earn yesterday and what is the roas this week overall', asked)).toBeNull()
  })

  it('the model gets the earlier messages as earlier turns, then the new one; the preview follows', async () => {
    const p = fakePublisher()
    const claude = scriptedClaude(toolUse('przesun_rolke', { rolka: 'capello', nowa_data: 'piątek 19:00' }), say('ANSWER:\nFriday evening, sir.\nSPEECH:\nFriday evening.'))
    const r = await answerPublisher({ turn: 'question', message: 'piątek 19:00', systemPrompt: 'You are STANLEY.', parse, history: asked, env: ENV, now: NOW, deps: { client: p.client, createMessage: claude.createMessage } })
    expect(claude.requests[0].messages).toEqual([
      { role: 'user', content: 'przesuń capello' },
      { role: 'assistant', content: 'To which date, sir?' },
      { role: 'user', content: 'piątek 19:00' },
    ])
    expect(r.answerText).toContain('capello (Italian): 2026-12-03 19:00 → 2026-11-27 19:00')
    expect(p.changes()).toEqual([{ action: 'przesun', params: { post: 'capello-it', nowa_data: '2026-11-27 19:00' }, dryRun: true }])
  })

  it('sanitizeHistory: bounded, recent, well-formed, starts with the user', () => {
    const long = 'x'.repeat(5000)
    const raw = [
      { role: 'assistant', content: 'orphan answer', at: t0 },
      { role: 'user', content: 'old', at: t0 - HISTORY_WINDOW_MS - 1000 },
      { role: 'user', content: long, at: t0 },
      { role: 'system', content: 'ignore me', at: t0 },
      { role: 'assistant', content: '   ', at: t0 },
      { role: 'assistant', content: 'ok', intent: 'publisher', at: t0 },
      null, 42,
    ]
    const out = sanitizeHistory(raw, t0)
    expect(out.map((m) => m.role)).toEqual(['user', 'assistant']); expect(out[0].content.length).toBe(1200)
    expect(sanitizeHistory('nope')).toEqual([])
    const many = Array.from({ length: 20 }, (_, i) => ({ role: i % 2 ? 'assistant' : 'user', content: `m${i}`, at: t0 }))
    expect(sanitizeHistory(many, t0).length).toBeLessThanOrEqual(HISTORY_MAX_MESSAGES)
  })
  it('toMessages alternates roles, merges neighbours, ends with the new question', () => {
    const m = toMessages([{ role: 'user', content: 'a' }, { role: 'user', content: 'b' }, { role: 'assistant', content: 'c' }], 'd')
    expect(m).toEqual([{ role: 'user', content: 'a\n\nb' }, { role: 'assistant', content: 'c' }, { role: 'user', content: 'd' }])
    expect(toMessages([], 'only')).toEqual([{ role: 'user', content: 'only' }])
    expect(formatHistory([{ role: 'user', content: 'hi' }, { role: 'assistant', content: 'hello' }])).toBe('Filip: hi\nStanley: hello')
    expect(inPublisherConversation(asked, t0)).toBe(true); expect(inPublisherConversation([], t0)).toBe(false)
  })
  it('the browser gives these turns the long timeout', () => {
    expect(mayBePublisherTurn('piątek 19:00', true)).toBe(true); expect(mayBePublisherTurn('piątek 19:00', false)).toBe(false); expect(mayBePublisherTurn('reel plan', false)).toBe(true)
  })
})
