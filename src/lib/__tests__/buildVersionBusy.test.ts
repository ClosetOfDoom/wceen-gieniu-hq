// Self-update never cuts Stanley off: while he is speaking the reload waits, and happens once he is done.
import { describe, it, expect, vi } from 'vitest'
import { checkBuild, installBuildWatcher, RELOAD_GUARD_KEY, type BuildCheckDeps } from '../buildVersion'

function memStorage() {
  const m = new Map<string, string>()
  return { getItem: (k: string) => m.get(k) ?? null, setItem: (k: string, v: string) => { m.set(k, v) }, removeItem: (k: string) => { m.delete(k) }, m }
}
function deps(server: string, busy: { now: boolean }, storage = memStorage()) {
  return {
    fetchVersion: async (): Promise<string | null> => server, storage,
    updateServiceWorker: vi.fn<() => Promise<void>>(async () => {}), reload: vi.fn<() => void>(), isBusy: () => busy.now,
  } satisfies BuildCheckDeps
}

describe('checkBuild while Stanley speaks', () => {
  it('a new build + speaking → "busy": no reload, no service-worker update, the loop guard untouched', async () => {
    const st = memStorage(); const busy = { now: true }; const d = deps('bbb2222', busy, st)
    expect(await checkBuild('aaa1111', d)).toBe('busy')
    expect(d.reload).not.toHaveBeenCalled(); expect(d.updateServiceWorker).not.toHaveBeenCalled(); expect(st.m.has(RELOAD_GUARD_KEY)).toBe(false)
  })
  it('once he has finished, the same check reloads (once)', async () => {
    const busy = { now: true }; const d = deps('bbb2222', busy)
    expect(await checkBuild('aaa1111', d)).toBe('busy')
    busy.now = false
    expect(await checkBuild('aaa1111', d)).toBe('reloaded'); expect(d.reload).toHaveBeenCalledTimes(1)
  })
  it('the same build is "same" even while speaking (nothing to wait for)', async () => {
    const d = deps('aaa1111', { now: true })
    expect(await checkBuild('aaa1111', d)).toBe('same')
  })
  it('without an isBusy dependency the old behaviour stays', async () => {
    const d = { ...deps('bbb2222', { now: true }) } as BuildCheckDeps; delete d.isBusy
    expect(await checkBuild('aaa1111', d)).toBe('reloaded')
  })
})

describe('the watcher asks again until he is done', () => {
  it('busy at start → retries every 5 s → reloads when the speech ends', async () => {
    vi.useFakeTimers()
    try {
      const busy = { now: true }; const d = deps('bbb2222', busy)
      const g = globalThis as { document?: unknown }
      const hadDocument = 'document' in g
      if (!hadDocument) g.document = { addEventListener: () => {}, removeEventListener: () => {}, visibilityState: 'visible' }
      const stop = installBuildWatcher('aaa1111', d)
      await vi.advanceTimersByTimeAsync(0)
      expect(d.reload).not.toHaveBeenCalled()
      await vi.advanceTimersByTimeAsync(5000); expect(d.reload).not.toHaveBeenCalled()      // still speaking
      busy.now = false
      await vi.advanceTimersByTimeAsync(5000); expect(d.reload).toHaveBeenCalledTimes(1)   // done: reload
      await vi.advanceTimersByTimeAsync(20000); expect(d.reload).toHaveBeenCalledTimes(1)  // and no more
      stop()
      if (!hadDocument) delete g.document
    } finally { vi.useRealTimers() }
  })
})
