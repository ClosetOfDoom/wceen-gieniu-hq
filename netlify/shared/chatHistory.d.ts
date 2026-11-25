export interface ChatMessage { role: 'user' | 'assistant'; content: string; intent?: string | null; at?: number | null }

export const HISTORY_MAX_MESSAGES: number
export const HISTORY_MAX_CHARS: number
export const HISTORY_WINDOW_MS: number
export const PUBLISHER_FOLLOWUP_MS: number
export function sanitizeHistory(raw: unknown, nowMs?: number): ChatMessage[]
export function formatHistory(history: ChatMessage[]): string
export function toMessages(history: ChatMessage[], userMessage: string): { role: 'user' | 'assistant'; content: string }[]
export function inPublisherConversation(history: ChatMessage[], nowMs?: number): boolean
