// The automatic webinar mails: 06:00 Warsaw wake-up (CET and CEST), sendAt 07:00, idempotency,
// every safeguard on its own, the subject validator, alternating link variants, empty queue,
// DRY_RUN end to end, and the Wix payloads. No network, nothing is ever published.
import { describe, it, expect, vi } from 'vitest'
import {
  runWebinarMail, validateSubject, validateTemplate, buildQueue, nextVariant, evaluateSafeguards,
  warsawParts, warsawLocalToUtc, buildAlerts, ctrOf, renderCampaignHtml, SLOT_NAMES,
  assertTestAudience, createAndPublish, testAudience, testSendAt,
  type RunDeps, type WixLike, type TemplateFile, type LogEntry,
} from '../../../netlify/shared/webinarMail.js'
import { WEBINAR_MAIL_CONFIG as CFG } from '../../../netlify/shared/webinarMailConfig.js'
import { createMemoryStore } from '../../../netlify/shared/webinarMailStore.js'
import { createWixClient } from '../../../netlify/shared/webinarMailWix.js'
import { adminAction, adminStatus } from '../../../netlify/shared/webinarMailAdmin.js'
import {
  importTemplate, unwrapTrackingLink, stripWixInjection, replaceWebinarLinks, classifySlot,
} from '../../../netlify/shared/webinarMailImport.js'

// ── helpers ─────────────────────────────────────────────────────────────────────

const tpl = (subject: string, body = '<p>Cześć</p><a href="{{WEBINAR_URL}}">Wchodzę</a>'): string =>
  `<!DOCTYPE html><html><head><meta charset="UTF-8"><title>${subject}</title><meta name="preheader" content=""></head><body>${body}</body></html>`

const T = (n: number, subject = `Temat numer ${n === 1 ? 'jeden' : n === 2 ? 'dwa' : n === 3 ? 'trzy' : n === 4 ? 'cztery' : 'pięć'}`): TemplateFile =>
  ({ file: `${String(n).padStart(2, '0')}-t.html`, html: tpl(subject) })

// Tuesday 2026-12-01 (CET, UTC+1) and Tuesday 2026-06-02 (CEST, UTC+2); Thursday 2026-12-03 / 2026-06-04.
const CET_TUE_0600 = new Date('2026-12-01T05:00:00Z')
const CEST_TUE_0600 = new Date('2026-06-02T04:00:00Z')

function fakeWix(over: Partial<WixLike> = {}) {
  const calls = { create: vi.fn(), publish: vi.fn() }
  const wix: WixLike = {
    accountDetails: async () => ({ status: 'ACTIVE' }),
    listRecentCampaigns: async () => [],
    previewCampaign: async () => ({ html: '' }),
    createCampaign: async (i) => { calls.create(i); return 'camp-' + calls.create.mock.calls.length },
    publishCampaign: async (id, i) => { calls.publish(id, i) },
    getCampaign: async (id) => ({ campaignId: id, distributionStatus: 'SCHEDULED', visibilityStatus: 'PUBLISHED', datePublished: null, mailsSent: null, delivered: null }),
    deleteCampaign: async () => undefined,
    campaignStats: async () => ({}),
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

  it('publishes to all contacts (label contacts-all), with the subject, once', async () => {
    const s = setup(); await run(s, CET_TUE_0600)
    expect(s.calls.publish).toHaveBeenCalledTimes(1)
    const [id, opts] = s.calls.publish.mock.calls[0]
    expect(id).toBe('camp-1')
    expect(opts.audience).toEqual({ labelIds: ['contacts-all'], activeContactsOnly: false })
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
    expect(r).toMatchObject({ ok: true, test: true, to: 'fundacja@wceen.com', contactId: CFG.testContactId, variant: 'clickmeeting', template: '01-t.html' })
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
    // and the real run afterwards still takes template 01 with the first variant, to contacts-all
    const real = await run(s, CET_TUE_0600)
    expect(real).toMatchObject({ status: 'scheduled' }); expect(real.plan).toMatchObject({ template: '01-t.html', variant: 'landing' })
    expect(s.calls.publish.mock.calls[2][1].audience).toEqual(CFG.audience)
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
      CFG.audience, // the production audience: contacts-all
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

  it('createAndPublish(test) with contacts-all never calls Wix', async () => {
    const { wix, calls } = fakeWix()
    await expect(createAndPublish({ wix, subject: 'Temat', html: '<p>x</p>', sendAt: '2026-12-01T06:00:00.000Z', audience: CFG.audience, test: true })).rejects.toThrow(/BEZPIECZNIK TESTU/)
    expect(calls.create).not.toHaveBeenCalled(); expect(calls.publish).not.toHaveBeenCalled()
  })

  it('a publish error still reports the created campaignId', async () => {
    const { wix } = fakeWix({ publishCampaign: async () => { throw new Error('HTTP 428') } })
    await expect(createAndPublish({ wix, subject: 'T', html: 'x', sendAt: 's', audience: testAudience(), test: true })).rejects.toMatchObject({ campaignId: 'camp-1' })
  })

  it('test sendAt is at least 30 minutes ahead, on a full minute', () => {
    const now = new Date('2026-11-19T15:00:20Z')
    const at = testSendAt(now)
    expect(at.toISOString()).toBe('2026-11-19T15:32:00.000Z')
    expect(at.getTime() - now.getTime()).toBeGreaterThanOrEqual(30 * 60000)
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

  it('publish: sendAt, contacts-all label, subject — and the test audience sends only contactIds', async () => {
    seen.length = 0
    const wix = createWixClient({ apiKey: 'k', siteId: 's', fetchImpl })
    await wix.publishCampaign('cid', { subject: 'Temat', sendAt: '2026-12-01T06:00:00.000Z', audience: CFG.audience })
    expect(seen[0].url).toMatch(/\/campaigns\/cid\/publish$/)
    expect(seen[0].body).toEqual({ emailDistributionOptions: { emailSubject: 'Temat', labelIds: ['contacts-all'], activeContactsOnly: false, sendAt: '2026-12-01T06:00:00.000Z' } })
    await wix.publishCampaign('cid', { subject: 'Temat', sendAt: '2026-11-19T15:32:00.000Z', audience: testAudience() })
    expect(seen[1].body).toEqual({ emailDistributionOptions: { emailSubject: 'Temat', contactIds: [CFG.testContactId], sendAt: '2026-11-19T15:32:00.000Z' } })
  })

  it('an API error never contains the key', async () => {
    const bad = (async () => new Response(JSON.stringify({ message: 'denied for secret-key-123' }), { status: 403 })) as unknown as typeof fetch
    const wix = createWixClient({ apiKey: 'secret-key-123', siteId: 's', fetchImpl: bad })
    await expect(wix.accountDetails()).rejects.toThrow(/HTTP 403/)
    await expect(wix.accountDetails()).rejects.not.toThrow(/secret-key-123/)
  })

  it('positive control: the placeholder really is replaced (a template that kept it would be caught)', () => {
    expect(renderCampaignHtml('<a href="{{WEBINAR_URL}}">x</a>', 'https://a.pl')).toBe('<a href="https://a.pl">x</a>')
    expect(renderCampaignHtml('<a href="{{WEBINAR_URL}}">x</a>', 'https://a.pl')).not.toContain('{{')
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

  it('strips the Wix footer and pixel, restores the unsubscribe placeholder, puts {{WEBINAR_URL}} in', () => {
    const t = importTemplate({ html: sample('https://fundacjawceen.clickmeeting.com/nauka-jezykow-w-xxi-wieku/register'), subject: 'Dziś 18:00' })
    expect(t.slot).toBe('tuesday')
    const html = t.html as string
    expect(html).toContain('href="{{WEBINAR_URL}}"'); expect(html).toContain('href="{{unsubscribe}}"')
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
