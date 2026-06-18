import { useState, useEffect } from 'react'
import type { DailyPerformance, MetaAdDaily, AutomationRun } from '../services/data'
import type { JsuFunnelSummary } from '../services/webinarFunnel'
import { fetchDataContract, type DataContractReport } from '../lib/dataAudit'

// Injected at build time by vite.config.ts
declare const __BUILD_HASH__: string
declare const __BUILD_TIME__: string

interface Props {
  perf: DailyPerformance | null
  trend: DailyPerformance[]
  ads: MetaAdDaily[]
  runs: AutomationRun[]
  jsuSummary: JsuFunnelSummary | null
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

export function DiagnosticsPanel({ perf, trend, ads, runs, jsuSummary }: Props) {
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
          <Row label="Data source"         value={jsuSummary?._debug?.source ?? '—'} ok={jsuSummary?._debug?.source === 'raw_tables'} />
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

      </div>
    </div>
  )
}
