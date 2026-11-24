// Web push "Brief gotowy": VAPID generated once and kept in Blobs, ES256 JWT that verifies, subscriptions, gone ones removed.
import { describe, it, expect, vi } from 'vitest'
import { createPublicKey, verify } from 'node:crypto'
import { readFileSync } from 'node:fs'
import { generateVapid, getVapid, vapidJwt, saveSubscription, listSubscriptions, notifyBriefReady } from '../netlify/shared/stanleyPush.js'
import { createMemoryKv } from '../netlify/shared/webinarMailStore.js'

const b64 = (s: string) => Buffer.from(s.replace(/-/g, '+').replace(/_/g, '/'), 'base64')
const SUB = (n: number) => ({ endpoint: `https://fcm.googleapis.com/fcm/send/abc${n}`, keys: { p256dh: 'BPx', auth: 'au' } })

describe('VAPID', () => {
  it('P-256 public key, 65 bytes uncompressed; generated once, then read back', async () => {
    const v = generateVapid()
    expect(b64(v.publicKey)).toHaveLength(65)
    expect(b64(v.publicKey)[0]).toBe(4)
    const kv = createMemoryKv()
    const a = await getVapid(kv)
    const b = await getVapid(kv)
    expect(b.publicKey).toBe(a.publicKey)
  })

  it('the JWT is ES256, verifies with the public key, aud = push origin, sub = site URL (no e-mail)', () => {
    const v = generateVapid()
    const now = new Date('2026-11-25T08:00:00Z')
    const jwt = vapidJwt('https://fcm.googleapis.com', v.privateJwk, now)
    const [h, p, s] = jwt.split('.')
    expect(JSON.parse(b64(h).toString())).toEqual({ typ: 'JWT', alg: 'ES256' })
    const payload = JSON.parse(b64(p).toString())
    expect(payload).toMatchObject({ aud: 'https://fcm.googleapis.com', exp: Math.floor(now.getTime() / 1000) + 43200 })
    expect(payload.sub).toMatch(/^https:\/\//)
    const raw = b64(v.publicKey)
    const pub = createPublicKey({ key: { kty: 'EC', crv: 'P-256', x: raw.subarray(1, 33).toString('base64url'), y: raw.subarray(33).toString('base64url') }, format: 'jwk' })
    expect(verify('sha256', Buffer.from(`${h}.${p}`), { key: pub, dsaEncoding: 'ieee-p1363' }, b64(s))).toBe(true)
  })
})

describe('subscriptions and sending', () => {
  it('stores only https subscriptions with keys; same endpoint = one entry', async () => {
    const kv = createMemoryKv()
    await saveSubscription(kv, SUB(1)); await saveSubscription(kv, SUB(1))
    expect(await listSubscriptions(kv)).toHaveLength(1)
    await expect(saveSubscription(kv, { endpoint: 'http://x', keys: { p256dh: 'a', auth: 'b' } })).rejects.toThrow(/https/)
    await expect(saveSubscription(kv, { endpoint: 'https://x' })).rejects.toThrow(/kluczy/)
  })

  it('payload-less POST with vapid auth and TTL; 201 sent, 410 removed, 500 failed', async () => {
    const kv = createMemoryKv()
    for (const n of [1, 2, 3]) await saveSubscription(kv, SUB(n))
    const seen: { url: string; headers: Record<string, string>; body: unknown }[] = []
    const fetchImpl = vi.fn(async (url: string, init: RequestInit) => {
      seen.push({ url, headers: init.headers as Record<string, string>, body: init.body })
      return new Response(null, { status: url.endsWith('abc1') ? 201 : url.endsWith('abc2') ? 410 : 500 })
    }) as unknown as typeof fetch
    expect(await notifyBriefReady(kv, null, { fetchImpl })).toEqual({ subscriptions: 3, sent: 1, removed: 1, failed: 1 })
    expect(await listSubscriptions(kv)).toHaveLength(2)
    expect(seen[0].headers.Authorization).toMatch(/^vapid t=[\w-]+\.[\w-]+\.[\w-]+, k=[\w-]{87}$/)
    expect(seen[0].headers.TTL).toBe('21600')
    expect(seen[0].body).toBeUndefined()
  })

  it('no subscriptions → nothing sent, no key needed', async () => {
    expect(await notifyBriefReady(createMemoryKv(), null)).toEqual({ subscriptions: 0, sent: 0, removed: 0, failed: 0 })
  })

  it('the service worker shows "Brief gotowy" and opens HOME; Workbox imports it; daily-brief notifies after saving', () => {
    const sw = readFileSync('public/push-sw.js', 'utf8')
    expect(sw).toContain("showNotification('Brief gotowy'")
    expect(sw).toContain("data: { url: '/' }")
    expect(readFileSync('vite.config.ts', 'utf8')).toContain("importScripts: ['push-sw.js']")
    expect(readFileSync('netlify/functions/daily-brief.js', 'utf8')).toContain('notify: (brief) => notifyBriefReady(deps.kv, brief)')
  })
})
