import { describe, it, expect } from 'vitest'
import gieniuCommandSrc from '../../../netlify/functions/gieniu-command.js?raw'
import { BARE_REFUSAL_RE, enforceNamedRefusalLocal, localGaps, loadedAtLabel } from '../namedRefusal'

const LOADED_AT = new Date('2026-08-25T15:42:00Z')   // 17:42 Warsaw

// Everything loaded — a refusal here is about a field that simply is not collected.
const FULL = {
  perf: { wix_orders: 10 },
  ads: [{ spend: 1 }],
  trend: [{ date: '2026-08-25' }],
  profitData: { ok: true },
  ordersData: { ok: true },
  today: '2026-08-25',
}
// Nothing loaded — the offline case the fallback actually runs in.
const EMPTY = { perf: null, ads: [], trend: [], profitData: null, ordersData: null, today: '2026-08-25' }

describe('BARE_REFUSAL_RE', () => {
  it('flags contentless refusals', () => {
    for (const t of [
      "I'm afraid those particulars are not available to me, sir.",
      'That information is not available.',
      'I lack the data for that, sir.',
      'I do not have that information, sir.',
      'No data available, sir.',
    ]) expect(BARE_REFUSAL_RE.test(t), t).toBe(true)
  })

  it('lets a refusal that names its gap through untouched', () => {
    for (const t of [
      'I do not have frequency for these creatives, sir — meta_ads_daily does not sync it.',
      'meta_ads_daily has no rows for 2026-08-19, sir.',
      'Revenue cannot be attributed to specific creatives, sir — orders lack UTM tracking.',
      'I do not have the data for refunds, sir, because orders carry no refund column.',
      'Revenue stands at 1,344 PLN today, sir.',
    ]) expect(BARE_REFUSAL_RE.test(t), t).toBe(false)
  })

  // The backend runs its own copy; if they drift, one path silently stops
  // matching. Compared after resolving \uXXXX escapes, so the two files may spell
  // a character either way but must mean the same thing.
  it('matches the copy in gieniu-command.js', () => {
    const m = gieniuCommandSrc.match(/const BARE_REFUSAL_RE =\s*\r?\n\s*(\/.*\/i)\s*$/m)
    expect(m, 'BARE_REFUSAL_RE literal not found in gieniu-command.js').toBeTruthy()
    const unescape = (s: string) =>
      s.replace(/\\u([0-9a-fA-F]{4})/g, (_, h) => String.fromCharCode(parseInt(h, 16)))
    expect(unescape(m![1])).toBe(unescape(BARE_REFUSAL_RE.toString()))
  })
})

describe('enforceNamedRefusalLocal', () => {
  it('leaves a complete answer alone', () => {
    const a = 'Today: 10 Wix orders, 1344.00 PLN revenue, 316.58 PLN Meta ad spend.'
    expect(enforceNamedRefusalLocal(a, FULL, LOADED_AT)).toBe(a)
  })

  // resolveIntent's own wording: specific enough to pass BARE_REFUSAL_RE, but it
  // never says the backend was unreachable — which is why the answer is local.
  it('adds the cause to a "no data" answer that names no backend failure', () => {
    const a = 'No data for today yet. Make scenarios may not have run, or the day is still early.'
    const out = enforceNamedRefusalLocal(a, EMPTY, LOADED_AT)
    expect(out).toContain('nie mam połączenia z gieniu-command')
    expect(out).toContain('17:42')
  })

  it('names the offline cause and the load time', () => {
    const out = enforceNamedRefusalLocal('That information is not available.', FULL, LOADED_AT)
    expect(out).toContain('nie mam połączenia z gieniu-command')
    expect(out).toContain('danych wczytanych o 17:42')
  })

  it('adds the specific empty sources when there are any', () => {
    const out = enforceNamedRefusalLocal('That information is not available.', EMPTY, LOADED_AT)
    expect(out).toContain('no daily-performance row loaded for 2026-08-25')
    expect(out).toContain('no Meta ad rows loaded for 2026-08-25')
    expect(out).toContain('profit data did not load')
  })

  it('says so when nothing has loaded at all', () => {
    const out = enforceNamedRefusalLocal('I lack the data for that, sir.', EMPTY, null)
    expect(out).toContain('żadne dane nie zdążyły się wczytać')
  })

  it('keeps the original sentence — it appends, never replaces', () => {
    const original = "I'm afraid those particulars are not available to me, sir."
    expect(enforceNamedRefusalLocal(original, FULL, LOADED_AT).startsWith(original)).toBe(true)
  })
})

describe('localGaps', () => {
  it('is empty when every local source has data', () => {
    expect(localGaps(FULL)).toEqual([])
  })
  it('names every empty source', () => {
    expect(localGaps(EMPTY)).toHaveLength(5)
  })
})

describe('loadedAtLabel', () => {
  it('formats Warsaw time', () => {
    expect(loadedAtLabel(LOADED_AT)).toBe('17:42')
  })
  it('returns null with no timestamp', () => {
    expect(loadedAtLabel(null)).toBeNull()
  })
})
