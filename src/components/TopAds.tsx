import type { MetaAdDaily } from '../services/data'

interface Props {
  ads: MetaAdDaily[]
  loading: boolean
}

export function TopAds({ ads, loading }: Props) {
  if (loading) {
    return (
      <div style={{ color: '#555', fontFamily: 'monospace', fontSize: '0.8rem', padding: '12px 0' }}>
        Ładuję top reklamy...
      </div>
    )
  }
  if (ads.length === 0) {
    return (
      <div style={{ color: '#555', fontFamily: 'monospace', fontSize: '0.8rem', padding: '12px 0' }}>
        Brak danych reklamowych na dziś.
      </div>
    )
  }

  const total = ads.reduce((s, a) => s + (a.spend ?? 0), 0)

  return (
    <div>
      <div
        style={{
          fontSize: '0.7rem',
          color: '#555',
          fontFamily: 'monospace',
          textTransform: 'uppercase',
          letterSpacing: '0.1em',
          marginBottom: '10px',
        }}
      >
        Top reklamy / kampanie — dziś
      </div>
      <div style={{ overflowX: 'auto' }}>
        <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: '0.78rem', fontFamily: 'monospace' }}>
          <thead>
            <tr style={{ borderBottom: '1px solid #2a2a2a', color: '#555' }}>
              <th style={{ textAlign: 'left', padding: '4px 8px', fontWeight: 'normal' }}>Kampania</th>
              <th style={{ textAlign: 'right', padding: '4px 8px', fontWeight: 'normal' }}>Spend</th>
              <th style={{ textAlign: 'right', padding: '4px 8px', fontWeight: 'normal' }}>% budżetu</th>
              <th style={{ textAlign: 'right', padding: '4px 8px', fontWeight: 'normal' }}>Kliknięcia</th>
            </tr>
          </thead>
          <tbody>
            {ads.map((ad, i) => {
              const pct = total > 0 ? ((ad.spend / total) * 100).toFixed(0) : '—'
              const isHigh = total > 0 && ad.spend / total > 0.7

              return (
                <tr
                  key={ad.ad_id ?? i}
                  style={{
                    borderBottom: '1px solid #1a1a1a',
                    color: isHigh ? '#ff6b00' : '#ccc',
                  }}
                >
                  <td style={{ padding: '5px 8px', maxWidth: '200px', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                    {ad.campaign_name ?? ad.campaign_id ?? '—'}
                  </td>
                  <td style={{ textAlign: 'right', padding: '5px 8px' }}>
                    {ad.spend?.toFixed(2) ?? '—'} zł
                  </td>
                  <td style={{ textAlign: 'right', padding: '5px 8px', color: isHigh ? '#ff6b00' : '#888' }}>
                    {pct}%
                  </td>
                  <td style={{ textAlign: 'right', padding: '5px 8px' }}>
                    {ad.link_clicks ?? '—'}
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
