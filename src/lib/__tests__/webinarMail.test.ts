// The automatic webinar mails: 06:00 Warsaw wake-up (CET and CEST), sendAt 07:00, idempotency,
// every safeguard on its own, the subject validator, alternating link variants, empty queue,
// DRY_RUN end to end, and the Wix payloads. No network, nothing is ever published.
import { describe, it, expect, vi } from 'vitest'
import {
  runWebinarMail, validateSubject, validateTemplate, buildQueue, nextVariant, evaluateSafeguards,
  warsawParts, warsawLocalToUtc, buildAlerts, autoOnBeforeRun, ctrOf, renderCampaignHtml, SLOT_NAMES,
  assertTestAudience, createAndPublish, testAudience, testSendAt, unresolvedTags, ensureSenderName,
  assertProductionAudience, resolveProductionAudience, evaluateRecipients, recipientsBaseline, PRODUCTION_SELECTION,
  type RunDeps, type WixLike, type TemplateFile, type LogEntry,
} from '../../../netlify/shared/webinarMail.js'
import { WEBINAR_MAIL_CONFIG as CFG } from '../../../netlify/shared/webinarMailConfig.js'
import { createMemoryStore } from '../../../netlify/shared/webinarMailStore.js'
import { createWixClient, SUBSCRIBED_FILTER } from '../../../netlify/shared/webinarMailWix.js'
import { adminAction, adminStatus, healthSummary, nextPlannedSend } from '../../../netlify/shared/webinarMailAdmin.js'
import {
  importTemplate, unwrapTrackingLink, stripWixInjection, replaceWebinarLinks, classifySlot, removeOwnUnsubscribeLinks,
} from '../../../netlify/shared/webinarMailImport.js'

// ── helpers ─────────────────────────────────────────────────────────────────────

const tpl = (subject: string, body = '<p>Cześć</p><a href="{{WEBINAR_URL}}">Wchodzę</a>'): string =>
  `<!DOCTYPE html><html><head><meta charset="UTF-8"><title>${subject}</title><meta name="preheader" content=""></head><body>${body}</body></html>`

const T = (n: number, subject = `Temat numer ${n === 1 ? 'jeden' : n === 2 ? 'dwa' : n === 3 ? 'trzy' : n === 4 ? 'cztery' : 'pięć'}`): TemplateFile =>
  ({ file: `${String(n).padStart(2, '0')}-t.html`, html: tpl(subject) })

// Tuesday 2026-12-01 (CET, UTC+1) and Tuesday 2026-06-02 (CEST, UTC+2); Thursday 2026-12-03 / 2026-06-04.
const CET_TUE_0600 = new Date('2026-12-01T05:00:00Z')
const CEST_TUE_0600 = new Date('2026-06-02T04:00:00Z')

/** Three e-mail subscribers of the fake Wix (the production audience in these tests). */
const SUBSCRIBERS = ['aaaaaaaa-0000-4000-8000-000000000001', 'aaaaaaaa-0000-4000-8000-000000000002', 'aaaaaaaa-0000-4000-8000-000000000003']
/** A production audience built the only allowed way (resolveProductionAudience over the fake Wix). */
const prodAudience = async () => (await resolveProductionAudience(fakeWix().wix)).audience

function fakeWix(over: Partial<WixLike> = {}) {
  const calls = { create: vi.fn(), publish: vi.fn(), order: [] as string[], senderName: 'Marek Szurawski' }
  const wix: WixLike = {
    getSenderName: async () => { calls.order.push('get-sender'); return calls.senderName },
    setSenderName: async (n) => { calls.order.push(`set-sender:${n}`); calls.senderName = n; return { fromName: n, changed: true } },
    accountDetails: async () => ({ status: 'ACTIVE' }),
    listRecentCampaigns: async () => [],
    previewCampaign: async () => ({ html: '' }),
    createCampaign: async (i) => { calls.create(i); calls.order.push('create'); return 'camp-' + calls.create.mock.calls.length },
    publishCampaign: async (id, i) => { calls.publish(id, i); calls.order.push('publish') },
    getCampaign: async (id) => ({ campaignId: id, distributionStatus: 'SCHEDULED', visibilityStatus: 'PUBLISHED', datePublished: null, mailsSent: null, delivered: null }),
    deleteCampaign: async () => undefined,
    campaignStats: async () => ({}),
    listEmailSubscriberIds: async () => ({ ids: [...SUBSCRIBERS], total: SUBSCRIBERS.length }),
    countEmailSubscribers: async () => SUBSCRIBERS.length,
    ...over,
  }
  return { wix, calls }
}

function setup(opts: { templates?: TemplateFile[]; auto?: boolean; pause?: boolean; wix?: Partial<WixLike>; link?: number; log?: LogEntry[] } = {}) {
  const store = createMemoryStore({ state: { auto: opts.auto ?? true, pause: opts.pause ?? false, ackedRunAt: null, updatedAt: null } })
  const { wix, calls } = fakeWix(opts.wix)
  const templates = opts.templates ?? [T(1), T(2), T(3), T(4), T(5)]
  const deps: RunDeps = {
    store, wix,
    loadTemplates: async () => templates,
    checkUrl: async () => ({ status: opts.link ?? 200 }),
  }
  const seeded = (async () => { for (const e of opts.log ?? []) await store.addLog(e) })()
  return { deps, store, calls, ready: seeded }
}

const run = async (s: ReturnType<typeof setup>, now: Date, extra: { dryRun?: boolean; force?: boolean } = {}) => {
  await s.ready
  return runWebinarMail({ now, deps: s.deps, ...extra })
}

// ── Warsaw clock, CET and CEST ──────────────────────────────────────────────────

describe('06:00 Warsaw in winter (CET) and summer (CEST)', () => {
  // That the function file carries the same literal is asserted by scripts/assert-webinar-mails.mjs.
  it('the cron has both UTC hours (04 for summer time, 05 for winter time), Tuesday and Thursday only', () => {
    expect(CFG.cron).toBe('0 4,5 * * 2,4')
  })

  it('CET: only 05:00 UTC is 06:00 in Warsaw', async () => {
    expect(warsawParts(new Date('2026-12-01T05:00:00Z'))).toMatchObject({ date: '2026-12-01', hour: 6, weekday: 2 })
    const early = setup(); const r4 = await run(early, new Date('2026-12-01T04:00:00Z'))
    expect(r4).toMatchObject({ status: 'skipped', reason: 'not-wake-hour' })
    expect(early.calls.create).not.toHaveBeenCalled()
    const ok = setup(); const r5 = await run(ok, CET_TUE_0600)
    expect(r5.status).toBe('scheduled')
  })

  it('CEST: only 04:00 UTC is 06:00 in Warsaw', async () => {
    expect(warsawParts(new Date('2026-06-02T04:00:00Z'))).toMatchObject({ date: '2026-06-02', hour: 6, weekday: 2 })
    const late = setup(); const r5 = await run(late, new Date('2026-06-02T05:00:00Z'))
    expect(r5).toMatchObject({ status: 'skipped', reason: 'not-wake-hour' })
    expect(late.calls.publish).not.toHaveBeenCalled()
    const ok = setup(); const r4 = await run(ok, CEST_TUE_0600)
    expect(r4.status).toBe('scheduled')
  })

  it('other weekdays do nothing', async () => {
    const s = setup(); const r = await run(s, new Date('2026-12-02T05:00:00Z')) // Wednesday
    expect(r).toMatchObject({ status: 'skipped', reason: 'not-a-send-day' })
  })

  it('Thursday is the memory slot, Tuesday the language slot', async () => {
    const t = setup(); expect((await run(t, CET_TUE_0600)).slot).toBe('tuesday')
    const th = setup(); expect((await run(th, new Date('2026-12-03T05:00:00Z'))).slot).toBe('thursday')
  })

  it('sendAt is 07:00 Warsaw: 06:00 UTC in winter, 05:00 UTC in summer', async () => {
    expect(warsawLocalToUtc('2026-12-01', '07:00').toISOString()).toBe('2026-12-01T06:00:00.000Z')
    expect(warsawLocalToUtc('2026-06-02', '07:00').toISOString()).toBe('2026-06-02T05:00:00.000Z')
    const w = setup(); await run(w, CET_TUE_0600)
    expect(w.calls.publish.mock.calls[0][1].sendAt).toBe('2026-12-01T06:00:00.000Z')
    const s = setup(); await run(s, CEST_TUE_0600)
    expect(s.calls.publish.mock.calls[0][1].sendAt).toBe('2026-06-02T05:00:00.000Z')
  })

  it('publishes to the e-mail subscribers only (contactIds from the SUBSCRIBED query), with the subject, once', async () => {
    const s = setup(); await run(s, CET_TUE_0600)
    expect(s.calls.publish).toHaveBeenCalledTimes(1)
    const [id, opts] = s.calls.publish.mock.calls[0]
    expect(id).toBe('camp-1')
    expect(opts.audience).toEqual({ contactIds: SUBSCRIBERS })
    expect(opts.audience).not.toHaveProperty('labelIds')
    expect(opts.subject).toBe('Temat numer jeden')
  })
})

// ── Idempotency ─────────────────────────────────────────────────────────────────

describe('idempotency per <date>-<slot>', () => {
  it('a second run on the same date and slot publishes nothing and uses no second template', async () => {
    const s = setup()
    const first = await run(s, CET_TUE_0600)
    const again = await run(s, new Date(CET_TUE_0600.getTime() + 10 * 60000))
    expect(first.status).toBe('scheduled')
    expect(again).toMatchObject({ status: 'skipped', reason: 'already-done' })
    expect(s.calls.create).toHaveBeenCalledTimes(1)
    expect(s.calls.publish).toHaveBeenCalledTimes(1)
  })

  it('two concurrent runs: only one takes the claim and publishes', async () => {
    const s = setup(); await s.ready
    const [a, b] = await Promise.all([run(s, CET_TUE_0600), run(s, CET_TUE_0600)])
    expect([a.status, b.status].filter((x) => x === 'scheduled')).toHaveLength(1)
    expect(s.calls.publish).toHaveBeenCalledTimes(1)
  })

  it('a different date uses the NEXT template', async () => {
    const s = setup()
    await run(s, CET_TUE_0600)
    await run(s, new Date('2026-12-08T05:00:00Z'))
    const subjects = s.calls.publish.mock.calls.map((c) => c[1].subject)
    expect(subjects).toEqual(['Temat numer jeden', 'Temat numer dwa'])
  })
})

// ── Switches: AUTO OFF, PAUZA, skipDates → no Publish ────────────────────────────

describe('no Publish when a gate is closed', () => {
  it('AUTO OFF', async () => {
    const s = setup({ auto: false }); const r = await run(s, CET_TUE_0600)
    expect(r).toMatchObject({ status: 'skipped', reason: 'auto-off' })
    expect(s.calls.create).not.toHaveBeenCalled(); expect(s.calls.publish).not.toHaveBeenCalled()
  })
  it('PAUZA', async () => {
    const s = setup({ pause: true }); const r = await run(s, CET_TUE_0600)
    expect(r).toMatchObject({ status: 'skipped', reason: 'pause' })
    expect(s.calls.create).not.toHaveBeenCalled(); expect(s.calls.publish).not.toHaveBeenCalled()
  })
  it.each(['2026-12-24', '2026-12-31'])('skipDate %s', async (date) => {
    const s = setup(); const r = await run(s, new Date(`${date}T05:00:00Z`))
    expect(r).toMatchObject({ status: 'skipped', reason: 'skip-date' })
    expect(s.calls.create).not.toHaveBeenCalled(); expect(s.calls.publish).not.toHaveBeenCalled()
  })
  it('a skipped run does not use a template up', async () => {
    const s = setup({ auto: false }); await run(s, CET_TUE_0600)
    await s.store.setState({ auto: true })
    await run(s, new Date('2026-12-08T05:00:00Z'))
    expect(s.calls.publish.mock.calls[0][1].subject).toBe('Temat numer jeden')
  })
  it('neutral states raise no alert', async () => {
    const s = setup({ auto: false }); const r = await run(s, CET_TUE_0600)
    const alerts = buildAlerts({ state: await s.store.getState(), lastRun: r, runToday: r, queues: [], now: CET_TUE_0600 })
    expect(alerts).toEqual([])
  })
})

// ── Every safeguard on its own ───────────────────────────────────────────────────

describe('safeguards, each alone', () => {
  const failedIds = (r: { checks?: { id: string; ok: boolean }[] }) => (r.checks ?? []).filter((c) => !c.ok).map((c) => c.id)
  const never = (s: ReturnType<typeof setup>) => { expect(s.calls.create).not.toHaveBeenCalled(); expect(s.calls.publish).not.toHaveBeenCalled() }

  it('all green → publishes', async () => {
    const s = setup(); const r = await run(s, CET_TUE_0600)
    expect(r.status).toBe('scheduled'); expect(failedIds(r)).toEqual([])
  })

  it('account not ACTIVE', async () => {
    const s = setup({ wix: { accountDetails: async () => ({ status: 'SUSPENDED' }) } }); const r = await run(s, CET_TUE_0600)
    expect(r).toMatchObject({ status: 'failed', reason: 'safeguard' }); expect(failedIds(r)).toEqual(['KONTO_ACTIVE']); never(s)
  })

  it('account API down', async () => {
    const s = setup({ wix: { accountDetails: async () => { throw new Error('boom') } } }); const r = await run(s, CET_TUE_0600)
    expect(failedIds(r)).toEqual(['KONTO_ACTIVE']); never(s)
  })

  it('registration link does not return 200', async () => {
    const s = setup({ link: 404 }); const r = await run(s, CET_TUE_0600)
    expect(failedIds(r)).toEqual(['LINK_200']); never(s)
  })

  it('registration link unreachable', async () => {
    const s = setup(); s.deps.checkUrl = async () => { throw new Error('ENOTFOUND') }
    const r = await run(s, CET_TUE_0600)
    expect(failedIds(r)).toEqual(['LINK_200']); never(s)
  })

  it('a campaign of this webinar already goes out today', async () => {
    const s = setup({ wix: {
      listRecentCampaigns: async () => [{ campaignId: 'manual-1', distributionStatus: 'SCHEDULED', datePublished: '2026-11-30T20:00:00Z' }],
      previewCampaign: async () => ({ html: '<a href="https://www.wceen.com/webinar-jezyk-w-17h">x</a>' }),
    } })
    const r = await run(s, CET_TUE_0600)
    expect(failedIds(r)).toEqual(['BRAK_WYSYLKI_DZIS']); never(s)
  })

  it('a campaign published today by hand also counts', async () => {
    const s = setup({ wix: {
      listRecentCampaigns: async () => [{ campaignId: 'manual-2', distributionStatus: 'DISTRIBUTED', datePublished: '2026-12-01T00:15:00Z' }],
      previewCampaign: async () => ({ html: '<a href="https://fundacjawceen.clickmeeting.com/nauka-jezykow-w-xxi-wieku/register">x</a>' }),
    } })
    expect(failedIds(await run(s, CET_TUE_0600))).toEqual(['BRAK_WYSYLKI_DZIS']); never(s)
  })

  it('a different mail sent today, or this webinar sent on another day, does not block', async () => {
    const s = setup({ wix: {
      listRecentCampaigns: async () => [
        { campaignId: 'other', distributionStatus: 'DISTRIBUTED', datePublished: '2026-12-01T00:15:00Z' },
        { campaignId: 'old', distributionStatus: 'DISTRIBUTED', datePublished: '2026-11-24T10:00:00Z' },
      ],
      previewCampaign: async (id) => ({ html: id === 'other' ? '<p>nurture</p>' : '<a href="https://www.wceen.com/webinar-jezyk-w-17h">x</a>' }),
    } })
    expect((await run(s, CET_TUE_0600)).status).toBe('scheduled')
  })

  it('list of campaigns unavailable → fails closed', async () => {
    const s = setup({ wix: { listRecentCampaigns: async () => { throw new Error('503') } } })
    const r = await run(s, CET_TUE_0600)
    expect(failedIds(r)).toEqual(['BRAK_WYSYLKI_DZIS']); never(s)
  })

  it('less than 30 minutes to sendAt', async () => {
    const s = setup(); const r = await run(s, new Date('2026-12-01T05:40:00Z'))
    expect(failedIds(r)).toEqual(['SENDAT_W_PRZYSZLOSCI']); never(s)
  })

  it('PAUZA is a safeguard of its own (defence in depth)', () => {
    const c = evaluateSafeguards({ account: { status: 'ACTIVE' }, subject: 'Temat', link: { status: 200 }, sendsToday: [], state: { pause: true }, sendAt: new Date('2026-12-01T06:00:00Z'), now: new Date('2026-12-01T05:00:00Z') })
    expect(c.filter((x) => !x.ok).map((x) => x.id)).toEqual(['PAUZA_WYLACZONA'])
  })

  it('subject missing or blocked is a safeguard of its own', () => {
    const base = { account: { status: 'ACTIVE' }, link: { status: 200 }, sendsToday: [], state: { pause: false }, sendAt: new Date('2026-12-01T06:00:00Z'), now: new Date('2026-12-01T05:00:00Z') }
    expect(evaluateSafeguards({ ...base, subject: '' }).filter((x) => !x.ok).map((x) => x.id)).toEqual(['TEMAT'])
    expect(evaluateSafeguards({ ...base, subject: 'Okazja!' }).filter((x) => !x.ok).map((x) => x.id)).toEqual(['TEMAT'])
  })

  it('a failure keeps a red alert until acknowledged; a later success clears it', async () => {
    const s = setup({ link: 500 })
    const r = await run(s, CET_TUE_0600)
    const state = await s.store.getState()
    const a1 = buildAlerts({ state, lastRun: r, runToday: r, queues: [], now: new Date('2026-12-01T06:30:00Z') })
    expect(a1.map((a) => [a.severity, a.rule])).toEqual([['red', 'MAILE_AWARIA']])
    const acked = buildAlerts({ state: { ...state, ackedRunAt: r.at }, lastRun: r, runToday: r, queues: [], now: new Date('2026-12-01T06:30:00Z') })
    expect(acked).toEqual([])
  })
})

// ── Publish failure, nothing used up ─────────────────────────────────────────────

describe('publish fails after the campaign was created', () => {
  it('logs the failure with the campaign id, raises the alert, keeps the template for next time', async () => {
    const s = setup({ wix: { publishCampaign: async () => { throw new Error('Wix 428 SCHEDULING_FEATURE_UNAVAILABLE') } } })
    const r = await run(s, CET_TUE_0600)
    expect(r).toMatchObject({ status: 'failed', reason: 'publish-failed', campaignId: 'camp-1' })
    const log = await s.store.getLog()
    expect(log).toHaveLength(1); expect(log[0]).toMatchObject({ status: 'failed', campaignId: 'camp-1' })
    expect(buildQueue('tuesday', [T(1), T(2)], log).next?.file).toBe('01-t.html')
    const alerts = buildAlerts({ state: await s.store.getState(), lastRun: r, runToday: r, queues: [], now: CET_TUE_0600 })
    expect(alerts[0]).toMatchObject({ severity: 'red', rule: 'MAILE_AWARIA' })
  })

  it('an unexpected exception is recorded, not thrown', async () => {
    const s = setup(); s.deps.loadTemplates = async () => { throw new Error('brak folderu') }
    const r = await run(s, CET_TUE_0600)
    expect(r).toMatchObject({ status: 'failed', reason: 'exception' })
  })
})

// ── Subject validator ───────────────────────────────────────────────────────────

describe('subject validator', () => {
  it('BLOCKS "!"', () => expect(validateSubject('Dziś webinar!').blocked).toHaveLength(1))
  it('BLOCKS ${...} merge tags', () => expect(validateSubject('${contact.name.first}, dziś o osiemnastej').blocked.join()).toMatch(/tag scalania/))
  it('BLOCKS {{...}} merge tags', () => expect(validateSubject('Cześć {{first_name}}').blocked.join()).toMatch(/tag scalania/))
  it('BLOCKS prices: "zł"', () => expect(validateSubject('Kurs za 499 zł').blocked.join()).toMatch(/zł/))
  it('BLOCKS prices: "%"', () => expect(validateSubject('Rabat dwadzieścia %').blocked.join()).toMatch(/%/))
  it('does not mistake a word that merely contains "zł" for a price', () => expect(validateSubject('Złożyć słowa w obraz').blocked).toEqual([]))
  it('WARNS about other digits, does not block', () => {
    const v = validateSubject('Dziś 18:00')
    expect(v.blocked).toEqual([]); expect(v.warnings).toEqual(['cyfry w temacie'])
  })
  it('a price digit alone is a block, not an extra digit warning', () => {
    const v = validateSubject('Tylko 499 zł'); expect(v.blocked).toHaveLength(1); expect(v.warnings).toEqual([])
  })
  it('clean subject passes without warnings', () => expect(validateSubject('Krewetka w Twoim łóżku')).toEqual({ blocked: [], warnings: [] }))
  it('empty subject is blocked', () => expect(validateSubject('   ').blocked).toEqual(['brak tematu']))

  it('a blocked template is listed WITH its file name and is skipped by the queue', () => {
    const templates = [
      { file: '01-zla.html', html: tpl('Okazja!') },
      { file: '02-cena.html', html: tpl('Kurs za 100 zł') },
      { file: '03-tag.html', html: tpl('${contact.name.first}, hej') },
      { file: '04-dobra.html', html: tpl('Dobry temat') },
    ]
    const q = buildQueue('tuesday', templates, [])
    expect(q.entries.filter((e) => e.blocked.length).map((e) => e.file)).toEqual(['01-zla.html', '02-cena.html', '03-tag.html'])
    expect(q.next?.file).toBe('04-dobra.html'); expect(q.readyCount).toBe(1); expect(q.blockedCount).toBe(3)
  })

  it('a template without {{WEBINAR_URL}} or with old tracking links or a Wix footer is blocked', () => {
    expect(validateTemplate('a.html', tpl('Temat', '<a href="https://x.pl">x</a>')).blocked.join()).toMatch(/WEBINAR_URL/)
    expect(validateTemplate('b.html', tpl('Temat', '<a href="{{WEBINAR_URL}}">x</a><a href="https://wceen.com/so/aaQ7f8J30/c?w=abc.def">y</a>')).blocked.join()).toMatch(/śledzące/)
    expect(validateTemplate('c.html', tpl('Temat', '<a href="{{WEBINAR_URL}}">x</a><!--TRACKING_PIXEL-->')).blocked.join()).toMatch(/stopka/)
    expect(validateTemplate('d.html', tpl('Temat')).blocked).toEqual([])
  })
})

// ── Link variants alternate per slot ─────────────────────────────────────────────

describe('link variants alternate per slot', () => {
  it('landing, clickmeeting, landing, clickmeeting… and the log keeps variant + campaign id', async () => {
    const s = setup()
    for (const d of ['2026-12-01', '2026-12-08', '2026-12-15', '2026-12-22']) await run(s, new Date(`${d}T05:00:00Z`))
    const log = await s.store.getLog()
    expect(log.map((e) => e.variant)).toEqual(['landing', 'clickmeeting', 'landing', 'clickmeeting'])
    expect(log.every((e) => /^camp-\d+$/.test(String(e.campaignId)))).toBe(true)
    expect(s.calls.create.mock.calls[0][0].html).toContain(CFG.slots.tuesday.variants.landing)
    expect(s.calls.create.mock.calls[1][0].html).toContain(CFG.slots.tuesday.variants.clickmeeting)
    expect(s.calls.create.mock.calls[1][0].html).not.toContain('{{WEBINAR_URL}}')
  })

  it('the two slots alternate independently', async () => {
    const s = setup()
    await run(s, new Date('2026-12-01T05:00:00Z')) // Tue → landing
    await run(s, new Date('2026-12-03T05:00:00Z')) // Thu → landing (its own first)
    await run(s, new Date('2026-12-08T05:00:00Z')) // Tue → clickmeeting
    const log = await s.store.getLog()
    expect(log.map((e) => `${e.slot}:${e.variant}`)).toEqual(['tuesday:landing', 'thursday:landing', 'tuesday:clickmeeting'])
    expect(CFG.slots.thursday.variants.landing).toBe('https://www.wceen.com/darmowy-webinar')
    expect(CFG.slots.tuesday.variants.landing).toBe('https://www.wceen.com/webinar-jezyk-w-17h')
  })

  it('a failed or dry run does not move the alternation', () => {
    const log: LogEntry[] = [
      { key: '2026-12-01-tuesday', date: '2026-12-01', slot: 'tuesday', variant: 'landing', templateFile: 'x', subject: 's', status: 'scheduled' },
      { key: '2026-12-08-tuesday', date: '2026-12-08', slot: 'tuesday', variant: 'clickmeeting', templateFile: 'y', subject: 's', status: 'failed' },
      { key: '2026-12-15-tuesday', date: '2026-12-15', slot: 'tuesday', variant: 'clickmeeting', templateFile: 'z', subject: 's', status: 'scheduled', dryRun: true },
    ]
    expect(nextVariant('tuesday', log)).toBe('clickmeeting')
  })
})

// ── Queue: warning, empty, no wrap-around ────────────────────────────────────────

describe('queue', () => {
  it('warns at ≤ 3 ready templates (amber) and not at 4', () => {
    const q3 = buildQueue('tuesday', [T(1), T(2), T(3)], []); const q4 = buildQueue('tuesday', [T(1), T(2), T(3), T(4)], [])
    expect(q3.low).toBe(true); expect(q4.low).toBe(false)
    const a = buildAlerts({ state: { auto: true, pause: false }, lastRun: null, runToday: null, queues: [{ slot: 'tuesday', empty: q3.empty, low: q3.low, readyCount: q3.readyCount }], now: new Date('2026-12-02T10:00:00Z') })
    expect(a).toEqual([expect.objectContaining({ severity: 'amber', rule: 'MAILE_KOLEJKA_NISKA' })])
  })

  it('an empty queue fails the run, raises a red alert and never wraps around', async () => {
    const s = setup({ templates: [T(1)] })
    expect((await run(s, new Date('2026-12-01T05:00:00Z'))).status).toBe('scheduled')
    const r = await run(s, new Date('2026-12-08T05:00:00Z'))
    expect(r).toMatchObject({ status: 'failed', reason: 'queue-empty' })
    expect(s.calls.create).toHaveBeenCalledTimes(1) // template 1 was NOT sent again
    const alerts = buildAlerts({ state: { auto: true, pause: false }, lastRun: r, runToday: r, queues: [{ slot: 'tuesday', empty: true, low: true, readyCount: 0 }], now: new Date('2026-12-08T05:30:00Z') })
    expect(alerts.map((a) => a.rule).sort()).toEqual(['MAILE_AWARIA', 'MAILE_KOLEJKA_PUSTA'])
    expect(alerts.every((a) => a.severity === 'red')).toBe(true)
  })

  it('a queue of only blocked templates is empty', async () => {
    const s = setup({ templates: [{ file: '01.html', html: tpl('Okazja!') }] })
    expect(await run(s, CET_TUE_0600)).toMatchObject({ status: 'failed', reason: 'queue-empty' })
  })

  it('a dry-run entry does not use a template up', () => {
    const log: LogEntry[] = [{ key: 'k', date: '2026-12-01', slot: 'tuesday', templateFile: '01-t.html', subject: 's', status: 'scheduled', dryRun: true }]
    expect(buildQueue('tuesday', [T(1), T(2)], log).next?.file).toBe('01-t.html')
  })

  it('a send day with AUTO on and no run record after 06:45 is a red alert (the function never fired)', () => {
    const base = { state: { auto: true, pause: false }, lastRun: null, queues: [] as never[] }
    const missed = buildAlerts({ ...base, runToday: null, now: new Date('2026-12-01T05:50:00Z') }) // 06:50 Warsaw
    expect(missed.map((a) => a.rule)).toEqual(['MAILE_NIE_ODPALILY'])
    expect(buildAlerts({ ...base, runToday: null, now: new Date('2026-12-01T05:30:00Z') })).toEqual([]) // 06:30: still early
    expect(buildAlerts({ ...base, state: { auto: false, pause: false }, runToday: null, now: new Date('2026-12-01T05:50:00Z') })).toEqual([])
    expect(buildAlerts({ ...base, runToday: null, now: new Date('2026-12-24T05:50:00Z') })).toEqual([]) // skipDate
  })
})

// ── T2: MAILE_NIE_ODPALILY only when AUTO was on before that day's 06:00 run ─────

describe('missed-run alarm and autoChangedAt', () => {
  const rules = (state: { auto: boolean; pause: boolean; autoChangedAt?: string | null }, now: string) =>
    buildAlerts({ state, lastRun: null, runToday: null, queues: [], now: new Date(now) }).map((a) => a.rule)

  it('AUTO switched on 19.11 at 22:38Z (Thursday, after the 06:00 run) → no alarm for 19.11', () => {
    const state = { auto: true, pause: false, autoChangedAt: '2026-11-19T22:38:00.000Z' }
    expect(autoOnBeforeRun(state, '2026-11-19')).toBe(false)
    expect(rules(state, '2026-11-19T22:45:00Z')).toEqual([])   // 23:45 Warsaw, no run record that day
  })

  it('AUTO switched on on Monday → Tuesday without any run record by 06:45 is a red alarm', () => {
    const state = { auto: true, pause: false, autoChangedAt: '2026-11-23T10:00:00.000Z' }   // Mon 23.11
    expect(rules(state, '2026-11-24T05:30:00Z')).toEqual([])                       // 06:30 Warsaw: still early
    expect(rules(state, '2026-11-24T05:46:00Z')).toEqual(['MAILE_NIE_ODPALILY'])   // 06:46 Warsaw
    // a run record that day (even a skip) clears it
    expect(buildAlerts({ state, lastRun: null, runToday: { status: 'skipped', reason: 'x', date: '2026-11-24' }, queues: [], now: new Date('2026-11-24T05:46:00Z') })).toEqual([])
  })

  it('AUTO switched on at 05:30 Warsaw on the send day itself (before 06:00) counts; at 06:10 it does not', () => {
    expect(rules({ auto: true, pause: false, autoChangedAt: '2026-11-24T04:30:00.000Z' }, '2026-11-24T06:00:00Z')).toEqual(['MAILE_NIE_ODPALILY'])
    expect(rules({ auto: true, pause: false, autoChangedAt: '2026-11-24T05:10:00.000Z' }, '2026-11-24T06:00:00Z')).toEqual([])
  })

  it('no autoChangedAt in the stored state → the deploy time of this fix is used', () => {
    expect(Date.parse(CFG.autoChangedAtFallback)).toBeGreaterThan(Date.parse('2026-11-19T22:38:00Z'))
    expect(Date.parse(CFG.autoChangedAtFallback)).toBeLessThan(Date.parse('2026-11-24T05:00:00Z'))
    expect(rules({ auto: true, pause: false }, '2026-11-19T22:45:00Z')).toEqual([])                       // 19.11: no
    expect(rules({ auto: true, pause: false, autoChangedAt: null }, '2026-11-24T05:46:00Z')).toEqual(['MAILE_NIE_ODPALILY']) // 24.11: yes
  })

  it('set-state stamps autoChangedAt on every change of AUTO, not on PAUZA or an unchanged AUTO', async () => {
    const s = setup({ auto: false })
    await adminAction({ action: 'set-state', body: { pause: true }, deps: s.deps, now: new Date('2026-11-19T20:00:00Z') })
    expect((await s.store.getState()).autoChangedAt ?? null).toBeNull()
    await adminAction({ action: 'set-state', body: { auto: true }, deps: s.deps, now: new Date('2026-11-19T22:38:00Z') })
    expect((await s.store.getState())).toMatchObject({ auto: true, autoChangedAt: '2026-11-19T22:38:00.000Z' })
    await adminAction({ action: 'set-state', body: { auto: true }, deps: s.deps, now: new Date('2026-11-20T08:00:00Z') })
    expect((await s.store.getState()).autoChangedAt).toBe('2026-11-19T22:38:00.000Z')   // same value: no new stamp
    await adminAction({ action: 'set-state', body: { auto: false }, deps: s.deps, now: new Date('2026-11-21T08:00:00Z') })
    expect((await s.store.getState())).toMatchObject({ auto: false, autoChangedAt: '2026-11-21T08:00:00.000Z' })
    // the store stamps a change made without a clock too
    await s.store.setState({ auto: true })
    const stamped = (await s.store.getState()).autoChangedAt
    expect(stamped).not.toBe('2026-11-21T08:00:00.000Z'); expect(Number.isFinite(Date.parse(String(stamped)))).toBe(true)
  })
})

// ── DRY_RUN end to end ──────────────────────────────────────────────────────────

describe('DRY_RUN end to end', () => {
  it('runs everything (templates, queue, variant, safeguards) but creates and publishes nothing', async () => {
    const s = setup()
    const r = await run(s, CET_TUE_0600, { dryRun: true })
    expect(r).toMatchObject({ status: 'dry-run', reason: 'planned', dryRun: true, wouldPublish: true })
    expect(r.plan).toMatchObject({ template: '01-t.html', variant: 'landing', sendAt: '2026-12-01T06:00:00.000Z', subject: 'Temat numer jeden' })
    expect(r.checks?.every((c) => c.ok)).toBe(true)
    expect(s.calls.create).not.toHaveBeenCalled(); expect(s.calls.publish).not.toHaveBeenCalled()
    expect(await s.store.getLog()).toEqual([])
    expect(await s.store.claim('2026-12-01-tuesday')).toBe(true) // no claim was taken
    expect(await s.store.getLastDryRun()).toMatchObject({ status: 'dry-run' })
    expect(await s.store.getLastRun()).toBeNull()
    // and the real run afterwards still takes template 1
    const real = await run(s, CET_TUE_0600.getTime() ? new Date('2026-12-08T05:00:00Z') : CET_TUE_0600)
    expect(real.plan?.template).toBe('01-t.html')
  })

  it('with AUTO off the dry run still shows the plan and says it would NOT publish', async () => {
    const s = setup({ auto: false })
    const r = await run(s, CET_TUE_0600, { dryRun: true })
    expect(r).toMatchObject({ status: 'dry-run', wouldPublish: false }); expect(r.gates?.map((g) => g.id)).toEqual(['AUTO_OFF'])
    expect(s.calls.publish).not.toHaveBeenCalled()
  })

  it('a failing safeguard shows up in the dry run too', async () => {
    const s = setup({ link: 404 })
    const r = await run(s, CET_TUE_0600, { dryRun: true })
    expect(r).toMatchObject({ status: 'failed', reason: 'safeguard', dryRun: true }); expect(s.calls.create).not.toHaveBeenCalled()
    expect(await s.store.getLastRun()).toBeNull() // a dry run never writes the real alert state
  })
})

// ── Admin: status, switches, registrations, send-test ────────────────────────────

describe('admin actions', () => {
  it('status: queues per slot, CTR from Wix, registrations, alerts', async () => {
    const s = setup({ wix: { campaignStats: async () => ({ 'camp-1': { delivered: 6900, opened: 600, clicked: 69 } }) } })
    await run(s, CET_TUE_0600)
    expect((await adminAction({ action: 'set-registrations', body: { key: '2026-12-01-tuesday', value: 17 }, deps: s.deps })).ok).toBe(true)
    const st = await adminStatus({ deps: s.deps, now: new Date('2026-12-02T10:00:00Z') })
    expect(st.queues.map((q: { slot: string }) => q.slot)).toEqual([...SLOT_NAMES])
    expect(st.log[0]).toMatchObject({ date: '2026-12-01', slot: 'tuesday', variant: 'landing', campaignId: 'camp-1', ctr: 1, registrations: 17 })
    expect(ctrOf({ delivered: 0, clicked: 0 })).toBeNull()
  })

  it('switches AUTO/PAUZA persist and reject non-booleans', async () => {
    const s = setup({ auto: false })
    expect(await adminAction({ action: 'set-state', body: { auto: true }, deps: s.deps })).toMatchObject({ ok: true })
    expect((await s.store.getState()).auto).toBe(true)
    expect((await adminAction({ action: 'set-state', body: { pause: 'yes' }, deps: s.deps })).ok).toBe(false)
    expect((await adminAction({ action: 'set-registrations', body: { key: 'zly', value: 3 }, deps: s.deps })).ok).toBe(false)
    expect((await adminAction({ action: 'set-registrations', body: { key: '2026-12-01-tuesday', value: -1 }, deps: s.deps })).ok).toBe(false)
  })

  it('dry-run from the app plans the next wake-up and publishes nothing', async () => {
    const s = setup()
    const r = await adminAction({ action: 'dry-run', body: { slot: 'thursday' }, deps: s.deps, now: new Date('2026-12-01T12:00:00Z') })
    expect(r.ok).toBe(true); expect(r.outcome).toMatchObject({ status: 'dry-run', slot: 'thursday', date: '2026-12-03' })
    expect(s.calls.create).not.toHaveBeenCalled(); expect(s.calls.publish).not.toHaveBeenCalled()
  })

  it('send-test uses the SAME create+publish path, to exactly the one test contact, sendAt >= 30 min ahead', async () => {
    const s = setup()
    const now = new Date('2026-11-19T15:00:20Z')
    const r = await adminAction({ action: 'send-test', body: { slot: 'tuesday', variant: 'clickmeeting' }, deps: s.deps, now })
    expect(r).toMatchObject({ ok: true, test: true, to: 'fundacjawceen@gmail.com', contactId: 'df6fa121-fe39-426b-bc1b-fc8734bd0812', variant: 'clickmeeting', template: '01-t.html' })
    expect(s.calls.create).toHaveBeenCalledTimes(1); expect(s.calls.publish).toHaveBeenCalledTimes(1)
    const pub = s.calls.publish.mock.calls[0][1]
    expect(pub.audience).toEqual({ contactIds: [CFG.testContactId] })
    expect(pub.audience).not.toHaveProperty('labelIds')
    expect((new Date(pub.sendAt).getTime() - now.getTime()) / 60000).toBeGreaterThanOrEqual(30)
    expect(s.calls.create.mock.calls[0][0].html).toContain(CFG.slots.tuesday.variants.clickmeeting)
    expect(s.calls.create.mock.calls[0][0].html).not.toContain('{{WEBINAR_URL}}')
    expect((await adminAction({ action: 'nope', body: {}, deps: s.deps })).ok).toBe(false)
  })

  it('send-test does not use the template up and does not move the link variant (logged as TEST)', async () => {
    const s = setup()
    await adminAction({ action: 'send-test', body: { slot: 'tuesday', variant: 'landing' }, deps: s.deps })
    await adminAction({ action: 'send-test', body: { slot: 'tuesday', variant: 'clickmeeting' }, deps: s.deps })
    const log = await s.store.getLog()
    expect(log).toHaveLength(2)
    expect(log.every((e) => e.test === true && e.status === 'test' && e.key.startsWith('TEST-'))).toBe(true)
    const q = buildQueue('tuesday', [T(1), T(2), T(3), T(4), T(5)], log)
    expect(q.next?.file).toBe('01-t.html'); expect(q.usedCount).toBe(0)
    expect(nextVariant('tuesday', log)).toBe('landing')
    // and the real run afterwards still takes template 01 with the first variant, to the e-mail subscribers
    const real = await run(s, CET_TUE_0600)
    expect(real).toMatchObject({ status: 'scheduled' }); expect(real.plan).toMatchObject({ template: '01-t.html', variant: 'landing' })
    expect(s.calls.publish.mock.calls[2][1].audience).toEqual({ contactIds: SUBSCRIBERS })
  })

  it('send-test rejects an audience chosen by the caller (contacts-all, other contact) before anything reaches Wix', async () => {
    const s = setup()
    const audiences = [{ labelIds: ['contacts-all'] }, { contactIds: [CFG.testContactId], labelIds: ['contacts-all'] }, { contactIds: ['00000000-0000-0000-0000-000000000000'] }]
    for (const audience of audiences) {
      const r = await adminAction({ action: 'send-test', body: { slot: 'thursday', audience }, deps: s.deps })
      expect(r.ok).toBe(false); expect(String(r.error)).toMatch(/BEZPIECZNIK TESTU/)
    }
    expect(s.calls.create).not.toHaveBeenCalled(); expect(s.calls.publish).not.toHaveBeenCalled()
    expect((await adminAction({ action: 'send-test', body: { slot: 'thursday', variant: 'x' }, deps: s.deps })).ok).toBe(false)
  })
})

// ── Safeguard of the test path ──────────────────────────────────────────────────

describe('test audience safeguard', () => {
  it('accepts exactly { contactIds: [testContactId] }', () => {
    expect(testAudience()).toEqual({ contactIds: [CFG.testContactId] })
    expect(assertTestAudience(testAudience())).toBe(true)
    expect(CFG.testContactId).toMatch(/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/)
  })

  it('rejects contacts-all and every other list or label', () => {
    const bad: unknown[] = [
      CFG.audience, // the production selection (config), not a contact list
      { labelIds: ['contacts-all'] },
      { labelIds: ['contacts-all'], contactIds: [CFG.testContactId] },
      { contactIds: [CFG.testContactId], segmentIds: ['11111111-1111-1111-1111-111111111111'] },
      { contactIds: [CFG.testContactId], activeContactsOnly: false },
      { contactIds: [CFG.testContactId, '22222222-2222-2222-2222-222222222222'] },
      { contactIds: ['22222222-2222-2222-2222-222222222222'] },
      { contactIds: [] }, {}, null, undefined, 'contacts-all',
    ]
    for (const a of bad) expect(() => assertTestAudience(a)).toThrow(/BEZPIECZNIK TESTU/)
  })

  it('createAndPublish(test) with contacts-all or the production selection never calls Wix', async () => {
    const { wix, calls } = fakeWix()
    await expect(createAndPublish({ wix, subject: 'Temat', html: '<p>x</p>', sendAt: '2026-12-01T06:00:00.000Z', audience: { labelIds: ['contacts-all'] }, test: true })).rejects.toThrow(/BEZPIECZNIK TESTU/)
    await expect(createAndPublish({ wix, subject: 'Temat', html: '<p>x</p>', sendAt: '2026-12-01T06:00:00.000Z', audience: CFG.audience as never, test: true })).rejects.toThrow(/BEZPIECZNIK TESTU/)
    expect(calls.create).not.toHaveBeenCalled(); expect(calls.publish).not.toHaveBeenCalled()
  })

  it('a publish error still reports the created campaignId', async () => {
    const { wix } = fakeWix({ publishCampaign: async () => { throw new Error('HTTP 428') } })
    await expect(createAndPublish({ wix, subject: 'T', html: 'x', sendAt: '2026-12-01T06:00:00.000Z', audience: testAudience(), test: true })).rejects.toMatchObject({ campaignId: 'camp-1' })
  })

  it('test sendAt is at least 30 minutes ahead, on a full minute', () => {
    const now = new Date('2026-11-19T15:00:20Z')
    const at = testSendAt(now)
    expect(at.toISOString()).toBe('2026-11-19T15:32:00.000Z')
    expect(at.getTime() - now.getTime()).toBeGreaterThanOrEqual(30 * 60000)
  })

  it('T3: no publish without a valid sendAt — test or production — and nothing reaches Wix (Wix answers 403 to it)', async () => {
    for (const test of [true, false]) {
      for (const sendAt of [undefined, null, '', 'teraz']) {
        const { wix, calls } = fakeWix()
        const audience = test ? testAudience() : await prodAudience()
        await expect(createAndPublish({ wix, subject: 'T', html: '<p>x</p>', sendAt: sendAt as unknown as string, audience, test })).rejects.toThrow(/BEZPIECZNIK WYSYŁKI/)
        expect(calls.create).not.toHaveBeenCalled(); expect(calls.publish).not.toHaveBeenCalled()
      }
    }
  })

  it('no Wix Send Test anywhere: the client has no sendTest', () => {
    const wix = createWixClient({ apiKey: 'k', siteId: 's', fetchImpl: (async () => new Response('{}')) as unknown as typeof fetch })
    expect('sendTest' in wix).toBe(false)
  })
})

// ── Wix payloads ────────────────────────────────────────────────────────────────

describe('Wix client payloads', () => {
  const seen: { method: string; url: string; body: Record<string, unknown> | null }[] = []
  const fetchImpl = (async (url: string, init: RequestInit) => {
    seen.push({ method: String(init.method), url: String(url), body: init.body ? JSON.parse(String(init.body)) : null })
    const json = String(url).endsWith('/campaigns') && init.method === 'POST' ? { campaign: { campaignId: 'new-id' } } : {}
    return new Response(JSON.stringify(json), { status: 200 })
  }) as unknown as typeof fetch

  it('create: HTML editor, html wrapped in composerDataJson, subject and preheader', async () => {
    seen.length = 0
    const wix = createWixClient({ apiKey: 'k', siteId: 's', fetchImpl })
    expect(await wix.createCampaign({ subject: 'Temat', preheader: 'Zajawka', html: '<p>x</p>' })).toBe('new-id')
    const b = seen[0].body as { campaignEditorType: { value: string }; composer: { composerDataJson: string }; emailSubject: string; emailPreheader: string }
    // The exact shape Wix accepts (from its documented example); a bare string is rejected with HTTP 400.
    expect(b.campaignEditorType).toEqual({ value: 'HTML' }); expect(JSON.parse(b.composer.composerDataJson)).toEqual({ html: '<p>x</p>' })
    expect(typeof b.composer.composerDataJson).toBe('string')
    expect([b.emailSubject, b.emailPreheader]).toEqual(['Temat', 'Zajawka'])
  })

  it('publish: sendAt, subscriber contactIds, subject — and the test audience sends only the test contact', async () => {
    seen.length = 0
    const wix = createWixClient({ apiKey: 'k', siteId: 's', fetchImpl })
    await wix.publishCampaign('cid', { subject: 'Temat', sendAt: '2026-12-01T06:00:00.000Z', audience: await prodAudience() })
    expect(seen[0].url).toMatch(/\/campaigns\/cid\/publish$/)
    expect(seen[0].body).toEqual({ emailDistributionOptions: { emailSubject: 'Temat', contactIds: SUBSCRIBERS, sendAt: '2026-12-01T06:00:00.000Z' } })
    await wix.publishCampaign('cid', { subject: 'Temat', sendAt: '2026-11-19T15:32:00.000Z', audience: testAudience() })
    expect(seen[1].body).toEqual({ emailDistributionOptions: { emailSubject: 'Temat', contactIds: [CFG.testContactId], sendAt: '2026-11-19T15:32:00.000Z' } })
  })

  it('publish: the client itself refuses contacts-all, any label, segment or activeContactsOnly (no request sent)', async () => {
    seen.length = 0
    const wix = createWixClient({ apiKey: 'k', siteId: 's', fetchImpl })
    for (const audience of [{ labelIds: ['contacts-all'] }, { labelIds: ['contacts-all'], activeContactsOnly: false }, { segmentIds: ['33dd07aa-aa24-48ff-8e4e-6d368fbad439'] }, { contactIds: SUBSCRIBERS, labelIds: ['x'] }, { contactIds: [] }, {}]) {
      await expect(wix.publishCampaign('cid', { subject: 'T', sendAt: '2026-12-01T06:00:00.000Z', audience })).rejects.toThrow(/BEZPIECZNIK ODBIORCÓW/)
    }
    expect(seen).toHaveLength(0)
  })

  it('subscriber query: filter SUBSCRIBED, all pages, every contact re-checked, count must equal the Wix total', async () => {
    const pages = [
      { contacts: [{ id: 'a', primaryEmail: { subscriptionStatus: 'SUBSCRIBED' } }, { id: 'b', primaryEmail: { subscriptionStatus: 'SUBSCRIBED' } }], pagingMetadata: { total: 3, hasNext: true } },
      { contacts: [{ id: 'c', primaryEmail: { subscriptionStatus: 'SUBSCRIBED' } }], pagingMetadata: { total: 3, hasNext: false } },
    ]
    const bodies: Record<string, any>[] = []
    const mk = (pg: typeof pages) => (async (_u: string, init: RequestInit) => { bodies.push(JSON.parse(String(init.body))); return new Response(JSON.stringify(pg[bodies.length - 1] ?? pg[pg.length - 1]), { status: 200 }) }) as unknown as typeof fetch
    const ok = createWixClient({ apiKey: 'k', siteId: 's', fetchImpl: mk(pages) })
    expect(await ok.listEmailSubscriberIds!()).toEqual({ ids: ['a', 'b', 'c'], total: 3 })
    expect(bodies[0].query.filter).toEqual({ 'primaryEmail.subscriptionStatus': 'SUBSCRIBED' })
    expect(bodies[1].query.paging.offset).toBe(2)
    expect(SUBSCRIBED_FILTER).toEqual(CFG.audience.contactsFilter)
    bodies.length = 0
    const notSub = createWixClient({ apiKey: 'k', siteId: 's', fetchImpl: mk([{ contacts: [{ id: 'a', primaryEmail: { subscriptionStatus: 'NOT_SET' } }], pagingMetadata: { total: 1, hasNext: false } }] as never) })
    await expect(notSub.listEmailSubscriberIds!()).rejects.toThrow(/bez subskrypcji/)
    bodies.length = 0
    const short = createWixClient({ apiKey: 'k', siteId: 's', fetchImpl: mk([{ contacts: [{ id: 'a', primaryEmail: { subscriptionStatus: 'SUBSCRIBED' } }], pagingMetadata: { total: 5854, hasNext: false } }] as never) })
    await expect(short.listEmailSubscriberIds!()).rejects.toThrow(/niepełna/)
  })

  it('an API error never contains the key', async () => {
    const bad = (async () => new Response(JSON.stringify({ message: 'denied for secret-key-123' }), { status: 403 })) as unknown as typeof fetch
    const wix = createWixClient({ apiKey: 'secret-key-123', siteId: 's', fetchImpl: bad })
    await expect(wix.accountDetails()).rejects.toThrow(/HTTP 403/)
    await expect(wix.accountDetails()).rejects.not.toThrow(/secret-key-123/)
  })

  it('positive control: the placeholder really is replaced (a template that kept it would be caught)', () => {
    expect(renderCampaignHtml('<a href="{{WEBINAR_URL}}">x</a>', 'https://a.pl')).toEqual({ html: '<a href="https://a.pl">x</a>', unresolved: [] })
    expect(renderCampaignHtml('<a href="{{WEBINAR_URL}}">x</a>', 'https://a.pl').html).not.toContain('{{')
  })
})

// ── Public health summary (webinar-mail-health) ──────────────────────────────────

describe('healthSummary (public webinar-mail-health)', () => {
  it('returns exactly the allowed fields: build, blobsRead, auto, pauza, kolejka{wtorek,czwartek}, nastepnaWysylka, alarmy, ostatnieWpisy', async () => {
    const s = setup({ auto: false, pause: true, templates: [T(1), T(2), { file: '03-bad.html', html: tpl('Zły!') }] })
    await s.ready
    const h = await healthSummary({ deps: s.deps, build: 'abc1234', now: new Date('2026-11-20T10:00:00Z') })
    expect(Object.keys(h).sort()).toEqual(['aktualnyNadawca', 'alarmy', 'auto', 'blobsRead', 'build', 'kolejka', 'liczbaOdbiorcow', 'nadawcy', 'nastepnaWysylka', 'odbiorcy', 'ostatnieWpisy', 'pauza'])
    expect(Object.keys(h.kolejka).sort()).toEqual(['czwartek', 'wtorek'])
    expect(h).toEqual({ build: 'abc1234', blobsRead: 'ok', auto: false, pauza: true, kolejka: { wtorek: 2, czwartek: 2 }, nastepnaWysylka: '2026-11-24T06:00:00.000Z', alarmy: ['MAILE_KOLEJKA_NISKA'], ostatnieWpisy: [], nadawcy: { wtorek: 'Filip Dąbrowski', czwartek: 'Marek Szurawski' }, aktualnyNadawca: 'Marek Szurawski', odbiorcy: 'Subskrybenci e-mail (SUBSCRIBED)', liczbaOdbiorcow: 3 })
  })

  it('no template content, file names, subjects, campaign IDs, e-mails or test contact in the body', async () => {
    const s = setup({ log: [{ key: '2026-11-17-tuesday', date: '2026-11-17', slot: 'tuesday', templateFile: '01-t.html', subject: 'Temat numer jeden', status: 'scheduled', campaignId: 'camp-secret-id', createdAt: '2026-11-17T05:00:00Z' } as LogEntry] })
    await s.ready
    const text = JSON.stringify(await healthSummary({ deps: s.deps, build: 'x', now: new Date('2026-11-20T10:00:00Z') }))
    for (const bad of ['camp-secret-id', '01-t.html', 'Temat', '@', 'WEBINAR_URL', CFG.testContactId, 'http']) expect(text).not.toContain(bad)
  })

  it('used templates leave the ready count (same queue as the run)', async () => {
    const s = setup({ log: [{ key: '2026-11-17-tuesday', date: '2026-11-17', slot: 'tuesday', templateFile: '01-t.html', subject: 'x', status: 'scheduled', campaignId: 'c', createdAt: '2026-11-17T05:00:00Z' } as LogEntry] })
    await s.ready
    expect((await healthSummary({ deps: s.deps, build: 'x', now: new Date('2026-11-20T10:00:00Z') })).kolejka).toEqual({ wtorek: 4, czwartek: 5 })
  })

  it('a failing store read → blobsRead "error", store fields null (never made-up values)', async () => {
    const boom = async () => { throw new Error('Netlify Blobs has failed to perform a read using strong consistency') }
    const deps = { store: { getState: boom, getLog: boom, getLastRun: boom, getRun: boom } as never, loadTemplates: async () => [T(1)] }
    const h = await healthSummary({ deps, build: 'x', now: new Date('2026-11-20T10:00:00Z') })
    expect(h).toMatchObject({ blobsRead: 'error', auto: null, pauza: null, kolejka: { wtorek: null, czwartek: null }, alarmy: null, ostatnieWpisy: null })
    expect(h.nastepnaWysylka).toBe('2026-11-24T06:00:00.000Z')
  })

  // T4: the production state of 19.11 night: AUTO switched on at 22:38Z (no autoChangedAt stored yet), the two test
  // publishes of 22:39Z / 22:40Z, no run record for 19.11.
  const NIGHT_19_11 = () => {
    const s = setup({ auto: true, log: [
      { key: 'TEST-2026-11-19-tuesday-landing', date: '2026-11-19', slot: 'tuesday', variant: 'landing', campaignId: 'd7f50e0f-0000-0000-0000-000000000000', templateFile: '01-t.html', subject: 'Temat numer jeden', sendAt: '2026-11-19T23:11:00.000Z', status: 'test', test: true, createdAt: '2026-11-19T22:39:14.000Z', dryRun: false },
      { key: 'TEST-2026-11-19-thursday-landing', date: '2026-11-19', slot: 'thursday', variant: 'landing', campaignId: 'e6cff03c-0000-0000-0000-000000000000', templateFile: '01-t.html', subject: 'Temat numer jeden', sendAt: '2026-11-19T23:12:00.000Z', status: 'test', test: true, createdAt: '2026-11-19T22:40:05.000Z', dryRun: false },
    ] as LogEntry[] })
    return s
  }

  it('alarmy: no MAILE_NIE_ODPALILY for 19.11 (AUTO on only at 22:38Z); ostatnieWpisy: the 19.11 tests as test: true, not "błąd"', async () => {
    const s = NIGHT_19_11(); await s.ready
    const h = await healthSummary({ deps: s.deps, build: 'x', now: new Date('2026-11-19T22:55:00Z') })   // 23:55 Warsaw, Thursday
    expect(h.auto).toBe(true)
    expect(h.alarmy).not.toContain('MAILE_NIE_ODPALILY')
    expect(h.ostatnieWpisy).toEqual([
      { data: '2026-11-19', slot: 'czwartek', status: 'zaplanowany', test: true },
      { data: '2026-11-19', slot: 'wtorek', status: 'zaplanowany', test: true },
    ])
    const later = await healthSummary({ deps: s.deps, build: 'x', now: new Date('2026-11-20T08:00:00Z') })
    expect(later.ostatnieWpisy?.map((w) => w.status)).toEqual(['wysłany', 'wysłany'])
  })

  it('alarmy: a real missed Tuesday run shows up; a failed run shows MAILE_AWARIA', async () => {
    const s = NIGHT_19_11(); await s.ready
    expect((await healthSummary({ deps: s.deps, build: 'x', now: new Date('2026-11-24T05:50:00Z') })).alarmy).toContain('MAILE_NIE_ODPALILY')
    const f = setup({ templates: [T(1), T(2), T(3), T(4), T(5)], wix: { accountDetails: async () => ({ status: 'SUSPENDED' }) } })
    await run(f, new Date('2026-11-24T05:00:00Z'))
    expect((await healthSummary({ deps: f.deps, build: 'x', now: new Date('2026-11-24T05:30:00Z') })).alarmy).toEqual(['MAILE_AWARIA'])
  })

  it('ostatnieWpisy: at most 5, newest first, no campaign IDs / subjects / files / e-mails', async () => {
    const log: LogEntry[] = Array.from({ length: 7 }, (_, i) => ({ key: `2026-11-${String(10 + i).padStart(2, '0')}-tuesday`, date: `2026-11-${String(10 + i).padStart(2, '0')}`, slot: 'tuesday', variant: 'landing', campaignId: `camp-secret-${i}`, templateFile: `0${i}-t.html`, subject: 'Tajny temat', sendAt: `2026-11-${String(10 + i).padStart(2, '0')}T06:00:00.000Z`, status: i === 6 ? 'failed' : 'scheduled', createdAt: `2026-11-${String(10 + i).padStart(2, '0')}T05:00:00.000Z`, dryRun: false }))
    const s = setup({ log }); await s.ready
    const h = await healthSummary({ deps: s.deps, build: 'x', now: new Date('2026-11-20T10:00:00Z') })
    expect(h.ostatnieWpisy).toHaveLength(5)
    expect(h.ostatnieWpisy?.[0]).toEqual({ data: '2026-11-16', slot: 'wtorek', status: 'błąd', test: false })
    expect(h.ostatnieWpisy?.map((w) => w.data)).toEqual(['2026-11-16', '2026-11-15', '2026-11-14', '2026-11-13', '2026-11-12'])
    for (const w of h.ostatnieWpisy ?? []) expect(Object.keys(w).sort()).toEqual(['data', 'slot', 'status', 'test'])
    const text = JSON.stringify(h)
    for (const bad of ['camp-secret', 'Tajny', '-t.html', '@', 'http', CFG.testContactId]) expect(text).not.toContain(bad)
  })

  it('nextPlannedSend: 07:00 Warsaw of the next Tue/Thu still ahead, CET and CEST, skipDates skipped', () => {
    expect(nextPlannedSend(new Date('2026-11-24T05:59:00Z'))?.toISOString()).toBe('2026-11-24T06:00:00.000Z') // Tue before 07:00
    expect(nextPlannedSend(new Date('2026-11-24T06:00:00Z'))?.toISOString()).toBe('2026-11-26T06:00:00.000Z') // after → Thu
    expect(nextPlannedSend(new Date('2026-06-01T12:00:00Z'))?.toISOString()).toBe('2026-06-02T05:00:00.000Z') // CEST
    expect(nextPlannedSend(new Date('2026-12-23T12:00:00Z'))?.toISOString()).toBe('2026-12-29T06:00:00.000Z') // 24.12 skipped
  })
})

// ── Unresolved tags: {{unsubscribe}}, {{X}}, ${...} block the send ───────────────

describe('unresolved tags in the final HTML', () => {
  const FOOT = '<p>Dostajesz tę wiadomość, bo zapisałeś się na nasze materiały o nauce i pamięci.\n  <a href="{{unsubscribe}}" style="color:#9A948A;">Wypisz się</a></p>'
  const withUnsub = tpl('Temat z linkiem wypisania', `<p>Cześć</p><a href="{{WEBINAR_URL}}">Wchodzę</a>${FOOT}`)

  it('a template with {{unsubscribe}} is rejected', () => {
    const v = validateTemplate('x.html', withUnsub)
    expect(v.blocked.join(' ')).toMatch(/nierozwiązane znaczniki po renderze: \{\{unsubscribe\}\}/)
    expect(buildQueue('tuesday', [{ file: '01-x.html', html: withUnsub }], []).next).toBeNull()
  })

  it('the same template without it passes (sentence kept, link gone)', () => {
    const { html, removed } = removeOwnUnsubscribeLinks(withUnsub)
    expect(removed).toBe(1)
    expect(html).toContain('Dostajesz tę wiadomość, bo zapisałeś się na nasze materiały o nauce i pamięci.')
    expect(html).not.toContain('Wypisz'); expect(html).not.toContain('{{unsubscribe}}')
    expect(validateTemplate('x.html', html).blocked).toEqual([])
    // <br> before a stand-alone link goes with it
    expect(removeOwnUnsubscribeLinks('a</a><br>\n  <a href="{{unsubscribe}}" style="x">Wypisz się z listy</a>\n</td>').html).toBe('a</a>\n</td>')
  })

  it('any unresolved {{X}} or ${...} blocks: validator, render, safeguard and createAndPublish', async () => {
    expect(unresolvedTags('a {{X}} b ${contact.name.first} c {{X}}')).toEqual(['{{X}}', '${contact.name.first}'])
    const r = renderCampaignHtml(tpl('Temat', '<a href="{{WEBINAR_URL}}">x</a> {{X}}'), 'https://a.pl')
    expect(r.unresolved).toEqual(['{{X}}'])
    expect(validateTemplate('x.html', tpl('Temat', '<a href="{{WEBINAR_URL}}">x</a> Cześć ${contact.name.first}')).blocked.join(' ')).toMatch(/\$\{contact\.name\.first\}/)
    const checks = evaluateSafeguards({ account: { status: 'ACTIVE' }, subject: 'Temat', link: { status: 200 }, sendsToday: [], state: { pause: false }, sendAt: new Date('2026-12-01T06:00:00Z'), now: CET_TUE_0600, unresolved: ['{{X}}'] })
    expect(checks.find((c) => c.id === 'ZNACZNIKI_ROZWIAZANE')).toMatchObject({ ok: false })
    const { wix, calls } = fakeWix()
    for (const test of [false, true]) {
      await expect(createAndPublish({ wix, subject: 'T', html: '<a href="https://a.pl">x</a> {{unsubscribe}}', sendAt: '2026-12-01T06:00:00.000Z', audience: test ? testAudience() : await prodAudience(), test })).rejects.toThrow(/BEZPIECZNIK TREŚCI/)
    }
    expect(calls.create).not.toHaveBeenCalled(); expect(calls.publish).not.toHaveBeenCalled()
  })

  it('the run skips a template with leftovers (not used up) and takes the next clean one', async () => {
    const bad = { file: '01-bad.html', html: withUnsub }
    const s = setup({ templates: [bad, T(2)] })
    const r = await run(s, CET_TUE_0600)
    expect(r).toMatchObject({ status: 'scheduled' }); expect(r.plan?.template).toBe('02-t.html')
    expect(s.calls.create.mock.calls[0][0].html).not.toMatch(/\{\{|\$\{/)
  })

  it('a queue with only such templates fails red (MAILE_AWARIA / queue-empty), nothing is used up', async () => {
    const s = setup({ templates: [{ file: '01-bad.html', html: withUnsub }] })
    const r = await run(s, CET_TUE_0600)
    expect(r).toMatchObject({ status: 'failed', reason: 'queue-empty' })
    expect(s.calls.create).not.toHaveBeenCalled()
    const alerts = buildAlerts({ state: { auto: true, pause: false, ackedRunAt: null }, lastRun: r, runToday: r, queues: [], now: CET_TUE_0600 })
    expect(alerts.map((a) => a.rule)).toContain('MAILE_AWARIA')
  })

  it('the test path refuses a template with leftovers too', async () => {
    const s = setup({ templates: [{ file: '01-bad.html', html: withUnsub }] })
    const r = await adminAction({ action: 'send-test', body: { slot: 'tuesday' }, deps: s.deps })
    expect(r.ok).toBe(false); expect(s.calls.create).not.toHaveBeenCalled()
  })
})

// ── Import from sent Wix campaigns ───────────────────────────────────────────────

describe('import from a sent Wix campaign', () => {
  const b64url = (text: string) => btoa(text).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '')
  const wrap = (u: string) => `https://wceen.com/so/aaQ7f8J30/c?w=SIGNATURE_-x.${b64url(JSON.stringify({ u, m: 'mail' }))}`
  const sample = (link: string) => `<!DOCTYPE html><html lang="pl"><head><title>Dziś 18:00</title></head><body><p>Hej</p><a href="${wrap(link)}">Wchodzę</a><a href="${wrap('[LINK%20WYPISANIA%20Z%20WIX]')}">Wypisz</a>`
    + '<table role="presentation" border="0" cellpadding="0" cellspacing="0" width="100%" dir="ltr" style="width:100%!important;background:#fff"><tbody><tr><td>Ta wiadomość e-mail została wysłana z <a href="https://wceen.com/so/aaQ7f8J30/c?w=abc.def">tej strony</a>.</td></tr></tbody></table>'
    + '<div style="display:none!important;visibility:hidden!important"><!--TRACKING_PIXEL--></div></body></html>'

  it('unwraps the tracking redirect to the original address', () => {
    expect(unwrapTrackingLink(wrap('https://www.wceen.com/webinar-jezyk-w-17h'))).toBe('https://www.wceen.com/webinar-jezyk-w-17h')
    expect(unwrapTrackingLink('https://example.com/x')).toBe('https://example.com/x')
  })

  it('strips the Wix footer and pixel, drops the own unsubscribe link, puts {{WEBINAR_URL}} in', () => {
    const t = importTemplate({ html: sample('https://fundacjawceen.clickmeeting.com/nauka-jezykow-w-xxi-wieku/register'), subject: 'Dziś 18:00' })
    expect(t.slot).toBe('tuesday')
    const html = t.html as string
    expect(html).toContain('href="{{WEBINAR_URL}}"'); expect(html).not.toContain('unsubscribe'); expect(html).not.toContain('Wypisz')
    expect(html).not.toMatch(/\/so\//); expect(html).not.toContain('TRACKING_PIXEL'); expect(html).not.toContain('wysłana z')
    expect(validateTemplate('x.html', html).blocked).toEqual([])
  })

  it('classifies by the webinar link; a mail with neither (or both) is not imported', () => {
    expect(classifySlot('https://fundacjawceen.clickmeeting.com/pamiec-czwartek/register')).toBe('thursday')
    expect(classifySlot('https://www.eccehomo21.com/darmowy-webinar?utm_source=wix')).toBe('thursday')
    expect(classifySlot('<a href="https://cogni.center/quiz">x</a>')).toBeNull()
    expect(classifySlot('webinar-jezyk-w-17h and pamiec-czwartek')).toBeNull()
    expect(importTemplate({ html: '<p>nurture</p>', subject: 'x' }).slot).toBeNull()
  })

  it('every historic webinar address becomes the placeholder, query strings included', () => {
    const out = replaceWebinarLinks('a https://eccehomo21.com/darmowy-webinar?utm_source=wix&utm_medium=mail b https://www.wceen.com/darmowy-webinar c https://fundacjawceen.clickmeeting.com/pamiec-czwartek/register d')
    expect(out).toBe('a {{WEBINAR_URL}} b {{WEBINAR_URL}} c {{WEBINAR_URL}} d')
  })

  it('stripWixInjection leaves a mail without the injection untouched', () => {
    expect(stripWixInjection('<body><p>x</p></body>')).toBe('<body><p>x</p></body>')
  })
})

// ── Sender name per slot (PATCH /email-marketing/v1/sender-details, only fromName) ────────────────────

describe('sender name of the slot (BEZPIECZNIK NADAWCA)', () => {
  it('config: Tuesday → Filip Dąbrowski, Thursday → Marek Szurawski, resting name Marek', () => {
    expect(CFG.slots.tuesday.fromName).toBe('Filip Dąbrowski')
    expect(CFG.slots.thursday.fromName).toBe('Marek Szurawski')
    expect(CFG.restingFromName).toBe('Marek Szurawski')
  })

  it('order: the name is set and confirmed by a read BEFORE the campaign is created and published', async () => {
    const { wix, calls } = fakeWix()
    const r = await createAndPublish({ wix, subject: 'T', html: '<p>x</p>', sendAt: '2026-12-01T06:00:00.000Z', audience: testAudience(), fromName: 'Filip Dąbrowski', test: true })
    expect(calls.order).toEqual(['set-sender:Filip Dąbrowski', 'get-sender', 'create', 'publish'])
    expect(r).toEqual({ campaignId: 'camp-1', sender: { expected: 'Filip Dąbrowski', ok: true } })
  })

  it('Tuesday production run sets Filip, Thursday run sets Marek; the log keeps the result', async () => {
    const tue = setup({ auto: true }); await tue.ready
    const r1 = await run(tue, CET_TUE_0600)
    expect(r1).toMatchObject({ status: 'scheduled', sender: { expected: 'Filip Dąbrowski', ok: true } })
    expect(tue.calls.order.slice(0, 2)).toEqual(['set-sender:Filip Dąbrowski', 'get-sender'])
    expect(tue.calls.order.indexOf('set-sender:Filip Dąbrowski')).toBeLessThan(tue.calls.order.indexOf('publish'))
    expect((await tue.store.getLog()).slice(-1)[0]?.sender).toEqual({ expected: 'Filip Dąbrowski', ok: true })

    const thu = setup({ auto: true }); await thu.ready
    const r2 = await run(thu, new Date('2026-12-03T05:00:00Z'))
    expect(r2).toMatchObject({ status: 'scheduled', sender: { expected: 'Marek Szurawski', ok: true } })
    expect(thu.calls.order.indexOf('set-sender:Marek Szurawski')).toBeLessThan(thu.calls.order.indexOf('create'))
  })

  it('"Wyślij test" goes the same path: the name of the chosen slot before the publish', async () => {
    for (const [slot, name] of [['tuesday', 'Filip Dąbrowski'], ['thursday', 'Marek Szurawski']] as const) {
      const s = setup(); await s.ready
      const r = await adminAction({ action: 'send-test', body: { slot }, deps: s.deps, now: new Date('2026-11-20T10:00:00Z') })
      expect(r).toMatchObject({ ok: true, sender: { expected: name, ok: true } })
      expect(s.calls.order).toEqual([`set-sender:${name}`, 'get-sender', 'create', 'publish'])
    }
  })

  it('a failed name change: the mail still goes out, the log says so, amber NADAWCA_NIE_USTAWIONY', async () => {
    const s = setup({ auto: true, wix: { setSenderName: async () => { throw new Error('Wix PATCH /email-marketing/v1/sender-details → HTTP 403 x@y.pl') } } })
    await s.ready
    const r = await run(s, CET_TUE_0600)
    expect(r.status).toBe('scheduled')
    expect(s.calls.publish).toHaveBeenCalledTimes(1)
    const entry = (await s.store.getLog()).slice(-1)[0]!
    expect(entry.sender).toMatchObject({ expected: 'Filip Dąbrowski', ok: false })
    expect(entry.sender?.error).toContain('HTTP 403')
    expect(entry.sender?.error).not.toContain('@')
    const alerts = buildAlerts({ state: await s.store.getState(), lastRun: r, runToday: r, queues: [], now: new Date('2026-12-01T06:30:00Z'), log: await s.store.getLog() })
    expect(alerts).toContainEqual(expect.objectContaining({ severity: 'amber', rule: 'NADAWCA_NIE_USTAWIONY' }))
  })

  it('a read-back with another name counts as a failure (mail still goes out)', async () => {
    const s = setup({ auto: true, wix: { getSenderName: async () => 'Ktoś Inny' } })
    await s.ready
    const r = await run(s, CET_TUE_0600)
    expect(r).toMatchObject({ status: 'scheduled', sender: { ok: false } })
    expect(r.sender?.error).toContain('Ktoś Inny')
  })

  it('the alert clears itself after the next send that sets the name; old entries without sender do not alert', async () => {
    const base = { date: '2026-12-01', slot: 'tuesday', templateFile: '01-t.html', subject: 'x', status: 'scheduled', campaignId: 'c' }
    const bad = { ...base, key: 'a', createdAt: '2026-12-01T05:00:00Z', sender: { expected: 'Filip Dąbrowski', ok: false, error: 'x' } } as LogEntry
    const good = { ...base, key: 'b', date: '2026-12-03', slot: 'thursday', createdAt: '2026-12-03T05:00:00Z', sender: { expected: 'Marek Szurawski', ok: true } } as LogEntry
    const old = { ...base, key: 'c', createdAt: '2026-11-17T05:00:00Z' } as LogEntry
    const at = (log: LogEntry[]) => buildAlerts({ state: { auto: true, pause: false }, lastRun: null, runToday: null, queues: [], now: new Date('2026-12-04T10:00:00Z'), log }).map((a) => a.rule)
    expect(at([old, bad])).toContain('NADAWCA_NIE_USTAWIONY')
    expect(at([old, bad, good])).not.toContain('NADAWCA_NIE_USTAWIONY')
    expect(at([old])).not.toContain('NADAWCA_NIE_USTAWIONY')
  })

  it('ensureSenderName never throws (missing config, client without the methods)', async () => {
    const { wix } = fakeWix()
    expect(await ensureSenderName(wix, '')).toMatchObject({ ok: false })
    const bare = { ...wix, setSenderName: undefined, getSenderName: undefined } as WixLike
    expect(await ensureSenderName(bare, 'Filip Dąbrowski')).toMatchObject({ ok: false, expected: 'Filip Dąbrowski' })
  })

  it('Wix client: PATCH sends only the new name plus the UNCHANGED address read just before; no PATCH when already right', async () => {
    const sent: { method: string; url: string; body?: string }[] = []
    let current = { fromName: 'Marek Szurawski', fromEmail: 'nadawca@example.org', dateVerified: '2023-12-05T14:37:25.633Z' }
    const fetchImpl = (async (url: string, init: RequestInit) => {
      sent.push({ method: String(init.method), url, body: init.body as string | undefined })
      if (init.method === 'PATCH') { current = { ...current, ...JSON.parse(String(init.body)).senderDetails }; return new Response('{"verificationNeeded":false}') }
      return new Response(JSON.stringify({ senderDetails: current }))
    }) as unknown as typeof fetch
    const wix = createWixClient({ apiKey: 'k', siteId: 's', fetchImpl })
    expect(await wix.setSenderName!('Filip Dąbrowski')).toEqual({ fromName: 'Filip Dąbrowski', changed: true })
    const patch = sent.find((r) => r.method === 'PATCH')!
    expect(patch.url).toBe('https://www.wixapis.com/email-marketing/v1/sender-details')
    expect(JSON.parse(patch.body!)).toEqual({ senderDetails: { fromName: 'Filip Dąbrowski', fromEmail: 'nadawca@example.org' } })
    expect(await wix.getSenderName!()).toBe('Filip Dąbrowski')
    sent.length = 0
    expect(await wix.setSenderName!('Filip Dąbrowski')).toEqual({ fromName: 'Filip Dąbrowski', changed: false })
    expect(sent.some((r) => r.method === 'PATCH')).toBe(false)
  })

  it('Wix client refuses to PATCH without a valid current address, and fails on verificationNeeded', async () => {
    const noAddr = createWixClient({ apiKey: 'k', siteId: 's', fetchImpl: (async () => new Response('{"senderDetails":{"fromName":"A"}}')) as unknown as typeof fetch })
    await expect(noAddr.setSenderName!('B')).rejects.toThrow(/adresu nadawcy/)
    const verify = createWixClient({ apiKey: 'k', siteId: 's', fetchImpl: (async (_u: string, init: RequestInit) => new Response(init.method === 'PATCH' ? '{"verificationNeeded":true}' : '{"senderDetails":{"fromName":"A","fromEmail":"a@b.pl"}}')) as unknown as typeof fetch })
    await expect(verify.setSenderName!('B')).rejects.toThrow(/weryfikacji/)
  })

  it('health: nadawcy from the config, aktualnyNadawca from Wix (name only), null when unreadable', async () => {
    const s = setup(); await s.ready
    const h = await healthSummary({ deps: s.deps, build: 'x', now: new Date('2026-11-20T10:00:00Z') })
    expect(h.nadawcy).toEqual({ wtorek: 'Filip Dąbrowski', czwartek: 'Marek Szurawski' })
    expect(h.aktualnyNadawca).toBe('Marek Szurawski')
    const broken = setup({ wix: { getSenderName: async () => { throw new Error('HTTP 500') } } }); await broken.ready
    expect((await healthSummary({ deps: broken.deps, build: 'x', now: new Date('2026-11-20T10:00:00Z') })).aktualnyNadawca).toBeNull()
    const noWix = await healthSummary({ deps: { store: s.deps.store, loadTemplates: s.deps.loadTemplates }, build: 'x', now: new Date('2026-11-20T10:00:00Z') })
    expect(noWix.aktualnyNadawca).toBeNull()
  })
})

// ── Production goes ONLY to the e-mail subscribers (2026-11-24) ─────────────────

describe('production audience safeguard (only e-mail subscribers)', () => {
  it('the config has exactly one selection: the e-mail subscribers, no label, no segment', () => {
    expect(CFG.audience).toEqual({ selection: PRODUCTION_SELECTION, name: 'Subskrybenci e-mail (SUBSCRIBED)', contactsFilter: { 'primaryEmail.subscriptionStatus': 'SUBSCRIBED' } })
    expect(JSON.stringify(CFG.audience)).not.toContain('contacts-all')
    expect(CFG.audience).not.toHaveProperty('labelIds')
    expect(CFG.audience).not.toHaveProperty('segmentIds')
  })

  it('accepts only the audience resolved from the SUBSCRIBED query', async () => {
    const r = await resolveProductionAudience(fakeWix().wix)
    expect(r).toMatchObject({ count: 3, total: 3, name: CFG.audience.name })
    expect(r.audience).toEqual({ contactIds: SUBSCRIBERS })
    expect(assertProductionAudience(r.audience)).toBe(true)
  })

  it('rejects contacts-all, any label, segment, activeContactsOnly, the test contact and hand-made lists', () => {
    const bad: unknown[] = [
      { labelIds: ['contacts-all'], activeContactsOnly: false }, // the old production audience
      { labelIds: ['contacts-all'] },
      { labelIds: ['custom.klienci'] },
      { segmentIds: ['33dd07aa-aa24-48ff-8e4e-6d368fbad439'] },
      { contactIds: [...SUBSCRIBERS] }, // same IDs, but not produced by the subscriber query
      testAudience(),
      { contactIds: [...SUBSCRIBERS], activeContactsOnly: true },
      CFG.audience, {}, null, undefined, 'contacts-all',
    ]
    for (const a of bad) expect(() => assertProductionAudience(a)).toThrow(/BEZPIECZNIK PRODUKCJI/)
  })

  it('a resolved audience is still rejected when the config selection is not the subscribers', async () => {
    const r = await resolveProductionAudience(fakeWix().wix)
    const contactsAll = { ...CFG, audience: { labelIds: ['contacts-all'], activeContactsOnly: false } } as never
    expect(() => assertProductionAudience(r.audience, contactsAll)).toThrow(/BEZPIECZNIK PRODUKCJI/)
    await expect(resolveProductionAudience(fakeWix().wix, contactsAll)).rejects.toThrow(/BEZPIECZNIK PRODUKCJI/)
    const otherFilter = { ...CFG, audience: { ...CFG.audience, contactsFilter: { 'primaryEmail.subscriptionStatus': 'NOT_SET' } } } as never
    expect(() => assertProductionAudience(r.audience, otherFilter)).toThrow(/BEZPIECZNIK PRODUKCJI/)
  })

  it('createAndPublish(production) with contacts-all, the test contact or a hand-made list never reaches Wix', async () => {
    for (const audience of [{ labelIds: ['contacts-all'], activeContactsOnly: false }, testAudience(), { contactIds: [...SUBSCRIBERS] }]) {
      const { wix, calls } = fakeWix()
      await expect(createAndPublish({ wix, subject: 'Temat', html: '<p>x</p>', sendAt: '2026-12-01T06:00:00.000Z', audience })).rejects.toThrow(/BEZPIECZNIK PRODUKCJI/)
      expect(calls.create).not.toHaveBeenCalled(); expect(calls.publish).not.toHaveBeenCalled()
    }
  })

  it('the test path still goes to the one test contact only (production subscribers never enter it)', async () => {
    const s = setup()
    const r = await adminAction({ action: 'send-test', body: { slot: 'tuesday' }, deps: s.deps })
    expect(r.ok).toBe(true)
    expect(s.calls.publish.mock.calls[0][1].audience).toEqual({ contactIds: [CFG.testContactId] })
    const prod = await prodAudience()
    expect(() => assertTestAudience(prod)).toThrow(/BEZPIECZNIK TESTU/)
    const bad = await adminAction({ action: 'send-test', body: { slot: 'tuesday', audience: { contactIds: SUBSCRIBERS } }, deps: s.deps })
    expect(bad.ok).toBe(false); expect(String(bad.error)).toMatch(/BEZPIECZNIK TESTU/)
  })
})

describe('BEZPIECZNIK ODBIORCY', () => {
  const R = (count: number, total = count) => ({ count, total, name: CFG.audience.name })

  it('passes for 0 < n ≤ 110% of the last recorded count', () => {
    expect(evaluateRecipients(R(5854), 5854)).toMatchObject({ id: 'ODBIORCY', ok: true })
    expect(evaluateRecipients(R(6439), 5854).ok).toBe(true) // floor(5854 × 1.1) = 6439
    expect(evaluateRecipients(R(1), 5854).ok).toBe(true)
  })

  it('fails on 0, above 110%, a list that differs from the Wix total, a Wix error, no baseline', () => {
    expect(evaluateRecipients(R(0), 5854).ok).toBe(false)
    expect(evaluateRecipients(R(6440), 5854)).toMatchObject({ ok: false })
    expect(evaluateRecipients(R(6952), 5854).detail).toMatch(/110%/) // contacts-all on 24.11 (6952) would have been stopped
    expect(evaluateRecipients(R(5000, 5854), 5854).ok).toBe(false)
    expect(evaluateRecipients({ error: 'HTTP 403' }, 5854).ok).toBe(false)
    expect(evaluateRecipients(null, 5854).ok).toBe(false)
    expect(evaluateRecipients(R(10), null).ok).toBe(false)
  })

  it('baseline: the store value, else the config (5854 on 2026-11-24)', async () => {
    expect(CFG.recipientsBaseline.count).toBe(5854)
    expect(await recipientsBaseline(createMemoryStore())).toBe(5854)
    expect(await recipientsBaseline(createMemoryStore({ recipients: { count: 6000, at: 'x' } }))).toBe(6000)
  })

  it('a run whose recipients fail the check publishes nothing and raises red MAILE_AWARIA + MAILE_ODBIORCY', async () => {
    const s = setup({ wix: { listEmailSubscriberIds: async () => ({ ids: [], total: 0 }) } })
    const r = await run(s, CET_TUE_0600)
    expect(r).toMatchObject({ status: 'failed', reason: 'safeguard' })
    expect(r.detail).toMatch(/ODBIORCY/)
    expect(s.calls.create).not.toHaveBeenCalled(); expect(s.calls.publish).not.toHaveBeenCalled()
    const h = await healthSummary({ deps: s.deps, build: 'x', now: new Date('2026-12-01T07:00:00Z') })
    expect(h.alarmy).toEqual(expect.arrayContaining(['MAILE_AWARIA', 'MAILE_ODBIORCY']))
  })

  it('too many recipients (over 110% of the stored count) → no publish', async () => {
    const s = setup()
    await s.store.setRecipients!({ count: 2, at: '2026-11-26T06:00:00Z' }) // 3 > floor(2 × 1.1) = 2
    const r = await run(s, CET_TUE_0600)
    expect(r.status).toBe('failed'); expect(s.calls.publish).not.toHaveBeenCalled()
  })

  it('a Wix error while listing subscribers → no publish (fails closed), no e-mail in the record', async () => {
    const s = setup({ wix: { listEmailSubscriberIds: async () => { throw new Error('Wix POST /contacts/v4/contacts/query → HTTP 403 a@b.pl') } } })
    const r = await run(s, CET_TUE_0600)
    expect(r.status).toBe('failed'); expect(s.calls.publish).not.toHaveBeenCalled()
    expect(JSON.stringify(r)).not.toContain('a@b.pl')
  })

  it('a successful send records the recipient count (new baseline) and the plan shows the selection', async () => {
    const s = setup()
    const r = await run(s, CET_TUE_0600)
    expect(r.status).toBe('scheduled')
    expect(r.plan).toMatchObject({ odbiorcy: 'Subskrybenci e-mail (SUBSCRIBED)', liczbaOdbiorcow: 3, limitOdbiorcow: 6439 })
    expect((await s.store.getRecipients!())?.count).toBe(3)
    expect((await s.store.getLog()).find((e) => !e.test)?.recipients).toBe(3)
  })

  it('a dry run shows the selection and the count, and records nothing', async () => {
    const s = setup()
    const r = await run(s, CET_TUE_0600, { dryRun: true })
    expect(r.status).toBe('dry-run')
    expect(r.checks?.find((c) => c.id === 'ODBIORCY')).toMatchObject({ ok: true })
    expect(r.plan).toMatchObject({ odbiorcy: CFG.audience.name, liczbaOdbiorcow: 3 })
    expect(await s.store.getRecipients!()).toBeNull()
  })
})
