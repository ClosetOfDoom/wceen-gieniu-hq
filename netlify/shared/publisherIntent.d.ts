export function norm(s: unknown): string
export function wordCount(s: string): number
export function looksLikeDatePhrase(message: string): boolean
export function isAffirmation(message: string): boolean
export function isNegation(message: string): boolean
export function hasPublisherKeyword(message: string): boolean
export function startsWithPublisherVerb(message: string): boolean
export function mayBePublisherTurn(message: string, open?: boolean): boolean
