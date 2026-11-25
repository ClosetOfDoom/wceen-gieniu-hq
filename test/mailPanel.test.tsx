// @vitest-environment jsdom
// The Mail tab: Google setup, the approval flow (preview → confirm → send), the unverified-buyer checkbox, the activation code.
import { act } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

vi.mock('../src/services/mail', () => ({
  fetchMailStatus: vi.fn(),
  triageInbox: vi.fn(),
  previewReply: vi.fn(),
  sendReply: vi.fn(),
  skipMail: vi.fn(),
  connectGoogleUrl: vi.fn(),
  disconnectGoogle: vi.fn(),
}))
import * as api from '../src/services/mail'
import { MailPanel } from '../src/components/MailPanel'

;(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true

const TEMPLATES = [
  { id: 'pp', label: 'Pakiet Pamięciowy (119 zł)', needsCode: false, subject: 'S1' },
  { id: 'jzk', label: 'Językozak AI (347 zł) + kod aktywacyjny', needsCode: true, subject: 'S2' },
]
const item = (over: Record<string, unknown> = {}) => ({
  id: 'msg-0001', kind: 'access-request', reason: 'asks about access to a product', fromName: 'Anna', from: 'anna@gmail.com', to: 'anna@gmail.com', toMasked: 'a***@gmail.com',
  subject: 'Brak materiałów', snippet: 'Nie dostałam linku', date: '2026-11-24T08:00:00.000Z', template: 'pp', confidence: 'high', candidates: ['pp'],
  buyer: { status: 'verified', orders: [{ date: '2026-11-20', product: 'Pakiet Pamięciowy' }] }, canReply: true, ...over,
})
const triage = (items: unknown[]) => ({ counts: { scanned: 7, automated: 3, protected: 2, sensitive: 0, access: items.length, human: 0 }, items, oldest: null, templates: TEMPLATES })
const connectedStatus = { configured: true, connected: true, invalid: false, email: 'fundacja@example.org', connectedAt: '2026-11-25T08:00:00.000Z' }

let host: HTMLDivElement
let root: Root
const flush = () => act(async () => { await new Promise((r) => setTimeout(r, 0)) })
async function mount() {
  host = document.createElement('div')
  document.body.appendChild(host)
  root = createRoot(host)
  await act(async () => { root.render(<MailPanel />) })
  await flush()
}
const btn = (text: string) => [...host.querySelectorAll('button')].find((b) => b.textContent?.includes(text)) as HTMLButtonElement | undefined
const click = async (el: Element | undefined) => { await act(async () => { el!.dispatchEvent(new MouseEvent('click', { bubbles: true })) }); await flush() }
const type = async (el: HTMLInputElement, value: string) => {
  await act(async () => {
    const set = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')!.set!
    set.call(el, value)
    el.dispatchEvent(new Event('input', { bubbles: true }))
  })
}

beforeEach(() => {
  vi.mocked(api.fetchMailStatus).mockResolvedValue(connectedStatus)
  vi.mocked(api.previewReply).mockImplementation(async (id: string) => ({ id, subject: 'Twój dostęp', plain: 'Dzień dobry, treść szablonu', html: '<p>x</p>', needsCode: id === 'jzk', codeReady: true }))
  vi.mocked(api.sendReply).mockResolvedValue({ sent: true, sentId: 'S1', templateId: 'pp', buyer: 'verified', labelError: null })
  vi.mocked(api.skipMail).mockResolvedValue({ skipped: true })
  vi.spyOn(window, 'confirm').mockReturnValue(true)
})
afterEach(() => {
  act(() => root?.unmount())
  host?.remove()
  vi.restoreAllMocks()
  vi.clearAllMocks()
})

describe('MailPanel: connection', () => {
  it('not configured: the Connect button is disabled and the one-time setup steps are shown', async () => {
    vi.mocked(api.fetchMailStatus).mockResolvedValue({ configured: false, connected: false, invalid: false, email: null, connectedAt: null })
    await mount()
    expect(btn('Connect Google')!.disabled).toBe(true)
    expect(host.textContent).toContain('GOOGLE_CLIENT_ID')
    expect(host.textContent).toContain('/.netlify/functions/mail-oauth-callback')
    expect(host.textContent).toContain('Internal')
    expect(api.triageInbox).not.toHaveBeenCalled()
  })
  it('configured but not connected: Connect opens the Google URL in a new tab, with no opener', async () => {
    vi.mocked(api.fetchMailStatus).mockResolvedValue({ configured: true, connected: false, invalid: false, email: null, connectedAt: null })
    vi.mocked(api.connectGoogleUrl).mockResolvedValue({ url: 'https://accounts.google.com/o/oauth2/v2/auth?x=1', redirectUri: 'r' })
    const open = vi.spyOn(window, 'open').mockReturnValue(null)
    await mount()
    await click(btn('Connect Google'))
    expect(open).toHaveBeenCalledWith('https://accounts.google.com/o/oauth2/v2/auth?x=1', '_blank', 'noopener')
  })
  it('revoked access shows "connect again" and does not read the inbox', async () => {
    vi.mocked(api.fetchMailStatus).mockResolvedValue({ configured: true, connected: true, invalid: true, email: null, connectedAt: null })
    await mount()
    expect(host.textContent).toContain('connect again')
    expect(api.triageInbox).not.toHaveBeenCalled()
  })
})

describe('MailPanel: approval flow', () => {
  it('nothing leaves before Preview → Approve; a verified buyer needs no extra box; the browser sends ids only', async () => {
    vi.mocked(api.triageInbox).mockResolvedValue(triage([item()]))
    await mount()
    expect(host.querySelector('[data-testid="mail-counts"]')!.textContent).toContain('7 messages checked')
    expect(host.textContent).toContain('✔ paid order found: Pakiet Pamięciowy (2026-11-20)')
    expect(btn('Approve and send')).toBeUndefined() // not before the preview
    await click(btn('Preview'))
    expect(host.textContent).toContain('Dzień dobry, treść szablonu')
    expect(api.sendReply).not.toHaveBeenCalled()
    await click(btn('Approve and send'))
    expect(window.confirm).toHaveBeenCalledOnce()
    expect(api.sendReply).toHaveBeenCalledWith({ messageId: 'msg-0001', templateId: 'pp', code: undefined, confirmUnverified: undefined })
    expect(host.querySelector('[data-testid="mail-item"]')).toBeNull()
    expect(host.textContent).toContain('1 replied')
  })

  it('declining the confirmation sends nothing and keeps the message', async () => {
    vi.mocked(api.triageInbox).mockResolvedValue(triage([item()]))
    vi.mocked(window.confirm).mockReturnValue(false)
    await mount()
    await click(btn('Preview'))
    await click(btn('Approve and send'))
    expect(api.sendReply).not.toHaveBeenCalled()
    expect(host.querySelector('[data-testid="mail-item"]')).not.toBeNull()
  })

  it('an unverified buyer: Approve stays disabled until the explicit "send anyway" box is ticked; then confirmUnverified: true', async () => {
    vi.mocked(api.triageInbox).mockResolvedValue(triage([item({ buyer: { status: 'unverified', orders: [] } })]))
    await mount()
    expect(host.textContent).toContain('no matching paid order for this address')
    await click(btn('Preview'))
    expect(btn('Approve and send')!.disabled).toBe(true)
    await click(host.querySelector('input[type="checkbox"]')!)
    expect(btn('Approve and send')!.disabled).toBe(false)
    await click(btn('Approve and send'))
    expect(api.sendReply).toHaveBeenCalledWith(expect.objectContaining({ confirmUnverified: true }))
  })

  it('Językozak AI: Approve stays disabled until the activation code is typed; the code is sent', async () => {
    vi.mocked(api.triageInbox).mockResolvedValue(triage([item({ template: 'jzk', candidates: ['jzk'] })]))
    await mount()
    await click(btn('Preview'))
    expect(host.textContent).toContain('type the activation code first')
    expect(btn('Approve and send')!.disabled).toBe(true)
    await type(host.querySelector('input[aria-label="Activation code"]')!, 'JZK-AB12-CD34')
    await click(btn('Preview'))
    await click(btn('Approve and send'))
    expect(api.sendReply).toHaveBeenCalledWith({ messageId: 'msg-0001', templateId: 'jzk', code: 'JZK-AB12-CD34', confirmUnverified: undefined })
  })

  it('a sensitive message has no template and no send button: it can only be hidden with a label', async () => {
    vi.mocked(api.triageInbox).mockResolvedValue(triage([item({ kind: 'sensitive', reason: 'invoice, refund, complaint, legal or tax topic: needs Filip', template: null, canReply: false, subject: 'Faktura' })]))
    await mount()
    expect(host.textContent).toContain('FOR YOU ONLY')
    expect(host.querySelector('select')).toBeNull()
    expect(btn('Preview')).toBeUndefined()
    expect(btn('Approve and send')).toBeUndefined()
    await click(btn('Hide (label only)'))
    expect(api.skipMail).toHaveBeenCalledWith('msg-0001')
  })

  it('a server refusal is shown and the message stays', async () => {
    vi.mocked(api.triageInbox).mockResolvedValue(triage([item()]))
    vi.mocked(api.sendReply).mockRejectedValue(new Error('this message was already answered'))
    await mount()
    await click(btn('Preview'))
    await click(btn('Approve and send'))
    expect(host.textContent).toContain('this message was already answered')
    expect(host.querySelector('[data-testid="mail-item"]')).not.toBeNull()
  })

  it('an empty inbox says so, in English', async () => {
    vi.mocked(api.triageInbox).mockResolvedValue(triage([]))
    await mount()
    expect(host.textContent).toContain('Nothing is waiting for you in the inbox, sir.')
  })
})
