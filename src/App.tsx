import { useState, useEffect, useCallback, useRef } from 'react'
import { KPICard } from './components/KPICard'
import { StatusBadge } from './components/StatusBadge'
import { CommandPanel } from './components/CommandPanel'
import { GieniuResponse } from './components/GieniuResponse'
import { TopAds } from './components/TopAds'
import { AutomationRuns } from './components/AutomationRuns'
import { WebinarFunnelPanel } from './components/WebinarFunnelPanel'
import { RevenueTrendChart } from './components/RevenueTrendChart'
import { GieniuAvatar } from './components/GieniuAvatar'
import {
  fetchTodayPerformance, fetchTopAds, fetchAutomationRuns,
  fetchRecentPerformance, fetchMetaStatsToday,
  computeStatus,
  type DailyPerformance, type MetaAdDaily, type AutomationRun,
  type DataStatus, type MetaStatsToday,
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
import { speak, stopAudio } from './voice/tts'

// ── Types ─────────────────────────────────────────────────────────────────────

type NavSection =
  | 'command-center'
  | 'webinars'
  | 'automation'
  | 'campaigns'
  | 'overview'
  | 'customers'
  | 'analytics'
  | 'reports'
  | 'settings'

// ── Format helpers ────────────────────────────────────────────────────────────

function fmtPln(n: number | null | undefined): string {
  if (n == null) return '—'
  return n.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 }) + ' PLN'
}
function fmtNum(n: number | null | undefined): string {
  if (n == null) return '—'
  return n.toLocaleString('en-US')
}
function fmtRoas(n: number | null | undefined): string {
  if (n == null) return '—'
  return n.toFixed(2) + 'x'
}

// ── Sidebar ───────────────────────────────────────────────────────────────────

const NAV_ITEMS: { key: NavSection; icon: string; label: string; live?: boolean }[] = [
  { key: 'command-center', icon: '⚔', label: 'Command Center', live: true },
  { key: 'campaigns',      icon: '📜', label: 'Campaigns',      live: true },
  { key: 'webinars',       icon: '🎙', label: 'Webinars',        live: true },
  { key: 'automation',     icon: '⚙',  label: 'Automation',      live: true },
  { key: 'overview',       icon: '👁',  label: 'Overview' },
  { key: 'customers',      icon: '👤', label: 'Customers' },
  { key: 'analytics',      icon: '📊', label: 'Analytics' },
  { key: 'reports',        icon: '📋', label: 'Reports' },
  { key: 'settings',       icon: '⚒',  label: 'Settings' },
]

function Sidebar({
  active, onNavigate, jsuAlert,
}: {
  active: NavSection
  onNavigate: (s: NavSection) => void
  jsuAlert: boolean
}) {
  return (
    <aside className="hud-sidebar">
      {/* Crest */}
      <div style={{ padding: '20px 18px 12px', borderBottom: '1px solid var(--border)' }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: '10px' }}>
          {/* Heraldic shield */}
          <svg viewBox="0 0 36 40" width="32" height="36">
            <path d="M18 2 L34 8 L34 22 Q34 34 18 38 Q2 34 2 22 L2 8 Z"
              fill="var(--surface3)" stroke="var(--gold)" strokeWidth="1.5" />
            <text x="18" y="26" textAnchor="middle" fill="var(--gold)" fontSize="14" fontFamily="Cinzel, serif" fontWeight="700">G</text>
            <line x1="8" y1="16" x2="28" y2="16" stroke="var(--border-gold)" strokeWidth="0.7" />
          </svg>
          <div>
            <div style={{ fontFamily: 'var(--font-serif)', fontSize: '0.9rem', fontWeight: 700, color: 'var(--gold)', letterSpacing: '0.08em' }}>
              GIENIU
            </div>
            <div style={{ fontFamily: 'var(--font-mono)', fontSize: '0.55rem', color: 'var(--muted)', letterSpacing: '0.1em', textTransform: 'uppercase' }}>
              HQ Command
            </div>
          </div>
        </div>
      </div>

      {/* Navigation */}
      <nav style={{ flex: 1, paddingTop: '8px' }}>
        <div className="nav-group-label">Operations</div>
        {NAV_ITEMS.slice(0, 4).map(item => (
          <button
            key={item.key}
            className={`nav-item${active === item.key ? ' active' : ''}`}
            onClick={() => onNavigate(item.key)}
          >
            <span className="nav-icon">{item.icon}</span>
            {item.label}
            {item.key === 'webinars' && jsuAlert && (
              <span style={{ marginLeft: 'auto', width: 6, height: 6, borderRadius: '50%', background: 'var(--orange)', flexShrink: 0, display: 'inline-block' }} />
            )}
          </button>
        ))}

        <div className="nav-group-label" style={{ marginTop: '8px' }}>Intelligence</div>
        {NAV_ITEMS.slice(4).map(item => (
          <button
            key={item.key}
            className={`nav-item${active === item.key ? ' active' : ''}`}
            onClick={() => onNavigate(item.key)}
            style={{ opacity: 0.5 }}
            disabled
          >
            <span className="nav-icon">{item.icon}</span>
            {item.label}
            <span style={{ marginLeft: 'auto', fontFamily: 'var(--font-mono)', fontSize: '0.55rem', color: 'var(--muted2)' }}>Soon</span>
          </button>
        ))}
      </nav>

      {/* Avatar card at bottom */}
      <div style={{
        padding: '14px 16px',
        borderTop: '1px solid var(--border)',
        display: 'flex',
        alignItems: 'center',
        gap: '10px',
      }}>
        <GieniuAvatar size={52} />
        <div>
          <div style={{ fontFamily: 'var(--font-serif)', fontSize: '0.72rem', color: 'var(--gold)', fontWeight: 600 }}>
            Gieniu
          </div>
          <div style={{ fontFamily: 'var(--font-mono)', fontSize: '0.6rem', color: 'var(--muted)', marginTop: '1px' }}>
            Revenue Advisor
          </div>
          <div style={{ fontFamily: 'var(--font-mono)', fontSize: '0.58rem', color: 'var(--teal)', marginTop: '2px', letterSpacing: '0.04em' }}>
            ● George voice
          </div>
        </div>
      </div>
    </aside>
  )
}

// ── Top bar ───────────────────────────────────────────────────────────────────

function TopBar({
  status, loading, lastRefresh, isStale, onRefresh,
}: {
  status: DataStatus
  loading: boolean
  lastRefresh: Date | null
  isStale: boolean
  onRefresh: () => void
}) {
  const [now, setNow] = useState(new Date())
  useEffect(() => {
    const t = setInterval(() => setNow(new Date()), 30000)
    return () => clearInterval(t)
  }, [])

  const dateStr = now.toLocaleDateString('en-GB', { weekday: 'long', day: '2-digit', month: 'long', year: 'numeric', timeZone: 'Europe/Warsaw' })
  const timeStr = now.toLocaleTimeString('en-GB', { hour: '2-digit', minute: '2-digit', timeZone: 'Europe/Warsaw' })

  return (
    <header style={{
      padding: '14px 24px',
      borderBottom: '1px solid var(--border)',
      display: 'flex',
      alignItems: 'flex-start',
      justifyContent: 'space-between',
      background: 'var(--bg2)',
      flexWrap: 'wrap',
      gap: '10px',
      flexShrink: 0,
    }}>
      <div>
        <div style={{ display: 'flex', alignItems: 'center', gap: '14px', marginBottom: '4px' }}>
          <h1 style={{
            fontFamily: 'var(--font-serif)',
            fontSize: '1.1rem',
            fontWeight: 700,
            color: 'var(--gold)',
            letterSpacing: '0.14em',
          }}>
            GIENIU HQ
          </h1>
          <StatusBadge status={status} />
        </div>
        <div style={{ fontFamily: 'var(--font-serif)', fontSize: '0.62rem', color: 'var(--muted)', letterSpacing: '0.1em' }}>
          Revenue &amp; Ops Command Center
        </div>
        {/* Motto */}
        <div style={{
          marginTop: '8px',
          padding: '5px 12px',
          background: 'var(--surface)',
          border: '1px solid var(--border)',
          borderLeft: '2px solid var(--gold-dim)',
          borderRadius: '3px',
          display: 'inline-block',
        }}>
          <span style={{ fontFamily: 'var(--font-serif)', fontSize: '0.62rem', color: 'var(--muted)', fontStyle: 'italic', letterSpacing: '0.05em' }}>
            "Steady hands, sharp numbers, calm decisions."
          </span>
        </div>
        {isStale && (
          <div className="stale-banner" style={{ marginTop: '8px' }}>
            ⚠ Meta data may be stale — no ads synced for today Warsaw time.
          </div>
        )}
      </div>

      <div style={{ textAlign: 'right' }}>
        <div style={{ fontFamily: 'var(--font-mono)', fontSize: '0.72rem', color: 'var(--text2)' }}>{timeStr}</div>
        <div style={{ fontFamily: 'var(--font-mono)', fontSize: '0.6rem', color: 'var(--muted)', marginTop: '2px' }}>{dateStr}</div>
        <div style={{ marginTop: '8px', display: 'flex', gap: '6px', justifyContent: 'flex-end' }}>
          {lastRefresh && (
            <span style={{ fontSize: '0.6rem', color: 'var(--muted2)', fontFamily: 'var(--font-mono)', alignSelf: 'center' }}>
              refreshed {lastRefresh.toLocaleTimeString('en-GB', { hour: '2-digit', minute: '2-digit' })}
            </span>
          )}
          <button className="btn-sm" onClick={onRefresh} disabled={loading}>
            {loading ? '…' : '↻ Refresh'}
          </button>
        </div>
      </div>
    </header>
  )
}

// ── Right panel (GIENIU SAYS + mic + chips) ───────────────────────────────────

function RightPanel({
  response, onPrompt, speaking, onMic, listening,
}: {
  response: string
  onPrompt: (label: string) => void
  speaking: boolean
  onMic: () => void
  listening: boolean
}) {
  const CHIPS = [
    'Revenue today',
    'Top campaign',
    'Webinar funnel',
    'Red flags',
  ]

  return (
    <aside className="hud-right">
      {/* GIENIU SAYS */}
      <div style={{ padding: '20px 18px', borderBottom: '1px solid var(--border)', flex: 1, overflowY: 'auto' }}>
        <div style={{ fontFamily: 'var(--font-serif)', fontSize: '0.62rem', color: 'var(--gold)', letterSpacing: '0.16em', textTransform: 'uppercase', marginBottom: '14px' }}>
          Gieniu Says
        </div>

        {response ? (
          <div>
            <pre style={{
              whiteSpace: 'pre-wrap',
              fontFamily: 'var(--font-mono)',
              fontSize: '0.8rem',
              lineHeight: 1.75,
              color: 'var(--text)',
              maxHeight: '50vh',
              overflowY: 'auto',
            }}>
              {response}
            </pre>
          </div>
        ) : (
          <div style={{
            padding: '20px',
            background: 'var(--surface)',
            border: '1px dashed var(--border)',
            borderRadius: '4px',
            textAlign: 'center',
          }}>
            <div style={{ fontSize: '1.5rem', marginBottom: '8px', opacity: 0.4 }}>📜</div>
            <div style={{ fontFamily: 'var(--font-serif)', fontSize: '0.72rem', color: 'var(--muted)', lineHeight: 1.6, fontStyle: 'italic' }}>
              Issue a command or speak<br />to receive the briefing.
            </div>
          </div>
        )}
      </div>

      {/* Speak to Gieniu */}
      <div style={{ padding: '18px', borderTop: '1px solid var(--border)' }}>
        <div style={{ fontFamily: 'var(--font-serif)', fontSize: '0.58rem', color: 'var(--muted)', letterSpacing: '0.14em', textTransform: 'uppercase', marginBottom: '14px' }}>
          Speak to Gieniu
        </div>

        <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', gap: '12px', marginBottom: '16px' }}>
          <button
            className={`btn-mic${listening ? ' listening' : ''}`}
            onClick={onMic}
            title={listening ? 'Stop listening' : 'Start voice input'}
          >
            {listening ? '⏹' : '🎙'}
          </button>
          <div style={{ fontFamily: 'var(--font-mono)', fontSize: '0.62rem', color: listening ? 'var(--teal)' : 'var(--muted2)' }}>
            {listening ? 'Listening…' : 'Tap to speak'}
          </div>
        </div>

        {/* Prompt chips */}
        <div style={{ fontFamily: 'var(--font-serif)', fontSize: '0.55rem', color: 'var(--muted2)', letterSpacing: '0.12em', textTransform: 'uppercase', marginBottom: '8px' }}>
          Quick prompts
        </div>
        <div style={{ display: 'flex', flexWrap: 'wrap', gap: '6px' }}>
          {CHIPS.map(chip => (
            <button key={chip} className="prompt-chip" onClick={() => onPrompt(chip)}>
              {chip}
            </button>
          ))}
        </div>
      </div>
    </aside>
  )
}

// ── Coming soon placeholder ───────────────────────────────────────────────────

function ComingSoon({ section }: { section: NavSection }) {
  return (
    <div style={{ padding: '60px 32px', textAlign: 'center' }}>
      <div style={{ fontSize: '2rem', opacity: 0.3, marginBottom: '16px' }}>🏰</div>
      <div style={{ fontFamily: 'var(--font-serif)', fontSize: '1rem', color: 'var(--muted)', letterSpacing: '0.1em', marginBottom: '8px' }}>
        {section.replace(/-/g, ' ').replace(/\b\w/g, c => c.toUpperCase())}
      </div>
      <div style={{ fontFamily: 'var(--font-mono)', fontSize: '0.72rem', color: 'var(--muted2)' }}>
        This section is being constructed.
      </div>
    </div>
  )
}

// ── App ───────────────────────────────────────────────────────────────────────

export default function App() {
  const [section, setSection]   = useState<NavSection>('command-center')

  // Dashboard data
  const [perf, setPerf]           = useState<DailyPerformance | null>(null)
  const [trend, setTrend]         = useState<DailyPerformance[]>([])
  const [ads, setAds]             = useState<MetaAdDaily[]>([])
  const [runs, setRuns]           = useState<AutomationRun[]>([])
  const [metaStats, setMetaStats] = useState<MetaStatsToday>({ meta_purchases: 0, latestDate: '', isStale: false })
  const [status, setStatus]       = useState<DataStatus>('NO_DATA')
  const [loading, setLoading]     = useState(true)
  const [adsLoading, setAdsLoading] = useState(true)
  const [runsLoading, setRunsLoading] = useState(true)
  const [lastRefresh, setLastRefresh] = useState<Date | null>(null)

  // JSU funnel
  const [jsuSummary, setJsuSummary]         = useState<JsuFunnelSummary | null>(null)
  const [jsuParticipants, setJsuParticipants] = useState<JsuParticipantRow[]>([])
  const [jsuLoading, setJsuLoading]           = useState(false)
  const [jsuParticipantsLoading, setJsuParticipantsLoading] = useState(false)
  const [jsuResponse, setJsuResponse]         = useState('')

  // Gieniu response (dashboard commands)
  const [response, setResponse] = useState('')

  // Voice
  const [speaking, setSpeaking] = useState(false)
  const [listening, setListening] = useState(false)
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const recognitionRef = useRef<any>(null)

  // ── Loaders ─────────────────────────────────────────────────────────────────

  const loadData = useCallback(async () => {
    setLoading(true)
    const [p, t, ms] = await Promise.all([
      fetchTodayPerformance(),
      fetchRecentPerformance(7),
      fetchMetaStatsToday(),
    ])
    setPerf(p)
    setTrend(t)
    setMetaStats(ms)
    setStatus(computeStatus(p))
    setLoading(false)
    setLastRefresh(new Date())
  }, [])

  const loadAds = useCallback(async () => {
    setAdsLoading(true)
    setAds(await fetchTopAds())
    setAdsLoading(false)
  }, [])

  const loadRuns = useCallback(async () => {
    setRunsLoading(true)
    setRuns(await fetchAutomationRuns())
    setRunsLoading(false)
  }, [])

  const loadJsuFunnel = useCallback(async () => {
    setJsuLoading(true)
    setJsuSummary(await loadJsuWebinarFunnel())
    setJsuLoading(false)
  }, [])

  const loadJsuParticipants = useCallback(async () => {
    setJsuParticipantsLoading(true)
    setJsuParticipants(await loadJsuParticipantJourney())
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

  // ── Command handlers ─────────────────────────────────────────────────────────

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
      case 'webinar jak się uczyć':        text = buildJsuWebinarReport(jsuSummary); break
      case 'czemu kurs się nie sprzedaje': text = buildWhyCourseNotSelling(jsuSummary); break
      case 'funnel JSU':                   text = buildJsuFunnelReport(jsuSummary); break
      case 'porównaj webinary JSU':        text = buildCompareJsuWebinars(jsuSummary); break
      case 'deliverability':               text = buildDeliverabilityReport(jsuSummary); break
      case 'czy mailing siadł':            text = buildMailingDiagnosis(jsuSummary); break
      case 'attendance rate':              text = buildAttendanceRateReport(jsuSummary); break
      case 'kto był i kupił':              text = buildWhoAttendedAndBought(jsuSummary); break
    }
    setJsuResponse(text)
    setResponse(text)
  }

  // ── Prompt chips ─────────────────────────────────────────────────────────────

  function handlePrompt(label: string) {
    switch (label) {
      case 'Revenue today':  handleCommand('revenue dzisiaj'); break
      case 'Top campaign': {
        if (ads.length === 0) { setResponse('No campaign data for today.'); break }
        const top = ads[0]
        setResponse(`Top campaign today:\n"${top.campaign_name ?? top.campaign_id}"\nSpend: ${top.spend.toFixed(2)} PLN  Clicks: ${top.link_clicks ?? '—'}  Meta purchases: ${top.purchases ?? 0}`)
        break
      }
      case 'Webinar funnel': {
        const text = buildJsuFunnelReport(jsuSummary)
        setJsuResponse(text)
        setResponse(text)
        break
      }
      case 'Red flags':  handleCommand('red flagi'); break
    }
  }

  // ── Voice input ───────────────────────────────────────────────────────────────

  function handleMic() {
    if (listening) {
      recognitionRef.current?.stop()
      setListening(false)
      return
    }

    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const w = window as any
    const SR = w.SpeechRecognition ?? w.webkitSpeechRecognition

    if (!SR) {
      setResponse('Voice input is not supported in this browser. Use Chrome or Edge.')
      return
    }

    const rec = new SR()
    rec.lang = 'en-US'
    rec.interimResults = false
    rec.maxAlternatives = 1
    recognitionRef.current = rec

    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    rec.onresult = (event: any) => {
      const transcript = event.results[0][0].transcript.toLowerCase().trim()
      setListening(false)

      if (transcript.includes('revenue') || transcript.includes('orders')) {
        handleCommand('revenue dzisiaj')
      } else if (transcript.includes('pipeline')) {
        handleCommand('pipeline')
      } else if (transcript.includes('cpa') || transcript.includes('thresholds')) {
        handleCommand('progi CPA')
      } else if (transcript.includes('flag') || transcript.includes('warning')) {
        handleCommand('red flagi')
      } else if (transcript.includes('creative')) {
        handleCommand('kreatywy')
      } else if (transcript.includes('retarget')) {
        handleCommand('retargeting')
      } else if (transcript.includes('mail') || transcript.includes('email')) {
        handleCommand('rytm maili')
      } else if (transcript.includes('webinar') || transcript.includes('funnel') || transcript.includes('jsu')) {
        handleJsuCommand('funnel JSU')
      } else if (transcript.includes('campaign') || transcript.includes('top ad')) {
        handlePrompt('Top campaign')
      } else if (transcript.includes('report') || transcript.includes('operational')) {
        handleCommand('raport operacyjny')
      } else {
        setResponse(`Heard: "${transcript}"\n\nI did not match a command. Try: "revenue", "red flags", "pipeline", "webinar funnel", "creatives".`)
      }
    }

    rec.onerror = () => setListening(false)
    rec.onend   = () => setListening(false)

    rec.start()
    setListening(true)
  }

  // ── Derived ──────────────────────────────────────────────────────────────────

  const cpaHigh = perf?.real_cpa != null && perf.real_cpa > 50
  const jsuAlert = !!jsuSummary && jsuSummary.bottleneck !== 'OK' && jsuSummary.bottleneck !== 'NO_DATA' && jsuSummary.bottleneck !== 'NO_SOURCES'
  const rightResponse = section === 'webinars' ? jsuResponse : response

  // ── Render ───────────────────────────────────────────────────────────────────

  return (
    <div className="hud-layout">

      {/* Sidebar */}
      <Sidebar active={section} onNavigate={setSection} jsuAlert={jsuAlert} />

      {/* Main area */}
      <div className="hud-main">
        <TopBar
          status={status}
          loading={loading}
          lastRefresh={lastRefresh}
          isStale={metaStats.isStale}
          onRefresh={() => { loadData(); loadAds(); loadRuns(); loadJsuFunnel() }}
        />

        <div style={{ flex: 1, padding: '20px 24px', display: 'flex', flexDirection: 'column', gap: '20px' }}>

          {/* ── COMMAND CENTER ─────────────────────────────────────── */}
          {section === 'command-center' && (
            <>
              {/* KPI Cards */}
              {loading ? (
                <div style={{ color: 'var(--muted)', fontFamily: 'var(--font-mono)', fontSize: '0.8rem' }}>
                  Loading data…
                </div>
              ) : (
                <div style={{ display: 'flex', flexWrap: 'wrap', gap: '10px' }}>
                  <KPICard label="Wix Orders" value={fmtNum(perf?.wix_orders)} />
                  <KPICard label="Wix Revenue" value={fmtPln(perf?.wix_revenue)} accent />
                  <KPICard label="Ad Spend" value={fmtPln(perf?.meta_spend)} />
                  <KPICard label="Real CPA" value={perf?.real_cpa != null ? fmtPln(perf.real_cpa) : '—'} warning={cpaHigh} sublabel="Meta spend / Wix orders" />
                  <KPICard label="Real ROAS" value={fmtRoas(perf?.real_roas)} sublabel="Wix revenue / Meta spend" />
                  <KPICard label="Meta Attr." value={fmtNum(metaStats.meta_purchases)} dim sublabel="Meta-reported purchases" />
                </div>
              )}

              {/* Revenue trend chart */}
              <div className="card">
                <div className="section-title section-title-gold" style={{ marginBottom: '10px' }}>Revenue Trend — 7 Days</div>
                <RevenueTrendChart rows={trend} loading={loading} />
                <div style={{ marginTop: '8px', display: 'flex', gap: '16px', flexWrap: 'wrap' }}>
                  <span style={{ fontFamily: 'var(--font-mono)', fontSize: '0.62rem', color: 'var(--muted2)' }}>
                    Real ROAS = Wix Revenue ÷ Meta Spend
                  </span>
                  <span style={{ fontFamily: 'var(--font-mono)', fontSize: '0.62rem', color: 'var(--muted2)' }}>
                    Real CPA = Meta Spend ÷ Wix Orders
                  </span>
                </div>
              </div>

              {/* Commands */}
              <div className="card">
                <CommandPanel onCommand={handleCommand} loading={false} />
              </div>
            </>
          )}

          {/* ── CAMPAIGNS ─────────────────────────────────────────── */}
          {section === 'campaigns' && (
            <div className="card">
              <div className="section-title section-title-gold">Top Campaigns — Today</div>
              <TopAds ads={ads} loading={adsLoading} />
            </div>
          )}

          {/* ── WEBINARS ──────────────────────────────────────────── */}
          {section === 'webinars' && (
            <div className="card">
              <WebinarFunnelPanel
                summary={jsuSummary}
                participants={jsuParticipants}
                participantsLoading={jsuParticipantsLoading}
                loading={jsuLoading}
                onCommand={handleJsuCommand}
                gieniuResponse=""
              />
            </div>
          )}

          {/* ── AUTOMATION ────────────────────────────────────────── */}
          {section === 'automation' && (
            <div className="card">
              <div className="section-title section-title-gold">Automation Runs</div>
              <AutomationRuns runs={runs} loading={runsLoading} />
            </div>
          )}

          {/* ── COMING SOON ───────────────────────────────────────── */}
          {!['command-center', 'campaigns', 'webinars', 'automation'].includes(section) && (
            <ComingSoon section={section} />
          )}

        </div>
      </div>

      {/* Right panel */}
      <RightPanel
        response={rightResponse}
        onPrompt={handlePrompt}
        speaking={speaking}
        onMic={handleMic}
        listening={listening}
      />

    </div>
  )
}
