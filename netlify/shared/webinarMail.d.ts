import type { SlotName, WebinarMailConfig } from './webinarMailConfig.js'

export const SLOT_NAMES: readonly SlotName[]

export interface WarsawParts { date: string; hour: number; minute: number; weekday: number }
export function warsawParts(instant: Date): WarsawParts
export function warsawLocalToUtc(date: string, hhmm: string): Date
export function slotForWeekday(weekday: number, config?: WebinarMailConfig): SlotName | null
export function nextWakeUp(now: Date, config?: WebinarMailConfig): { date: string; slot: SlotName; at: Date } | null

export interface SubjectCheck { blocked: string[]; warnings: string[] }
export function validateSubject(subject: unknown): SubjectCheck
export function escapeHtml(text: string): string
export function parseTemplate(html: string): { subject: string; preheader: string }

export interface TemplateCheck { file: string; subject: string; preheader: string; blocked: string[]; warnings: string[] }
export function validateTemplate(file: string, html: string, config?: WebinarMailConfig): TemplateCheck
export function unresolvedTags(html: string): string[]
export function renderCampaignHtml(html: string, url: string, config?: WebinarMailConfig): { html: string; unresolved: string[] }

export interface TemplateFile { file: string; html: string }
export interface LogEntry {
  key: string
  date: string
  slot: SlotName
  variant?: string | null
  url?: string
  campaignId?: string | null
  templateFile: string
  subject: string
  sendAt?: string | null
  status: string
  error?: string | null
  createdAt?: string
  dryRun?: boolean
  /** true for "Wyślij test" entries: never use a template up, never count for the link variant. */
  test?: boolean
  registrations?: number | null
  /** Sender name of the slot: was it set and confirmed before the publish (no e-mail address). */
  sender?: { expected: string; ok: boolean; error?: string } | null
  /** Number of e-mail subscribers the production publish went to. */
  recipients?: number | null
}
export interface QueueEntryCheck extends TemplateCheck { used: boolean }
export interface Queue {
  slot: SlotName
  entries: QueueEntryCheck[]
  next: QueueEntryCheck | null
  readyCount: number
  blockedCount: number
  usedCount: number
  empty: boolean
  low: boolean
}
export function buildQueue(slot: SlotName, templates: TemplateFile[], log: LogEntry[], config?: WebinarMailConfig): Queue
export function nextVariant(slot: SlotName, log: LogEntry[], config?: WebinarMailConfig): string

export interface SafeguardCheck { id: string; ok: boolean; detail: string }
export function evaluateSafeguards(ctx: {
  account?: { status?: string } | null
  subject: string
  link?: { status?: number; error?: string } | null
  sendsToday?: { campaignId: string }[]
  state?: { pause?: boolean } | null
  sendAt: Date
  now: Date
  unresolved?: string[]
}, config?: WebinarMailConfig): SafeguardCheck[]

export interface MailAudience {
  readonly labelIds?: readonly string[]
  readonly contactIds?: readonly string[]
  readonly segmentIds?: readonly string[]
  readonly activeContactsOnly?: boolean
}
export const PRODUCTION_SELECTION: 'subskrybenci-email'
export interface ResolvedAudience { audience: MailAudience; count: number; total: number; name: string }
export function resolveProductionAudience(wix: WixLike, config?: WebinarMailConfig): Promise<ResolvedAudience>
export function assertProductionAudience(audience: unknown, config?: WebinarMailConfig): true
export function evaluateRecipients(resolved: { count?: number; total?: number; name?: string; error?: string } | null, baseline: number | null, config?: WebinarMailConfig): SafeguardCheck
export function recipientsBaseline(store: Partial<MailStoreLike> | null | undefined, config?: WebinarMailConfig): Promise<number>
export function testAudience(config?: WebinarMailConfig): MailAudience
export function assertTestAudience(audience: unknown, config?: WebinarMailConfig): true
export function testSendAt(now: Date, config?: WebinarMailConfig): Date
export interface SenderResult { expected: string; ok: boolean; error?: string }
export function ensureSenderName(wix: WixLike, fromName: string | undefined): Promise<SenderResult>
export function createAndPublish(args: { wix: WixLike; subject: string; preheader?: string; html: string; sendAt: string; audience: MailAudience; fromName?: string; test?: boolean }, config?: WebinarMailConfig): Promise<{ campaignId: string; sender: SenderResult }>

export interface WixLike {
  accountDetails(): Promise<{ status?: string }>
  listRecentCampaigns(): Promise<{ campaignId: string; distributionStatus?: string; datePublished?: string | null; emailSubject?: string }[]>
  previewCampaign(id: string): Promise<{ html: string; emailSubject?: string }>
  createCampaign(input: { subject: string; preheader?: string; html: string }): Promise<string>
  publishCampaign(id: string, input: { subject: string; sendAt: string; audience: MailAudience }): Promise<unknown>
  getCampaign(id: string): Promise<{ campaignId: string; distributionStatus: string | null; visibilityStatus: string | null; datePublished: string | null; mailsSent: number | null; delivered: number | null }>
  deleteCampaign(id: string): Promise<unknown>
  campaignStats(ids: string[]): Promise<Record<string, { delivered: number; opened: number; clicked: number; bounced?: number }>>
  getSenderName?(): Promise<string | null>
  setSenderName?(fromName: string): Promise<{ fromName: string; changed: boolean }>
  /** IDs of every contact whose primary e-mail is SUBSCRIBED, and the total Wix reports for that filter. */
  listEmailSubscriberIds?(): Promise<{ ids: string[]; total: number }>
  countEmailSubscribers?(): Promise<number>
}
export function findSendsToday(args: { slot: SlotName; today: string; wix: WixLike; knownIds?: string[] }, config?: WebinarMailConfig): Promise<{ campaignId: string }[]>

export interface RunOutcome {
  status: 'skipped' | 'failed' | 'scheduled' | 'dry-run'
  reason: string
  detail?: string
  key?: string
  slot?: SlotName
  date: string
  at?: string
  dryRun?: boolean
  campaignId?: string
  plan?: { template: string; subject: string; variant: string; url: string; sendAt: string; readyBefore: number; odbiorcy?: string; liczbaOdbiorcow?: number | null; limitOdbiorcow?: number }
  checks?: SafeguardCheck[]
  gates?: { id: string; reason: string }[]
  wouldPublish?: boolean
  readyAfter?: number
  storeError?: string
  sender?: SenderResult | null
}

export interface MailStoreLike {
  getState(): Promise<{ auto: boolean; pause: boolean; ackedRunAt: string | null; autoChangedAt?: string | null; updatedAt: string | null }>
  setState(patch: Record<string, unknown>): Promise<unknown>
  getLog(): Promise<LogEntry[]>
  addLog(entry: LogEntry): Promise<void>
  claim(key: string): Promise<boolean>
  getRun(key: string): Promise<RunOutcome | null>
  setRun(key: string, record: RunOutcome): Promise<void>
  getLastRun(): Promise<RunOutcome | null>
  setLastRun(record: RunOutcome): Promise<void>
  getLastDryRun(): Promise<RunOutcome | null>
  setLastDryRun(record: RunOutcome): Promise<void>
  setRegistrations(key: string, value: number | null): Promise<void>
  getRecipients?(): Promise<{ count: number; at: string } | null>
  setRecipients?(value: { count: number; at: string }): Promise<void>
}

export interface RunDeps {
  store: MailStoreLike
  wix: WixLike
  loadTemplates(slot: SlotName): Promise<TemplateFile[]>
  checkUrl(url: string): Promise<{ status: number; finalUrl?: string }>
}
export function runWebinarMail(args: { now: Date; deps: RunDeps; dryRun?: boolean; force?: boolean; config?: WebinarMailConfig }): Promise<RunOutcome>

export function ctrOf(stats: { delivered?: number; clicked?: number } | null | undefined): number | null
export function autoOnBeforeRun(state: { autoChangedAt?: string | null } | null | undefined, date: string, config?: WebinarMailConfig): boolean
export interface MailAlertResult { severity: 'red' | 'amber'; rule: string; message: string; runAt?: string }
export function buildAlerts(args: {
  state: { auto: boolean; pause: boolean; ackedRunAt?: string | null; autoChangedAt?: string | null }
  lastRun: RunOutcome | null
  runToday: RunOutcome | null
  queues: { slot: SlotName; empty: boolean; low: boolean; readyCount: number }[]
  now: Date
  log?: LogEntry[]
}, config?: WebinarMailConfig): MailAlertResult[]
