import { useState, useEffect, useCallback, useRef } from 'react'
import { KPICard } from './components/KPICard'
import { StatusBadge } from './components/StatusBadge'
import { GieniuAvatar } from './components/GieniuAvatar'
import { AutomationRuns } from './components/AutomationRuns'
import { WebinarFunnelPanel } from './components/WebinarFunnelPanel'
import { RevenueTrendChart } from './components/RevenueTrendChart'
import { InsightChart } from './components/InsightChart'
import { CampaignsPanel } from './components/CampaignsPanel'
import { DiagnosticsPanel } from './components/DiagnosticsPanel'
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
import { fetchOpsWeekReport, type OpsWeekReport } from './lib/opsWeekReport'
import { fetchOrdersData, type OrdersData } from './lib/ordersData'
import {
  buildJsuWebinarReport, buildWhyCourseNotSelling, buildJsuFunnelReport,
  buildCompareJsuWebinars, buildDeliverabilityReport, buildMailingDiagnosis,
  buildAttendanceRateReport, buildWhoAttendedAndBought,
  wrapResponse,
  type JsuCommandKey,
  type GieniuResponse,
  type InsightChartSpec,
} from './brain/responses'
import { resolveIntent } from './brain/intent'
import { speak, stopAudio, prewarmAudio } from './voice/tts'

// ── Constants ─────────────────────────────────────────────────────────────────

const VOICE_UNLOCK_KEY = 'gieniu_voice_unlocked_v1'
const OPENING_TEXT = "Lifidi, GIENIU HQ is awake. I'm watching revenue, Meta, Wix, webinars, and operational leaks. Ask me what's moving, what's wasting money, or what needs your attention first."

// ── Types ─────────────────────────────────────────────────────────────────────

type NavSection =
  | 'command-center'
  | 'campaigns'
  | 'webinars'
  | 'automation'
  | 'diagnostics'

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

const NAV_ITEMS: { key: NavSection; icon: string; label: string }[] = [
  { key: 'command-center', icon: '⚔',  label: 'Command Center' },
  { key: 'campaigns',      icon: '📜', label: 'Campaigns'       },
  { key: 'webinars',       icon: '🎙', label: 'Webinars'        },
  { key: 'automation',     icon: '⚙',  label: 'Sync / Automation' },
  { key: 'diagnostics',    icon: '🔬', label: 'Diagnostics'     },
]

function Sidebar({
  active, onNavigate, jsuAlert, onInstall,
}: {
  active: NavSection
  onNavigate: (s: NavSection) => void
  jsuAlert: boolean
  onInstall?: () => void
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
        {NAV_ITEMS.map(item => (
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
      </nav>

      {onInstall && (
        <div style={{ padding: '10px 16px', borderTop: '1px solid var(--border)' }}>
          <button
            className="btn-sm"
            onClick={onInstall}
            style={{ width: '100%', fontSize: '0.72rem', color: 'var(--gold)', borderColor: 'var(--border-gold)' }}
          >
            ⬇ Install GIENIU
          </button>
        </div>
      )}

      <div style={{ padding: '14px 16px', borderTop: '1px solid var(--border)', display: 'flex', alignItems: 'center', gap: '10px' }}>
        <GieniuAvatar size={52} />
        <div>
          <div style={{ fontFamily: 'var(--font-serif)', fontSize: '0.82rem', color: 'var(--gold)', fontWeight: 600 }}>Gieniu</div>
          <div style={{ fontFamily: 'var(--font-mono)', fontSize: '0.68rem', color: 'var(--muted)', marginTop: '2px' }}>Revenue Advisor</div>
          <div style={{ fontFamily: 'var(--font-mono)', fontSize: '0.65rem', color: 'var(--teal)', marginTop: '3px', letterSpacing: '0.04em' }}>● Active</div>
        </div>
      </div>
    </aside>
  )
}

// ── Mobile bottom nav ─────────────────────────────────────────────────────────

const MOBILE_NAV_ITEMS: { key: NavSection; icon: string; label: string }[] = [
  { key: 'command-center', icon: '⚔',  label: 'Home'       },
  { key: 'campaigns',      icon: '📜', label: 'Campaigns'  },
  { key: 'webinars',       icon: '🎙', label: 'Webinars'   },
  { key: 'automation',     icon: '⚙',  label: 'Sync'       },
  { key: 'diagnostics',    icon: '🔬', label: 'Status'     },
]

function MobileNav({ active, onNavigate, jsuAlert }: {
  active: NavSection
  onNavigate: (s: NavSection) => void
  jsuAlert: boolean
}) {
  return (
    <nav className="mobile-nav">
      {MOBILE_NAV_ITEMS.map(item => (
        <button
          key={item.key}
          className={`mobile-nav-item${active === item.key ? ' active' : ''}`}
          onClick={() => onNavigate(item.key)}
        >
          <span className="mobile-nav-icon">
            {item.icon}
            {item.key === 'webinars' && jsuAlert && (
              <span style={{ position: 'absolute', top: -2, right: -4, width: 6, height: 6, borderRadius: '50%', background: 'var(--orange)', display: 'inline-block' }} />
            )}
          </span>
          <span className="mobile-nav-label">{item.label}</span>
        </button>
      ))}
    </nav>
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

function getTtsErrorMessage(err: string): string {
  if (!err) return ''
  if (/NotAllowedError|play\(\) failed|autoplay|interrupted/i.test(err))
    return 'Browser blocked autoplay — click "Start voice" once to unlock.'
  if (/missing_api_key/i.test(err))
    return 'Voice unavailable: No API key found in Netlify env. Check ELEVENLABS_API_KEY (scope must be All, not Build-only).'
  if (/quota_exceeded/i.test(err))
    return 'Voice paused: quota exhausted. Upgrade the plan or wait for the monthly reset.'
  if (/elevenStatus 401/i.test(err)) {
    if (/bearerPrefix/i.test(err))
      return 'Voice: API key has "Bearer" prefix — was stripped. If still failing, update the key in Netlify env.'
    if (/quotedKey/i.test(err))
      return 'Voice: API key was quoted — quotes stripped. If still failing, update the key in Netlify env.'
    if (/len:0|len:1[0-9]$/i.test(err))
      return 'Voice: API key looks too short (possibly truncated). Check ELEVENLABS_API_KEY in Netlify env vars.'
    return 'Voice: API key rejected (401). Check ELEVENLABS_API_KEY in Netlify env vars — scope must be "All" not "Build".'
  }
  if (/elevenStatus 422/i.test(err))
    return 'Voice: TTS request rejected (422). Voice ID or model may be wrong.'
  if (/elevenStatus 429/i.test(err))
    return 'Voice: Rate limit hit (429). Character quota may be exhausted.'
  if (/elevenlabs_http_error|HTTP [45]\d\d/i.test(err))
    return `Voice unavailable: ${err.replace(/^HTTP \d+: /, '').slice(0, 140)}`
  return 'Tab may be muted. Unmute the tab in browser settings, then click Speak again.'
}

function RightPanel({
  response,
  chart,
  lastQuery,
  voiceUnlocked,
  onStartGeorgeVoice,
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
  chart?: InsightChartSpec
  lastQuery?: string
  voiceUnlocked?: boolean
  onStartGeorgeVoice?: () => void
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
              Speaking…
            </div>
          )}
        </div>

        {/* Response text */}
        {response ? (
          <>
            {lastQuery && (
              <div style={{ fontFamily: 'var(--font-mono)', fontSize: '0.7rem', color: 'var(--muted2)', marginBottom: '10px', padding: '4px 8px', background: 'var(--surface)', borderLeft: '2px solid var(--border)', borderRadius: '2px' }}>
                ↑ {lastQuery}
              </div>
            )}

            <pre style={{ whiteSpace: 'pre-wrap', fontFamily: 'var(--font-mono)', fontSize: '1.05rem', lineHeight: 1.85, color: 'var(--text)', margin: 0, marginBottom: chart ? '8px' : '14px' }}>
              {response}
            </pre>

            {chart && <InsightChart spec={chart} />}

            {/* Voice controls */}
            <div style={{ display: 'flex', gap: '8px', alignItems: 'center', flexWrap: 'wrap', marginTop: chart ? '10px' : '0' }}>
              {!voiceUnlocked ? (
                <button
                  className="btn-sm"
                  onClick={onStartGeorgeVoice}
                  style={{ borderColor: 'var(--gold)', color: 'var(--gold)', fontWeight: 700, padding: '6px 14px' }}
                >
                  ▶ Start voice
                </button>
              ) : speaking ? (
                <button
                  className="btn-sm"
                  onClick={onSpeak}
                  style={{ borderColor: 'var(--teal)', color: 'var(--teal)' }}
                >
                  ⏹ Stop speaking
                </button>
              ) : (
                <button className="btn-sm" onClick={onSpeak}>
                  ▶ Speak again
                </button>
              )}
              {ttsError && (
                <span style={{ fontFamily: 'var(--font-mono)', fontSize: '0.7rem', color: 'var(--orange)', lineHeight: 1.4, maxWidth: '200px' }}>
                  {getTtsErrorMessage(ttsError)}
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

  // Ops week report
  const [opsWeekReport, setOpsWeekReport]       = useState<OpsWeekReport | null>(null)
  const [opsWeekLoading, setOpsWeekLoading]     = useState(false)

  // Orders data (backend, service role)
  const [ordersData, setOrdersData] = useState<OrdersData | null>(null)

  // Conversational state
  const [response, setResponse]           = useState('')
  const [responseSpoken, setResponseSpoken] = useState('')
  const [responseChart, setResponseChart]   = useState<InsightChartSpec | undefined>(undefined)
  const [speaking, setSpeaking]           = useState(false)
  const [thinking, setThinking]           = useState(false)
  const [muted, setMuted]                 = useState(false)
  const [listening, setListening]         = useState(false)
  const [transcript, setTranscript]       = useState('')
  const [ttsError, setTtsError]           = useState('')
  const [voiceUnlocked, setVoiceUnlocked] = useState(() => sessionStorage.getItem(VOICE_UNLOCK_KEY) === '1')
  const [lastQuery, setLastQuery]         = useState('')
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const recognitionRef = useRef<any>(null)
  const debounceRef    = useRef<ReturnType<typeof setTimeout> | null>(null)
  const ttsSessionRef  = useRef(0)

  // PWA install
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const [installPrompt, setInstallPrompt] = useState<any>(null)
  useEffect(() => {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const handler = (e: any) => { e.preventDefault(); setInstallPrompt(e) }
    window.addEventListener('beforeinstallprompt', handler)
    return () => window.removeEventListener('beforeinstallprompt', handler)
  }, [])

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

  const loadOpsWeekReport = useCallback(async () => {
    setOpsWeekLoading(true)
    try {
      setOpsWeekReport(await fetchOpsWeekReport())
    } catch (e) {
      // eslint-disable-next-line no-console
      console.warn('GIENIU ops-week-report failed:', e)
      setOpsWeekReport({ ok: false, error: String(e), range: {} as never, webinars: {} as never, orders: {} as never, attribution: {} as never, meta: {} as never, summary: {} as never, debug: {} as never })
    } finally {
      setOpsWeekLoading(false)
    }
  }, [])

  const loadJsuParticipants = useCallback(async () => {
    setJsuParticipantsLoading(true)
    setJsuParticipants(await loadJsuParticipantJourney())
    setJsuParticipantsLoading(false)
  }, [])

  const loadOrdersData = useCallback(async () => {
    try {
      setOrdersData(await fetchOrdersData())
    } catch (e) {
      // eslint-disable-next-line no-console
      console.warn('GIENIU orders-data failed:', e)
    }
  }, [])

  useEffect(() => {
    // eslint-disable-next-line no-console
    console.log(`GIENIU HQ build ${__BUILD_HASH__} loaded (${__BUILD_TIME__})`)
    loadData()
    loadAds()
    loadRuns()
    loadJsuFunnel()
    loadJsuParticipants()
    loadOpsWeekReport()
    loadOrdersData()
    const interval = setInterval(() => { loadData(); loadAds() }, 5 * 60 * 1000)
    return () => clearInterval(interval)
  }, [loadData, loadAds, loadRuns, loadJsuFunnel, loadJsuParticipants, loadOpsWeekReport, loadOrdersData])

  // ── Opening greeting ─────────────────────────────────────────────────────────

  useEffect(() => {
    setResponse(OPENING_TEXT)
    setResponseSpoken(OPENING_TEXT)
    if (sessionStorage.getItem(VOICE_UNLOCK_KEY) !== '1') return
    const t = setTimeout(async () => {
      setSpeaking(true)
      const result = await speak(OPENING_TEXT)
      setSpeaking(false)
      if (!result.ok && !result.aborted) {
        // eslint-disable-next-line no-console
        console.log('GIENIU TTS error detail', result.error)
        setTtsError(result.error ?? 'unknown error')
      } else if (result.ok) {
        // eslint-disable-next-line no-console
        console.log('GIENIU opening line spoken')
      }
    }, 900)
    return () => clearTimeout(t)
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  // ── Stop speaking ────────────────────────────────────────────────────────────

  function stopSpeaking() {
    stopAudio()
    setSpeaking(false)
  }

  // ── Auto-speak every answer ──────────────────────────────────────────────────

  async function speakAnswer(gr: GieniuResponse) {
    const session = ++ttsSessionRef.current
    stopSpeaking()
    setResponse(gr.displayText)
    setResponseSpoken(gr.spokenText)
    setResponseChart(gr.chart)
    setTtsError('')
    // eslint-disable-next-line no-console
    console.log('GIENIU spokenText', gr.spokenText.slice(0, 100))
    if (muted || !voiceUnlocked || !gr.spokenText.trim()) return
    setSpeaking(true)
    const result = await speak(gr.spokenText)
    if (ttsSessionRef.current !== session) return
    setSpeaking(false)
    if (!result.ok && !result.aborted) {
      setTtsError(result.error ?? 'unknown error')
      // eslint-disable-next-line no-console
      console.log('GIENIU TTS error detail', result.error)
    }
  }

  function handleSpeakAgain() {
    if (speaking) {
      stopSpeaking()
      return
    }
    prewarmAudio()
    const toSpeak = responseSpoken || response
    if (!toSpeak.trim()) return
    const session = ++ttsSessionRef.current
    setTtsError('')
    setSpeaking(true)
    speak(toSpeak).then(res => {
      if (ttsSessionRef.current !== session) return
      setSpeaking(false)
      if (res.ok && !voiceUnlocked) {
        sessionStorage.setItem(VOICE_UNLOCK_KEY, '1')
        setVoiceUnlocked(true)
        // eslint-disable-next-line no-console
        console.log('GIENIU voice unlocked', true)
      } else if (!res.ok && !res.aborted) {
        setTtsError(res.error ?? 'unknown error')
        // eslint-disable-next-line no-console
        console.log('GIENIU TTS error detail', res.error)
      }
    })
  }

  // ── Intent handler ────────────────────────────────────────────────────────────

  function handleIntentQuery(query: string) {
    setLastQuery(query)
    stopSpeaking()
    const result = resolveIntent(query, { perf, status, ads, metaStats, jsuSummary, trend, opsWeekReport, ordersData })
    speakAnswer(result)
  }

  // ── Start George voice ────────────────────────────────────────────────────────

  async function handleStartGeorgeVoice() {
    prewarmAudio()
    setTtsError('')
    // eslint-disable-next-line no-console
    console.log('GIENIU Start voice — endpoint: /.netlify/functions/gieniu-tts')
    const session = ++ttsSessionRef.current
    setSpeaking(true)
    const result = await speak(responseSpoken || response || OPENING_TEXT)
    if (ttsSessionRef.current !== session) return
    setSpeaking(false)
    if (result.ok) {
      sessionStorage.setItem(VOICE_UNLOCK_KEY, '1')
      setVoiceUnlocked(true)
      // eslint-disable-next-line no-console
      console.log('GIENIU voice unlocked', true)
    } else if (!result.aborted) {
      setTtsError(result.error ?? 'unknown error')
      // eslint-disable-next-line no-console
      console.log('GIENIU TTS error detail', result.error)
    }
  }

  // ── PWA install ───────────────────────────────────────────────────────────────

  async function handleInstall() {
    if (!installPrompt) return
    installPrompt.prompt()
    const { outcome } = await installPrompt.userChoice
    if (outcome === 'accepted') setInstallPrompt(null)
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
    speakAnswer(wrapResponse(text))
  }

  // ── Speech helpers ────────────────────────────────────────────────────────────

  function normalizeSpeech(raw: string): string {
    return raw
      .toLowerCase()
      .replace(/ą/g, 'a').replace(/ć/g, 'c').replace(/ę/g, 'e')
      .replace(/ł/g, 'l').replace(/ń/g, 'n').replace(/ó/g, 'o')
      .replace(/ś/g, 's').replace(/ź/g, 'z').replace(/ż/g, 'z')
      .replace(/[.,!?;:]/g, '')
      .replace(/\s+/g, ' ')
      .trim()
  }

  function isStopCommand(normalized: string): boolean {
    const stops = ['stop', 'stop speaking', 'przestan mowic', 'stop audio', 'quiet',
      'cisza', 'milcz', 'stop talking', 'zatrzymaj', 'stop george']
    return stops.some(s => normalized === s || normalized.startsWith(s + ' ') || normalized.endsWith(' ' + s))
  }

  // ── Voice input ───────────────────────────────────────────────────────────────

  function handleMic() {
    if (speaking) stopSpeaking()

    if (listening) {
      recognitionRef.current?.stop()
      setListening(false)
      return
    }

    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const w = window as any
    const SR = w.SpeechRecognition ?? w.webkitSpeechRecognition

    if (!SR) {
      speakAnswer(wrapResponse('Voice input is not supported in this browser. Use Chrome or Edge.'))
      return
    }

    const rec = new SR()
    rec.lang = 'pl-PL'
    rec.interimResults = true
    rec.maxAlternatives = 1
    recognitionRef.current = rec

    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    rec.onresult = (event: any) => {
      let interim = ''
      let final   = ''
      for (let i = 0; i < event.results.length; i++) {
        if (event.results[i].isFinal) final   += event.results[i][0].transcript
        else                          interim += event.results[i][0].transcript
      }
      setTranscript(final || interim)

      if (final) {
        const normalized = normalizeSpeech(final)
        // eslint-disable-next-line no-console
        console.log('GIENIU speech final transcript', final)
        // eslint-disable-next-line no-console
        console.log('GIENIU normalized query', normalized)

        setListening(false)

        if (isStopCommand(normalized)) {
          stopSpeaking()
          // eslint-disable-next-line no-console
          console.log('GIENIU stop command received')
          return
        }

        setThinking(true)
        if (debounceRef.current) clearTimeout(debounceRef.current)
        debounceRef.current = setTimeout(() => {
          setThinking(false)
          handleIntentQuery(final)
        }, 750)
      }
    }

    rec.onerror = () => { setListening(false); setThinking(false) }
    rec.onend   = () => { setListening(false) }

    rec.start()
    setListening(true)
    setTranscript('')
  }

  // ── Derived ──────────────────────────────────────────────────────────────────

  const displayPerf = perf ?? (trend.length > 0 ? trend[0] : null)
  const perfIsStale  = !perf && trend.length > 0
  const cpaHigh      = displayPerf?.real_cpa != null && displayPerf.real_cpa > 50
  const jsuAlert     = !!jsuSummary && jsuSummary.bottleneck !== 'OK' && jsuSummary.bottleneck !== 'NO_DATA' && jsuSummary.bottleneck !== 'NO_SOURCES'

  // ── Render ───────────────────────────────────────────────────────────────────

  return (
    <div className="hud-layout">

      <Sidebar active={section} onNavigate={setSection} jsuAlert={jsuAlert} onInstall={installPrompt ? handleInstall : undefined} />

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
              <CampaignsPanel />
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

          {/* ── DIAGNOSTICS ───────────────────────────────────────── */}
          {section === 'diagnostics' && (
            <DiagnosticsPanel
              perf={perf}
              trend={trend}
              ads={ads}
              runs={runs}
              jsuSummary={jsuSummary}
              opsWeekReport={opsWeekReport}
              opsWeekLoading={opsWeekLoading}
            />
          )}

        </div>
      </div>

      <RightPanel
        response={response}
        chart={responseChart}
        lastQuery={lastQuery}
        voiceUnlocked={voiceUnlocked}
        onStartGeorgeVoice={handleStartGeorgeVoice}
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

      {/* Mobile bottom nav */}
      <MobileNav active={section} onNavigate={setSection} jsuAlert={jsuAlert} />

      {/* Build stamp — always visible, bottom-right */}
      <div className="build-stamp">
        GIENIU build: {__BUILD_HASH__}
      </div>

    </div>
  )
}
