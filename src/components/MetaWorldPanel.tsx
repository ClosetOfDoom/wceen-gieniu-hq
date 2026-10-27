// ŚWIAT META — Meta's own numbers, per ad, kept strictly apart from Wix.
//
// NOT RENDERED YET. App.tsx gates this on META_WORLD_ACTIVE in
// lib/orderWindow.ts, which is false, and the reason is measured rather than
// suspected: Meta's Business Manager reports 46 purchases for PP-22.06.2026
// over 2026-10-20…26, and meta_ads_daily holds 5 for the same window, all of
// them on the final day. A panel whose entire subject is Meta's attribution
// cannot be shown while it has a ninth of Meta's attribution.
//
// WHY A SEPARATE SECTION AT ALL
// ---------------------------------------------------------------------------
// Meta's purchases and Wix's orders are not two measurements of one thing.
// They use different attribution windows, Meta counts a view-through that Wix
// never sees, and no Wix order carries a UTM, so no individual order can ever
// be matched to an ad. Putting a Meta CPA next to a Wix CPA invites a
// comparison that cannot be made. Keeping Meta's figures in their own section,
// labelled as pixel attribution, is the only honest way to show them at all.
//
// This is NOT the old claim that Meta under-reports. That assumption is
// withdrawn: it was never tested, and the zeros that seemed to prove it came
// from our ingest, not from Meta.
//
// Turning it on: fix the ingest, run `npm run assert:meta-purchases` against a
// figure from Business Manager, and only then flip META_WORLD_ACTIVE.

import type { MetaAdDaily } from '../services/data'
import { KPICard } from './KPICard'

interface AdAgg {
  adId: string
  adName: string
  campaignName: string
  spend: number
  impressions: number
  clicks: number
  linkClicks: number
  purchases: number
  value: number
  /** Days in range that reported no purchase for this ad. */
  zeroDays: number
  days: number
}

const fmtPln = (n: number | null | undefined) =>
  n == null ? '—' : n.toLocaleString('pl-PL', { minimumFractionDigits: 2, maximumFractionDigits: 2 }) + ' PLN'
const fmtRoas = (n: number | null | undefined) => (n == null ? '—' : n.toFixed(2) + '×')

/**
 * One row per AD, because that is the level the decisions are made at.
 *
 * Business Manager shows two ads in one campaign with CPAs of 70,05 and 82,82
 * — a difference worth acting on that a campaign-level average hides
 * completely.
 */
export function aggregateByAd(rows: MetaAdDaily[]): AdAgg[] {
  const map = new Map<string, AdAgg & { seen: Map<string, number> }>()
  for (const r of rows) {
    const adId = String(r.ad_id ?? '').trim()
    const adName = String(r.ad_name ?? '').trim()
    // A row with no ad is a campaign-level aggregate and has no place in a
    // per-ad table — see CampaignEntry.granularity.
    if (!adId && !adName) continue
    const key = adId || adName
    const g = map.get(key) ?? {
      adId, adName: adName || adId, campaignName: r.campaign_name ?? '—',
      spend: 0, impressions: 0, clicks: 0, linkClicks: 0,
      purchases: 0, value: 0, zeroDays: 0, days: 0, seen: new Map<string, number>(),
    }
    const p = r.meta_purchases ?? r.purchases ?? 0
    g.spend += r.spend ?? 0
    g.impressions += r.impressions ?? 0
    g.clicks += r.clicks ?? 0
    g.linkClicks += r.link_clicks ?? 0
    g.purchases += p
    g.value += r.meta_purchase_value ?? 0
    if (r.date) g.seen.set(r.date, (g.seen.get(r.date) ?? 0) + p)
    map.set(key, g)
  }
  return [...map.values()]
    .map(({ seen, ...g }) => ({
      ...g,
      days: seen.size,
      zeroDays: [...seen.values()].filter(n => n === 0).length,
    }))
    .sort((a, b) => b.spend - a.spend)
}

export function MetaWorldPanel({ rows, rangeLabel }: { rows: MetaAdDaily[]; rangeLabel: string }) {
  const ads = aggregateByAd(rows)
  const totSpend = ads.reduce((s, a) => s + a.spend, 0)
  const totPurch = ads.reduce((s, a) => s + a.purchases, 0)
  const totValue = ads.reduce((s, a) => s + a.value, 0)

  return (
    <div className="panel-illuminate card">
      <div className="section-title section-title-gold" style={{ marginBottom: '6px' }}>
        Świat Meta · {rangeLabel}
      </div>
      <div style={{ fontFamily: 'var(--font-mono)', fontSize: '0.68rem', color: 'var(--muted2)',
        lineHeight: 1.6, marginBottom: '12px' }}>
        Liczby z piksela Meta. Mierzą co innego niż Wix — inne okno atrybucji, zliczane
        view-through, brak UTM na zamówieniu. Nieporównywalne z Wixem w żadną stronę
        i nieprzeznaczone do sumowania z nim.
      </div>

      <div className="kpi-grid" style={{ display: 'flex', flexWrap: 'wrap', gap: '10px', marginBottom: '14px' }}>
        <KPICard label="Wydatek" value={fmtPln(totSpend)} accent sublabel={rangeLabel} />
        <KPICard label="Zakupy (Meta)" value={String(totPurch)} sublabel="piksel, nie Wix" />
        <KPICard label="CPA (Meta)" value={fmtPln(totPurch > 0 ? totSpend / totPurch : null)}
          sublabel="wydatek ÷ zakupy Meta" />
        <KPICard label="ROAS (Meta)" value={fmtRoas(totSpend > 0 ? totValue / totSpend : null)}
          sublabel="wartość Meta ÷ wydatek" />
      </div>

      <table style={{ width: '100%', borderCollapse: 'collapse', fontFamily: 'var(--font-mono)', fontSize: '0.72rem' }}>
        <thead>
          <tr style={{ color: 'var(--muted2)', textAlign: 'left' }}>
            <th>reklama</th><th>kampania</th>
            <th style={{ textAlign: 'right' }}>wydatek</th>
            <th style={{ textAlign: 'right' }}>wyświetlenia</th>
            <th style={{ textAlign: 'right' }}>CTR</th>
            <th style={{ textAlign: 'right' }}>CPC</th>
            <th style={{ textAlign: 'right' }}>CPM</th>
            <th style={{ textAlign: 'right' }}>zakupy</th>
            <th style={{ textAlign: 'right' }}>CPA</th>
            <th style={{ textAlign: 'right' }}>ROAS</th>
            <th style={{ textAlign: 'right' }}>doby zerowe</th>
          </tr>
        </thead>
        <tbody>
          {ads.map(a => (
            <tr key={a.adId || a.adName}>
              <td style={{ color: 'var(--text2)' }}>{a.adName}</td>
              <td style={{ color: 'var(--muted2)' }}>{a.campaignName}</td>
              <td style={{ textAlign: 'right' }}>{a.spend.toFixed(2)}</td>
              <td style={{ textAlign: 'right' }}>{a.impressions.toLocaleString('pl-PL')}</td>
              <td style={{ textAlign: 'right' }}>
                {a.impressions > 0 ? (a.linkClicks / a.impressions * 100).toFixed(2) + '%' : '—'}
              </td>
              <td style={{ textAlign: 'right' }}>
                {a.clicks > 0 ? (a.spend / a.clicks).toFixed(2) : '—'}
              </td>
              <td style={{ textAlign: 'right' }}>
                {a.impressions > 0 ? (a.spend / a.impressions * 1000).toFixed(2) : '—'}
              </td>
              <td style={{ textAlign: 'right' }}>{a.purchases}</td>
              <td style={{ textAlign: 'right' }}>
                {a.purchases > 0 ? (a.spend / a.purchases).toFixed(2) : '—'}
              </td>
              <td style={{ textAlign: 'right' }}>
                {a.spend > 0 ? (a.value / a.spend).toFixed(2) + '×' : '—'}
              </td>
              {/* The honesty column: a CPA computed over a week of zeros is not
                  a CPA, and this is where that shows. */}
              <td style={{ textAlign: 'right', color: a.zeroDays > 0 ? 'var(--amber)' : 'var(--muted2)' }}>
                {a.zeroDays} / {a.days}
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  )
}
