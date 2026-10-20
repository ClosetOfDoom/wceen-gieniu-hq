// A row Meta reported per CAMPAIGN is not a creative, and must not be shown
// as one.
//
// Four rows in meta_ads_daily carry no ad_id and no ad_name: 2026-06-12 and
// 2026-06-13, two campaigns each (PP-PROSPECTING and PP-RETEST-KREATYWY).
// They come from the period before the ingest moved to ad granularity, they
// are the two earliest days in the table, and their spend is real.
//
// `ad_name` falls back to the campaign name for display, which is sensible
// and also means the reader cannot tell a creative from a whole campaign.
// That is what `granularity` is for.

import { describe, it, expect } from 'vitest'
import { buildCampaignDiagnosis, funnelScope, classifyCampaignScope } from '../campaignDiagnosis'

const row = (over: Record<string, unknown> = {}) => ({
  campaign_id: '120228916225720607',
  campaign_name: 'PP-PROSPECTING [30.07.2025]',
  ad_name: 'PP-VID<1> [31.08.2025]',
  ad_id: '123',
  date: '2026-06-12',
  spend: 547.84, impressions: 18060, clicks: 677, link_clicks: 188,
  meta_purchases: 0, meta_purchase_value: 0,
  ...over,
})

const entries = (rows: Array<Record<string, unknown>>) =>
  buildCampaignDiagnosis(rows as never, 'ALL', '2026-06-12', '2026-06-12').campaigns

describe('granularity is reported, never guessed at by the reader', () => {
  it('a row with an ad is ad-level', () => {
    expect(entries([row()])[0].granularity).toBe('ad')
  })

  it('a row with neither ad_id nor ad_name is campaign-level', () => {
    const [e] = entries([row({ ad_id: '', ad_name: '' })])
    expect(e.granularity).toBe('campaign')
  })

  it('an empty string counts as absent, which is what these rows carry', () => {
    expect(entries([row({ ad_id: '   ', ad_name: '   ' })])[0].granularity).toBe('campaign')
    expect(entries([row({ ad_id: null, ad_name: null })])[0].granularity).toBe('campaign')
  })

  it('the server’s own verdict wins when it sends one', () => {
    // Range mode groups rows and decides there; today mode sends raw rows.
    expect(entries([row({ granularity: 'campaign' })])[0].granularity).toBe('campaign')
  })
})

describe('scope attribution is unaffected by the missing ad', () => {
  // The prefix lives on the campaign name, and these rows have one.
  it('PP- resolves to the memory funnel with no ad_name at all', () => {
    const [e] = entries([row({ ad_id: '', ad_name: '', spend: 523.96 })])
    expect(e.funnelScope).toBe('memory')
    expect(e.scope).toBe('JSU')
    expect(e.spend).toBe(523.96)
  })

  it('and directly, on the two campaigns that actually have such rows', () => {
    for (const name of ['PP-PROSPECTING [30.07.2025]', 'PP-RETEST-KREATYWY [09.06]']) {
      expect(funnelScope(name)).toBe('memory')
      expect(classifyCampaignScope(` ${name}`)).toBe('JSU')
    }
  })

  it('their spend is not dropped from the totals', () => {
    const list = entries([
      row({ spend: 547.84 }),
      row({ ad_id: '', ad_name: '', spend: 523.96 }),
    ])
    expect(list.reduce((s, c) => s + c.spend, 0)).toBeCloseTo(1071.80, 2)
  })
})
