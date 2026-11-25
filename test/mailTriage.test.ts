// Stanley's inbox triage and approved replies: the hard rules of the mail feature (see netlify/shared/mailTriage.js).
import { describe, expect, it, vi } from 'vitest'
// @ts-expect-error plain JS module
import { classify, triageInbox, sendApprovedReply, skipMessage, previewReply, inboxSummary, MailPolicyError, LABELS, INBOX_QUERY, KIND } from '../netlify/shared/mailTriage.js'
// @ts-expect-error plain JS module
import { createMemoryKv } from '../netlify/shared/webinarMailStore.js'
// @ts-expect-error plain JS module
import { inboxLines } from '../netlify/shared/dailyBrief.js'
// @ts-expect-error plain JS module
import { REPLY_TEMPLATES } from '../netlify/shared/replyTemplates.js'

type Msg = { id: string; threadId?: string; from: string; replyTo?: string; fromName?: string; subject: string; snippet?: string; labelIds?: string[]; bulk?: boolean; messageId?: string; references?: string; internalDate?: string }
const msg = (o: Partial<Msg> & { id: string }): Msg => ({ threadId: `t-${o.id}`, from: 'anna.kowalska@gmail.com', replyTo: '', fromName: 'Anna', subject: '', snippet: '', labelIds: ['INBOX'], bulk: false, messageId: `<${o.id}@mail.gmail.com>`, references: '', internalDate: '2026-11-24T08:00:00.000Z', ...o })

function fakeGmail(messages: Msg[], { sendFails = false, labelFails = false } = {}) {
  const sent: any[] = []
  const labelled: any[] = []
  const labels = new Map<string, string>()
  const byId = new Map(messages.map((m) => [m.id, m]))
  return {
    sent, labelled,
    async listIds() { return messages.map((m) => m.id) },
    async getMeta(id: string) { const m = byId.get(id); if (!m) throw new Error('404'); return { ...m, labelIds: [...(m.labelIds ?? []), ...(labelled.filter((l) => l.id === id).map(() => labels.get(LABELS.replied)!).filter(Boolean))] } },
    async labelId(name: string, { create = true } = {}) { if (!labels.has(name) && create) labels.set(name, `Label_${labels.size + 1}`); return labels.get(name) ?? null },
    async modifyLabels(id: string, { add = [] as string[] }) { if (labelFails) throw new Error('Gmail API HTTP 500'); for (const n of add) await this.labelId(n); labelled.push({ id, add }) },
    async send(m: any) { if (sendFails) throw new Error('Gmail API HTTP 500'); sent.push(m); return { id: `sent-${sent.length}`, threadId: m.threadId } },
  }
}

const paid = async () => [{ date: '2026-11-20', product: 'Pakiet Pamięciowy' }]
const unpaid = async () => []

describe('classify: who Stanley may answer', () => {
  it('a customer asking for the memory pack materials gets the pp template (high confidence)', () => {
    const c = classify(msg({ id: 'a', subject: 'Brak materiałów cyfrowych', snippet: 'Dzień dobry, kupiłam Pakiet Pamięciowy i nie dostałam linku do materiałów' }))
    expect(c).toMatchObject({ kind: KIND.ACCESS, template: 'pp', confidence: 'high' })
  })
  it('Językozak AI: the app and the activation code point to jzk', () => {
    expect(classify(msg({ id: 'b', subject: 'Dostęp do Językozak AI', snippet: 'nie mam kodu aktywacyjnego' }))).toMatchObject({ kind: KIND.ACCESS, template: 'jzk' })
  })
  it('the course, the language techniques and WSZTP map to their templates', () => {
    expect(classify(msg({ id: 'c', subject: 'Dostęp do kursu', snippet: 'nie mogę się zalogować do kursu Jak się uczyć' })).template).toBe('kurs')
    expect(classify(msg({ id: 'd', subject: 'Link do 3 Zadziwiających Technik', snippet: 'nie dostałem linku' })).template).toBe('tech')
    expect(classify(msg({ id: 'e', subject: 'WSZTP – materiały bonusowe', snippet: 'brak maila z bonusami' })).template).toBe('wsztp')
  })
  it('English questions work too', () => {
    expect(classify(msg({ id: 'f', subject: 'Access to the course', snippet: 'I did not receive the link to the course' }))).toMatchObject({ kind: KIND.ACCESS, template: 'kurs' })
  })
  it('two products named: the first by priority, but the confidence is low (Filip picks)', () => {
    const c = classify(msg({ id: 'g', subject: 'Dostęp', snippet: 'nie dostałem linku do aplikacji Językozak ani do kursu' }))
    expect(c.confidence).toBe('low')
    expect(c.candidates).toEqual(expect.arrayContaining(['jzk', 'kurs']))
  })
  it('an access question with no product has NO template (a person decides)', () => {
    expect(classify(msg({ id: 'h', subject: 'Brak dostępu', snippet: 'nie dostałem maila' }))).toMatchObject({ kind: KIND.HUMAN, template: null })
  })
  it('a plain person mail with no access question: human, no template', () => {
    expect(classify(msg({ id: 'i', subject: 'Pytanie o turnus w lipcu', snippet: 'Czy są jeszcze wolne miejsca?' })).kind).not.toBe(KIND.ACCESS)
  })
})

describe('classify: what Stanley never answers', () => {
  it('automated senders, newsletters and Gmail promotion/social categories', () => {
    expect(classify(msg({ id: 'n1', from: 'no-reply@sklep.pl', subject: 'Dostęp do kursu' })).kind).toBe(KIND.AUTOMATED)
    expect(classify(msg({ id: 'n2', bulk: true, subject: 'Newsletter' })).kind).toBe(KIND.AUTOMATED)
    expect(classify(msg({ id: 'n3', labelIds: ['INBOX', 'CATEGORY_PROMOTIONS'], subject: 'Dostęp do kursu -50%' })).kind).toBe(KIND.AUTOMATED)
    expect(classify(msg({ id: 'n4', from: '' , subject: 'x' })).kind).toBe(KIND.AUTOMATED)
  })
  it('system, bank, authority, billing and security senders are protected, even with an access-sounding subject', () => {
    for (const from of ['security@accounts.google.com', 'billing@facebookmail.com', 'info@stripe.com', 'noreply@wix.com', 'kontakt@mbank.pl', 'sekretariat@uodo.gov.pl', 'urzad@podatki.gov.pl', 'x@zus.pl', 'alert@netlify.com', 'a@mail.github.com']) {
      expect(classify(msg({ id: 'p', from, subject: 'Brak dostępu do konta', snippet: 'link' })).kind, from).toBe(KIND.PROTECTED)
    }
  })
  it('invoices, refunds, complaints, legal and tax topics are sensitive: never a template', () => {
    for (const s of ['Faktura do zamówienia', 'Chcę zwrot pieniędzy za kurs', 'Reklamacja: nie dostałem materiałów', 'Pytanie o RODO', 'I want a refund for the course', 'Wezwanie do zapłaty']) {
      const c = classify(msg({ id: 's', subject: s, snippet: 'Pakiet Pamięciowy, brak linku' }))
      expect(c.kind, s).toBe(KIND.SENSITIVE)
      expect(c.template).toBeNull()
    }
  })
})

describe('triageInbox', () => {
  const inbox = [
    msg({ id: 'm-pp', subject: 'Brak materiałów', snippet: 'Pakiet Pamięciowy, nie dostałem linku', internalDate: '2026-11-24T10:00:00.000Z' }),
    msg({ id: 'm-promo', from: 'oferta@sklep.pl', bulk: true, subject: 'Promocja' }),
    msg({ id: 'm-bank', from: 'x@mbank.pl', subject: 'Wyciąg' }),
    msg({ id: 'm-inv', subject: 'Faktura do zamówienia' }),
    msg({ id: 'm-hi', subject: 'Dzień dobry', snippet: 'Kiedy kolejny turnus?', internalDate: '2026-11-20T09:00:00.000Z' }),
  ]
  it('counts everything, lists only what waits for Filip, access requests first, with the buyer check', async () => {
    const t = await triageInbox({ gmail: fakeGmail(inbox), findOrders: paid })
    expect(t.counts).toEqual({ scanned: 5, automated: 1, protected: 1, sensitive: 1, access: 1, human: 1 })
    expect(t.items.map((i: any) => i.id)).toEqual(['m-pp', 'm-hi', 'm-inv'])
    expect(t.items[0]).toMatchObject({ kind: 'access-request', template: 'pp', canReply: true, buyer: { status: 'verified' } })
    expect(t.items.find((i: any) => i.id === 'm-inv')).toMatchObject({ canReply: false })
    expect(t.oldest).toBe('2026-11-20T09:00:00.000Z')
    expect(t.templates.map((x: any) => x.id)).toEqual(['pp', 'tech', 'jzk', 'kurs', 'wsztp'])
  })
  it('no matching order → unverified; a failing order lookup → unknown (never "verified")', async () => {
    expect((await triageInbox({ gmail: fakeGmail(inbox), findOrders: unpaid })).items[0].buyer.status).toBe('unverified')
    expect((await triageInbox({ gmail: fakeGmail(inbox), findOrders: async () => { throw new Error('db down') } })).items[0].buyer.status).toBe('unknown')
    expect((await triageInbox({ gmail: fakeGmail(inbox), findOrders: null })).items[0].buyer.status).toBe('unknown')
  })
  it('the Gmail query leaves out what was already handled and promotions', () => {
    expect(INBOX_QUERY).toContain(`-label:${LABELS.replied}`)
    expect(INBOX_QUERY).toContain(`-label:${LABELS.skipped}`)
    expect(INBOX_QUERY).toContain('-category:promotions')
  })
})

describe('sendApprovedReply: the approval gate', () => {
  const ask = (over: Record<string, unknown> = {}, g = fakeGmail([msg({ id: 'mm-pp-001', subject: 'Brak materiałów', snippet: 'Pakiet Pamięciowy, nie dostałem linku' })]), kv = createMemoryKv()) =>
    ({ g, kv, run: () => sendApprovedReply({ gmail: g, kv, findOrders: paid, messageId: 'mm-pp-001', templateId: 'pp', now: Date.UTC(2026, 10, 25, 8), ...over }) })

  it('sends the template to the sender, in the thread, labels the message, and logs without address or subject', async () => {
    const { g, kv, run } = ask()
    const r = await run()
    expect(r).toMatchObject({ sent: true, templateId: 'pp', buyer: 'verified' })
    expect(g.sent).toHaveLength(1)
    expect(g.sent[0]).toMatchObject({ to: 'anna.kowalska@gmail.com', subject: REPLY_TEMPLATES.pp.subject, threadId: 't-mm-pp-001', inReplyTo: '<mm-pp-001@mail.gmail.com>' })
    expect(g.sent[0].plain).toContain('Pakietu Pamięciowego')
    expect(g.labelled).toEqual([{ id: 'mm-pp-001', add: [LABELS.replied] }])
    const logs = await kv.list('mail/log/')
    expect(logs).toHaveLength(1)
    const entry = JSON.stringify(await kv.getJSON(logs[0]))
    expect(entry).not.toContain('anna')
    expect(entry).not.toContain('Brak materiałów')
    expect(entry).toContain('gmail.com')
  })

  it('one reply per message: the second approval is refused and nothing more is sent', async () => {
    const { g, kv, run } = ask()
    await run()
    await expect(ask({}, g, kv).run()).rejects.toMatchObject({ code: 'already_replied' })
    expect(g.sent).toHaveLength(1)
  })

  it('even when the label could not be applied, the claim still blocks a second reply (double click, lost label)', async () => {
    const g = fakeGmail([msg({ id: 'mm-pp-001', subject: 'Brak materiałów', snippet: 'Pakiet Pamięciowy, nie dostałem linku' })], { labelFails: true })
    const kv = createMemoryKv()
    const first = await ask({}, g, kv).run()
    expect(first.labelError).toContain('HTTP 500')
    await expect(ask({}, g, kv).run()).rejects.toMatchObject({ code: 'already_replied' })
    expect(g.sent).toHaveLength(1)
  })

  it('a failed send releases the claim, so the message can be retried', async () => {
    const g = fakeGmail([msg({ id: 'mm-pp-001', subject: 'Brak materiałów', snippet: 'Pakiet Pamięciowy, nie dostałem linku' })], { sendFails: true })
    const kv = createMemoryKv()
    await expect(ask({}, g, kv).run()).rejects.toThrow('HTTP 500')
    expect(await kv.list('mail/claim/')).toEqual([])
  })

  it('an unverified buyer needs an explicit confirmation; an unknown one too', async () => {
    const { g, run } = ask({ findOrders: unpaid })
    await expect(run()).rejects.toMatchObject({ code: 'unverified_buyer' })
    expect(g.sent).toHaveLength(0)
    await expect(ask({ findOrders: async () => { throw new Error('x') } }).run()).rejects.toMatchObject({ code: 'unverified_buyer' })
    const ok = ask({ findOrders: unpaid, confirmUnverified: true })
    expect((await ok.run()).buyer).toBe('unverified')
    expect(ok.g.sent).toHaveLength(1)
    await expect(ask({ findOrders: unpaid, confirmUnverified: 'yes' }).run()).rejects.toMatchObject({ code: 'unverified_buyer' }) // only boolean true counts
  })

  it('refuses automated, protected and sensitive messages whatever the browser asks', async () => {
    for (const m of [
      msg({ id: 'mm-auto-01', from: 'no-reply@x.pl', subject: 'Dostęp' }),
      msg({ id: 'mm-bank-01', from: 'a@mbank.pl', subject: 'Dostęp do konta' }),
      msg({ id: 'mm-inv-001', subject: 'Faktura', snippet: 'Pakiet Pamięciowy' }),
      msg({ id: 'mm-trash-1', subject: 'Brak materiałów', snippet: 'Pakiet Pamięciowy link', labelIds: ['TRASH'] }),
    ]) {
      const g = fakeGmail([m])
      await expect(sendApprovedReply({ gmail: g, kv: createMemoryKv(), findOrders: paid, messageId: m.id, templateId: 'pp' }), m.id).rejects.toMatchObject({ code: 'not_allowed' })
      expect(g.sent).toHaveLength(0)
    }
  })

  it('refuses to answer to an automated or system Reply-To address (a spoofed Reply-To cannot redirect a paid link)', async () => {
    for (const replyTo of ['no-reply@x.pl', 'victim@mbank.pl']) {
      const g = fakeGmail([msg({ id: 'mm-pp-001', replyTo, subject: 'Brak materiałów', snippet: 'Pakiet Pamięciowy, nie dostałem linku' })])
      await expect(sendApprovedReply({ gmail: g, kv: createMemoryKv(), findOrders: paid, messageId: 'mm-pp-001', templateId: 'pp' })).rejects.toMatchObject({ code: 'not_allowed' })
      expect(g.sent).toHaveLength(0)
    }
  })

  it('the buyer check uses the address the reply would go to (Reply-To), not the From', async () => {
    const lookup = vi.fn(paid)
    const g = fakeGmail([msg({ id: 'mm-pp-001', replyTo: 'real.buyer@poczta.pl', subject: 'Brak materiałów', snippet: 'Pakiet Pamięciowy, nie dostałem linku' })])
    await sendApprovedReply({ gmail: g, kv: createMemoryKv(), findOrders: lookup, messageId: 'mm-pp-001', templateId: 'pp' })
    expect(lookup).toHaveBeenCalledWith('real.buyer@poczta.pl')
    expect(g.sent[0].to).toBe('real.buyer@poczta.pl')
  })

  it('Językozak AI needs a valid activation code typed by Filip; the code lands in the mail', async () => {
    const m = msg({ id: 'mm-jzk-001', subject: 'Dostęp do Językozak AI', snippet: 'nie mam kodu aktywacyjnego' })
    for (const code of [undefined, '', '  ', 'x', 'JZK XXXX']) {
      const g = fakeGmail([m])
      await expect(sendApprovedReply({ gmail: g, kv: createMemoryKv(), findOrders: paid, messageId: m.id, templateId: 'jzk', code }), String(code)).rejects.toMatchObject({ code: 'code_required' })
      expect(g.sent).toHaveLength(0)
    }
    const g = fakeGmail([m])
    await sendApprovedReply({ gmail: g, kv: createMemoryKv(), findOrders: paid, messageId: m.id, templateId: 'jzk', code: 'JZK-AB12-CD34' })
    expect(g.sent[0].plain).toContain('JZK-AB12-CD34')
    expect(g.sent[0].plain).not.toContain('{{CODE}}')
    expect(g.sent[0].html).not.toContain('JZK-XXXX-XXXX')
  })

  it('bad input never reaches Gmail', async () => {
    const g = fakeGmail([])
    await expect(sendApprovedReply({ gmail: g, kv: createMemoryKv(), findOrders: paid, messageId: '../x', templateId: 'pp' })).rejects.toMatchObject({ code: 'bad_request' })
    await expect(sendApprovedReply({ gmail: g, kv: createMemoryKv(), findOrders: paid, messageId: 'mm-pp-001', templateId: 'nope' })).rejects.toMatchObject({ code: 'bad_request' })
    expect(g.sent).toHaveLength(0)
    expect(new MailPolicyError('x', 'y')).toBeInstanceOf(Error)
  })

  it('the Gmail client given to the policy has no delete or trash call to use', () => {
    const g = fakeGmail([])
    expect(Object.keys(g).filter((k) => /delete|trash|remove/i.test(k))).toEqual([])
  })
})

describe('skip, preview, summary', () => {
  it('skip only adds the label STANLEY/skipped', async () => {
    const g = fakeGmail([msg({ id: 'mm-pp-001' })])
    await skipMessage({ gmail: g, messageId: 'mm-pp-001' })
    expect(g.labelled).toEqual([{ id: 'mm-pp-001', add: [LABELS.skipped] }])
    await expect(skipMessage({ gmail: g, messageId: '../' })).rejects.toMatchObject({ code: 'bad_request' })
  })
  it('preview shows the draft; for Językozak AI it shows a placeholder and says the code is not ready', () => {
    expect(previewReply('pp', '')).toMatchObject({ codeReady: true, needsCode: false })
    const p = previewReply('jzk', '')
    expect(p).toMatchObject({ codeReady: false, needsCode: true })
    expect(p.plain).toContain('JZK-XXXX-XXXX')
    expect(previewReply('jzk', 'JZK-AB12-CD34')).toMatchObject({ codeReady: true })
    expect(() => previewReply('zzz', '')).toThrow()
  })
  it('the summary for the brief is numbers only: no address, no subject', async () => {
    const s = await inboxSummary({ gmail: fakeGmail([msg({ id: 'mm-pp-001', subject: 'Brak materiałów', snippet: 'Pakiet Pamięciowy link' }), msg({ id: 'mm-x-0001', subject: 'Cześć', snippet: 'Pytanie' })]), findOrders: unpaid })
    expect(s).toMatchObject({ connected: true, access: 1, human: 1, waiting: 2, unverified: 1 })
    expect(JSON.stringify(s)).not.toMatch(/anna|@|Brak materiałów/)
  })
})

describe('brief section 4 (inboxLines): English, counts only', () => {
  it('not connected / error / a real summary', () => {
    expect(inboxLines(null)[0]).toContain('Google is not connected yet')
    expect(inboxLines({ ok: true, value: { connected: false } })[0]).toContain('Connect Google')
    expect(inboxLines({ ok: false, error: 'HTTP 403' })[0]).toContain('NO DATA: Gmail inbox')
    const alerts: string[] = []
    const lines = inboxLines({ ok: true, value: { connected: true, access: 2, unverified: 1, human: 3, sensitive: 1, automated: 12, protected: 4, oldest: '2026-11-20T09:00:00.000Z' } }, alerts)
    expect(lines.join('\n')).toContain('2 customer messages about access to a product wait for your approval')
    expect(lines.join('\n')).toContain('1 without a matching paid order')
    expect(lines.join('\n')).toContain('4 other messages from people')
    expect(lines.join('\n')).toContain('Stanley never answers those')
    expect(lines.join('\n')).toContain('12 automated and 4 system')
    expect(lines.join('\n')).toContain('nothing is deleted')
    expect(alerts).toEqual(['Inbox: 2 access requests waiting for approval'])
    expect(lines.join('\n')).not.toMatch(/po polsku|poczta|wiadomo/i)
  })
  it('nothing waiting', () => {
    const lines = inboxLines({ ok: true, value: { connected: true, access: 0, human: 0, sensitive: 0, automated: 3, protected: 1 } })
    expect(lines[0]).toBe('No customer access requests are waiting.')
    expect(lines[1]).toBe('No other messages from people are waiting.')
  })
})
