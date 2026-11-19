// Client of the webinar-mail-admin function (the "Maile webinarowe" tab).
// All calls go through stanleyFetch (shared password); nothing here can publish to the audience.

import { stanleyFetch } from '../lib/stanleyAuth'

export type MailSlot = 'tuesday' | 'thursday'

export interface MailAlert {
  severity: 'red' | 'amber'
  rule: string
  message: string
  runAt?: string
}

export interface QueueEntry {
  file: string
  subject: string
  blocked: string[]
  warnings: string[]
  used: boolean
}

export interface SlotQueue {
  slot: MailSlot
  label: string
  loadError: string | null
  readyCount: number
  blockedCount: number
  usedCount: number
  low: boolean
  empty: boolean
  nextVariant: string
  next: { file: string; subject: string; warnings: string[] } | null
  entries: QueueEntry[]
}

export interface SendRow {
  key: string
  date: string
  slot: MailSlot
  variant: string | null
  campaignId: string | null
  templateFile: string
  subject: string
  /** One of LOG_STATUSES (netlify/shared/webinarMailStatus.js); shown through sendStatusView, never compared by hand. */
  status: string
  /** A "Wyślij test" entry: listed under "Testy", never in the CTR / A/B statistics. */
  test?: boolean
  sendAt: string | null
  createdAt?: string | null
  error: string | null
  registrations: number | null
  delivered: number | null
  clicked: number | null
  /** Unique clickers / delivered, in percent. */
  ctr: number | null
}

export interface RunRecord {
  status: 'skipped' | 'failed' | 'scheduled' | 'dry-run'
  reason: string
  detail?: string
  key: string
  slot: MailSlot
  date: string
  at: string
  dryRun: boolean
  campaignId?: string
  plan?: { template: string; subject: string; variant: string; url: string; sendAt: string; readyBefore: number }
  checks?: { id: string; ok: boolean; detail: string }[]
  gates?: { id: string; reason: string }[]
  wouldPublish?: boolean
}

export interface WebinarMailStatus {
  now: string
  state: { auto: boolean; pause: boolean; ackedRunAt: string | null; autoChangedAt?: string | null; updatedAt: string | null }
  config: {
    wakeHour: number
    sendAtLocal: string
    lowQueueThreshold: number
    skipDates: string[]
    cron: string
    testRecipient: string
    testLeadMinutes: number
    slots: Record<MailSlot, { label: string; webinarTime: string; variants: Record<string, string> }>
  }
  nextWakeUp: { date: string; slot: MailSlot; at: string } | null
  queues: SlotQueue[]
  /** Production sends only. */
  log: SendRow[]
  /** Test publishes ("Wyślij test"), newest first. Missing in responses of builds before T1. */
  tests?: SendRow[]
  statsError: string | null
  lastRun: RunRecord | null
  lastDryRun: RunRecord | null
  alerts: MailAlert[]
}

const URL = '/.netlify/functions/webinar-mail-admin'

async function parse<T>(res: Response): Promise<T> {
  const text = await res.text()
  let body: unknown = null
  try { body = JSON.parse(text) } catch { /* not JSON */ }
  if (!res.ok) {
    const msg = (body as { error?: string } | null)?.error
    throw new Error(msg ? `HTTP ${res.status}: ${msg}` : `HTTP ${res.status}`)
  }
  return body as T
}

export async function fetchWebinarMailStatus(): Promise<WebinarMailStatus> {
  return parse<WebinarMailStatus>(await stanleyFetch(URL, { cache: 'no-store' }))
}

async function post<T>(body: Record<string, unknown>): Promise<T> {
  return parse<T>(await stanleyFetch(URL, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) }))
}

export const setMailState = (patch: { auto?: boolean; pause?: boolean }) => post<{ ok: true }>({ action: 'set-state', ...patch })
export const ackMailFailure = () => post<{ ok: true }>({ action: 'ack' })
export const setRegistrations = (key: string, value: number | null) => post<{ ok: true }>({ action: 'set-registrations', key, value })
export const dryRunSlot = (slot: MailSlot) => post<{ ok: true; outcome: RunRecord }>({ action: 'dry-run', slot })
/** "Wyślij test": the same Create + Publish as production, to the one test contact, sendAt now + testLeadMinutes. */
export const sendTestMail = (slot: MailSlot) =>
  post<{ ok: true; test: true; template: string; subject: string; variant: string; campaignId: string; sendAt: string; to: string }>({ action: 'send-test', slot })
