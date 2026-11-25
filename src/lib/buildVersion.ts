// buildVersion.ts — the app updates itself; nobody has to "Unregister SW + clear cache" by hand.
//
// The service worker already takes over at once (workbox skipWaiting + clientsClaim in vite.config.ts). On top of
// that, at start and whenever the tab becomes visible again, the app reads /version.json (written by `vite build`,
// served no-store, never precached) and compares the server's build hash with its own (__BUILD_HASH__).
// On a mismatch it asks the SW to update and reloads ONCE. The loop guard is per tab (sessionStorage): it remembers
// the server hash it already reloaded for, so a reload that still comes up old (e.g. a CDN lag) does not reload again.
// Without working storage it never reloads (a reload it cannot remember could loop).

import { isSpeaking } from './speechGate'

export const RELOAD_GUARD_KEY = 'stanley.reloadedForBuild'

export type ReloadDecision = 'none' | 'reload'

/** Pure: should the app reload? */
export function decideReload({ local, server, reloadedFor }: { local: string; server: string | null; reloadedFor: string | null }): ReloadDecision {
  if (!server || server === 'unknown' || !local || local === 'dev') return 'none'
  if (server === local) return 'none'
  if (reloadedFor === server) return 'none'   // already reloaded once for this server build: no loop
  return 'reload'
}

export interface BuildCheckDeps {
  fetchVersion: () => Promise<string | null>
  storage: Pick<Storage, 'getItem' | 'setItem' | 'removeItem'> | null
  updateServiceWorker: () => Promise<void>
  reload: () => void
  /** True while Stanley is speaking: a reload then would cut his voice off mid-sentence, so it waits. */
  isBusy?: () => boolean
}

/** One check: returns what it did ('busy' = an update is waiting for Stanley to finish speaking). */
export async function checkBuild(local: string, deps: BuildCheckDeps): Promise<'same' | 'reloaded' | 'skipped' | 'error' | 'busy'> {
  let server: string | null
  try { server = await deps.fetchVersion() } catch { return 'error' }
  if (!server) return 'error'
  let reloadedFor: string | null = null
  try {
    if (!deps.storage) return server === local ? 'same' : 'skipped'
    if (server === local) { deps.storage.removeItem(RELOAD_GUARD_KEY); return 'same' }
    reloadedFor = deps.storage.getItem(RELOAD_GUARD_KEY)
  } catch {
    return server === local ? 'same' : 'skipped'
  }
  if (decideReload({ local, server, reloadedFor }) !== 'reload') return 'skipped'
  if (deps.isBusy?.()) return 'busy'   // before the guard is written: the reload still happens, just not now
  try { deps.storage.setItem(RELOAD_GUARD_KEY, server) } catch { return 'skipped' }   // cannot remember → no reload
  try { await deps.updateServiceWorker() } catch { /* reload anyway: the network has the new index */ }
  deps.reload()
  return 'reloaded'
}

/** Browser wiring: real fetch, sessionStorage, the SW registration, location.reload. */
export function browserBuildCheckDeps(): BuildCheckDeps {
  let storage: BuildCheckDeps['storage'] = null
  try { storage = window.sessionStorage; storage.getItem(RELOAD_GUARD_KEY) } catch { storage = null }
  return {
    storage,
    async fetchVersion() {
      const res = await fetch(`/version.json?t=${Date.now()}`, { cache: 'no-store' })
      if (!res.ok) return null
      const v = await res.json() as { build?: unknown }
      return typeof v.build === 'string' && v.build ? v.build : null
    },
    async updateServiceWorker() {
      if (!('serviceWorker' in navigator)) return
      const reg = await navigator.serviceWorker.getRegistration()
      if (!reg) return
      await reg.update()
      // New SW with skipWaiting + clientsClaim takes control; wait for that briefly, never forever.
      if (reg.installing || reg.waiting) {
        await new Promise<void>((resolve) => {
          const t = setTimeout(resolve, 3000)
          navigator.serviceWorker.addEventListener('controllerchange', () => { clearTimeout(t); resolve() }, { once: true })
        })
      }
    },
    reload: () => window.location.reload(),
    isBusy: () => isSpeaking(),
  }
}

/** Check at start and on every return to the tab. Returns a cleanup. */
export function installBuildWatcher(local: string, deps: BuildCheckDeps = browserBuildCheckDeps()): () => void {
  let running = false
  let retries = 0
  const run = () => {
    if (running) return
    running = true
    checkBuild(local, deps).catch((): 'error' => 'error').then((result) => {
      running = false
      // Stanley is speaking: ask again in a few seconds (for at most 20 minutes) instead of cutting him off.
      if (result === 'busy' && retries++ < 240) setTimeout(run, 5000)
    })
  }
  const onVisible = () => { if (document.visibilityState === 'visible') run() }
  run()
  document.addEventListener('visibilitychange', onVisible)
  return () => document.removeEventListener('visibilitychange', onVisible)
}
