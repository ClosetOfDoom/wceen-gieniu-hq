// Web push "Brief gotowy" (09:00): one-time enable on the phone. The subscription goes to stanley-push (password).
import { stanleyFetch } from './stanleyAuth'

export type PushState = 'unsupported' | 'denied' | 'enabled' | 'available'

function keyBytes(base64url: string): Uint8Array {
  const pad = '='.repeat((4 - (base64url.length % 4)) % 4)
  const raw = atob((base64url + pad).replace(/-/g, '+').replace(/_/g, '/'))
  return Uint8Array.from(raw, (c) => c.charCodeAt(0))
}

export async function pushState(): Promise<PushState> {
  if (typeof window === 'undefined' || !('serviceWorker' in navigator) || !('PushManager' in window) || !('Notification' in window)) return 'unsupported'
  if (Notification.permission === 'denied') return 'denied'
  const reg = await navigator.serviceWorker.getRegistration()
  const sub = await reg?.pushManager.getSubscription()
  return sub && Notification.permission === 'granted' ? 'enabled' : 'available'
}

/** Asks for permission, subscribes with the server's VAPID key and stores the subscription. */
export async function enablePush(): Promise<PushState> {
  if ((await pushState()) === 'unsupported') return 'unsupported'
  const permission = await Notification.requestPermission()
  if (permission !== 'granted') return permission === 'denied' ? 'denied' : 'available'
  const keyRes = await stanleyFetch('/.netlify/functions/stanley-push')
  if (!keyRes.ok) throw new Error(`stanley-push ${keyRes.status}`)
  const { publicKey } = (await keyRes.json()) as { publicKey: string }
  const reg = await navigator.serviceWorker.ready
  const sub = (await reg.pushManager.getSubscription())
    ?? (await reg.pushManager.subscribe({ userVisibleOnly: true, applicationServerKey: keyBytes(publicKey) as BufferSource }))
  const res = await stanleyFetch('/.netlify/functions/stanley-push', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ action: 'subscribe', subscription: sub.toJSON() }),
  })
  if (!res.ok) throw new Error(`stanley-push ${res.status}`)
  return 'enabled'
}
