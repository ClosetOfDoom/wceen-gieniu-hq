import type { MailStoreLike } from './webinarMail.js'

export const DEFAULT_STATE: Readonly<{ auto: boolean; pause: boolean; ackedRunAt: string | null; updatedAt: string | null }>
export function createBlobStore(blobStore?: unknown): MailStoreLike
export function createMemoryStore(seed?: Record<string, unknown>): MailStoreLike
export interface KvStore {
  getJSON<T = any>(key: string): Promise<T | null>
  setJSON(key: string, value: unknown): Promise<void>
  setJSONIfNew(key: string, value: unknown): Promise<boolean>
  delete(key: string): Promise<void>
  list(prefix: string): Promise<string[]>
}
export function createKvStore(name?: string, blobStore?: unknown): KvStore
export function createMemoryKv(seed?: Record<string, unknown>): KvStore
