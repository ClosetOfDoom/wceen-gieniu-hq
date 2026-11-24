export class PublisherError extends Error {
  code: number | string
  validation: boolean
  constructor(code: number | string, message: string, validation?: boolean)
}

export interface PlanEntry {
  post: string
  data_warszawa: string
  termin_utc: string
  dzien: string
  slowo: string
  jezyk: string
  wstrzymany: boolean
  platformy: Record<string, { status: string; etykieta: string; blad: string | null }>
  permalinki: Record<string, string | null>
}
export interface PlanResult { od: string; do: string; liczba: number; wpisy: PlanEntry[] }
export interface ChangeResult {
  ok: true
  dry_run: boolean
  zmieniono: boolean
  zmiany: { post: string; z: string | null; na: string | null }[]
  ostrzezenia: string[]
}
export interface StatusResult {
  tryb: 'START' | 'PAUZA'
  zapasDoWarszawa: string | null
  wKolejce: number
  ostrzezenia: unknown[]
  bledy: unknown[]
  teraz: string
  [k: string]: unknown
}
export interface PublisherClient {
  plan(args?: { od?: string; do?: string }): Promise<PlanResult>
  status(): Promise<StatusResult>
  change(action: string, params: Record<string, unknown>, opts: { dryRun: boolean }): Promise<ChangeResult>
}

export function zewnUrl(base: string): string
export function publisherConfigFromEnv(env?: Record<string, string | undefined>): { token: string; url: string }
export function createPublisherClient(opts: { url: string; token: string; fetchImpl?: typeof fetch; timeoutMs?: number }): PublisherClient
