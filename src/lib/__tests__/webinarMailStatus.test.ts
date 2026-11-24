// T1: ONE list of send-log statuses, shared by backend and frontend. A successful test publish is never "błąd",
// and tests never count for the queue, the link variant (A/B), the slot idempotency or the CTR statistics.
import { describe, it, expect } from 'vitest'
import {
  LOG_STATUS, LOG_STATUSES, STATUS_VIEW, isProductionSend, isTestEntry, sendStatusView,
} from '../../../netlify/shared/webinarMailStatus.js'
import { buildQueue, nextVariant, runWebinarMail, type LogEntry, type WixLike } from '../../../netlify/shared/webinarMail.js'
import { adminStatus } from '../../../netlify/shared/webinarMailAdmin.js'
import { createMemoryStore } from '../../../netlify/shared/webinarMailStore.js'

const tpl = (subject: string) => `<html><head><title>${subject}</title></head><body><a href="{{WEBINAR_URL}}">x</a></body></html>`
const TEMPLATES = [1, 2, 3, 4, 5].map((n) => ({ file: `0${n}-t.html`, html: tpl(`Temat ${'abcde'[n - 1]}`) }))

// The two real test publishes of 19.11 (campaign IDs shortened), as the store keeps them.
const TEST_TUE: LogEntry = { key: 'TEST-2026-11-19-tuesday-landing', date: '2026-11-19', slot: 'tuesday', variant: 'landing', campaignId: 'd7f50e0f', templateFile: '01-t.html', subject: 'Temat a', sendAt: '2026-11-19T23:11:00.000Z', status: 'test', test: true, createdAt: '2026-11-19T22:39:14.000Z', dryRun: false }
const TEST_THU: LogEntry = { key: 'TEST-2026-11-19-thursday-landing', date: '2026-11-19', slot: 'thursday', variant: 'landing', campaignId: 'e6cff03c', templateFile: '01-t.html', subject: 'Temat a', sendAt: '2026-11-19T23:12:00.000Z', status: 'test', test: true, createdAt: '2026-11-19T22:40:05.000Z', dryRun: false }

describe('the one status list', () => {
  it('has exactly the four log statuses', () => {
    expect([...LOG_STATUSES].sort()).toEqual(['failed', 'scheduled', 'test', 'test-failed'])
    expect(LOG_STATUS.TEST).toBe('test')
  })
})

describe('sendStatusView (mapping shown in the MAILE tab and in health)', () => {
  const before = new Date('2026-11-19T22:45:00Z')
  const after = new Date('2026-11-19T23:30:00Z')

  it('a successful test is "zaplanowany" before its sendAt and "wysłany" after it, with the TEST mark, never "błąd"', () => {
    expect(sendStatusView(TEST_TUE, before)).toEqual({ code: 'zaplanowany', label: 'TEST · zaplanowany', tone: 'pending', test: true })
    expect(sendStatusView(TEST_TUE, after)).toEqual({ code: 'wysłany', label: 'TEST · wysłany', tone: 'ok', test: true })
    for (const now of [before, after]) for (const e of [TEST_TUE, TEST_THU]) expect(sendStatusView(e, now).code).not.toBe(STATUS_VIEW.BLAD)
  })

  it('a test published at once (no sendAt) is "wysłany"', () => {
    expect(sendStatusView({ ...TEST_TUE, sendAt: null }, before)).toMatchObject({ code: 'wysłany', test: true })
  })

  it('production: scheduled → zaplanowany / wysłany; failed → błąd', () => {
    const prod = { key: '2026-11-24-tuesday', status: 'scheduled', sendAt: '2026-11-24T06:00:00.000Z' }
    expect(sendStatusView(prod, new Date('2026-11-24T05:00:00Z'))).toEqual({ code: 'zaplanowany', label: 'zaplanowany', tone: 'pending', test: false })
    expect(sendStatusView(prod, new Date('2026-11-24T06:05:00Z'))).toMatchObject({ code: 'wysłany', test: false })
    expect(sendStatusView({ ...prod, status: 'failed' })).toMatchObject({ code: 'błąd', tone: 'error', test: false })
  })

  it('only a failed publish is "błąd"; an unknown status is "nieznany", not "błąd"', () => {
    expect(sendStatusView({ ...TEST_TUE, status: 'test-failed' })).toMatchObject({ code: 'błąd', label: 'TEST · błąd', test: true })
    expect(sendStatusView({ key: 'x', status: 'something-new' })).toMatchObject({ code: 'nieznany', tone: 'muted' })
    for (const s of LOG_STATUSES) {
      const v = sendStatusView({ key: 'k', status: s, sendAt: null })
      expect(v.code === 'błąd').toBe(s === 'failed' || s === 'test-failed')
    }
  })

  it('test recognition works for older entries too (by key or status, without the flag)', () => {
    expect(isTestEntry({ key: 'TEST-2026-11-19-tuesday-landing', status: 'scheduled' })).toBe(true)
    expect(isTestEntry({ key: '2026-11-19-tuesday', status: 'test' })).toBe(true)
    expect(isTestEntry({ key: '2026-11-24-tuesday', status: 'scheduled' })).toBe(false)
  })
})

describe('tests never count', () => {
  it('not for the queue, not for the link variant (A/B), not for the production idempotency', () => {
    const log = [TEST_TUE, { ...TEST_TUE, key: 'TEST-x', status: 'scheduled' as const }]  // even a test mislabelled "scheduled"
    expect(log.some(isProductionSend)).toBe(false)
    const q = buildQueue('tuesday', TEMPLATES, log)
    expect(q.usedCount).toBe(0); expect(q.next?.file).toBe('01-t.html')
    expect(nextVariant('tuesday', log)).toBe('landing')
  })

  it('a production run on the same day still publishes (a test does not take the slot)', async () => {
    const store = createMemoryStore({ state: { auto: true, pause: false } })
    await store.addLog({ ...TEST_TUE, key: 'TEST-2026-12-01-tuesday-landing', date: '2026-12-01' })
    const wix: WixLike = {
      accountDetails: async () => ({ status: 'ACTIVE' }), listRecentCampaigns: async () => [], previewCampaign: async () => ({ html: '' }),
      createCampaign: async () => 'prod-1', publishCampaign: async () => ({}), getCampaign: async () => { throw new Error('x') },
      deleteCampaign: async () => ({}), campaignStats: async () => ({}),
      listEmailSubscriberIds: async () => ({ ids: ['aaaaaaaa-0000-4000-8000-000000000001'], total: 1 }),
    }
    const r = await runWebinarMail({ now: new Date('2026-12-01T05:00:00Z'), deps: { store, wix, loadTemplates: async () => TEMPLATES, checkUrl: async () => ({ status: 200 }) } })
    expect(r).toMatchObject({ status: 'scheduled', plan: { template: '01-t.html', variant: 'landing' } })
  })

  it('adminStatus: tests listed apart (tests[]), not in log[], and their CTR is never fetched', async () => {
    const store = createMemoryStore({ state: { auto: true, pause: false } })
    await store.addLog(TEST_TUE); await store.addLog(TEST_THU)
    await store.addLog({ key: '2026-11-24-tuesday', date: '2026-11-24', slot: 'tuesday', variant: 'landing', campaignId: 'prod-1', templateFile: '01-t.html', subject: 'Temat a', sendAt: '2026-11-24T06:00:00.000Z', status: 'scheduled', createdAt: '2026-11-24T05:00:00.000Z', dryRun: false })
    const asked: string[][] = []
    const wix = { campaignStats: async (ids: string[]) => { asked.push(ids); return { 'prod-1': { delivered: 100, opened: 10, clicked: 2 }, d7f50e0f: { delivered: 1, opened: 1, clicked: 1 } } } } as unknown as WixLike
    const st = await adminStatus({ deps: { store, wix, loadTemplates: async () => TEMPLATES, checkUrl: async () => ({ status: 200 }) }, now: new Date('2026-11-24T10:00:00Z') })
    expect(asked).toEqual([['prod-1']])
    expect(st.log.map((r: { key: string }) => r.key)).toEqual(['2026-11-24-tuesday'])
    expect(st.log[0]).toMatchObject({ ctr: 2, test: false })
    expect(st.tests.map((r: { campaignId: string }) => r.campaignId)).toEqual(['e6cff03c', 'd7f50e0f'])
    expect(st.tests.every((r: { test: boolean; ctr: number | null }) => r.test && r.ctr === null)).toBe(true)
    expect(st.tests.map((r: LogEntry) => sendStatusView(r, new Date(st.now)).label)).toEqual(['TEST · wysłany', 'TEST · wysłany'])
  })
})
