import type { SlotName, WebinarMailConfig } from './webinarMailConfig.js'
import type { RunDeps, RunOutcome } from './webinarMail.js'

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
}
export function healthSummary(args: { deps: Pick<RunDeps, 'store' | 'loadTemplates'>; build: string; now?: Date; config?: WebinarMailConfig }): Promise<HealthSummary>
