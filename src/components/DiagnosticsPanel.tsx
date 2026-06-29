import { useState, useEffect } from 'react'
import type { DailyPerformance, MetaAdDaily, AutomationRun } from '../services/data'
import type { JsuFunnelSummary } from '../services/webinarFunnel'
import { fetchDataContract, type DataContractReport } from '../lib/dataAudit'
import type { OpsWeekReport } from '../lib/opsWeekReport'
import { fetchDataHealth, type DataHealthReport } from '../lib/dataHealth'

// Injected at build time by vite.config.ts
declare const __BUILD_HASH__: string
declare const __BUILD_TIME__: string

interface Props {
  perf: DailyPerformance | null
  trend: DailyPerformance[]
  ads: MetaAdDaily[]
  runs: AutomationRun[]
  jsuSummary: JsuFunnelSummary | null
  opsWeekReport: OpsWeekReport | null
  opsWeekLoading: boolean
  ttsLastElevenError?: string
  ttsFallbackActive?: boolean
  browserVoiceInfo?: { name: string; lang: string } | null
  englishVoiceCount?: number
  lastIntent?: string
  lastIntentConfidence?: number
  llmConnected?: boolean | null
  sttLastFinal?: string
  sttInterim?: string
  sttConfidence?: number | null
  sttStatus?: 'idle' | 'accepted' | 'rejected'
  sttRejectionReason?: string
  lastRefresh?: Date | null
  profitDataDate?: string | null
  profitDataOrders?: number | null
}

function Row({ label, value, ok }: { label: string; value: string; ok?: boolean | null }) {
  const color = ok === true ? 'var(--teal)' : ok === false ? 'var(--orange)' : 'var(--text2)'
  return (
    <div style={{ display: 'flex', justifyContent: 'space-between', padding: '9px 0', borderBottom: '1px solid var(--border)' }}>
      <span style={{ fontFamily: 'var(--font-mono)', fontSize: '0.76rem', color: 'var(--muted)' }}>{label}</span>
      <span style={{ fontFamily: 'var(--font-mono)', fontSize: '0.76rem', color, maxWidth: '55%', textAlign: 'right', wordBreak: 'break-all' }}>{value}</span>
    </div>
  )
}

export function DiagnosticsPanel({ perf, trend, ads, runs, jsuSummary, opsWeekReport, opsWeekLoading, ttsLastElevenError, ttsFallbackActive, browserVoiceInfo, englishVoiceCount, lastIntent, lastIntentConfidence, llmConnected, sttLastFinal, sttInterim, sttConfidence, sttStatus, sttRejectionReason, lastRefresh, profitDataDate, profitDataOrders }: Props) {
  const [dataContract, setDataContract] = useState<DataContractReport | null>(null)
  const [dataHealth, setDataHealth] = useState<DataHealthReport | null>(null)
  const [healthLoading, setHealthLoading] = useState(true)

  useEffect(() => {
    fetchDataContract().then(setDataContract).catch(() => {})
    fetchDataHealth().then(h => { setDataHealth(h); setHealthLoading(false) }).catch(() => setHealthLoading(false))
  }, [])

  const today = new Date().toLocaleDateString('en-CA', { timeZone: 'Europe/Warsaw' })
  const latestMetaDate = ads[0]?.date ?? trend.find(r => r.meta_spend > 0)?.date ?? '—'
  const latestWixDate  = trend[0]?.date ?? '—'
  const metaFresh      = latestMetaDate === today
  const wixFresh       = latestWixDate === today

  const latestRun = runs[0]
  const lastAutoRunAge = latestRun
    ? Math.round((Date.now() - new Date(latestRun.ran_at).getTime()) / 60000)
    : null

  const webinarSessions     = jsuSummary?._debug?.sessionsCount ?? 0
  const webinarParticipants = jsuSummary?._debug?.participantsCount ?? 0

  return (
    <div>
      <div className="section-title section-title-gold" style={{ marginBottom: '18px' }}>
        Diagnostics
      </div>

      <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '20px' }}>

        {/* Data freshness */}
        <div className="card" style={{ padding: '18px 20px' }}>
          <div style={{ fontFamily: 'var(--font-mono)', fontSize: '0.62rem', color: 'var(--muted2)', letterSpacing: '0.12em', textTransform: 'uppercase', marginBottom: '12px' }}>
            Data Freshness
          </div>
          <Row label="Today (Warsaw)" value={today} />
          <Row label="Latest Meta date"  value={latestMetaDate} ok={metaFresh} />
          <Row label="Latest Wix date"   value={latestWixDate}  ok={wixFresh} />
          <Row label="Meta rows loaded"  value={String(ads.length)} ok={ads.length > 0} />
          <Row label="Wix trend rows"    value={String(trend.length)} ok={trend.length > 0} />
          <Row label="Today's Wix orders" value={perf ? String(perf.wix_orders) : '—'} ok={perf != null} />
          <Row label="Today's Meta spend" value={perf ? perf.meta_spend.toFixed(2) + ' PLN' : '—'} ok={perf != null} />
          {profitDataDate != null && (
            <Row label="Profit data date"   value={profitDataDate} ok={profitDataDate === today} />
          )}
          {profitDataOrders != null && (
            <Row label="Profit paid orders" value={String(profitDataOrders)} ok={profitDataOrders > 0} />
          )}
          {lastRefresh && (
            <Row label="Last refresh"    value={lastRefresh.toLocaleTimeString('en-GB', { hour: '2-digit', minute: '2-digit', second: '2-digit' })} ok />
          )}
          <Row label="Auto-refresh"    value="every 60 s" ok />
        </div>

        {/* Automation */}
        <div className="card" style={{ padding: '18px 20px' }}>
          <div style={{ fontFamily: 'var(--font-mono)', fontSize: '0.62rem', color: 'var(--muted2)', letterSpacing: '0.12em', textTransform: 'uppercase', marginBottom: '12px' }}>
            Automation
          </div>
          <Row label="Last run scenario"
            value={latestRun?.scenario_name ?? '—'}
            ok={latestRun?.status === 'success'} />
          <Row label="Last run status"   value={latestRun?.status ?? '—'} ok={latestRun?.status === 'success'} />
          <Row label="Last run age"      value={lastAutoRunAge != null ? `${lastAutoRunAge} min ago` : '—'} ok={lastAutoRunAge != null && lastAutoRunAge < 120} />
          <Row label="Last run rows"     value={latestRun?.rows_inserted != null ? String(latestRun.rows_inserted) : '—'} />
          <Row label="Recent runs"       value={String(runs.length)} ok={runs.length > 0} />
        </div>

        {/* Webinars */}
        <div className="card" style={{ padding: '18px 20px' }}>
          <div style={{ fontFamily: 'var(--font-mono)', fontSize: '0.62rem', color: 'var(--muted2)', letterSpacing: '0.12em', textTransform: 'uppercase', marginBottom: '12px' }}>
            Webinars
          </div>
          <Row label="Sessions in DB"      value={String(webinarSessions)}     ok={webinarSessions > 0} />
          <Row label="Participants in DB"  value={String(webinarParticipants)} ok={webinarParticipants > 0} />
          <Row label="Latest session"      value={jsuSummary?._debug?.latestSessionName?.slice(0, 30) ?? '—'} />
          <Row label="Latest session date" value={jsuSummary?._debug?.latestSessionDate ?? '—'} />
          <Row label="Data source"         value={jsuSummary?._debug?.source ?? '—'} ok={jsuSummary?._debug?.source === 'raw_tables' || jsuSummary?._debug?.source === 'backend-function'} />
          <Row label="Bottleneck"          value={jsuSummary?.bottleneck ?? '—'} ok={jsuSummary?.bottleneck === 'OK'} />
        </div>

        {/* Build */}
        <div className="card" style={{ padding: '18px 20px' }}>
          <div style={{ fontFamily: 'var(--font-mono)', fontSize: '0.62rem', color: 'var(--muted2)', letterSpacing: '0.12em', textTransform: 'uppercase', marginBottom: '12px' }}>
            Build / System
          </div>
          <Row label="Build hash"     value={__BUILD_HASH__} ok />
          <Row label="Build time"     value={__BUILD_TIME__} />
          <Row label="TTS endpoint"   value="/.netlify/functions/gieniu-tts" ok />
          <Row label="TTS voice"      value={ttsFallbackActive ? 'Browser TTS (ElevenLabs paused)' : 'Stanley (ElevenLabs)'} ok={!ttsFallbackActive} />
          {ttsLastElevenError && (
            <Row label="Last ElevenLabs error" value={ttsLastElevenError.slice(0, 80)} ok={false} />
          )}
          {browserVoiceInfo && (
            <Row label="Browser voice" value={`${browserVoiceInfo.name} (${browserVoiceInfo.lang})`} />
          )}
          {englishVoiceCount != null && (
            <Row label="English voices available" value={String(englishVoiceCount)} ok={englishVoiceCount > 0} />
          )}
          <Row label="LLM Gateway"
            value={llmConnected === true ? 'connected' : llmConnected === false ? 'not connected' : 'unknown'}
            ok={llmConnected === true ? true : llmConnected === false ? false : null}
          />
          {lastIntent && (
            <Row label="Last intent"
              value={`${lastIntent} (${lastIntentConfidence != null ? (lastIntentConfidence * 100).toFixed(0) + '%' : '—'})`}
            />
          )}
          <Row label="SpeechRecognition"
            value={typeof window !== 'undefined' && ('SpeechRecognition' in window || 'webkitSpeechRecognition' in window) ? 'available' : 'not available'}
            ok={typeof window !== 'undefined' && ('SpeechRecognition' in window || 'webkitSpeechRecognition' in window) ? true : false}
          />
          {sttLastFinal && (
            <Row label="Last STT transcript"
              value={sttLastFinal.length > 50 ? sttLastFinal.slice(0, 50) + '…' : sttLastFinal}
            />
          )}
          {sttInterim && <Row label="STT interim" value={sttInterim.slice(0, 50)} />}
          {sttConfidence != null && (
            <Row label="STT confidence"
              value={`${(sttConfidence * 100).toFixed(0)}%`}
              ok={sttConfidence >= 0.65}
            />
          )}
          {sttStatus && sttStatus !== 'idle' && (
            <Row label="STT result" value={sttStatus} ok={sttStatus === 'accepted'} />
          )}
          {sttStatus === 'rejected' && sttRejectionReason && (
            <Row label="Rejection reason" value={sttRejectionReason} ok={false} />
          )}
          <Row label="PWA"            value={typeof window !== 'undefined' && 'serviceWorker' in navigator ? 'supported' : 'not supported'} />
          <Row label="Supabase"       value="connected" ok />
        </div>

        {/* Product Data Contract */}
        <div className="card" style={{ padding: '18px 20px', gridColumn: '1 / -1' }}>
          <div style={{ fontFamily: 'var(--font-mono)', fontSize: '0.62rem', color: 'var(--muted2)', letterSpacing: '0.12em', textTransform: 'uppercase', marginBottom: '12px' }}>
            Product Data Contract
          </div>
          {dataContract === null ? (
            <Row label="Status" value="checking…" />
          ) : (
            <>
              <Row label="orders table"             value={dataContract.wixOrdersTableExists ? 'found' : 'not found'} ok={dataContract.wixOrdersTableExists} />
              <Row label="product_name_raw column" value={dataContract.hasProductNameRaw ? 'present' : 'absent'} ok={dataContract.hasProductNameRaw} />
              <Row label="Product classification" value={dataContract.classificationAvailable ? 'available' : 'UNAVAILABLE'} ok={dataContract.classificationAvailable} />
              {dataContract.error && <Row label="Query error" value={dataContract.error} ok={false} />}
            </>
          )}
        </div>

        {/* Ops Week Report */}
        <div className="card" style={{ padding: '18px 20px', gridColumn: '1 / -1' }}>
          <div style={{ fontFamily: 'var(--font-mono)', fontSize: '0.62rem', color: 'var(--muted2)', letterSpacing: '0.12em', textTransform: 'uppercase', marginBottom: '12px' }}>
            Ops Week Report (JSU / Memory)
          </div>
          {opsWeekLoading || opsWeekReport === null ? (
            <Row label="Status" value={opsWeekLoading ? 'loading…' : 'not loaded'} />
          ) : !opsWeekReport.ok ? (
            <Row label="Error" value={opsWeekReport.error ?? 'unknown error'} ok={false} />
          ) : (
            <>
              <Row label="Week range"
                value={`${opsWeekReport.range.week_start} → ${opsWeekReport.range.week_end}`}
                ok />
              <Row label="JSU sessions (Thu 18:00)"
                value={String(opsWeekReport.webinars.this_week.jsu_sessions)}
                ok={opsWeekReport.webinars.this_week.jsu_sessions > 0} />
              <Row label="JSU participants this week"
                value={String(opsWeekReport.webinars.this_week.jsu_participants)}
                ok={opsWeekReport.webinars.this_week.jsu_participants > 0} />
              <Row label="JZK sessions (Tue 18:00)"
                value={String(opsWeekReport.webinars.this_week.jzk_sessions ?? 0)}
                ok={opsWeekReport.webinars.this_week.jzk_sessions > 0 ? true : null} />
              <Row label="JZK participants this week"
                value={String(opsWeekReport.webinars.this_week.jzk_participants ?? 0)}
                ok={opsWeekReport.webinars.this_week.jzk_participants > 0 ? true : null} />
              <Row label="Yesterday JSU webinar"
                value={opsWeekReport.summary.jsu_webinar_ran_yesterday ? 'yes' : 'no'}
                ok={opsWeekReport.summary.jsu_webinar_ran_yesterday} />
              <Row label="Yesterday JSU participants"
                value={String(opsWeekReport.webinars.yesterday.jsu_participants)}
                ok={opsWeekReport.webinars.yesterday.jsu_participants > 0} />
              <Row label="Yesterday JZK webinar"
                value={(opsWeekReport.summary.jzk_webinar_ran_yesterday ?? false) ? 'yes' : 'no'}
                ok={(opsWeekReport.summary.jzk_webinar_ran_yesterday ?? false) ? true : null} />
              <Row label="All Wix orders this week"
                value={String(opsWeekReport.orders.this_week.all_orders)}
                ok={opsWeekReport.orders.this_week.all_orders > 0} />
              <Row label="JSU course orders"
                value={opsWeekReport.orders.this_week.product_classification === 'available'
                  ? String(opsWeekReport.orders.this_week.jsu_course_orders)
                  : 'unavailable (no product data)'}
                ok={opsWeekReport.orders.this_week.product_classification === 'available'
                  ? opsWeekReport.orders.this_week.jsu_course_orders > 0
                  : null} />
              <Row label="Attribution"
                value={opsWeekReport.attribution.attribution_reason.slice(0, 60)}
                ok={opsWeekReport.attribution.attributed_sales > 0 ? true : null} />
              <Row label="Order source"
                value={opsWeekReport.debug.orderClassificationSource} />
              <Row label="Orders table"
                value={opsWeekReport.debug.ordersTable ?? '—'}
                ok={opsWeekReport.debug.ordersTable !== 'none' && opsWeekReport.debug.ordersTable != null ? true : null} />
              <Row label="Price rules applied"
                value={opsWeekReport.debug.priceRulesApplied ? 'yes' : 'no'}
                ok={opsWeekReport.debug.priceRulesApplied ?? null} />
              {(opsWeekReport.orders.this_week.price_warnings_count ?? 0) > 0 && (
                <Row label="Price fallback warnings"
                  value={`${opsWeekReport.orders.this_week.price_warnings_count} order(s) classified by price (Wix name was misleading)`}
                  ok={false} />
              )}
              {opsWeekReport.debug.webinarSessionsError && (
                <Row label="Sessions error" value={opsWeekReport.debug.webinarSessionsError.slice(0, 60)} ok={false} />
              )}
              {opsWeekReport.debug.wixOrdersError && (
                <Row label="Orders error" value={opsWeekReport.debug.wixOrdersError.slice(0, 60)} ok={false} />
              )}

              {/* Order diagnostics table */}
              {(opsWeekReport.orders.this_week.order_diagnostics?.length ?? 0) > 0 && (
                <div style={{ marginTop: '16px' }}>
                  <div style={{ fontFamily: 'var(--font-mono)', fontSize: '0.6rem', color: 'var(--muted2)', textTransform: 'uppercase', letterSpacing: '0.1em', marginBottom: '8px' }}>
                    Order Classification Details (this week)
                  </div>
                  <div style={{ overflowX: 'auto' }}>
                    <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: '0.68rem', fontFamily: 'var(--font-mono)' }}>
                      <thead>
                        <tr style={{ borderBottom: '1px solid var(--border)' }}>
                          {['Order ID', 'Email', 'Product name (Wix)', 'Amount', 'Classified', 'Reason'].map(h => (
                            <th key={h} style={{ textAlign: 'left', padding: '4px 8px', color: 'var(--muted2)', fontWeight: 400 }}>{h}</th>
                          ))}
                        </tr>
                      </thead>
                      <tbody>
                        {opsWeekReport.orders.this_week.order_diagnostics!.map((row, i) => (
                          <tr key={i} style={{ borderBottom: '1px solid var(--border)', background: row.classification_warning ? 'rgba(194,65,12,0.12)' : 'transparent' }}>
                            <td style={{ padding: '4px 8px', color: 'var(--muted)' }}>{row.external_order_id ?? '—'}</td>
                            <td style={{ padding: '4px 8px', color: 'var(--muted)' }}>{row.email_masked}</td>
                            <td style={{ padding: '4px 8px', color: row.classification_warning ? 'var(--orange)' : 'var(--text2)', maxWidth: '180px', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }} title={row.product_name_raw ?? ''}>{row.product_name_raw ?? '—'}</td>
                            <td style={{ padding: '4px 8px', color: 'var(--teal)', textAlign: 'right' }}>{row.amount > 0 ? `${row.amount} PLN` : '—'}</td>
                            <td style={{ padding: '4px 8px', color: row.classified_product === 'JSU_COURSE' ? '#c9a96e' : row.classified_product === 'JZK_LANGUAGE' ? '#2dd4bf' : row.classified_product === 'MEMORY_PACK' ? '#7dd3fc' : 'var(--muted)' }}>{row.classified_product}</td>
                            <td style={{ padding: '4px 8px', color: 'var(--muted2)', maxWidth: '200px', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }} title={row.classification_warning ?? row.classification_reason}>{row.classification_warning ?? row.classification_reason}</td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                </div>
              )}
            </>
          )}
        </div>

        {/* Data Health — backend service role check */}
        <div className="card" style={{ padding: '18px 20px', gridColumn: '1 / -1' }}>
          <div style={{ fontFamily: 'var(--font-mono)', fontSize: '0.62rem', color: 'var(--muted2)', letterSpacing: '0.12em', textTransform: 'uppercase', marginBottom: '12px' }}>
            Data Health (Service Role)
          </div>
          {healthLoading ? (
            <Row label="Status" value="checking…" />
          ) : dataHealth === null ? (
            <Row label="Status" value="data-health endpoint unreachable" ok={false} />
          ) : !dataHealth.ok ? (
            <Row label="Error" value={dataHealth.error ?? 'unknown'} ok={false} />
          ) : (
            <>
              {/* Orders */}
              <Row label="orders table count"
                value={dataHealth.orders.count != null ? String(dataHealth.orders.count) : (dataHealth.orders.count_error ?? '—')}
                ok={dataHealth.orders.count != null && dataHealth.orders.count > 0} />
              <Row label="latest order date"
                value={dataHealth.orders.latest_order_date ?? '—'}
                ok={dataHealth.orders.latest_order_date != null} />
              <Row label="today orders (Warsaw)"
                value={`${dataHealth.orders.today_count} · ${dataHealth.orders.today_revenue.toFixed(2)} PLN`}
                ok={dataHealth.orders.today_count > 0 ? true : null} />
              <Row label="this week orders"
                value={`${dataHealth.orders.week_count} · ${dataHealth.orders.week_revenue.toFixed(2)} PLN`}
                ok={dataHealth.orders.week_count > 0 ? true : null} />

              {/* Webinars */}
              <Row label="webinar_sessions count"
                value={dataHealth.webinars.sessions_count != null ? String(dataHealth.webinars.sessions_count) : '—'}
                ok={dataHealth.webinars.sessions_count != null && dataHealth.webinars.sessions_count > 0} />
              <Row label="webinar_participants count"
                value={dataHealth.webinars.participants_count != null ? String(dataHealth.webinars.participants_count) : '—'}
                ok={dataHealth.webinars.participants_count != null && dataHealth.webinars.participants_count > 0} />

              {/* Meta sources */}
              <Row label="Command Center source"
                value={dataHealth.meta.command_center_source.table}
                ok />
              <Row label="Command Center latest date"
                value={dataHealth.meta.command_center_source.latest_date ?? '—'}
                ok={dataHealth.meta.command_center_source.latest_date != null} />
              <Row label="Command Center has spend"
                value={dataHealth.meta.command_center_source.has_meta_spend
                  ? `yes — ${dataHealth.meta.command_center_source.total_spend_7d.toFixed(2)} PLN (7d)`
                  : 'no'}
                ok={dataHealth.meta.command_center_source.has_meta_spend} />
              <Row label="Campaigns source"
                value={dataHealth.meta.campaigns_source.table}
                ok={!dataHealth.meta.source_mismatch} />
              <Row label="meta_ads_daily count"
                value={dataHealth.meta.meta_ads_daily.count != null ? String(dataHealth.meta.meta_ads_daily.count) : '—'}
                ok={dataHealth.meta.meta_ads_daily.count != null && dataHealth.meta.meta_ads_daily.count > 0 ? true
                  : dataHealth.meta.meta_ads_daily.count === 0 ? false : null} />
              <Row label="meta_ads_daily latest date"
                value={dataHealth.meta.meta_ads_daily.latest_date ?? '—'}
                ok={dataHealth.meta.meta_ads_daily.latest_date != null ? true : null} />

              {/* Source mismatch warning */}
              {dataHealth.meta.source_mismatch && (
                <>
                  <Row label="⚠ Campaigns source mismatch"
                    value="MISMATCH DETECTED"
                    ok={false} />
                  <div style={{ marginTop: '8px', fontFamily: 'var(--font-mono)', fontSize: '0.72rem', color: 'var(--orange)', lineHeight: 1.5, paddingBottom: '8px', borderBottom: '1px solid var(--border)' }}>
                    {dataHealth.meta.source_mismatch_explanation}
                  </div>
                </>
              )}

              {/* Latest 5 orders */}
              {dataHealth.orders.latest_5.length > 0 && (
                <div style={{ marginTop: '16px' }}>
                  <div style={{ fontFamily: 'var(--font-mono)', fontSize: '0.6rem', color: 'var(--muted2)', textTransform: 'uppercase', letterSpacing: '0.1em', marginBottom: '8px' }}>
                    Latest 5 Orders (service role)
                  </div>
                  <div style={{ overflowX: 'auto' }}>
                    <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: '0.68rem', fontFamily: 'var(--font-mono)' }}>
                      <thead>
                        <tr style={{ borderBottom: '1px solid var(--border)' }}>
                          {['Order ID', 'Email', 'Product (Wix)', 'Amount', 'Date'].map(h => (
                            <th key={h} style={{ textAlign: 'left', padding: '4px 8px', color: 'var(--muted2)', fontWeight: 400 }}>{h}</th>
                          ))}
                        </tr>
                      </thead>
                      <tbody>
                        {dataHealth.orders.latest_5.map((row, i) => (
                          <tr key={i} style={{ borderBottom: '1px solid var(--border)' }}>
                            <td style={{ padding: '4px 8px', color: 'var(--muted)' }}>{row.external_order_id}</td>
                            <td style={{ padding: '4px 8px', color: 'var(--muted)' }}>{row.email_masked}</td>
                            <td style={{ padding: '4px 8px', color: 'var(--text2)', maxWidth: '180px', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{row.product_name_raw}</td>
                            <td style={{ padding: '4px 8px', color: 'var(--teal)', textAlign: 'right' }}>{row.amount > 0 ? `${row.amount} PLN` : '—'}</td>
                            <td style={{ padding: '4px 8px', color: 'var(--muted)' }}>{row.order_date}</td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                </div>
              )}

              {/* Meta campaign names (if available) */}
              {dataHealth.meta.meta_ads_daily.campaign_names.length > 0 && (
                <div style={{ marginTop: '12px', fontFamily: 'var(--font-mono)', fontSize: '0.68rem', color: 'var(--muted2)' }}>
                  Latest campaign names: {dataHealth.meta.meta_ads_daily.campaign_names.join(', ')}
                </div>
              )}
            </>
          )}
        </div>

      </div>
    </div>
  )
}
