export type LogStatus = 'scheduled' | 'failed' | 'test' | 'test-failed'
export const LOG_STATUS: {
  readonly SCHEDULED: 'scheduled'
  readonly FAILED: 'failed'
  readonly TEST: 'test'
  readonly TEST_FAILED: 'test-failed'
}
export const LOG_STATUSES: readonly LogStatus[]

export type StatusViewCode = 'zaplanowany' | 'wysłany' | 'błąd' | 'nieznany'
export const STATUS_VIEW: {
  readonly ZAPLANOWANY: 'zaplanowany'
  readonly WYSLANY: 'wysłany'
  readonly BLAD: 'błąd'
  readonly NIEZNANY: 'nieznany'
}

export interface StatusEntryLike {
  key?: string
  status?: string
  test?: boolean
  dryRun?: boolean
  sendAt?: string | null
}
export interface StatusView { code: StatusViewCode; label: string; tone: 'ok' | 'pending' | 'error' | 'muted'; test: boolean }

export function isTestEntry(e: StatusEntryLike | null | undefined): boolean
export function isProductionSend(e: StatusEntryLike | null | undefined): boolean
export function sendStatusView(e: StatusEntryLike, now?: Date): StatusView
