import { describe, it, expect } from 'vitest'
import en, { type Strings } from '../en'
import pl from '../pl'
import { getStrings, t } from '../index'

// Recursively collect all leaf string paths from a strings object
function leafPaths(obj: Record<string, unknown>, prefix = ''): string[] {
  const result: string[] = []
  for (const [k, v] of Object.entries(obj)) {
    const path = prefix ? `${prefix}.${k}` : k
    if (typeof v === 'string') {
      result.push(path)
    } else if (v && typeof v === 'object') {
      result.push(...leafPaths(v as Record<string, unknown>, path))
    }
  }
  return result
}

describe('i18n completeness', () => {
  const enPaths = leafPaths(en as unknown as Record<string, unknown>)
  const plPaths = leafPaths(pl as unknown as Record<string, unknown>)

  it('PL has exactly the same keys as EN', () => {
    const missing = enPaths.filter(p => !plPaths.includes(p))
    const extra   = plPaths.filter(p => !enPaths.includes(p))
    expect(missing).toEqual([])
    expect(extra).toEqual([])
  })

  it('EN has no empty strings', () => {
    const empty = enPaths.filter(path => {
      const parts = path.split('.')
      let obj: unknown = en
      for (const p of parts) obj = (obj as Record<string, unknown>)[p]
      return (obj as string).trim() === ''
    })
    expect(empty).toEqual([])
  })

  it('PL has no empty strings', () => {
    const empty = plPaths.filter(path => {
      const parts = path.split('.')
      let obj: unknown = pl
      for (const p of parts) obj = (obj as Record<string, unknown>)[p]
      return (obj as string).trim() === ''
    })
    expect(empty).toEqual([])
  })

  it('EN and PL are not identical (PL is actually translated)', () => {
    // Spot-check a few keys that must differ
    expect(pl.kpi.wixOrders).not.toBe(en.kpi.wixOrders)
    expect(pl.status.loading).not.toBe(en.status.loading)
    expect(pl.freshness.stale).not.toBe(en.freshness.stale)
  })
})

describe('getStrings', () => {
  it('returns EN for "en"', () => {
    expect(getStrings('en').kpi.wixOrders).toBe(en.kpi.wixOrders)
  })
  it('returns PL for "pl"', () => {
    expect(getStrings('pl').kpi.wixOrders).toBe(pl.kpi.wixOrders)
  })
  it('falls back to EN for unknown locale', () => {
    expect(getStrings('de').kpi.wixOrders).toBe(en.kpi.wixOrders)
  })
  it('falls back to EN for null', () => {
    expect(getStrings(null).kpi.wixOrders).toBe(en.kpi.wixOrders)
  })
})

describe('default export t', () => {
  it('t is the EN strings object', () => {
    expect(t.kpi.wixOrders).toBe('Wix Orders')
    expect(t.voice.listening).toBe('Listening…')
    expect(t.freshness.stale).toBe('stale')
  })
})

describe('Strings type exhaustiveness', () => {
  it('all top-level sections exist in EN', () => {
    const sections: (keyof Strings)[] = ['kpi', 'sublabel', 'status', 'panel', 'voice', 'freshness']
    for (const s of sections) {
      expect(en[s]).toBeDefined()
    }
  })
})
