import { useState, useEffect, useCallback, useRef } from 'react'
import { KPICard } from './components/KPICard'
import { StatusBadge } from './components/StatusBadge'
import { GieniuAvatar } from './components/GieniuAvatar'
import { TopAds } from './components/TopAds'
import { AutomationRuns } from './components/AutomationRuns'
import { WebinarFunnelPanel } from './components/WebinarFunnelPanel'
import { RevenueTrendChart } from './components/RevenueTrendChart'
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
  buildJsuWebinarReport, buildWhyCourseNotSelling, buildJsuFunnelReport,
  buildCompareJsuWebinars, buildDeliverabilityReport, buildMailingDiagnosis,
  buildAttendanceRateReport, buildWhoAttendedAndBought,
  type JsuCommandKey,
} from './brain/responses'
import { resolveIntent } from './brain/intent'
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
      <div style={{ padding: '20px 18px 12px', borderBottom: '1px solid var(--border)' }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: '10px' }}>
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
            <span style={{ marginLeft: 'auto', fontFamily: 'var(--font-mono)', fontSize: '0.64rem', color: 'var(--muted2)' }}>Soon</span>
          </button>
        ))}
      </nav>

      <div style={{ padding: '14px 16px', borderTop: '1px solid var(--border)', display: 'flex', alignItems: 'center', gap: '10px' }}>
        <GieniuAvatar size={52} />
        <div>
          <div style={{ fontFamily: 'var(--font-serif)', fontSize: '0.82rem', color: 'var(--gold)', fontWeight: 600 }}>Gieniu</div>
          <div style={{ fontFamily: 'var(--font-mono)', fontSize: '0.68rem', color: 'var(--muted)', marginTop: '2px' }}>Revenue Advisor</div>
          <div style={{ fontFamily: 'var(--font-mono)', fontSize: '0.65rem', color: 'var(--teal)', marginTop: '3px', letterSpacing: '0.04em' }}>● George voice</div>
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
          <h1 style={{ fontFamily: 'var(--font-serif)', fontSize: '1.3rem', fontWeight: 700, color: 'var(--gold)', letterSpacing: '0.14em' }}>
            GIENIU HQ
          </h1>
          <StatusBadge status={status} />
        </div>
        <div style={{ fontFamily: 'var(--font-serif)', fontSize: '0.75rem', color: 'var(--muted)', letterSpacing: '0.1em' }}>
          Revenue &amp; Ops Command Center
        </div>
        {isStale && (
          <div className="stale-banner" style={{ marginTop: '8px' }}>
            ⚠ Meta data may be stale — no ads synced for today Warsaw time.
          </div>
        )}
      </div>

      <div style={{ textAlign: 'right' }}>
        <div style={{ fontFamily: 'var(--font-mono)', fontSize: '0.9rem', color: 'var(--text2)' }}>{timeStr}</div>
        <div style={{ fontFamily: 'var(--font-mono)', fontSize: '0.72rem', color: 'var(--muted)', marginTop: '2px' }}>{dateStr}</div>
        <div style={{ marginTop: '8px', display: 'flex', gap: '6px', justifyContent: 'flex-end' }}>
          {lastRefresh && (
            <span style={{ fontSize: '0.68rem', color: 'var(--muted2)', fontFamily: 'var(--font-mono)', alignSelf: 'center' }}>
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

// ── Right panel — voice-first conversational interface ────────────────────────

const CHIPS = [
  'How are we doing today?',
  'How was yesterday?',
  'This week so far',
  'Today vs yesterday',
  'What needs attention?',
]

function RightPanel({
  response,
  onQuery,
  speaking,
  thinking,
  onSpeak,
  onMic,
  listening,
  muted,
  onMuteToggle,
  transcript,
  ttsError,
}: {
  response: string
  onQuery: (query: string) => void
  speaking: boolean
  thinking: boolean
  onSpeak: () => void
  onMic: () => void
  listening: boolean
  muted: boolean
  onMuteToggle: () => void
  transcript: string
  ttsError: string
}) {
  const [inputVal, setInputVal] = useState('')

  function handleSubmit() {
    const q = inputVal.trim()
    if (!q) return
    onQuery(q)
    setInputVal('')
  }

  return (
    <aside className="hud-right">
      {/* Response area — scrollable */}
      <div style={{ flex: 1, minHeight: 0, overflowY: 'auto', padding: '20px 22px' }}>

        {/* Header row */}
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: '14px' }}>
          <div style={{ fontFamily: 'var(--font-serif)', fontSize: '0.78rem', color: 'var(--gold)', letterSpacing: '0.16em', textTransform: 'uppercase' }}>
            Gieniu Says
          </div>
          {listening && (
            <div style={{ fontFamily: 'var(--font-mono)', fontSize: '0.72rem', color: 'var(--teal)', display: 'flex', alignItems: 'center', gap: '5px' }}>
              <span style={{ display: 'inline-block', width: 6, height: 6, borderRadius: '50%', background: 'var(--teal)', animation: 'pulse-mic 1.2s infinite' }} />
              Listening...
            </div>
          )}
          {thinking && !listening && (
            <div style={{ fontFamily: 'var(--font-mono)', fontSize: '0.72rem', color: 'var(--gold)', display: 'flex', alignItems: 'center', gap: '5px' }}>
              <span style={{ display: 'inline-block', width: 6, height: 6, borderRadius: '50%', background: 'var(--gold)', animation: 'pulse-mic 1.2s infinite' }} />
              Thinking...
            </div>
          )}
          {speaking && !listening && !thinking && (
            <div style={{ fontFamily: 'var(--font-mono)', fontSize: '0.72rem', color: 'var(--teal)', display: 'flex', alignItems: 'center', gap: '5px' }}>
              <span style={{ display: 'inline-block', width: 6, height: 6, borderRadius: '50%', background: 'var(--teal)', animation: 'pulse-mic 1.2s infinite' }} />
              George is speaking…
            </div>
          )}
        </div>

        {/* Response text */}
        {response ? (
          <>
            <pre style={{ whiteSpace: 'pre-wrap', fontFamily: 'var(--font-mono)', fontSize: '1.05rem', lineHeight: 1.85, color: 'var(--text)', margin: 0, marginBottom: '14px' }}>
              {response}
            </pre>

            {/* Speak again / stop */}
            <div style={{ display: 'flex', gap: '8px', alignItems: 'center', flexWrap: 'wrap' }}>
              <button
                className="btn-sm"
                onClick={onSpeak}
                style={{ borderColor: speaking ? 'var(--teal)' : undefined, color: speaking ? 'var(--teal)' : undefined }}
              >
                {speaking ? '⏹ Stop' : '▶ Speak again'}
              </button>
              {ttsError && (
                <span style={{ fontFamily: 'var(--font-mono)', fontSize: '0.72rem', color: 'var(--orange)' }}>
                  Audio playback failed — click Speak again or unmute.
                </span>
              )}
            </div>
          </>
        ) : (
          <div style={{ padding: '28px 20px', background: 'var(--surface)', border: '1px dashed var(--border)', borderRadius: '4px', textAlign: 'center' }}>
            <div style={{ fontSize: '2rem', marginBottom: '10px', opacity: 0.35 }}>🎙</div>
            <div style={{ fontFamily: 'var(--font-serif)', fontSize: '0.9rem', color: 'var(--muted)', lineHeight: 1.7, fontStyle: 'italic' }}>
              Speak or type to receive the briefing.
            </div>
            <div style={{ fontFamily: 'var(--font-mono)', fontSize: '0.72rem', color: 'var(--muted2)', marginTop: '10px', lineHeight: 1.6 }}>
              Try: "how are we doing?"<br />
              "how was yesterday?" · "this week so far"<br />
              "what's wrong with ads?"
            </div>
          </div>
        )}
      </div>

      {/* Input area — fixed at bottom */}
      <div style={{ flexShrink: 0, padding: '16px 20px', borderTop: '1px solid var(--border)' }}>

        {transcript && (
          <div className="transcript-display" style={{ marginBottom: '10px' }}>
            Heard: "{transcript}"
          </div>
        )}

        {/* Text input */}
        <div style={{ display: 'flex', gap: '6px', marginBottom: '12px' }}>
          <input
            type="text"
            className="gieniu-input"
            placeholder="Ask about revenue, ads, Wix, Meta, or webinars…"
            value={inputVal}
            onChange={e => setInputVal(e.target.value)}
            onKeyDown={e => { if (e.key === 'Enter') handleSubmit() }}
          />
          <button
            className="btn-sm"
            onClick={handleSubmit}
            disabled={!inputVal.trim()}
            style={{ flexShrink: 0, minWidth: 52 }}
          >
            Ask
          </button>
        </div>

        {/* Mic + mute row */}
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', gap: '20px', marginBottom: '14px' }}>
          <button
            className={`btn-mic${listening ? ' listening' : ''}`}
            onClick={onMic}
            title={speaking ? 'Interrupt George' : listening ? 'Stop listening' : 'Start voice input'}
          >
            {listening ? '⏹' : speaking ? '✋' : '🎙'}
          </button>
          <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'flex-start', gap: '6px' }}>
            <div style={{ fontFamily: 'var(--font-mono)', fontSize: '0.8rem', color: listening ? 'var(--teal)' : thinking ? 'var(--gold)' : speaking ? 'var(--teal)' : 'var(--muted2)' }}>
              {listening ? 'Listening...' : thinking ? 'Thinking...' : speaking ? 'Speaking...' : 'Tap to speak'}
            </div>
            <button
              className={`btn-mute${muted ? ' muted' : ''}`}
              onClick={onMuteToggle}
              title={muted ? 'Unmute auto-speak' : 'Mute auto-speak'}
            >
              {muted ? '🔇 Muted' : '🔊 Auto-speak'}
            </button>
          </div>
        </div>

        {/* Prompt chips */}
        <div style={{ fontFamily: 'var(--font-serif)', fontSize: '0.65rem', color: 'var(--muted2)', letterSpacing: '0.12em', textTransform: 'uppercase', marginBottom: '7px' }}>
          Quick
        </div>
        <div style={{ display: 'flex', flexWrap: 'wrap', gap: '5px' }}>
          {CHIPS.map(chip => (
            <button key={chip} className="prompt-chip" onClick={() => onQuery(chip)}>
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
  const [section, setSection] = useState<NavSection>('command-center')

  // Dashboard data
  const [perf, setPerf]               = useState<DailyPerformance | null>(null)
  const [trend, setTrend]             = useState<DailyPerformance[]>([])
  const [ads, setAds]                 = useState<MetaAdDaily[]>([])
  const [runs, setRuns]               = useState<AutomationRun[]>([])
  const [metaStats, setMetaStats]     = useState<MetaStatsToday>({ meta_purchases: 0, latestDate: '', isStale: false })
  const [status, setStatus]           = useState<DataStatus>('NO_DATA')
  const [loading, setLoading]         = useState(true)
  const [adsLoading, setAdsLoading]   = useState(true)
  const [runsLoading, setRunsLoading] = useState(true)
  const [lastRefresh, setLastRefresh] = useState<Date | null>(null)

  // JSU funnel
  const [jsuSummary, setJsuSummary]                   = useState<JsuFunnelSummary | null>(null)
  const [jsuParticipants, setJsuParticipants]         = useState<JsuParticipantRow[]>([])
  const [jsuLoading, setJsuLoading]                   = useState(false)
  const [jsuParticipantsLoading, setJsuParticipantsLoading] = useState(false)

  // Conversational state
  const [response, setResponse]       = useState('')
  const [speaking, setSpeaking]       = useState(false)
  const [thinking, setThinking]       = useState(false)
  const [muted, setMuted]             = useState(false)
  const [listening, setListening]     = useState(false)
  const [transcript, setTranscript]   = useState('')
  const [ttsError, setTtsError]       = useState('')
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const recognitionRef = useRef<any>(null)
  const debounceRef    = useRef<ReturnType<typeof setTimeout> | null>(null)

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
    // eslint-disable-next-line no-console
    console.log(`GIENIU HQ build ${__BUILD_HASH__} loaded (${__BUILD_TIME__})`)
    loadData()
    loadAds()
    loadRuns()
    loadJsuFunnel()
    loadJsuParticipants()
    const interval = setInterval(() => { loadData(); loadAds() }, 5 * 60 * 1000)
    return () => clearInterval(interval)
  }, [loadData, loadAds, loadRuns, loadJsuFunnel, loadJsuParticipants])

  // ── Auto-speak every answer ──────────────────────────────────────────────────

  async function speakAnswer(text: string) {
    setResponse(text)
    setTtsError('')
    // eslint-disable-next-line no-console
    console.log('GIENIU answer generated', text.slice(0, 80) + (text.length > 80 ? '…' : ''))
    if (muted || !text.trim()) return
    stopAudio()
    setSpeaking(true)
    const result = await speak(text)
    setSpeaking(false)
    if (!result.ok) {
      setTtsError(result.error ?? 'unknown error')
      // eslint-disable-next-line no-console
      console.warn('GIENIU TTS failed:', result.error)
    }
  }

  // Speak again / stop current audio
  function handleSpeakAgain() {
    if (speaking) {
      stopAudio()
      setSpeaking(false)
      return
    }
    if (!response.trim()) return
    setTtsError('')
    setSpeaking(true)
    speak(response).then(res => {
      setSpeaking(false)
      if (!res.ok) setTtsError(res.error ?? 'unknown error')
    })
  }

  // ── Intent handler ────────────────────────────────────────────────────────────

  function handleIntentQuery(query: string) {
    // Stop any current audio before processing new query
    if (speaking) {
      stopAudio()
      setSpeaking(false)
    }
    const result = resolveIntent(query, { perf, status, ads, metaStats, jsuSummary, trend })
    speakAnswer(result)
  }

  // ── JSU command handler ───────────────────────────────────────────────────────

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
    speakAnswer(text)
  }

  // ── Voice input ───────────────────────────────────────────────────────────────

  function handleMic() {
    // If speaking, interrupt: stop audio and start listening
    if (speaking) {
      stopAudio()
      setSpeaking(false)
    }

    if (listening) {
      recognitionRef.current?.stop()
      setListening(false)
      return
    }

    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const w = window as any
    const SR = w.SpeechRecognition ?? w.webkitSpeechRecognition

    if (!SR) {
      speakAnswer('Voice input is not supported in this browser. Use Chrome or Edge.')
      return
    }

    const rec = new SR()
    rec.lang = 'pl-PL'
    rec.interimResults = false
    rec.maxAlternatives = 1
    recognitionRef.current = rec

    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    rec.onresult = (event: any) => {
      const heard = event.results[0][0].transcript.trim()
      setListening(false)
      setTranscript(heard)
      setThinking(true)
      if (debounceRef.current) clearTimeout(debounceRef.current)
      debounceRef.current = setTimeout(() => {
        setThinking(false)
        handleIntentQuery(heard)
      }, 750)
    }

    rec.onerror = () => { setListening(false); setThinking(false) }
    rec.onend   = () => { setListening(false) }

    rec.start()
    setListening(true)
    setTranscript('')
  }

  // ── Derived ──────────────────────────────────────────────────────────────────

  // Use most recent trend row when today has no data, so KPI cards are never blank if history exists
  const displayPerf = perf ?? (trend.length > 0 ? trend[0] : null)
  const perfIsStale  = !perf && trend.length > 0
  const cpaHigh      = displayPerf?.real_cpa != null && displayPerf.real_cpa > 50
  const jsuAlert     = !!jsuSummary && jsuSummary.bottleneck !== 'OK' && jsuSummary.bottleneck !== 'NO_DATA' && jsuSummary.bottleneck !== 'NO_SOURCES'

  // ── Render ───────────────────────────────────────────────────────────────────

  return (
    <div className="hud-layout">

      <Sidebar active={section} onNavigate={setSection} jsuAlert={jsuAlert} />

      <div className="hud-main">
        <TopBar
          status={status}
          loading={loading}
          lastRefresh={lastRefresh}
          isStale={metaStats.isStale}
          onRefresh={() => { loadData(); loadAds(); loadRuns(); loadJsuFunnel() }}
        />

        <div style={{ flex: 1, padding: '28px 32px', display: 'flex', flexDirection: 'column', gap: '28px', overflowY: 'auto' }}>

          {/* ── COMMAND CENTER ─────────────────────────────────────── */}
          {section === 'command-center' && (
            <>
              {loading ? (
                <div style={{ color: 'var(--muted)', fontFamily: 'var(--font-mono)', fontSize: '0.8rem' }}>Loading data…</div>
              ) : (
                <>
                  {perfIsStale && (
                    <div style={{ fontFamily: 'var(--font-mono)', fontSize: '0.76rem', color: 'var(--amber)', padding: '8px 14px', background: 'rgba(251,191,36,0.06)', border: '1px solid rgba(251,191,36,0.2)', borderRadius: '3px' }}>
                      No data for today yet — showing latest available: {trend[0]?.date}
                    </div>
                  )}
                  <div style={{ display: 'flex', flexWrap: 'wrap', gap: '10px' }}>
                    <KPICard label="Wix Orders" value={fmtNum(displayPerf?.wix_orders)} sublabel={perfIsStale ? trend[0]?.date : undefined} />
                    <KPICard label="Wix Revenue" value={fmtPln(displayPerf?.wix_revenue)} accent sublabel={perfIsStale ? trend[0]?.date : undefined} />
                    <KPICard label="Ad Spend" value={fmtPln(displayPerf?.meta_spend)} sublabel={perfIsStale ? trend[0]?.date : undefined} />
                    <KPICard label="Real CPA" value={displayPerf?.real_cpa != null ? fmtPln(displayPerf.real_cpa) : '—'} warning={cpaHigh} sublabel="Meta spend / Wix orders" />
                    <KPICard label="Real ROAS" value={fmtRoas(displayPerf?.real_roas)} sublabel="Wix revenue / Meta spend" />
                    <KPICard label="Meta Attr." value={fmtNum(metaStats.meta_purchases)} dim sublabel="Meta-reported purchases" />
                  </div>
                </>
              )}

              <div className="card">
                <div className="section-title section-title-gold" style={{ marginBottom: '10px' }}>Revenue Trend — 7 Days</div>
                <RevenueTrendChart rows={trend} loading={loading} />
                <div style={{ marginTop: '8px', display: 'flex', gap: '16px', flexWrap: 'wrap' }}>
                  <span style={{ fontFamily: 'var(--font-mono)', fontSize: '0.72rem', color: 'var(--muted2)' }}>Real ROAS = Wix Revenue ÷ Meta Spend</span>
                  <span style={{ fontFamily: 'var(--font-mono)', fontSize: '0.72rem', color: 'var(--muted2)' }}>Real CPA = Meta Spend ÷ Wix Orders</span>
                </div>
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

          {!['command-center', 'campaigns', 'webinars', 'automation'].includes(section) && (
            <ComingSoon section={section} />
          )}

        </div>
      </div>

      <RightPanel
        response={response}
        onQuery={handleIntentQuery}
        speaking={speaking}
        thinking={thinking}
        onSpeak={handleSpeakAgain}
        onMic={handleMic}
        listening={listening}
        muted={muted}
        onMuteToggle={() => setMuted(m => !m)}
        transcript={transcript}
        ttsError={ttsError}
      />

      {/* Build stamp — always visible, bottom-right */}
      <div className="build-stamp">
        GIENIU build: {__BUILD_HASH__}
      </div>

    </div>
  )
}
