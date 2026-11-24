import type { KvStore } from './webinarMailStore.js'
export interface Vapid { publicKey: string; privateJwk: Record<string, string>; createdAt: string }
export function generateVapid(): Vapid
export function getVapid(kv: KvStore): Promise<Vapid>
export function vapidJwt(audience: string, privateJwk: Record<string, string>, now?: Date, subject?: string): string
export function saveSubscription(kv: KvStore, sub: unknown, now?: Date): Promise<string>
export function listSubscriptions(kv: KvStore): Promise<{ key: string; sub: { endpoint: string; keys: { p256dh: string; auth: string } } }[]>
export function sendPush(sub: { endpoint: string }, vapid: Vapid, opts?: { fetchImpl?: typeof fetch; now?: Date; ttl?: number }): Promise<number>
export function notifyBriefReady(kv: KvStore, brief: unknown, opts?: { fetchImpl?: typeof fetch; now?: Date }): Promise<{ subscriptions: number; sent: number; removed: number; failed: number }>
