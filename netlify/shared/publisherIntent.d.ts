export function norm(s: unknown): string
export function isAffirmation(message: string): boolean
export function isNegation(message: string): boolean
export function hasPublisherKeyword(message: string): boolean
export function startsWithPublisherVerb(message: string): boolean
export function mayBePublisherTurn(message: string, hasPending: boolean): boolean
