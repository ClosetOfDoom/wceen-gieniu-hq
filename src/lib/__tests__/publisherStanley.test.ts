// Stanley and the reel Publisher: date phrases → Warsaw dates, which turns are ours, the tools against a mocked
// Publisher API (writes are ALWAYS previews), the whole chat turn with a scripted Claude, the "yes" that makes the
// change, and every way the API can fail. No network.
import { describe, it, expect, vi, beforeEach } from 'vitest'
import { parseWhen, periodRange, resolveRange } from '../../../netlify/shared/publisherWhen.js'
import {
  answerPublisher, makeExecutor, publisherTurn, resetWordsCache, resolvePost, signPending, verifyPending,
  renderPlan, PUBLISHER_TOOLS, PENDING_TTL_MS, type TurnState,
} from '../../../netlify/shared/publisherStanley.js'
import { PublisherError, createPublisherClient, zewnUrl, publisherConfigFromEnv, type PlanEntry, type PublisherClient } from '../../../netlify/shared/publisherClient.js'
import { enforceRefusal } from '../refusalGuard'

// ── helpers ─────────────────────────────────────────────────────────────────────

// Tuesday 2026-11-24, 15:40 in Warsaw (CET).
const NOW = new Date('2026-11-24T14:40:00Z')
const SECRET = 'test-shared-password'

const entry = (slug: string, slowo: string, jezyk: string, data: string, over: Partial<PlanEntry> = {}): PlanEntry => ({
  post: slug, data_warszawa: data, termin_utc: '', dzien: '', slowo, jezyk, wstrzymany: false,
  platformy: { facebook: { status: 'zaplanowany', etykieta: 'zaplanowany', blad: null }, instagram: { status: 'zaplanowany', etykieta: 'zaplanowany', blad: null }, youtube: { status: 'zaplanowany', etykieta: 'zaplanowany', blad: null } },
  permalinki: {}, ...over,
})

const QUEUE: PlanEntry[] = [
  entry('mettere-it', 'mettere', 'wloski', '2026-11-25 19:00'),
  entry('casa-es', 'casa', 'hiszpanski', '2026-11-28 10:00'),
  entry('scopo-it', 'scopo', 'wloski', '2026-11-30 19:00'),
  entry('capello-it', 'capello', 'wloski', '2026-12-03 19:00'),
  entry('krevati-el', 'krevati', 'grecki', '2026-12-05 21:00', { platformy: { facebook: { status: 'opublikowany_recznie', etykieta: 'opublikowany ręcznie', blad: null }, instagram: { status: 'blad', etykieta: 'błąd', blad: 'token wygasł' }, youtube: { status: 'wgrany', etykieta: 'wgrany', blad: null } } }),
]

function fakePublisher(over: { plan?: PlanEntry[]; failWith?: PublisherError; changeError?: PublisherError } = {}) {
  const calls: { kind: string; args: unknown }[] = []
  const queue = over.plan ?? QUEUE
  const client: PublisherClient = {
    async plan(args = {}) {
      calls.push({ kind: 'plan', args })
      if (over.failWith) throw over.failWith
      const od = args.od ?? '0000-00-00'
      const doDnia = args.do ?? '9999-99-99'
      const wpisy = queue.filter((w) => w.data_warszawa.slice(0, 10) >= od && w.data_warszawa.slice(0, 10) <= doDnia)
      return { od, do: doDnia, liczba: wpisy.length, wpisy }
    },
    async status() {
      calls.push({ kind: 'status', args: null })
      if (over.failWith) throw over.failWith
      return { tryb: 'START', zapasDoWarszawa: '2026-12-26', wKolejce: 14, ostrzezenia: [], bledy: [], teraz: NOW.toISOString() }
    },
    async change(action, params, opts) {
      calls.push({ kind: 'change', args: { action, params, dryRun: opts.dryRun } })
      if (over.changeError) throw over.changeError
      const find = (slug: unknown) => queue.find((w) => w.post === slug)
      if (action === 'przesun') {
        const w = find(params.post)
        return { ok: true, dry_run: opts.dryRun, zmieniono: !opts.dryRun, zmiany: [{ post: String(params.post), z: w?.data_warszawa ?? null, na: String(params.nowa_data).length === 10 ? `${params.nowa_data} 19:00` : String(params.nowa_data) }], ostrzezenia: [] }
      }
      if (action === 'zamien') {
        const a = find(params.post_a); const b = find(params.post_b)
        return { ok: true, dry_run: opts.dryRun, zmieniono: !opts.dryRun, zmiany: [{ post: String(params.post_a), z: a?.data_warszawa ?? null, na: b?.data_warszawa ?? null }, { post: String(params.post_b), z: b?.data_warszawa ?? null, na: a?.data_warszawa ?? null }], ostrzezenia: [] }
      }
      const w = find(params.post)
      return { ok: true, dry_run: opts.dryRun, zmieniono: !opts.dryRun, zmiany: [{ post: String(params.post), z: action === 'wstrzymaj' ? w?.data_warszawa ?? null : null, na: action === 'wstrzymaj' ? null : 'kolejny wolny slot' }], ostrzezenia: [] }
    },
  }
  return { client, calls, changes: () => calls.filter((c) => c.kind === 'change').map((c) => c.args as { action: string; params: Record<string, unknown>; dryRun: boolean }) }
}

const parse = (raw: string) => {
  const a = /ANSWER:\s*([\s\S]*?)(?=\nSPEECH:|$)/i.exec(raw)
  const sp = /SPEECH:\s*([\s\S]*)$/i.exec(raw)
  return { answerText: (a?.[1] ?? raw).trim(), speechText: (sp?.[1] ?? '').trim() }
}

type Block = { type: string; id?: string; name?: string; input?: Record<string, unknown>; text?: string }
const toolUse = (name: string, input: Record<string, unknown>, id = `tu_${name}`): { content: Block[]; stop_reason: string; usage: object } =>
  ({ content: [{ type: 'tool_use', id, name, input }], stop_reason: 'tool_use', usage: { input_tokens: 10, output_tokens: 5 } })
const say = (text: string) => ({ content: [{ type: 'text', text }], stop_reason: 'end_turn', usage: { input_tokens: 10, output_tokens: 20 } })

/** A scripted Claude: returns the queued responses in order and remembers every request. */
function scriptedClaude(...responses: object[]) {
  const requests: Record<string, unknown>[] = []
  const createMessage = vi.fn(async (body: Record<string, unknown>) => {
    requests.push(JSON.parse(JSON.stringify(body)))
    const next = responses.shift()
    if (!next) throw new Error('script exhausted')
    return next
  })
  return { createMessage, requests }
}

const ENV = { ANTHROPIC_API_KEY: 'k', STANLEY_ACCESS_TOKEN: SECRET }
const PERSONA = 'You are STANLEY.'

const ask = (message: string, claude: ReturnType<typeof scriptedClaude>, pub: ReturnType<typeof fakePublisher>, extra: { pendingToken?: string | null; now?: Date } = {}) =>
  answerPublisher({ turn: 'question', message, systemPrompt: PERSONA, parse, env: ENV, now: extra.now ?? NOW, deps: { client: pub.client, createMessage: claude.createMessage }, pendingToken: extra.pendingToken ?? null })

beforeEach(() => resetWordsCache())

// ── dates: weekday → date in Europe/Warsaw, "tomorrow", a concrete date ──────────

describe('parseWhen: Filip\'s words → a date in Europe/Warsaw (never a guess)', () => {
  const ok = (text: string, now = NOW) => { const r = parseWhen(text, now); expect(r.ok, text).toBe(true); return r as Extract<typeof r, { ok: true }> }

  it('a weekday with a time: "Friday 19:00"', () => {
    const r = ok('Friday 19:00'); expect([r.date, r.time, r.spec]).toEqual(['2026-11-27', '19:00', '2026-11-27 19:00'])
  })
  it('a weekday without a time keeps the date only (the Publisher keeps the reel\'s own hour)', () => {
    const r = ok('friday'); expect([r.date, r.time, r.spec]).toEqual(['2026-11-27', null, '2026-11-27'])
  })
  it('the weekday of today means next week, never today', () => expect(ok('Tuesday').date).toBe('2026-12-01'))
  it('"next Monday", "this Saturday"', () => { expect(ok('next Monday').date).toBe('2026-11-30'); expect(ok('this Saturday 10:00').spec).toBe('2026-11-28 10:00') })
  it('"tomorrow", "day after tomorrow", "today"', () => {
    expect(ok('tomorrow').date).toBe('2026-11-25'); expect(ok('day after tomorrow 18:00').spec).toBe('2026-11-26 18:00'); expect(ok('today 20:00').spec).toBe('2026-11-24 20:00')
  })
  it('Polish: jutro, pojutrze, piątek o 19, w sobotę o 10:00', () => {
    expect(ok('jutro 18:00').spec).toBe('2026-11-25 18:00'); expect(ok('pojutrze').date).toBe('2026-11-26')
    expect(ok('piątek o 19').spec).toBe('2026-11-27 19:00'); expect(ok('w sobotę o 10:00').spec).toBe('2026-11-28 10:00')
  })
  it('a concrete date: ISO, 4.12, 4.12.2026, "in 3 days"', () => {
    expect(ok('2026-12-04 18:00').spec).toBe('2026-12-04 18:00'); expect(ok('4.12 19:00').spec).toBe('2026-12-04 19:00')
    expect(ok('4.12.2027').date).toBe('2027-12-04'); expect(ok('in 3 days').date).toBe('2026-11-27')
  })
  it('12-hour clock and "at 19"', () => {
    expect(ok('7pm Friday').spec).toBe('2026-11-27 19:00'); expect(ok('tomorrow 7:30 pm').spec).toBe('2026-11-25 19:30'); expect(ok('tomorrow at 19').spec).toBe('2026-11-25 19:00'); expect(ok('12am friday').time).toBe('00:00')
  })
  it('"today" is the WARSAW date: 00:30 in Warsaw is still the previous day in UTC', () => {
    const lateUtc = new Date('2026-11-24T23:30:00Z')              // Wed 00:30 in Warsaw
    expect(ok('today', lateUtc).date).toBe('2026-11-25'); expect(ok('tomorrow', lateUtc).date).toBe('2026-11-26'); expect(ok('Wednesday', lateUtc).date).toBe('2026-12-02')
  })
  it('across the end of summer time (2026-10-25)', () => {
    const sat = new Date('2026-10-24T22:30:00Z')                  // Sun 00:30 CEST
    expect(ok('today', sat).date).toBe('2026-10-25'); expect(ok('tomorrow', sat).date).toBe('2026-10-26')
  })
  it('refuses what it cannot resolve instead of guessing', () => {
    for (const bad of ['', 'whenever', 'sometime soon', '2026-02-30', 'tomorrow 25:00', '31.02', 'friday 7:99']) {
      const r = parseWhen(bad, NOW); expect(r.ok, bad).toBe(false)
      expect((r as { error: string }).error.length).toBeGreaterThan(3)
    }
  })

  it('ranges: next week is Monday to Sunday of the NEXT week; the default is 7 days from today', () => {
    expect(periodRange('next_7_days', NOW)).toMatchObject({ od: '2026-11-24', do: '2026-11-30' })
    expect(periodRange('this_week', NOW)).toMatchObject({ od: '2026-11-24', do: '2026-11-29' })
    expect(periodRange('next_week', NOW)).toMatchObject({ od: '2026-11-30', do: '2026-12-06' })
    expect(periodRange('this_month', NOW)).toMatchObject({ od: '2026-11-24', do: '2026-11-30' })
    const sunday = new Date('2026-11-29T10:00:00Z')
    expect(periodRange('this_week', sunday)).toMatchObject({ od: '2026-11-29', do: '2026-11-29' })
    expect(periodRange('next_week', sunday)).toMatchObject({ od: '2026-11-30', do: '2026-12-06' })
    expect(resolveRange({}, NOW)).toMatchObject({ ok: true, od: '2026-11-24', do: '2026-11-30' })
    expect(resolveRange({ od: 'Monday', do: '2026-12-06' }, NOW)).toMatchObject({ ok: true, od: '2026-11-30', do: '2026-12-06' })
    expect(resolveRange({ od: '2026-12-06', do: '2026-12-01' }, NOW).ok).toBe(false)
    expect(resolveRange({ okres: 'next_decade' }, NOW).ok).toBe(false)
  })
})

// ── which turns are ours ────────────────────────────────────────────────────────

describe('which chat turns go to the Publisher', () => {
  const pub = fakePublisher()
  const turn = (m: string, pending: string | null = null) => publisherTurn(m, { pending, now: NOW, deps: { client: pub.client } })

  it('reel / publication questions', async () => {
    for (const m of ["what's the reel plan", "What's the reel plan for next week?", 'plan publikacji rolek', 'show me the publication plan', 'when does the next reel go out'])
      expect(await turn(m), m).toBe('question')
  })
  it('commands that do not say "reel" are ours only when they name a word from the queue', async () => {
    expect(await turn('move capello to Friday 19:00')).toBe('question')
    expect(await turn('swap casa and scopo')).toBe('question')
    expect(await turn('pause mettere')).toBe('question')
    expect(await turn('move the budget to Friday')).toBeNull()
    expect(await turn('pause the ads')).toBeNull()
  })
  it('other questions stay with the rest of Stanley', async () => {
    for (const m of ['how much did we earn today', 'what is the ROAS', 'who bought the course', 'what was revenue in October']) expect(await turn(m), m).toBeNull()
  })
  it('"yes" and "no" are ours only while a preview waits', async () => {
    const live = signPending({ actions: [{ action: 'wstrzymaj', params: { post: 'mettere-it' } }], summary: 'x' }, SECRET, NOW.getTime())
    const turnWith = (m: string, pending: string | null) => publisherTurn(m, { pending, now: NOW, env: { STANLEY_ACCESS_TOKEN: SECRET }, deps: { client: pub.client } })
    expect(await turn('yes')).toBeNull()
    expect(await turnWith('Yes, sir.', live)).toBe('confirm')
    expect(await turnWith('go ahead', live)).toBe('confirm')
    expect(await turnWith('no', live)).toBe('cancel')
    expect(await turnWith('what is the roas, and how did the ads do over the last week', live)).toBeNull()
    // an expired or forged token still hears "yes" / "no" (the answer says it expired), but nothing else
    expect(await turnWith('yes', 'v1.expired.token')).toBe('confirm')
    expect(await turnWith('what is the roas', 'v1.expired.token')).toBeNull()
  })
  it('if the Publisher cannot be read, a bare command is simply not ours', async () => {
    const broken = fakePublisher({ failWith: new PublisherError(503, 'x') })
    expect(await publisherTurn('pause mettere', { now: NOW, deps: { client: broken.client } })).toBeNull()
  })
})

// ── the tools: writes are previews, whatever the model asks ──────────────────────

describe('tools against a mocked Publisher API', () => {
  const fresh = (pub = fakePublisher()): { state: TurnState; run: ReturnType<typeof makeExecutor>; pub: ReturnType<typeof fakePublisher> } => {
    const state: TurnState = { plan: null, status: null, proposals: [], refusals: [], apiFailure: null }
    return { state, run: makeExecutor({ client: pub.client, now: NOW, state }), pub }
  }

  it('the six tools of the brief exist', () => {
    expect(PUBLISHER_TOOLS.map((t) => t.name).sort()).toEqual(['plan_publikacji', 'przesun_rolke', 'status_publikacji', 'wstrzymaj_rolke', 'wznow_rolke', 'zamien_rolki'])
  })

  it('resolves a word, rejects an unknown one, and asks when a word is ambiguous', async () => {
    const pub = fakePublisher({ plan: [...QUEUE, entry('casa-pt', 'casa', 'portugalski', '2026-12-10 19:00')] })
    expect(await resolvePost(pub.client, 'Scopo', NOW)).toMatchObject({ post: 'scopo-it', label: 'scopo (Italian)' })
    expect(await resolvePost(pub.client, 'nieistnieje', NOW)).toHaveProperty('error')
    const amb = await resolvePost(pub.client, 'casa', NOW) as { error: string }
    expect(amb.error).toMatch(/matches 2 reels/); expect(amb.error).toContain('Spanish'); expect(amb.error).toContain('Portuguese')
    expect(await resolvePost(pub.client, '3f2a6b1c-0d4e-4f8a-9b7c-1a2b3c4d5e6f', NOW)).toMatchObject({ post: '3f2a6b1c-0d4e-4f8a-9b7c-1a2b3c4d5e6f' })
  })

  it('przesun_rolke previews (dry_run=true) with the resolved date and never writes', async () => {
    const { run, state, pub } = fresh()
    const out = await run('przesun_rolke', { rolka: 'capello', nowa_data: 'Friday 19:00' })
    expect(out).toMatchObject({ preview: true, nothing_changes_until_yes: true })
    expect(pub.changes()).toEqual([{ action: 'przesun', params: { post: 'capello-it', nowa_data: '2026-11-27 19:00' }, dryRun: true }])
    expect(state.proposals).toHaveLength(1)
  })

  it('an unreadable date never reaches the Publisher', async () => {
    const { run, pub } = fresh()
    const out = await run('przesun_rolke', { rolka: 'capello', nowa_data: 'whenever suits' })
    expect(out).toHaveProperty('error'); expect(pub.changes()).toEqual([])
  })

  it('zamien / wstrzymaj / wznow are previews too', async () => {
    const { run, pub } = fresh()
    await run('zamien_rolki', { a: 'casa', b: 'scopo' }); await run('wstrzymaj_rolke', { rolka: 'mettere' }); await run('wznow_rolke', { rolka: 'mettere' })
    expect(pub.changes()).toEqual([
      { action: 'zamien', params: { post_a: 'casa-es', post_b: 'scopo-it' }, dryRun: true },
      { action: 'wstrzymaj', params: { post: 'mettere-it' }, dryRun: true },
      { action: 'wznow', params: { post: 'mettere-it' }, dryRun: true },
    ])
  })

  it('no more than three changes can wait for one "yes"', async () => {
    const { run, state } = fresh()
    for (const w of ['mettere', 'casa', 'scopo', 'capello']) await run('wstrzymaj_rolke', { rolka: w })
    expect(state.proposals).toHaveLength(3)
  })

  it('a Publisher refusal (past date, collision) is kept word for word', async () => {
    const reason = 'Termin 2026-11-20 18:00 jest w przeszłości.'
    const { run, state } = fresh(fakePublisher({ changeError: new PublisherError(400, reason, true) }))
    const out = await run('przesun_rolke', { rolka: 'capello', nowa_data: '2026-11-20 18:00' })
    expect(out).toMatchObject({ refused_by_publisher: true }); expect(state.refusals).toEqual([reason]); expect(state.apiFailure).toBeNull()
  })

  it('an unavailable API is recorded with its code, not as a refusal', async () => {
    const { run, state } = fresh(fakePublisher({ failWith: new PublisherError(503, 'x') }))
    await run('plan_publikacji', {}); expect(state.apiFailure).toEqual({ code: 503 }); expect(state.refusals).toEqual([])
  })

  it('plan_publikacji turns "next_week" into the real Monday-Sunday range', async () => {
    const { run, state, pub } = fresh()
    await run('plan_publikacji', { okres: 'next_week' })
    expect(pub.calls[0]).toEqual({ kind: 'plan', args: { od: '2026-11-30', do: '2026-12-06' } })
    expect(state.plan?.plan.liczba).toBe(3)
  })
})

// ── the whole chat turn ─────────────────────────────────────────────────────────

describe('what Stanley answers', () => {
  it('"what\'s the reel plan for next week?": real dates and words, printed by the server, then the voice', async () => {
    const pub = fakePublisher()
    const claude = scriptedClaude(toolUse('plan_publikacji', { okres: 'next_week' }), say('ANSWER:\nTwo Italian reels and a Greek one, sir; the Greek one has an Instagram error.\nSPEECH:\nThree reels next week, sir, and one Instagram error.'))
    const r = await ask("what's the reel plan for next week?", claude, pub)
    expect(r.answerText).toContain('Reel plan, next week (2026-11-30 to 2026-12-06, Warsaw time), 3 reels:')
    expect(r.answerText).toContain('• Mon 2026-11-30 19:00 · scopo (Italian) · FB: scheduled, IG: scheduled, YT: scheduled')
    expect(r.answerText).toContain('• Thu 2026-12-03 19:00 · capello (Italian)')
    expect(r.answerText).toContain('• Sat 2026-12-05 21:00 · krevati (Greek) · FB: published manually, IG: error (token wygasł), YT: uploaded (goes live on time)')
    expect(r.answerText).not.toContain('mettere')                   // 2026-11-25 is outside next week
    expect(r.answerText).toContain('Queue runs until 2026-12-26.')
    expect(r.answerText.indexOf('Reel plan')).toBeLessThan(r.answerText.indexOf('Two Italian reels'))   // facts first, voice after
    expect(r.speechText).toBe('Three reels next week, sir, and one Instagram error.')
    expect(r).toMatchObject({ intent: 'publisher', llmUsed: true, llmProvider: 'anthropic', pendingPublisher: null })
    expect(pub.changes()).toEqual([])
  })

  it('the default is the next 7 days', async () => {
    const pub = fakePublisher()
    const claude = scriptedClaude(toolUse('plan_publikacji', {}), say('ANSWER:\nFour on the books, sir.\nSPEECH:\nFour reels.'))
    const r = await ask('plan publikacji', claude, pub)
    expect(r.answerText).toContain('(2026-11-24 to 2026-11-30, Warsaw time), 3 reels:')   // mettere 25.11, casa 28.11, scopo 30.11
  })

  it('the request to Claude: the six tools, the persona, today\'s date, no temperature, no forced tool', async () => {
    const pub = fakePublisher()
    const claude = scriptedClaude(say('ANSWER:\nNothing to add.\nSPEECH:\nNothing to add.'))
    await ask('reel plan', claude, pub)
    const req = claude.requests[0] as { system: string; tools: { name: string }[]; tool_choice: { type: string }; model: string } & Record<string, unknown>
    expect(req.tools.map((t) => t.name)).toHaveLength(6)
    expect(req.system).toContain(PERSONA); expect(req.system).toContain('Today is 2026-11-24 (Tue)'); expect(req.system).toContain('REEL PUBLISHER MODE')
    expect(req.tool_choice).toEqual({ type: 'auto' }); expect('temperature' in req).toBe(false); expect(req.model.startsWith('claude-')).toBe(true)
  })

  it('"move capello to Friday 19:00": shows before / after, waits for "yes", changes nothing yet', async () => {
    const pub = fakePublisher()
    const claude = scriptedClaude(toolUse('przesun_rolke', { rolka: 'capello', nowa_data: 'Friday 19:00' }), say('ANSWER:\nCapello would move to Friday evening, sir.\nSPEECH:\nCapello moves to Friday at seven, if you confirm.'))
    const r = await ask('move capello to Friday 19:00', claude, pub)
    expect(r.answerText).toContain('Before → After:')
    expect(r.answerText).toContain('capello (Italian): 2026-12-03 19:00 → 2026-11-27 19:00')
    expect(r.answerText).toContain('Say "yes" to make this change')
    expect(r.pendingPublisher).toMatch(/^v1\./)
    expect(pub.changes()).toEqual([{ action: 'przesun', params: { post: 'capello-it', nowa_data: '2026-11-27 19:00' }, dryRun: true }])
  })

  it('"yes": the change is made for real, then the plan is read again and shown', async () => {
    const pub = fakePublisher()
    const first = await ask('swap casa and scopo', scriptedClaude(toolUse('zamien_rolki', { a: 'casa', b: 'scopo' }), say('ANSWER:\nThey would trade places, sir.\nSPEECH:\nCasa and scopo swap.')), pub)
    expect(first.answerText).toContain('casa (Spanish): 2026-11-28 10:00 → 2026-11-30 19:00')
    const claude = scriptedClaude(say('ANSWER:\nDone, sir. The two have traded places.\nSPEECH:\nDone, sir.'))
    const done = await answerPublisher({ turn: 'confirm', message: 'yes', systemPrompt: PERSONA, parse, env: ENV, now: new Date(NOW.getTime() + 60_000), deps: { client: pub.client, createMessage: claude.createMessage }, pendingToken: first.pendingPublisher })
    const kinds = pub.calls.map((c) => c.kind + (c.kind === 'change' ? ((c.args as { dryRun: boolean }).dryRun ? ':dry' : ':live') : ''))
    expect(kinds.filter((k) => k.startsWith('change'))).toEqual(['change:dry', 'change:live'])
    expect(kinds.slice(kinds.indexOf('change:live') + 1)).toContain('plan')       // read again AFTER the write
    expect(done.answerText).toContain('Changed:')
    expect(done.answerText).toContain('casa (Spanish): 2026-11-28 10:00 → 2026-11-30 19:00')
    expect(done.answerText).toContain('Plan now:')
    expect(done.answerText).toContain('Done, sir.')
    expect(done.pendingPublisher).toBeNull()
  })

  it('"no" cancels: nothing is changed', async () => {
    const pub = fakePublisher()
    const first = await ask('pause mettere', scriptedClaude(toolUse('wstrzymaj_rolke', { rolka: 'mettere' }), say('ANSWER:\nIt would give up Wednesday\'s slot.\nSPEECH:\nPausing mettere.')), pub)
    const r = await answerPublisher({ turn: 'cancel', message: 'no', systemPrompt: PERSONA, parse, env: ENV, now: NOW, deps: { client: pub.client }, pendingToken: first.pendingPublisher })
    expect(r.answerText).toBe('Understood, sir. Nothing was changed.'); expect(pub.changes().every((c) => c.dryRun)).toBe(true)
  })

  it('an expired, forged or foreign confirmation changes nothing', async () => {
    const pub = fakePublisher()
    const first = await ask('pause mettere', scriptedClaude(toolUse('wstrzymaj_rolke', { rolka: 'mettere' }), say('ANSWER:\nOk.\nSPEECH:\nOk.')), pub)
    const base = { turn: 'confirm' as const, message: 'yes', systemPrompt: PERSONA, parse, env: ENV, deps: { client: pub.client } }
    const late = await answerPublisher({ ...base, now: new Date(NOW.getTime() + PENDING_TTL_MS + 1000), pendingToken: first.pendingPublisher })
    const forged = await answerPublisher({ ...base, now: NOW, pendingToken: (first.pendingPublisher as string).replace(/.$/, (c) => (c === 'A' ? 'B' : 'A')) })
    const foreign = await answerPublisher({ ...base, now: NOW, pendingToken: signPending({ actions: [{ action: 'wstrzymaj', params: { post: 'mettere-it' } }] }, 'someone-elses-secret', NOW.getTime()) })
    const none = await answerPublisher({ ...base, now: NOW, pendingToken: null })
    for (const r of [late, forged, foreign, none]) expect(r.answerText).toMatch(/expired/)
    expect(pub.changes().filter((c) => !c.dryRun)).toEqual([])
  })

  it('the Publisher refuses a change: Stanley says why, in the Publisher\'s words, and offers no "yes"', async () => {
    const reason = 'Termin 2026-11-20 18:00 jest w przeszłości.'
    const pub = fakePublisher({ changeError: new PublisherError(400, reason, true) })
    const claude = scriptedClaude(toolUse('przesun_rolke', { rolka: 'capello', nowa_data: '2026-11-20 18:00' }), say('ANSWER:\nThat date has already gone by, sir.\nSPEECH:\nThat date is in the past, sir.'))
    const r = await ask('move capello to 2026-11-20 18:00', claude, pub)
    expect(r.answerText).toContain(`Publisher refused: ${reason}`); expect(r.answerText).not.toContain('Say "yes"'); expect(r.pendingPublisher).toBeNull()
  })

  it('a word that matches two reels: Stanley asks which, nothing is previewed', async () => {
    const pub = fakePublisher({ plan: [...QUEUE, entry('casa-pt', 'casa', 'portugalski', '2026-12-10 19:00')] })
    const claude = scriptedClaude(toolUse('wstrzymaj_rolke', { rolka: 'casa' }), say('ANSWER:\nSpanish or Portuguese casa, sir?\nSPEECH:\nWhich casa, sir?'))
    const r = await ask('pause casa', claude, pub)
    expect(r.pendingPublisher).toBeNull(); expect(pub.changes()).toEqual([]); expect(r.answerText).toContain('Spanish or Portuguese')
  })

  describe('the Publisher cannot be reached: "I don\'t have that data — Publisher API returned <code>", no dates', () => {
    it.each([[503, '503'], [401, '401'], [500, '500'], ['timeout', 'timeout'], ['unreachable', 'unreachable']])('code %s', async (code, shown) => {
      const pub = fakePublisher({ failWith: new PublisherError(code, 'x') })
      const claude = scriptedClaude(toolUse('plan_publikacji', {}), say('ANSWER:\nThe plan is: casa on 2026-11-28, sir.\nSPEECH:\nCasa on the 28th.'))
      const r = await ask("what's the reel plan", claude, pub)
      expect(r.answerText).toBe(`I don't have that data — Publisher API returned ${shown}.`)
      expect(r.answerText).not.toMatch(/\d{4}-\d{2}-\d{2}/)           // whatever the model wrote is dropped
      expect(r.pendingPublisher).toBeNull()
    })

    it('not configured (no token / address in the environment)', async () => {
      const r = await answerPublisher({ turn: 'question', message: 'reel plan', systemPrompt: PERSONA, parse, env: ENV, now: NOW, deps: { createMessage: scriptedClaude().createMessage } })
      expect(r.answerText).toBe("I don't have that data — Publisher API returned not-configured.")
    })

    it('the confirmation itself: a failed write is reported, not hidden', async () => {
      const pub = fakePublisher()
      const first = await ask('pause mettere', scriptedClaude(toolUse('wstrzymaj_rolke', { rolka: 'mettere' }), say('ANSWER:\nOk.\nSPEECH:\nOk.')), pub)
      const down = fakePublisher({ changeError: new PublisherError(503, 'x') })
      const r = await answerPublisher({ turn: 'confirm', message: 'yes', systemPrompt: PERSONA, parse, env: ENV, now: NOW, deps: { client: down.client }, pendingToken: first.pendingPublisher })
      expect(r.answerText).toContain("I don't have that data — Publisher API returned 503."); expect(r.answerText).not.toContain('Done')
    })
  })

  it('Claude down: a plain plan question is still answered from the Publisher; a command is not guessed', async () => {
    const pub = fakePublisher()
    const failing = vi.fn(async () => { throw new Error('529 overloaded') })
    const plan = await answerPublisher({ turn: 'question', message: 'reel plan', systemPrompt: PERSONA, parse, env: ENV, now: NOW, deps: { client: pub.client, createMessage: failing } })
    expect(plan.answerText).toContain('Reel plan, the next 7 days'); expect(plan.llmUsed).toBe(false)
    const cmd = await answerPublisher({ turn: 'question', message: 'move capello to Friday', systemPrompt: PERSONA, parse, env: ENV, now: NOW, deps: { client: pub.client, createMessage: failing } })
    expect(cmd.answerText).toMatch(/will not guess/); expect(pub.changes()).toEqual([])
  })

  it('the refusal guard would rewrite these answers, which is why the browser marks them trusted', () => {
    const msg = "I don't have that data — Publisher API returned 503."
    expect(enforceRefusal(msg, "what's the reel plan")).not.toBe(msg)   // generic "orders does not exist" template
  })
})

// ── the token and the client ────────────────────────────────────────────────────

describe('signed confirmation token', () => {
  const actions = [{ action: 'przesun', params: { post: 'capello-it', nowa_data: '2026-11-27 19:00' } }]
  it('round trip, tamper, expiry, wrong secret', () => {
    const t = signPending({ actions }, SECRET, 1_000_000)
    expect(verifyPending(t, SECRET, 1_000_000 + 1000)?.actions).toEqual(actions)
    expect(verifyPending(t, 'other', 1_000_000 + 1000)).toBeNull()
    expect(verifyPending(t.replace('v1.', 'v1.A'), SECRET, 1_000_000)).toBeNull()
    expect(verifyPending(t, SECRET, 1_000_000 + PENDING_TTL_MS + 1)).toBeNull()
    expect(verifyPending('garbage', SECRET)).toBeNull(); expect(verifyPending(null, SECRET)).toBeNull(); expect(verifyPending(t, undefined)).toBeNull()
  })
})

describe('Publisher client', () => {
  const calls: { url: string; init: RequestInit }[] = []
  const reply = (status: number, body: unknown) => (async (url: string, init: RequestInit) => { calls.push({ url: String(url), init }); return new Response(typeof body === 'string' ? body : JSON.stringify(body), { status }) }) as unknown as typeof fetch

  it('address: the site or the full endpoint both end in /api/zewn', () => {
    expect(zewnUrl('https://pub.example.app')).toBe('https://pub.example.app/api/zewn')
    expect(zewnUrl('https://pub.example.app/')).toBe('https://pub.example.app/api/zewn')
    expect(zewnUrl('https://pub.example.app/api/zewn')).toBe('https://pub.example.app/api/zewn')
    expect(() => publisherConfigFromEnv({})).toThrow(PublisherError)
  })

  it('sends the Bearer token and the action; dry_run is explicit', async () => {
    calls.length = 0
    const c = createPublisherClient({ url: 'https://pub.example.app/api/zewn', token: 'tok-123', fetchImpl: reply(200, { ok: true }) })
    await c.change('przesun', { post: 'x', nowa_data: '2026-11-27 19:00' }, { dryRun: true })
    const h = calls[0].init.headers as Record<string, string>
    expect(h.authorization).toBe('Bearer tok-123')
    expect(JSON.parse(String(calls[0].init.body))).toEqual({ akcja: 'przesun', post: 'x', nowa_data: '2026-11-27 19:00', dry_run: true })
  })

  it('4xx with a reason is a validation error (the Publisher\'s words); 5xx, 401 and network errors are "unavailable"', async () => {
    const mk = (status: number, body: unknown) => createPublisherClient({ url: 'https://p/api/zewn', token: 't', fetchImpl: reply(status, body) })
    await expect(mk(400, { blad: 'Termin jest w przeszłości.' }).status()).rejects.toMatchObject({ code: 400, validation: true, message: 'Termin jest w przeszłości.' })
    await expect(mk(422, { blad: 'Brak pola: post' }).status()).rejects.toMatchObject({ code: 422, validation: true })
    await expect(mk(401, { blad: 'Brak dostępu' }).status()).rejects.toMatchObject({ code: 401, validation: false })
    await expect(mk(503, { blad: 'wyłączone' }).status()).rejects.toMatchObject({ code: 503, validation: false })
    await expect(mk(500, 'boom').status()).rejects.toMatchObject({ code: 500 })
    const down = createPublisherClient({ url: 'https://p/api/zewn', token: 't', fetchImpl: (async () => { throw new TypeError('fetch failed') }) as unknown as typeof fetch })
    await expect(down.status()).rejects.toMatchObject({ code: 'unreachable' })
  })

  it('renderPlan: an empty range says so', () => {
    expect(renderPlan({ range: { label: 'next week' }, plan: { od: '2026-12-07', do: '2026-12-13', liczba: 0, wpisy: [] } })).toBe('No reels are scheduled between 2026-12-07 and 2026-12-13.')
  })
})
