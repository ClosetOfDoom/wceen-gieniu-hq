import type { PublisherClient, PlanResult, StatusResult } from './publisherClient.js'

export const PENDING_TTL_MS: number
export const MAX_TOOL_CALLS: number
export const MAX_ACTIONS_PER_CONFIRMATION: number
export const PUBLISHER_RULES: string
export const PUBLISHER_TOOLS: { name: string; description: string; input_schema: Record<string, unknown> }[]

export function isAffirmation(message: string): boolean
export function isNegation(message: string): boolean
export function resetWordsCache(): void
export function publisherTurn(
  message: string,
  opts?: { pending?: string | null; env?: Record<string, string | undefined>; now?: Date; deps?: { client?: PublisherClient } },
): Promise<'confirm' | 'cancel' | 'question' | null>

export interface PendingAction { action: string; params: Record<string, unknown>; labels?: Record<string, string> }
export function signPending(payload: { actions: PendingAction[] }, secret: string, now?: number): string
export function verifyPending(token: string | null | undefined, secret: string | undefined, now?: number): { actions: PendingAction[]; t: number } | null

export function resolvePost(client: PublisherClient, ref: string, now: Date): Promise<{ post: string; label: string } | { error: string }>
export interface TurnState {
  plan: { range: { label: string }; plan: PlanResult } | null
  status: StatusResult | null
  proposals: { action: string; params: Record<string, unknown>; labels: Record<string, string>; result: unknown }[]
  refusals: string[]
  apiFailure: { code: number | string } | null
}
export function makeExecutor(args: { client: PublisherClient; now: Date; state: TurnState }): (name: string, args: Record<string, unknown>) => Promise<Record<string, unknown>>

export function renderPlan(input: { range: { label: string }; plan: PlanResult }): string
export function queueEndLine(status: StatusResult | null | undefined): string | null
export function renderChange(item: { result: unknown; labels?: Record<string, string> }, opts?: { executed?: boolean }): string

export interface PublisherBody {
  answerText: string
  speechText: string
  intent: string
  confidence: number
  dataSourcesUsed: string[]
  warnings: string[]
  llmUsed: boolean
  llmProvider: string | null
  pendingPublisher: string | null
}
export function answerPublisher(args: {
  turn: 'confirm' | 'cancel' | 'question'
  message: string
  systemPrompt: string
  parse: (raw: string) => { answerText: string; speechText: string }
  pendingToken?: string | null
  env?: Record<string, string | undefined>
  now?: Date
  deps?: { client?: PublisherClient; createMessage?: (body: any, opts?: any) => Promise<any> }
}): Promise<PublisherBody>
