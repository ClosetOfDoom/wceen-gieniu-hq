// Campaign inspector — a dropdown to pick a specific Meta campaign (or "All")
// and see its DELIVERY metrics for the panel's selected range: spend,
// impressions, clicks, CTR, CPC, CPM. Only real rows from meta_ads_daily.
//
// CPA (Meta) AND ROAS (Meta) WERE REMOVED ON 2026-10-27, deliberately, and
// must not come back until the ingest is fixed.
//
// Both divided by meta_purchases. Meta's own Business Manager reports 46
// purchases for PP-22.06.2026 over 2026-10-20…26; meta_ads_daily holds 5 for
// the same window, every one of them on the last day. Dividing real spend by
// a denominator that is a ninth of the truth does not produce an
// approximation of CPA — it produces an artefact of the division. The card
// read 1 762,25 PLN against a real Wix CPA of about 40, and it read it in
// red, which this dashboard reserves for a signal somebody should act on.
//
// Annotating it harder was the wrong fix and had already been tried: the old
// footnote said the purchases were under-reported, and the number stayed on
// screen anyway. A figure nobody should read does not belong on a card.
//
// Purchases itself STAYS, as a raw Meta count with its provenance and the
// number of days in the range on which it is zero — so the reader can see
// what the figure stands on.

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
  rows, loading, rangeLabel, wixCpa, wixRoas, globalSpend,
}: {
  rows: MetaAdDaily[]
  loading: boolean
  rangeLabel: string
  /** Blended CPA from Wix for the same range — whole account, not this campaign. */
  wixCpa?: number | null
  /** Blended ROAS from Wix for the same range — whole account, not this campaign. */
  wixRoas?: number | null
  /**
   * The Ad Spend the global KPI card shows for this same range.
   *
   * Both numbers come from meta_ads_daily — the global one through
   * v_daily_wix_meta_performance, which is a sum of it — so they agree by
   * construction. They can still differ ON SCREEN, because they are two
   * independent fetches and a day in progress gains spend between them. That
   * is worth saying out loud rather than leaving two silent numbers on one
   * page: on 2026-10-27 they read 280,75 and 292,79, twelve złoty apart, and
   * nothing explained it.
   */
  globalSpend?: number | null
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
  // No ROAS, no CPA. See the header: both divide by meta_purchases, which is
  // not what Meta itself reports. `current.value` and `current.purchases` are
  // still aggregated because Purchases is shown raw, and because the ŚWIAT
  // META section will need them once the ingest is fixed.

  // How many days in this range reported no purchases at all. The point of
  // the figure is to show what the Purchases number stands on: 6 zero-days
  // out of 7 is not a quiet week, it is a broken feed.
  const dayStats = useMemo(() => {
    const byDay = new Map<string, number>()
    for (const r of rows) {
      if (!r.date) continue
      if (sel !== ALL && (r.campaign_name ?? r.campaign_id ?? '—') !== sel) continue
      byDay.set(r.date, (byDay.get(r.date) ?? 0) + (r.meta_purchases ?? r.purchases ?? 0))
    }
    const days = [...byDay.values()]
    return { total: days.length, zero: days.filter(n => n === 0).length }
  }, [rows, sel])

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
            {/* Every card carries the same range sublabel. AD SPEND used to
                show the campaign name here while IMPRESSIONS showed the range,
                so two cards side by side looked like two different periods. */}
            <KPICard label="Ad Spend" value={fmtPln(current.spend)} accent sublabel={rangeLabel} />
            <KPICard label="Purchases" value={fmtNum(current.purchases)}
              sublabel="Meta-reported · nie łączy się z zamówieniami Wix" />
            <KPICard label="CTR" value={fmtPct(ctr)} sublabel={rangeLabel} />
            <KPICard label="CPC" value={fmtPln(cpc)} sublabel={rangeLabel} />
            <KPICard label="CPM" value={fmtPln(cpm)} dim sublabel={rangeLabel} />
            <KPICard label="Impressions" value={fmtNum(current.impressions)} dim sublabel={rangeLabel} />
          </div>
          {sel === ALL && globalSpend != null && Math.abs(globalSpend - current.spend) > 0.01 && (
            <div style={{ marginTop: '10px', fontFamily: 'var(--font-mono)', fontSize: '0.66rem',
              color: 'var(--amber)', lineHeight: 1.6 }}>
              Karta globalna pokazuje {fmtPln(globalSpend)}, ta sekcja {fmtPln(current.spend)} —
              różnica {fmtPln(Math.abs(globalSpend - current.spend))}. To jedno źródło
              (meta_ads_daily) pobrane dwa razy w różnych momentach; doba w toku rośnie
              między jednym pobraniem a drugim. Dla dób zamkniętych obie liczby są równe.
            </div>
          )}
          <div style={{ marginTop: '10px', fontFamily: 'var(--font-mono)', fontSize: '0.66rem', color: 'var(--muted2)', lineHeight: 1.6 }}>
            {dayStats.zero > 0 && (
              <>
                <span style={{ color: 'var(--amber)' }}>
                  Purchases = {current.purchases} przy {dayStats.zero} z {dayStats.total} dób
                  zakresu raportujących zero.
                </span>{' '}
                Ingest nie pobiera tego pola z Meta — liczby w Business Managerze są wyższe.
                Dopóki to nie jest naprawione, Purchases nie mierzy sprzedaży.
                <br />
              </>
            )}
            Purchases pochodzi z piksela Meta (meta_ads_daily, sync Make) i mierzy co innego
            niż Wix: inne okno atrybucji, brak UTM, brak połączenia z konkretnym zamówieniem.
            Nie jest porównywalne z Wixem w żadną stronę. Prawda transakcyjna: Wix orders/revenue.
            {/* CPA i ROAS per kampania są NIEMOŻLIWE i nie będą tu dodane: zamówienia
                Wix nie niosą UTM, więc żadnego zamówienia nie da się przypisać do
                kampanii. Blended, dla całego konta, podane niżej. */}
            <br />
            {sel === ALL ? (
              <>
                Realne CPA i ROAS z Wix dla tego zakresu:{' '}
                <span style={{ color: 'var(--text2)' }}>
                  CPA {fmtPln(wixCpa)} · ROAS {fmtRoas(wixRoas)}
                </span>{' '}
                — blended, całe konto, nie ta kampania.
              </>
            ) : (
              <>CPA per kampania niemożliwe: zamówienia nie niosą UTM.</>
            )}
          </div>
        </>
      )}
    </div>
  )
}
