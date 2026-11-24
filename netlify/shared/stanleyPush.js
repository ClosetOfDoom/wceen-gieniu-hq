// stanleyPush.js — web push "Brief gotowy" at 09:00, no environment variables.
//
// VAPID: an EC P-256 key pair generated on first use and kept in Blobs (push/vapid, store "stanley"); the public key goes to
// the browser (stanley-push GET), the private key never leaves the store. Subscriptions: push/sub/<sha256(endpoint)>.
// The push carries NO payload (so no payload encryption is needed): the service worker (public/push-sw.js) shows the fixed
// notification "Brief gotowy" and opens HOME on click. A subscription that the push service reports gone (404 / 410) is deleted.
// The VAPID "sub" claim is the site URL, not an e-mail address.

import { createHash, generateKeyPairSync, createPrivateKey, sign } from 'node:crypto'
import { DEFAULT_APP_ORIGIN } from './auth.js'

const b64url = (buf) => Buffer.from(buf).toString('base64').replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '')
const fromB64url = (s) => Buffer.from(String(s).replace(/-/g, '+').replace(/_/g, '/'), 'base64')

export function generateVapid() {
  const { privateKey, publicKey } = generateKeyPairSync('ec', { namedCurve: 'prime256v1' })
  const pub = publicKey.export({ format: 'jwk' })
  const priv = privateKey.export({ format: 'jwk' })
  return { publicKey: b64url(Buffer.concat([Buffer.from([4]), fromB64url(pub.x), fromB64url(pub.y)])), privateJwk: priv, createdAt: new Date().toISOString() }
}

/** The stored key pair, generated (once, race-safe) when missing. */
export async function getVapid(kv) {
  const cur = await kv.getJSON('push/vapid')
  if (cur?.publicKey && cur?.privateJwk) return cur
  await kv.setJSONIfNew('push/vapid', generateVapid())
  return kv.getJSON('push/vapid')
}

/** ES256 JWT for one push service origin, valid 12 h. */
export function vapidJwt(audience, privateJwk, now = new Date(), subject = DEFAULT_APP_ORIGIN) {
  const header = b64url(JSON.stringify({ typ: 'JWT', alg: 'ES256' }))
  const payload = b64url(JSON.stringify({ aud: audience, exp: Math.floor(now.getTime() / 1000) + 12 * 3600, sub: subject }))
  const key = createPrivateKey({ key: privateJwk, format: 'jwk' })
  const sig = sign('sha256', Buffer.from(`${header}.${payload}`), { key, dsaEncoding: 'ieee-p1363' })
  return `${header}.${payload}.${b64url(sig)}`
}

const subKey = (endpoint) => `push/sub/${createHash('sha256').update(String(endpoint)).digest('hex').slice(0, 32)}`

/** Saves a PushSubscription JSON ({ endpoint, keys: { p256dh, auth } }); only https endpoints. */
export async function saveSubscription(kv, sub, now = new Date()) {
  const endpoint = String(sub?.endpoint ?? '')
  let url
  try { url = new URL(endpoint) } catch { throw new Error('subskrypcja bez poprawnego endpoint') }
  if (url.protocol !== 'https:') throw new Error('endpoint musi być https')
  if (!sub?.keys?.p256dh || !sub?.keys?.auth) throw new Error('subskrypcja bez kluczy p256dh / auth')
  const key = subKey(endpoint)
  await kv.setJSON(key, { endpoint, keys: { p256dh: String(sub.keys.p256dh), auth: String(sub.keys.auth) }, createdAt: now.toISOString() })
  return key
}

export async function listSubscriptions(kv) {
  const keys = await kv.list('push/sub/')
  return (await Promise.all(keys.map(async (k) => ({ key: k, sub: await kv.getJSON(k) })))).filter((x) => x.sub)
}

/** One payload-less push. Returns the HTTP status of the push service. */
export async function sendPush(sub, vapid, { fetchImpl = fetch, now = new Date(), ttl = 6 * 3600 } = {}) {
  const audience = new URL(sub.endpoint).origin
  const res = await fetchImpl(sub.endpoint, {
    method: 'POST',
    headers: { Authorization: `vapid t=${vapidJwt(audience, vapid.privateJwk, now)}, k=${vapid.publicKey}`, TTL: String(ttl), Urgency: 'normal', 'Content-Length': '0' },
    signal: AbortSignal.timeout(10000),
  })
  return res.status
}

/** "Brief gotowy" to every subscription: { subscriptions, sent, removed, failed }. */
export async function notifyBriefReady(kv, _brief, opts = {}) {
  const subs = await listSubscriptions(kv)
  if (!subs.length) return { subscriptions: 0, sent: 0, removed: 0, failed: 0 }
  const vapid = await getVapid(kv)
  let sent = 0, removed = 0, failed = 0
  for (const { key, sub } of subs) {
    try {
      const status = await sendPush(sub, vapid, opts)
      if (status >= 200 && status < 300) sent++
      else if (status === 404 || status === 410) { await kv.delete(key); removed++ }
      else failed++
    } catch {
      failed++
    }
  }
  return { subscriptions: subs.length, sent, removed, failed }
}
