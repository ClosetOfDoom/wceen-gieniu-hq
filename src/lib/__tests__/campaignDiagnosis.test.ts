import { describe, it, expect } from 'vitest'
import { buildCampaignDiagnosis, classifyCampaignScope } from '../campaignDiagnosis'
import type { MetaAdDaily } from '../../services/data'

// Minimal row — only columns confirmed in DB (no ctr/cpc/cpm/adset_id/ad_id/meta_purchase_value)
function makeRow(overrides: Partial<MetaAdDaily> = {}): MetaAdDaily {
  return {
    date: '2026-06-23',
    campaign_id: 'camp_1',
    campaign_name: 'PP-22.06.2026',
    adset_id: '',
    ad_id: '',
    spend: 154.97,
    impressions: 5000,
    clicks: 129,
    link_clicks: 74,
    purchases: 0,
    // optional: ctr/cpc/cpm/meta_purchase_value intentionally absent
    ...overrides,
  }
}

describe('buildCampaignDiagnosis', () => {
  it('handles rows with null optional fields (ctr/cpc/cpm absent)', () => {
    const rows = [makeRow()]
    const d = buildCampaignDiagnosis(rows, 'ALL', '2026-06-23', '2026-06-23')
    expect(d.rowCount).toBe(1)
    expect(d.campaigns[0].campaign_name).toBe('PP-22.06.2026')
    expect(d.campaigns[0].spend).toBeCloseTo(154.97)
    // ctr is computed from link_clicks/impressions when column absent; cpm stays null
    expect(d.campaigns[0].ctr).toBeCloseTo((74 / 5000) * 100, 2)
    expect(d.campaigns[0].cpm).toBeNull()
  })

  it('returns 0 rows for empty input without throwing', () => {
    const d = buildCampaignDiagnosis([], 'ALL', '2026-06-23', '2026-06-23')
    expect(d.rowCount).toBe(0)
    expect(d.campaigns).toHaveLength(0)
  })

  it('computes totals across multiple rows', () => {
    const rows = [
      makeRow({ campaign_name: 'PP-22.06.2026', spend: 154.97, purchases: 0 }),
      makeRow({ campaign_id: 'camp_2', campaign_name: 'PP-PROSPECTING [30.07.2025]', spend: 0, purchases: 0 }),
    ]
    const d = buildCampaignDiagnosis(rows, 'ALL', '2026-06-23', '2026-06-23')
    expect(d.rowCount).toBe(2)
    expect(d.totals.spend).toBeCloseTo(154.97)
    expect(d.totals.purchases).toBe(0)
    expect(d.totals.metaCpa).toBeNull()
  })

  it('identifies zero-attribution campaign (spend>10, purchases=0)', () => {
    const rows = [makeRow({ spend: 154.97, purchases: 0 })]
    const d = buildCampaignDiagnosis(rows, 'ALL', '2026-06-23', '2026-06-23')
    expect(d.zeroAttribution).toHaveLength(1)
    expect(d.zeroAttribution[0].campaign_name).toBe('PP-22.06.2026')
  })

  it('correctly classifies PP campaign scope', () => {
    // "PP" in campaign name = JSU (Pakiet Pamięciowy)
    expect(classifyCampaignScope('PP-22.06.2026')).toBe('JSU')
    expect(classifyCampaignScope('PP-PROSPECTING [30.07.2025]')).toBe('JSU')
  })
})
