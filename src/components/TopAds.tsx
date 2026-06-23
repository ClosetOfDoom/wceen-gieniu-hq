import type { MetaAdDaily } from '../services/data'

interface Props {
  ads: MetaAdDaily[]
  loading: boolean
}

export function TopAds({ ads, loading }: Props) {
  if (loading) {
    return <div style={{ color: 'var(--muted)', fontFamily: 'var(--font-mono)', fontSize: '0.76rem', padding: '10px 0' }}>Loading campaigns…</div>
  }
  if (ads.length === 0) {
    return <div style={{ color: 'var(--muted)', fontFamily: 'var(--font-mono)', fontSize: '0.76rem', padding: '10px 0' }}>No campaign data for today.</div>
  }

  const total = ads.reduce((s, a) => s + (a.spend ?? 0), 0)
  const totalPurchases = ads.reduce((s, a) => s + (a.meta_purchases ?? a.purchases ?? 0), 0)

  return (
    <div>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'baseline', marginBottom: '12px' }}>
        <div className="panel-label">Top Campaigns — Today</div>
        <span style={{ fontSize: '0.68rem', color: 'var(--muted)', fontFamily: 'var(--font-mono)' }}>
          Meta attr. purchases: <span style={{ color: 'var(--teal)' }}>{totalPurchases}</span>
        </span>
      </div>
      <div style={{ overflowX: 'auto' }}>
        <table className="data-table">
          <thead>
            <tr>
              <th style={{ textAlign: 'left' }}>Campaign</th>
              <th style={{ textAlign: 'right' }}>Spend PLN</th>
              <th style={{ textAlign: 'right' }}>Budget %</th>
              <th style={{ textAlign: 'right' }}>Clicks</th>
              <th style={{ textAlign: 'right' }}>Attr.</th>
            </tr>
          </thead>
          <tbody>
            {ads.map((ad, i) => {
              const pct = total > 0 ? ((ad.spend / total) * 100).toFixed(0) : '—'
              const isHigh = total > 0 && ad.spend / total > 0.7

              return (
                <tr key={ad.ad_id ?? i}>
                  <td style={{ maxWidth: '180px', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', color: isHigh ? 'var(--orange)' : 'var(--text2)' }}>
                    {ad.campaign_name ?? ad.campaign_id ?? '—'}
                  </td>
                  <td style={{ textAlign: 'right', color: isHigh ? 'var(--orange)' : 'var(--text2)' }}>
                    {ad.spend?.toFixed(2) ?? '—'}
                  </td>
                  <td style={{ textAlign: 'right', color: isHigh ? 'var(--orange)' : 'var(--muted)' }}>
                    {pct}%
                  </td>
                  <td style={{ textAlign: 'right', color: 'var(--muted)' }}>
                    {ad.link_clicks ?? '—'}
                  </td>
                  <td style={{ textAlign: 'right', color: (ad.meta_purchases ?? ad.purchases ?? 0) > 0 ? 'var(--teal)' : 'var(--muted2)' }}>
                    {ad.meta_purchases ?? ad.purchases ?? 0}
                  </td>
                </tr>
              )
            })}
          </tbody>
        </table>
      </div>
    </div>
  )
}
