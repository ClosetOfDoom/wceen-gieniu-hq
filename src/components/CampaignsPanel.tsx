import { useState, useEffect, useMemo } from 'react'
import {
  fetchCampaignRows, buildCampaignDiagnosis,
  type CampaignDiagnosis, type CampaignScope, type CampaignEntry,
  type CampaignFetchResult,
} from '../lib/campaignDiagnosis'
import type { MetaAdDaily } from '../services/data'
import { RangeSwitcher } from './RangeSwitcher'
import { rangeDates, rangeSubLabel, RANGE_LABELS, type TimeRange } from '../lib/timeRange'

// ── Helpers ───────────────────────────────────────────────────────────────────

function fmtPln(n: number | null | undefined): string {
  if (n == null) return '—'
  return n.toFixed(2) + ' PLN'
}
function fmtPct(n: number | null | undefined): string {
  if (n == null) return '—'
  return (n * 100).toFixed(1) + '%'
}

// ── Status badge ──────────────────────────────────────────────────────────────

const STATUS_COLORS: Record<string, string> = {
  'efficient':       'var(--teal)',
  'expensive':       'var(--orange)',
  'zero-attribution':'var(--amber)',
  'needs-watch':     'var(--red)',
  'unclassified':    'var(--muted2)',
}

function StatusBadge({ status }: { status: string }) {
  return (
    <span style={{
      fontFamily: 'var(--font-mono)', fontSize: '0.65rem',
      color: STATUS_COLORS[status] ?? 'var(--muted2)',
      border: `1px solid ${STATUS_COLORS[status] ?? 'var(--border)'}`,
      borderRadius: '3px', padding: '2px 6px', whiteSpace: 'nowrap',
      opacity: 0.9,
    }}>
      {status}
    </span>
  )
}

// ── Scope chip row ────────────────────────────────────────────────────────────

const SCOPE_LABELS: { key: CampaignScope; label: string }[] = [
  { key: 'JSU', label: 'Memory / JSU' },
  { key: 'JZK', label: 'Językozak AI' },
  { key: 'ALL', label: 'All campaigns' },
]

function ScopeChips({ scope, onChange }: { scope: CampaignScope; onChange: (s: CampaignScope) => void }) {
  return (
    <div style={{ display: 'flex', gap: '6px', flexWrap: 'wrap', marginBottom: '18px' }}>
      {SCOPE_LABELS.map(({ key, label }) => (
        <button
          key={key}
          onClick={() => onChange(key)}
          className={scope === key ? 'scope-chip active' : 'scope-chip'}
        >
          {label}
        </button>
      ))}
    </div>
  )
}

// ── Summary cards ─────────────────────────────────────────────────────────────

function SummaryCards({ d }: { d: CampaignDiagnosis }) {
  const { totals, bestCampaign, worstCampaign, usedDate, isStale } = d
  const items = [
    { label: 'Total Spend',  value: fmtPln(totals.spend), accent: false },
    { label: 'Meta Purchases', value: String(totals.purchases), accent: true },
    { label: 'Meta CPA',     value: fmtPln(totals.metaCpa), accent: false },
    { label: 'Best Ad',
      value: bestCampaign
        ? `${bestCampaign.ad_name.slice(0, 20)}${bestCampaign.ad_name.length > 20 ? '…' : ''}`
        : '—',
      sub: bestCampaign ? `CPA ${(bestCampaign.metaCpa ?? 0).toFixed(0)} PLN` : '',
      accent: false,
    },
    { label: 'Weakest Ad',
      value: worstCampaign && worstCampaign !== bestCampaign
        ? `${worstCampaign.ad_name.slice(0, 20)}${worstCampaign.ad_name.length > 20 ? '…' : ''}`
        : bestCampaign ? 'same as best' : '—',
      sub: worstCampaign && worstCampaign !== bestCampaign ? `CPA ${(worstCampaign.metaCpa ?? 0).toFixed(0)} PLN` : '',
      accent: false,
    },
    { label: 'Data Date', value: usedDate || '—', sub: isStale ? 'stale' : 'live', accent: false },
  ]
  return (
    <div style={{ display: 'flex', flexWrap: 'wrap', gap: '10px', marginBottom: '20px' }}>
      {items.map(item => (
        <div key={item.label} style={{
          flex: '1 1 140px', minWidth: 130, background: 'var(--surface2)',
          border: '1px solid var(--border)', borderRadius: '5px',
          padding: '14px 16px',
        }}>
          <div style={{ fontFamily: 'var(--font-mono)', fontSize: '0.62rem', color: 'var(--muted2)', letterSpacing: '0.12em', textTransform: 'uppercase', marginBottom: '6px' }}>
            {item.label}
          </div>
          <div style={{ fontFamily: 'var(--font-mono)', fontSize: '0.9rem', color: item.accent ? 'var(--teal)' : 'var(--text)', fontWeight: 600 }}>
            {item.value}
          </div>
          {item.sub && (
            <div style={{ fontFamily: 'var(--font-mono)', fontSize: '0.65rem', color: 'var(--muted)', marginTop: '3px' }}>
              {item.sub}
            </div>
          )}
        </div>
      ))}
    </div>
  )
}

// ── Bar chart (inline) ────────────────────────────────────────────────────────

function SpendBarChart({ campaigns }: { campaigns: CampaignEntry[] }) {
  if (campaigns.length === 0) return null
  const maxSpend = Math.max(...campaigns.map(c => c.spend), 1)
  const hasPurchases = campaigns.some(c => c.purchases > 0)

  return (
    <div style={{ marginBottom: '22px' }}>
      <div style={{ fontFamily: 'var(--font-mono)', fontSize: '0.62rem', color: 'var(--muted2)', letterSpacing: '0.12em', textTransform: 'uppercase', marginBottom: '10px' }}>
        Spend Distribution
      </div>
      {campaigns.map(c => (
        <div key={c.campaign_id + c.ad_name} style={{ marginBottom: '8px' }}>
          <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: '3px' }}>
            <span style={{ fontFamily: 'var(--font-mono)', fontSize: '0.72rem', color: 'var(--text2)',
              maxWidth: '55%', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
              {c.ad_name}
            </span>
            <span style={{ fontFamily: 'var(--font-mono)', fontSize: '0.72rem', color: 'var(--muted)' }}>
              {c.spend.toFixed(0)} PLN
              {hasPurchases && c.purchases > 0 && (
                <span style={{ marginLeft: '8px', color: 'var(--teal)' }}>
                  ×{c.purchases} @ {(c.metaCpa ?? 0).toFixed(0)}
                </span>
              )}
            </span>
          </div>
          <div style={{ height: '5px', background: 'var(--surface3)', borderRadius: '2px', overflow: 'hidden' }}>
            <div style={{
              height: '100%', borderRadius: '2px',
              width: `${(c.spend / maxSpend) * 100}%`,
              background: c.status === 'zero-attribution' ? 'var(--amber)' :
                          c.status === 'efficient'        ? 'var(--teal)' :
                          c.status === 'expensive'        ? 'var(--orange)' :
                          'var(--border-gold)',
              transition: 'width 0.4s ease',
            }} />
          </div>
        </div>
      ))}
    </div>
  )
}

// ── Campaign table ────────────────────────────────────────────────────────────

function CampaignTable({ campaigns }: { campaigns: CampaignEntry[] }) {
  if (campaigns.length === 0) return null
  return (
    <div className="data-table-wrap" style={{ marginBottom: '22px' }}>
      <table className="data-table">
        <thead>
          <tr>
            <th style={{ textAlign: 'left' }}>Ad / Creative</th>
            <th style={{ textAlign: 'right' }}>Spend PLN</th>
            <th style={{ textAlign: 'right' }}>Purch.</th>
            <th style={{ textAlign: 'right' }}>CPA</th>
            <th style={{ textAlign: 'right' }}>CTR</th>
            <th style={{ textAlign: 'right' }}>CPC</th>
            <th style={{ textAlign: 'right' }}>Clicks</th>
            <th style={{ textAlign: 'left' }}>Diagnosis</th>
          </tr>
        </thead>
        <tbody>
          {campaigns.map((c, i) => (
            <tr key={c.campaign_id + c.ad_name + i}>
              <td style={{ maxWidth: '180px', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', color: 'var(--text2)' }}>
                {c.ad_name}
              </td>
              <td style={{ textAlign: 'right', color: c.spendShare > 0.5 ? 'var(--orange)' : 'var(--text2)' }}>
                {c.spend.toFixed(2)}
              </td>
              <td style={{ textAlign: 'right', color: c.purchases > 0 ? 'var(--teal)' : 'var(--muted2)' }}>
                {c.purchases}
              </td>
              <td style={{ textAlign: 'right', color: c.metaCpa == null ? 'var(--muted2)' : c.metaCpa < 50 ? 'var(--teal)' : 'var(--orange)' }}>
                {c.metaCpa != null ? c.metaCpa.toFixed(0) : '—'}
              </td>
              <td style={{ textAlign: 'right', color: 'var(--muted)' }}>
                {c.ctr != null ? fmtPct(c.ctr / 100) : '—'}
              </td>
              <td style={{ textAlign: 'right', color: 'var(--muted)' }}>
                {c.cpc != null ? c.cpc.toFixed(2) : '—'}
              </td>
              <td style={{ textAlign: 'right', color: 'var(--muted)' }}>
                {c.linkClicks}
              </td>
              <td>
                <StatusBadge status={c.status} />
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  )
}

// ── Diagnosis card ────────────────────────────────────────────────────────────

function DiagnosisCard({ text, scope }: { text: string; scope: CampaignScope }) {
  if (!text) return null
  const scopeLabel = scope === 'JSU' ? 'Memory / JSU campaigns' : scope === 'JZK' ? 'Językozak AI campaigns' : 'all campaigns'
  return (
    <div style={{
      background: 'var(--surface2)', border: '1px solid var(--border-gold)',
      borderRadius: '5px', padding: '16px 18px',
    }}>
      <div style={{ fontFamily: 'var(--font-mono)', fontSize: '0.62rem', color: 'var(--gold)', letterSpacing: '0.12em', textTransform: 'uppercase', marginBottom: '8px' }}>
        STANLEY Diagnosis — {scopeLabel}
      </div>
      <pre style={{ fontFamily: 'var(--font-mono)', fontSize: '0.8rem', color: 'var(--text2)', whiteSpace: 'pre-wrap', lineHeight: 1.7, margin: 0 }}>
        {text}
      </pre>
    </div>
  )
}

// ── Main panel ────────────────────────────────────────────────────────────────

export function CampaignsPanel() {
  const [allRows, setAllRows] = useState<MetaAdDaily[]>([])
  const [usedDate, setUsedDate] = useState('')
  const [requestedDate, setRequestedDate] = useState('')
  const [loading, setLoading] = useState(true)
  const [scope, setScope] = useState<CampaignScope>('JSU')
  const [range, setRange] = useState<TimeRange>('today')
  const [datesPresent, setDatesPresent] = useState<string[]>([])
  const [fetchResult, setFetchResult] = useState<CampaignFetchResult | null>(null)

  // Refetch (aggregated per creative) whenever the time range changes.
  useEffect(() => {
    setLoading(true)
    fetchCampaignRows(rangeDates(range)).then((result) => {
      setFetchResult(result)
      setAllRows(result.rows)
      setUsedDate(result.usedDate)
      setRequestedDate(result.requestedDate)
      setDatesPresent(result.datesPresent ?? [])
      setLoading(false)
    })
  }, [range])

  // Actual data coverage — what dates the rows really span (fixes header vs data).
  const coverage = datesPresent.length === 0
    ? '—'
    : datesPresent.length === 1
      ? datesPresent[0]
      : `${datesPresent[0]} → ${datesPresent[datesPresent.length - 1]} (${datesPresent.length} dni)`

  const diagnosis: CampaignDiagnosis = useMemo(
    () => buildCampaignDiagnosis(allRows, scope, requestedDate, usedDate),
    [allRows, scope, requestedDate, usedDate],
  )

  const isStale  = diagnosis.isStale
  const hasRows  = diagnosis.rowCount > 0
  const sourceMismatch = fetchResult?.sourceMismatch ?? false
  const fetchError = fetchResult?.fetchError ?? null

  // Empty/error state type:
  // A) fetchError: network/auth error
  // B) sourceMismatch: aggregate spend found but no campaign rows
  // C) no data at all
  const emptyStateType = fetchError
    ? 'error'
    : !hasRows
      ? (sourceMismatch ? 'mismatch' : 'empty')
      : null

  return (
    <div>
      {/* Header */}
      <div style={{ display: 'flex', alignItems: 'baseline', justifyContent: 'space-between', marginBottom: '12px', flexWrap: 'wrap', gap: '8px' }}>
        <div className="section-title section-title-gold" style={{ margin: 0 }}>
          Campaigns
        </div>
        <span style={{ fontFamily: 'var(--font-mono)', fontSize: '0.68rem', color: 'var(--muted)' }}>
          {loading ? 'Loading…' : hasRows
            ? `${rangeSubLabel(range)} · dane: ${coverage}`
            : sourceMismatch
              ? `Aggregate spend found, no campaign rows · source: v_daily_wix_meta_performance`
              : `Brak danych reklam dla zakresu ${RANGE_LABELS[range]}`}
        </span>
      </div>

      {/* Time-range switcher — same control as Command Center */}
      <div style={{ marginBottom: '16px' }}>
        <RangeSwitcher range={range} onChange={setRange} showSub={false} />
      </div>

      {/* Stale notice */}
      {isStale && hasRows && (
        <div style={{
          fontFamily: 'var(--font-mono)', fontSize: '0.76rem', color: 'var(--amber)',
          padding: '8px 14px', background: 'rgba(251,191,36,0.06)',
          border: '1px solid rgba(251,191,36,0.2)', borderRadius: '3px', marginBottom: '14px',
        }}>
          ⚠ Today's Meta campaign rows are not in yet. Showing latest available data from {usedDate}.
        </div>
      )}

      {/* State Error: network/auth failure during fetch */}
      {!loading && emptyStateType === 'error' && (
        <div style={{
          padding: '16px 20px', fontFamily: 'var(--font-mono)', fontSize: '0.8rem',
          background: 'rgba(239,68,68,0.05)', border: '1px solid rgba(239,68,68,0.3)',
          borderRadius: '5px', marginBottom: '14px',
        }}>
          <div style={{ color: 'var(--red)', fontWeight: 600, marginBottom: '6px' }}>
            ✕ Failed to load campaign data
          </div>
          <div style={{ color: 'var(--muted)', fontSize: '0.72rem' }}>
            {fetchError}
          </div>
        </div>
      )}

      {/* State A: Meta spend exists but campaign rows missing */}
      {!loading && emptyStateType === 'mismatch' && (
        <div style={{
          padding: '24px', fontFamily: 'var(--font-mono)', fontSize: '0.8rem',
          background: 'rgba(251,191,36,0.04)', border: '1px solid rgba(251,191,36,0.25)',
          borderRadius: '5px', marginBottom: '14px',
        }}>
          <div style={{ color: 'var(--amber)', fontWeight: 600, marginBottom: '10px', fontSize: '0.82rem' }}>
            ⚠ Meta spend exists, but campaign-level rows are missing.
          </div>
          <div style={{ color: 'var(--text2)', lineHeight: 1.7 }}>
            <div>Source used by Command Center: <span style={{ color: 'var(--teal)' }}>v_daily_wix_meta_performance</span></div>
            <div>Total Meta spend (last 7d): <span style={{ color: 'var(--teal)' }}>{(fetchResult?.aggregateSpendTotal ?? 0).toFixed(2)} PLN</span></div>
            <div>Latest aggregate date: <span style={{ color: 'var(--muted)' }}>{fetchResult?.aggregateLatestDate ?? '—'}</span></div>
            <div style={{ marginTop: '8px' }}>Campaigns source: <span style={{ color: 'var(--orange)' }}>meta_ads_daily — 0 rows</span></div>
          </div>
          <div style={{ marginTop: '12px', fontSize: '0.72rem', color: 'var(--muted2)', lineHeight: 1.6 }}>
            Missing required fields in meta_ads_daily: campaign_name, spend, clicks, purchases.<br />
            Check that the Meta webhook maps data into the meta_ads_daily table.
          </div>
        </div>
      )}

      {/* State B: No Meta data anywhere */}
      {!loading && emptyStateType === 'empty' && (
        <div style={{
          padding: '32px', textAlign: 'center',
          fontFamily: 'var(--font-mono)', fontSize: '0.8rem', color: 'var(--muted)',
          background: 'var(--surface2)', border: '1px dashed var(--border)', borderRadius: '5px',
          marginBottom: '14px',
        }}>
          <div style={{ marginBottom: '10px', opacity: 0.4, fontSize: '2rem' }}>📊</div>
          No Meta data found in Supabase.
          <div style={{ marginTop: '8px', fontSize: '0.72rem', color: 'var(--muted2)' }}>
            meta_ads_daily: 0 rows · v_daily_wix_meta_performance: no spend
          </div>
        </div>
      )}

      {/* Scope chips */}
      {!loading && <ScopeChips scope={scope} onChange={setScope} />}

      {/* Scope label */}
      {!loading && hasRows && (
        <div style={{ fontFamily: 'var(--font-mono)', fontSize: '0.68rem', color: 'var(--muted2)', marginBottom: '16px' }}>
          Scope: {scope === 'JSU' ? 'Memory / JSU campaigns' : scope === 'JZK' ? 'Językozak AI campaigns' : 'All campaigns'}
          {' '}— {diagnosis.rowCount} campaign{diagnosis.rowCount !== 1 ? 's' : ''}
          {diagnosis.allRowCount !== diagnosis.rowCount ? ` (${diagnosis.allRowCount} total)` : ''}
        </div>
      )}

      {/* Loading */}
      {loading && (
        <div style={{ fontFamily: 'var(--font-mono)', fontSize: '0.76rem', color: 'var(--muted)', padding: '12px 0' }}>
          Loading campaign data…
        </div>
      )}

      {/* Content */}
      {!loading && hasRows && (
        <>
          <SummaryCards d={diagnosis} />
          <SpendBarChart campaigns={diagnosis.campaigns} />
          <CampaignTable campaigns={diagnosis.campaigns} />
          <DiagnosisCard text={diagnosis.diagnosisText} scope={scope} />
          {/* Honest provenance — conversions are what the sync stored, not a live Meta pull */}
          <div style={{ marginTop: '12px', fontFamily: 'var(--font-mono)', fontSize: '0.66rem', color: 'var(--muted2)', lineHeight: 1.7 }}>
            Purch. = kolumna <span style={{ color: 'var(--muted)' }}>meta_purchases</span> z meta_ads_daily (sync Make).
            Może różnić się od Meta Ads Manager „Wyniki / Zakupy w witrynie" (inna atrybucja / typ akcji / dosync konwersji).
            {usedDate ? ` Najnowsza data w danych: ${usedDate}.` : ''}
            {' '}Spend i konwersje sumowane po dacie dla wybranego zakresu — jeśli różni się od Meta, źródłem jest sync (meta_ads_daily), nie agregacja.
          </div>
        </>
      )}
    </div>
  )
}
