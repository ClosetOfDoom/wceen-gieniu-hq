// Campaign inspector — a dropdown to pick a specific Meta campaign (or "All") and
// see its metrics for the panel's selected time range. Groups raw per-ad rows by
// campaign and aggregates spend / impressions / clicks / purchases → CTR, CPC, CPM,
// ROAS, CPA. Uses only real rows from meta_ads_daily for the chosen range.

import { useMemo, useState, useEffect } from 'react'
import type { MetaAdDaily } from '../services/data'
import { KPICard } from './KPICard'

interface CampaignAgg {
  name: string
  spend: number
  impressions: number
  clicks: number
  linkClicks: number
  purchases: number
  value: number
}

const ALL = '__all__'

function fmtPln(n: number | null | undefined): string {
  if (n == null) return '—'
  return n.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 }) + ' PLN'
}
function fmtNum(n: number | null | undefined): string {
  if (n == null) return '—'
  return n.toLocaleString('en-US')
}
function fmtPct(n: number | null | undefined): string {
  if (n == null) return '—'
  return n.toFixed(2) + '%'
}
function fmtRoas(n: number | null | undefined): string {
  if (n == null) return '—'
  return n.toFixed(2) + '×'
}

function groupByCampaign(rows: MetaAdDaily[]): CampaignAgg[] {
  const map = new Map<string, CampaignAgg>()
  for (const r of rows) {
    const name = r.campaign_name ?? r.campaign_id ?? '—'
    const agg = map.get(name) ?? { name, spend: 0, impressions: 0, clicks: 0, linkClicks: 0, purchases: 0, value: 0 }
    agg.spend       += r.spend ?? 0
    agg.impressions += r.impressions ?? 0
    agg.clicks      += r.clicks ?? 0
    agg.linkClicks  += r.link_clicks ?? 0
    agg.purchases   += r.meta_purchases ?? r.purchases ?? 0
    agg.value       += r.meta_purchase_value ?? 0
    map.set(name, agg)
  }
  return [...map.values()].sort((a, b) => b.spend - a.spend)
}

function aggregateAll(list: CampaignAgg[]): CampaignAgg {
  return list.reduce<CampaignAgg>((acc, c) => ({
    name: ALL,
    spend: acc.spend + c.spend,
    impressions: acc.impressions + c.impressions,
    clicks: acc.clicks + c.clicks,
    linkClicks: acc.linkClicks + c.linkClicks,
    purchases: acc.purchases + c.purchases,
    value: acc.value + c.value,
  }), { name: ALL, spend: 0, impressions: 0, clicks: 0, linkClicks: 0, purchases: 0, value: 0 })
}

export function CampaignInspector({
  rows, loading, rangeLabel,
}: {
  rows: MetaAdDaily[]
  loading: boolean
  rangeLabel: string
}) {
  const campaigns = useMemo(() => groupByCampaign(rows), [rows])
  const [sel, setSel] = useState<string>(ALL)

  // Reset the selection if the picked campaign isn't in the new range's data.
  useEffect(() => {
    if (sel !== ALL && !campaigns.some(c => c.name === sel)) setSel(ALL)
  }, [campaigns, sel])

  const current: CampaignAgg | null =
    campaigns.length === 0 ? null
    : sel === ALL ? aggregateAll(campaigns)
    : (campaigns.find(c => c.name === sel) ?? aggregateAll(campaigns))

  const ctr  = current && current.impressions > 0 ? current.linkClicks / current.impressions * 100 : null
  const cpc  = current && current.clicks > 0      ? current.spend / current.clicks : null
  const cpm  = current && current.impressions > 0 ? current.spend / current.impressions * 1000 : null
  const roas = current && current.spend > 0       ? current.value / current.spend : null
  const cpa  = current && current.purchases > 0   ? current.spend / current.purchases : null

  return (
    <div className="panel-illuminate card">
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: '12px', flexWrap: 'wrap', marginBottom: '14px' }}>
        <div className="section-title section-title-gold" style={{ marginBottom: 0 }}>Reklamy — kampanie</div>
        <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
          <label style={{ fontFamily: 'var(--font-mono)', fontSize: '0.68rem', color: 'var(--muted2)', textTransform: 'uppercase', letterSpacing: '0.08em' }}>
            Kampania
          </label>
          <select
            className="gieniu-input"
            value={sel}
            onChange={e => setSel(e.target.value)}
            disabled={loading || campaigns.length === 0}
            style={{ minWidth: 180, maxWidth: 300, padding: '8px 10px', cursor: 'pointer' }}
          >
            <option value={ALL}>Wszystkie ({campaigns.length})</option>
            {campaigns.map(c => (
              <option key={c.name} value={c.name}>{c.name}</option>
            ))}
          </select>
        </div>
      </div>

      {loading ? (
        <div style={{ color: 'var(--muted)', fontFamily: 'var(--font-mono)', fontSize: '0.8rem' }}>Loading campaigns…</div>
      ) : !current ? (
        <div style={{ color: 'var(--muted)', fontFamily: 'var(--font-mono)', fontSize: '0.78rem' }}>
          Brak danych reklamowych dla zakresu {rangeLabel}.
        </div>
      ) : (
        <>
          <div className="kpi-grid" style={{ display: 'flex', flexWrap: 'wrap', gap: '10px' }}>
            <KPICard label="Ad Spend" value={fmtPln(current.spend)} accent sublabel={sel === ALL ? 'All campaigns' : current.name} />
            <KPICard label="ROAS (Meta)" value={fmtRoas(roas)} sublabel="Purchase value ÷ spend" />
            <KPICard label="CPA (Meta)" value={fmtPln(cpa)} warning={cpa != null && cpa > 50} sublabel="Spend ÷ purchases" />
            <KPICard label="Purchases" value={fmtNum(current.purchases)} sublabel="Meta-reported" />
            <KPICard label="CTR" value={fmtPct(ctr)} sublabel="Link clicks / impressions" />
            <KPICard label="CPC" value={fmtPln(cpc)} sublabel="Spend / clicks" />
            <KPICard label="CPM" value={fmtPln(cpm)} dim sublabel="Spend / 1 000 impr." />
            <KPICard label="Impressions" value={fmtNum(current.impressions)} dim sublabel={rangeLabel} />
          </div>
          <div style={{ marginTop: '10px', fontFamily: 'var(--font-mono)', fontSize: '0.66rem', color: 'var(--muted2)' }}>
            ROAS/CPA to metryki atrybucji Meta (nie Wix). Zakres: {rangeLabel}.
          </div>
        </>
      )}
    </div>
  )
}
