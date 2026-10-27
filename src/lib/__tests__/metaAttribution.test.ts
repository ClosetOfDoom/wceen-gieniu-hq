// A zero in meta_purchases means "we did not ask", not "nobody bought".
//
// Measured 2026-10-27: Business Manager reports 46 purchases for PP-22.06.2026
// over 2026-10-20…26, split across two ads with CPAs of 70,05 and 82,82 PLN.
// meta_ads_daily holds 5 for the same window, every one of them on the final
// day — six of seven days read zero.
//
// Two things followed from that, and these tests pin both:
//
//   · Nothing divides by meta_purchases any more. A CPA of 1 762,25 PLN
//     against a real Wix CPA of about 40 is not an under-reported metric, it
//     is an artefact of the denominator, and it was being drawn in red.
//   · The old house rule — "Meta under-reports conversions" — is withdrawn.
//     It was never tested, and the zeros that appeared to prove it came from
//     our own ingest.

import { describe, it, expect } from 'vitest'
import {
  META_WORLD_ACTIVE, META_PURCHASES_FIXED_ON, metaPurchasesAreCollected,
} from '../orderWindow'
import { aggregateByAd } from '../../components/MetaWorldPanel'
import type { MetaAdDaily } from '../../services/data'

const row = (over: Partial<MetaAdDaily> = {}): MetaAdDaily => ({
  date: '2026-10-20',
  campaign_id: 'c1',
  campaign_name: 'PP-22.06.2026',
  ad_id: 'a1',
  ad_name: 'PP-COLD-NOWE-WIDEO [22.06.2026]',
  spend: 309.37,
  impressions: 1000,
  clicks: 50,
  link_clicks: 20,
  meta_purchases: 0,
  ...over,
} as MetaAdDaily)

describe('the period before the fix is named, not counted', () => {
  it('meta_purchases is not yet trusted for any day', () => {
    expect(META_PURCHASES_FIXED_ON).toBeNull()
    expect(metaPurchasesAreCollected('2026-10-20')).toBe(false)
    expect(metaPurchasesAreCollected('2026-10-26')).toBe(false)
    expect(metaPurchasesAreCollected('2099-01-01')).toBe(false)
  })

  it('the report says NIEPOBIERANE rather than printing a zero', async () => {
    const { metaPurchasesNote } = await import('../exportReport')
    const note = metaPurchasesNote()
    expect(note).toContain('NIEPOBIERANE')
    expect(note).toContain('nie wiemy')
    // The measured evidence travels with the claim.
    expect(note).toContain('46')
  })

})

describe('ŚWIAT META is built and switched off', () => {
  it('the flag is false while the ingest is broken', () => {
    expect(META_WORLD_ACTIVE).toBe(false)
  })

  it('but the aggregation it needs works, per AD and not per campaign', () => {
    // Business Manager's own split: two ads, one campaign, different CPAs.
    const ads = aggregateByAd([
      row({ ad_id: 'a1', ad_name: 'PP-COLD-NOWE-WIDEO [22.06.2026]', spend: 2381.67, meta_purchases: 34 }),
      row({ ad_id: 'a2', ad_name: 'PP-VID<2> [22.06.2026]', spend: 993.85, meta_purchases: 12 }),
    ])
    expect(ads).toHaveLength(2)
    expect(ads[0].spend / ads[0].purchases).toBeCloseTo(70.05, 1)
    expect(ads[1].spend / ads[1].purchases).toBeCloseTo(82.82, 1)
  })

  it('a campaign-level row has no place in a per-ad table', () => {
    const ads = aggregateByAd([
      row(),
      row({ ad_id: '', ad_name: '', spend: 500 } as never),
    ])
    expect(ads).toHaveLength(1)
  })

  it('counts the zero days, which is the point of showing it at all', () => {
    const ads = aggregateByAd([
      row({ date: '2026-10-20', meta_purchases: 0 }),
      row({ date: '2026-10-21', meta_purchases: 0 }),
      row({ date: '2026-10-26', meta_purchases: 5 }),
    ])
    expect(ads[0].days).toBe(3)
    expect(ads[0].zeroDays).toBe(2)
  })
})

describe('the KPI card parses a formatted number back correctly', () => {
  // The Impressions bug: fmtNum uses en-US, so 5826 renders as "5,826", and
  // the count-up animation's parser did `.replace(',', '.')` — 5.826, shown
  // with zero decimals as **6**. The animation restarts on every re-render,
  // so it never reached the final value and 6 simply sat there.
  it.each([
    ['5,826', 5826],       // en-US thousands — the one that broke
    ['12 335,73', 12335.73], // pl-PL
    ['292.79', 292.79],
    ['2,88', 2.88],        // pl-PL decimal — must NOT become 288
    ['1,234.56', 1234.56],
    ['1.234,56', 1234.56],
    ['266', 266],
  ])('%s parses to %s', async (text, want) => {
    const { parseNumericValueForTest } = await import('../../components/KPICard')
    expect(parseNumericValueForTest(text)?.numeric).toBe(want)
  })

  it('keeps the decimal count of the original, so a ROAS does not round to 3', async () => {
    const { parseNumericValueForTest } = await import('../../components/KPICard')
    expect(parseNumericValueForTest('2,88×')?.decimals).toBe(2)
    expect(parseNumericValueForTest('5,826')?.decimals).toBe(0)
  })
})
