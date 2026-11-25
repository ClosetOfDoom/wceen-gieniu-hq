// Client of the mail-admin function (the "Mail" tab): Google connection, inbox triage, approved template replies.
// Everything goes through stanleyFetch (shared password). The browser sends a message id and a template id, never an address or a text.

import { stanleyFetch } from '../lib/stanleyAuth'

export type MailKind = 'access-request' | 'human' | 'sensitive'
export type BuyerStatus = 'verified' | 'unverified' | 'unknown' | 'n/a'

export interface MailStatus {
  configured: boolean
  connected: boolean
  invalid: boolean
  email: string | null
  connectedAt: string | null
}

export interface TemplateInfo { id: string; label: string; needsCode: boolean; subject: string }

export interface InboxItem {
  id: string
  kind: MailKind
  reason: string
  fromName: string
  from: string
  to: string
  toMasked: string
  subject: string
  snippet: string
  date: string | null
  template: string | null
  confidence: 'high' | 'low' | 'none'
  candidates: string[]
  buyer: { status: BuyerStatus; orders: Array<{ date: string | null; product: string }> }
  canReply: boolean
}

export interface Triage {
  counts: { scanned: number; automated: number; protected: number; sensitive: number; access: number; human: number }
  items: InboxItem[]
  oldest: string | null
  templates: TemplateInfo[]
}

export interface Preview { id: string; subject: string; plain: string; html: string; needsCode: boolean; codeReady: boolean }

const URL = '/.netlify/functions/mail-admin'

async function parse<T>(res: Response): Promise<T> {
  const text = await res.text()
  let body: unknown = null
  try { body = JSON.parse(text) } catch { /* not JSON */ }
  if (!res.ok) {
    const msg = (body as { error?: string } | null)?.error
    throw new Error(msg ? msg : `HTTP ${res.status}`)
  }
  return body as T
}

const post = async <T,>(body: Record<string, unknown>): Promise<T> =>
  parse<T>(await stanleyFetch(URL, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) }))

export const fetchMailStatus = async (): Promise<MailStatus> => parse<MailStatus>(await stanleyFetch(URL, { cache: 'no-store' }))
export const connectGoogleUrl = () => post<{ url: string; redirectUri: string }>({ action: 'connect-url' })
export const disconnectGoogle = () => post<{ ok: true }>({ action: 'disconnect' })
export const triageInbox = () => post<Triage>({ action: 'triage' })
export const previewReply = (templateId: string, code?: string) => post<Preview>({ action: 'preview', templateId, code })
export const skipMail = (messageId: string) => post<{ skipped: true }>({ action: 'skip', messageId })
export const sendReply = (p: { messageId: string; templateId: string; code?: string; confirmUnverified?: boolean }) =>
  post<{ sent: true; sentId: string | null; templateId: string; buyer: BuyerStatus; labelError: string | null }>({ action: 'send', ...p })
