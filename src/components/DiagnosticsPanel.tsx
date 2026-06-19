import { useState, useEffect } from 'react'
import type { DailyPerformance, MetaAdDaily, AutomationRun } from '../services/data'
import type { JsuFunnelSummary } from '../services/webinarFunnel'
import { fetchDataContract, type DataContractReport } from '../lib/dataAudit'
import type { OpsWeekReport } from '../lib/opsWeekReport'

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

export function DiagnosticsPanel({ perf, trend, ads, runs, jsuSummary, opsWeekReport, opsWeekLoading }: Props) {
  const [dataContract, setDataContract] = useState<DataContractReport | null>(null)

  useEffect(() => {
    fetchDataContract().then(setDataContract).catch(() => {})
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
          <Row label="TTS voice"      value="George (ElevenLabs)" ok />
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
              <Row label="wix_orders table"        value={dataContract.wixOrdersTableExists ? 'exists' : 'not found'} ok={dataContract.wixOrdersTableExists} />
              <Row label="product_name column"     value={dataContract.hasProductName ? 'present' : 'absent'} ok={dataContract.hasProductName} />
              <Row label="item_name column"        value={dataContract.hasItemName ? 'present' : 'absent'} ok={dataContract.hasItemName} />
              <Row label="line_items column"       value={dataContract.hasLineItems ? 'present' : 'absent'} ok={dataContract.hasLineItems} />
              <Row label="Product classification" value={dataContract.classificationAvailable ? 'available' : 'UNAVAILABLE — orders unclassifiable'} ok={dataContract.classificationAvailable} />
              {dataContract.error && <Row label="Query error" value={dataContract.error} ok={false} />}
              {!dataContract.classificationAvailable && (
                <div style={{ marginTop: '10px', fontFamily: 'var(--font-mono)', fontSize: '0.72rem', color: 'var(--orange)', lineHeight: 1.5 }}>
                  GIENIU cannot answer "how many memory bundles" until line items are saved per order.<br />
                  Fix: extend Make → Wix scenario → see docs/wix_orders_product_mapping_fix.md
                </div>
              )}
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
                          <tr key={i} style={{ borderBottom: '1px solid var(--border)', background: row.classification_warning ? '#1a0d00' : 'transparent' }}>
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

      </div>
    </div>
  )
}
