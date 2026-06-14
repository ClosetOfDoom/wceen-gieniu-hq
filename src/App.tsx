import { useState, useEffect, useCallback } from 'react'
import { KPICard } from './components/KPICard'
import { StatusBadge } from './components/StatusBadge'
import { CommandPanel } from './components/CommandPanel'
import { GieniuResponse } from './components/GieniuResponse'
import { VoiceControls } from './components/VoiceControls'
import { TopAds } from './components/TopAds'
import { AutomationRuns } from './components/AutomationRuns'
import { WebinarFunnelPanel } from './components/WebinarFunnelPanel'
import {
  fetchTodayPerformance, fetchTopAds, fetchAutomationRuns,
  computeStatus, type DailyPerformance, type MetaAdDaily, type AutomationRun, type DataStatus,
} from './services/data'
import {
  loadJsuWebinarFunnel, loadJsuParticipantJourney,
  type JsuFunnelSummary, type JsuParticipantRow,
} from './services/webinarFunnel'
import {
  buildRevenueReport, buildOperationalReport, buildPipelineReport,
  buildCPAThresholds, buildCPAThresholdsLang, buildRedFlags,
  buildCreativesReport, buildRetargetingReport, buildMailRhythm, buildWeeklyPlan,
  buildJsuWebinarReport, buildWhyCourseNotSelling, buildJsuFunnelReport,
  buildCompareJsuWebinars, buildDeliverabilityReport, buildMailingDiagnosis,
  buildAttendanceRateReport, buildWhoAttendedAndBought,
  type CommandKey, type JsuCommandKey,
} from './brain/responses'

type AppTab = 'dashboard' | 'jsu-funnel'

function fmtZl(n: number | null | undefined): string {
  if (n == null) return '—'
  return n.toLocaleString('pl-PL', { minimumFractionDigits: 2, maximumFractionDigits: 2 }) + ' zł'
}
function fmtNum(n: number | null | undefined): string {
  if (n == null) return '—'
  return n.toLocaleString('pl-PL')
}
function fmtRoas(n: number | null | undefined): string {
  if (n == null) return '—'
  return n.toFixed(2) + 'x'
}

export default function App() {
  // ── Tab ──────────────────────────────────────────────────────────────────
  const [activeTab, setActiveTab] = useState<AppTab>('dashboard')

  // ── Dashboard data ────────────────────────────────────────────────────────
  const [perf, setPerf] = useState<DailyPerformance | null>(null)
  const [ads, setAds] = useState<MetaAdDaily[]>([])
  const [runs, setRuns] = useState<AutomationRun[]>([])
  const [status, setStatus] = useState<DataStatus>('NO_DATA')
  const [loading, setLoading] = useState(true)
  const [adsLoading, setAdsLoading] = useState(true)
  const [runsLoading, setRunsLoading] = useState(true)
  const [response, setResponse] = useState('')
  const [lastRefresh, setLastRefresh] = useState<Date | null>(null)

  // ── JSU Funnel data ───────────────────────────────────────────────────────
  const [jsuSummary, setJsuSummary] = useState<JsuFunnelSummary | null>(null)
  const [jsuParticipants, setJsuParticipants] = useState<JsuParticipantRow[]>([])
  const [jsuLoading, setJsuLoading] = useState(false)
  const [jsuParticipantsLoading, setJsuParticipantsLoading] = useState(false)
  const [jsuResponse, setJsuResponse] = useState('')

  // ── Loaders ───────────────────────────────────────────────────────────────
  const loadData = useCallback(async () => {
    setLoading(true)
    const p = await fetchTodayPerformance()
    setPerf(p)
    setStatus(computeStatus(p))
    setLoading(false)
    setLastRefresh(new Date())
  }, [])

  const loadAds = useCallback(async () => {
    setAdsLoading(true)
    const a = await fetchTopAds()
    setAds(a)
    setAdsLoading(false)
  }, [])

  const loadRuns = useCallback(async () => {
    setRunsLoading(true)
    const r = await fetchAutomationRuns()
    setRuns(r)
    setRunsLoading(false)
  }, [])

  const loadJsuFunnel = useCallback(async () => {
    setJsuLoading(true)
    const summary = await loadJsuWebinarFunnel()
    setJsuSummary(summary)
    setJsuLoading(false)
  }, [])

  const loadJsuParticipants = useCallback(async () => {
    setJsuParticipantsLoading(true)
    const rows = await loadJsuParticipantJourney()
    setJsuParticipants(rows)
    setJsuParticipantsLoading(false)
  }, [])

  useEffect(() => {
    loadData()
    loadAds()
    loadRuns()
    loadJsuFunnel()
    loadJsuParticipants()
    const interval = setInterval(() => { loadData(); loadAds() }, 5 * 60 * 1000)
    return () => clearInterval(interval)
  }, [loadData, loadAds, loadRuns, loadJsuFunnel, loadJsuParticipants])

  // ── Command handlers ──────────────────────────────────────────────────────
  function handleCommand(key: CommandKey) {
    let text = ''
    switch (key) {
      case 'revenue dzisiaj':      text = buildRevenueReport(perf, status); break
      case 'raport operacyjny':    text = buildOperationalReport(perf, status); break
      case 'pipeline':             text = buildPipelineReport(); break
      case 'progi CPA':            text = buildCPAThresholds(); break
      case 'progi CPA językowy':   text = buildCPAThresholdsLang(); break
      case 'red flagi':            text = buildRedFlags(perf); break
      case 'kreatywy':             text = buildCreativesReport(); break
      case 'retargeting':          text = buildRetargetingReport(); break
      case 'rytm maili':           text = buildMailRhythm(); break
      case 'co tydzień':           text = buildWeeklyPlan(); break
    }
    setResponse(text)
  }

  function handleJsuCommand(key: JsuCommandKey) {
    let text = ''
    switch (key) {
      case 'webinar jak się uczyć':      text = buildJsuWebinarReport(jsuSummary); break
      case 'czemu kurs się nie sprzedaje': text = buildWhyCourseNotSelling(jsuSummary); break
      case 'funnel JSU':                 text = buildJsuFunnelReport(jsuSummary); break
      case 'porównaj webinary JSU':      text = buildCompareJsuWebinars(jsuSummary); break
      case 'deliverability':             text = buildDeliverabilityReport(jsuSummary); break
      case 'czy mailing siadł':          text = buildMailingDiagnosis(jsuSummary); break
      case 'attendance rate':            text = buildAttendanceRateReport(jsuSummary); break
      case 'kto był i kupił':            text = buildWhoAttendedAndBought(jsuSummary); break
    }
    setJsuResponse(text)
  }

  const cpaHigh = perf?.real_cpa != null && perf.real_cpa > 50

  return (
    <div style={{ minHeight: '100vh', background: '#0d0d0d', color: '#e0e0e0' }}>

      {/* ── Header ── */}
      <header
        style={{
          padding: '14px 20px',
          borderBottom: '1px solid #1a1a1a',
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'space-between',
          position: 'sticky',
          top: 0,
          background: '#0d0d0d',
          zIndex: 10,
          flexWrap: 'wrap',
          gap: '10px',
        }}
      >
        <div style={{ display: 'flex', alignItems: 'center', gap: '14px' }}>
          <span
            style={{
              fontFamily: 'monospace',
              fontWeight: 900,
              fontSize: '1.1rem',
              letterSpacing: '0.12em',
              color: '#e8ff00',
            }}
          >
            GIENIU HQ
          </span>
          <StatusBadge status={status} />
        </div>

        <div style={{ display: 'flex', gap: '8px', alignItems: 'center', flexWrap: 'wrap' }}>
          {lastRefresh && (
            <span style={{ fontSize: '0.65rem', color: '#444', fontFamily: 'monospace' }}>
              {lastRefresh.toLocaleTimeString('pl-PL', { hour: '2-digit', minute: '2-digit' })}
            </span>
          )}
          <button
            className="btn-sm"
            onClick={() => { loadData(); loadAds(); loadRuns(); loadJsuFunnel() }}
            disabled={loading}
          >
            {loading ? '...' : 'Odśwież'}
          </button>
        </div>
      </header>

      {/* ── Tab bar ── */}
      <div
        style={{
          borderBottom: '1px solid #1a1a1a',
          padding: '0 20px',
          display: 'flex',
          gap: '4px',
          background: '#0d0d0d',
          position: 'sticky',
          top: '53px',
          zIndex: 9,
        }}
      >
        {([
          ['dashboard', 'Dashboard'],
          ['jsu-funnel', 'JSU Webinar Funnel'],
        ] as [AppTab, string][]).map(([tab, label]) => (
          <button
            key={tab}
            onClick={() => setActiveTab(tab)}
            style={{
              background: 'transparent',
              border: 'none',
              borderBottom: activeTab === tab ? '2px solid #e8ff00' : '2px solid transparent',
              color: activeTab === tab ? '#e8ff00' : '#555',
              fontFamily: 'monospace',
              fontSize: '0.78rem',
              padding: '10px 16px',
              cursor: 'pointer',
              letterSpacing: '0.05em',
              transition: 'color 0.15s',
            }}
          >
            {label}
            {tab === 'jsu-funnel' && jsuSummary && jsuSummary.bottleneck !== 'OK' && jsuSummary.bottleneck !== 'NO_DATA' && jsuSummary.bottleneck !== 'NO_SOURCES' && (
              <span style={{ marginLeft: '6px', color: '#ff6b00', fontSize: '0.7rem' }}>●</span>
            )}
          </button>
        ))}
      </div>

      <main style={{ maxWidth: '1200px', margin: '0 auto', padding: '20px 16px' }}>

        {/* ── DASHBOARD TAB ── */}
        {activeTab === 'dashboard' && (
          <>
            {/* KPI Grid */}
            <section style={{ marginBottom: '24px' }}>
              {loading ? (
                <div style={{ color: '#444', fontFamily: 'monospace', fontSize: '0.85rem', padding: '20px 0' }}>
                  Ładuję dane Supabase...
                </div>
              ) : (
                <div style={{ display: 'flex', flexWrap: 'wrap', gap: '10px' }}>
                  <KPICard label="Zamówienia Wix" value={fmtNum(perf?.wix_orders)} />
                  <KPICard label="Przychód Wix" value={fmtZl(perf?.wix_revenue)} accent />
                  <KPICard label="Meta Spend" value={fmtZl(perf?.meta_spend)} />
                  <KPICard label="Kliknięcia linku" value={fmtNum(perf?.link_clicks)} />
                  <KPICard
                    label="Realny koszt zakupu"
                    value={perf?.real_cpa != null ? fmtZl(perf.real_cpa) : '—'}
                    warning={cpaHigh}
                  />
                  <KPICard label="Realny ROAS" value={fmtRoas(perf?.real_roas)} />
                </div>
              )}
            </section>

            {/* Two-column layout */}
            <div
              style={{
                display: 'grid',
                gridTemplateColumns: 'minmax(0, 1fr) minmax(0, 340px)',
                gap: '20px',
              }}
              className="layout-grid"
            >
              {/* Left */}
              <div style={{ display: 'flex', flexDirection: 'column', gap: '20px' }}>
                <section
                  style={{ background: '#111', border: '1px solid #2a2a2a', borderRadius: '12px', padding: '20px' }}
                >
                  <CommandPanel onCommand={handleCommand} loading={false} />
                  <GieniuResponse text={response} />
                </section>
                <section
                  style={{ background: '#111', border: '1px solid #2a2a2a', borderRadius: '12px', padding: '20px' }}
                >
                  <TopAds ads={ads} loading={adsLoading} />
                </section>
              </div>

              {/* Right */}
              <div style={{ display: 'flex', flexDirection: 'column', gap: '20px' }}>
                <VoiceControls />
                <section
                  style={{ background: '#111', border: '1px solid #2a2a2a', borderRadius: '12px', padding: '20px' }}
                >
                  <AutomationRuns runs={runs} loading={runsLoading} />
                </section>
                <section
                  style={{ background: '#0a0a14', border: '1px dashed #2a2a4a', borderRadius: '12px', padding: '20px', opacity: 0.7 }}
                >
                  <div style={{ fontSize: '0.7rem', color: '#4444aa', fontFamily: 'monospace', textTransform: 'uppercase', letterSpacing: '0.1em', marginBottom: '8px' }}>
                    Command Gateway / LLM — wkrótce
                  </div>
                  <div style={{ fontSize: '0.78rem', color: '#555', fontFamily: 'monospace', lineHeight: 1.6 }}>
                    Tu pojawi się moduł wysyłający komendy do LLM (Claude / GPT) z kontekstem Supabase i personalością Gienia.
                  </div>
                </section>
              </div>
            </div>
          </>
        )}

        {/* ── JSU WEBINAR FUNNEL TAB ── */}
        {activeTab === 'jsu-funnel' && (
          <section
            style={{
              background: '#111',
              border: '1px solid #2a2a2a',
              borderRadius: '12px',
              padding: '24px',
            }}
          >
            <WebinarFunnelPanel
              summary={jsuSummary}
              participants={jsuParticipants}
              participantsLoading={jsuParticipantsLoading}
              loading={jsuLoading}
              onCommand={handleJsuCommand}
              gieniuResponse={jsuResponse}
            />
          </section>
        )}

      </main>

      <style>{`
        @media (max-width: 768px) {
          .layout-grid {
            grid-template-columns: 1fr !important;
          }
        }
      `}</style>
    </div>
  )
}
