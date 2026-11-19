import type { MailStoreLike } from './webinarMail.js'

export const DEFAULT_STATE: Readonly<{ auto: boolean; pause: boolean; ackedRunAt: string | null; updatedAt: string | null }>
export function createBlobStore(blobStore?: unknown): MailStoreLike
export function createMemoryStore(seed?: Record<string, unknown>): MailStoreLike
