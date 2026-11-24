import type { SlotName, WebinarMailConfig } from './webinarMailConfig.js'
import type { RunDeps, RunOutcome, WixLike } from './webinarMail.js'

export function adminStatus(args: { deps: RunDeps; now?: Date; config?: WebinarMailConfig }): Promise<Record<string, any>>
export function nextWakeInstantOfSlot(slot: SlotName, now: Date, config?: WebinarMailConfig): Date
export function adminAction(args: {
  action: string
  body: Record<string, unknown>
  deps: RunDeps
  now?: Date
  config?: WebinarMailConfig
}): Promise<{ ok: boolean; error?: string; outcome?: RunOutcome; [k: string]: unknown }>
export function nextPlannedSend(now: Date, config?: WebinarMailConfig): Date | null
export interface HealthSummary {
  build: string
  blobsRead: 'ok' | 'error'
  auto: boolean | null
  pauza: boolean | null
  kolejka: { wtorek: number | null; czwartek: number | null }
  nastepnaWysylka: string | null
  /** Codes of the alerts active now (same rules as the MAILE tab). */
  alarmy: string[] | null
  /** The 5 newest log entries, without campaign IDs, subjects or e-mails. */
  ostatnieWpisy: { data: string; slot: string; status: 'zaplanowany' | 'wysłany' | 'błąd' | 'nieznany'; test: boolean }[] | null
  /** Sender NAME per slot (config). */
  nadawcy: { wtorek: string; czwartek: string }
  /** Sender NAME in Wix now; null when it cannot be read. Never an address. */
  aktualnyNadawca: string | null
  /** Name of the production recipient selection (config). */
  odbiorcy: string
  /** E-mail subscribers in Wix now; null when it cannot be read. */
  liczbaOdbiorcow: number | null
}
export function healthSummary(args: { deps: Pick<RunDeps, 'store' | 'loadTemplates'> & { wix?: Pick<WixLike, 'getSenderName' | 'countEmailSubscribers'> | null }; build: string; now?: Date; config?: WebinarMailConfig }): Promise<HealthSummary>
