// P5: the app reloads itself ONCE when the server serves another build, and never loops.
import { describe, it, expect, vi } from 'vitest'
import { decideReload, checkBuild, RELOAD_GUARD_KEY, type BuildCheckDeps } from '../buildVersion'

function memStorage(seed: Record<string, string> = {}) {
  const m = new Map(Object.entries(seed))
  return { getItem: (k: string) => m.get(k) ?? null, setItem: (k: string, v: string) => { m.set(k, v) }, removeItem: (k: string) => { m.delete(k) }, m }
}
function deps(server: string | null, storage: BuildCheckDeps['storage'] = memStorage()) {
  const reload = vi.fn<() => void>()
  const updateServiceWorker = vi.fn<() => Promise<void>>(async () => {})
  return { fetchVersion: async (): Promise<string | null> => server, storage, updateServiceWorker, reload } satisfies BuildCheckDeps
}

describe('decideReload (pure comparison)', () => {
  it('same hash → none; different → reload; already reloaded for that server hash → none', () => {
    expect(decideReload({ local: 'aaa1111', server: 'aaa1111', reloadedFor: null })).toBe('none')
    expect(decideReload({ local: 'aaa1111', server: 'bbb2222', reloadedFor: null })).toBe('reload')
    expect(decideReload({ local: 'aaa1111', server: 'bbb2222', reloadedFor: 'bbb2222' })).toBe('none')
    expect(decideReload({ local: 'aaa1111', server: 'ccc3333', reloadedFor: 'bbb2222' })).toBe('reload')   // a NEWER build again
  })
  it('unknown / missing server hash or a dev build → none', () => {
    expect(decideReload({ local: 'aaa1111', server: null, reloadedFor: null })).toBe('none')
    expect(decideReload({ local: 'aaa1111', server: 'unknown', reloadedFor: null })).toBe('none')
    expect(decideReload({ local: 'dev', server: 'bbb2222', reloadedFor: null })).toBe('none')
  })
})

describe('checkBuild (one check, with the loop guard)', () => {
  it('mismatch → SW update, then exactly one reload; the second check after that reload does not reload again', async () => {
    const st = memStorage()
    const d = deps('bbb2222', st)
    expect(await checkBuild('aaa1111', d)).toBe('reloaded')
    expect(d.updateServiceWorker).toHaveBeenCalledTimes(1)
    expect(d.reload).toHaveBeenCalledTimes(1)
    expect(st.m.get(RELOAD_GUARD_KEY)).toBe('bbb2222')
    // the page came back still old (CDN lag): same check again → no second reload
    expect(await checkBuild('aaa1111', d)).toBe('skipped')
    expect(d.reload).toHaveBeenCalledTimes(1)
  })

  it('match → no reload and the guard is cleared (a later deploy can reload again)', async () => {
    const st = memStorage({ [RELOAD_GUARD_KEY]: 'bbb2222' })
    const d = deps('bbb2222', st)
    expect(await checkBuild('bbb2222', d)).toBe('same')
    expect(d.reload).not.toHaveBeenCalled()
    expect(st.m.has(RELOAD_GUARD_KEY)).toBe(false)
  })

  it('no storage (private mode) or storage that throws → never reloads (a reload it cannot remember could loop)', async () => {
    const d1 = deps('bbb2222', null)
    expect(await checkBuild('aaa1111', d1)).toBe('skipped')
    const throwing = { getItem: () => { throw new Error('blocked') }, setItem: () => { throw new Error('blocked') }, removeItem: () => {} }
    const d2 = deps('bbb2222', throwing)
    expect(await checkBuild('aaa1111', d2)).toBe('skipped')
    expect(d1.reload).not.toHaveBeenCalled(); expect(d2.reload).not.toHaveBeenCalled()
  })

  it('version fetch fails or returns nothing → error, no reload; a failing SW update still reloads once', async () => {
    const bad = { ...deps(null), fetchVersion: async () => { throw new Error('offline') } }
    expect(await checkBuild('aaa1111', bad)).toBe('error')
    expect(await checkBuild('aaa1111', deps(null))).toBe('error')
    const d = deps('bbb2222'); d.updateServiceWorker.mockRejectedValueOnce(new Error('no sw'))
    expect(await checkBuild('aaa1111', d)).toBe('reloaded')
    expect(d.reload).toHaveBeenCalledTimes(1)
  })
})
