import { useState, useEffect, useCallback, useRef } from 'react'
import {
  ReactionSystem,
  tryTriggerMicroSales,
  tryTriggerWebinarFull,
} from './components/ReactionSystem'
import { IntroSplash } from './components/IntroSplash'
import { PondBackground } from './components/PondBackground'
import { initAmbient, setAmbientEnabled, setAmbientPeriod } from './lib/ambient'
import { useTheme } from './hooks/useTheme'
import { KPICard } from './components/KPICard'
import { StatusBadge } from './components/StatusBadge'
import { GieniuAvatar } from './components/GieniuAvatar'
import { AutomationRuns } from './components/AutomationRuns'
import { WebinarFunnelPanel } from './components/WebinarFunnelPanel'
import { RevenueTrendChart } from './components/RevenueTrendChart'
import { InsightChart } from './components/InsightChart'
import { CampaignsPanel } from './components/CampaignsPanel'
import { DiagnosticsPanel } from './components/DiagnosticsPanel'
import { StanleyOwl } from './components/StanleyOwl'
import { CampaignInspector } from './components/CampaignInspector'
import { GoalBar } from './components/GoalBar'
import {
  ppOrdersGoal, monthlyRevenueGoal, cpaGoal, roasGoal,
  daysInMonthOf, sumMonthToDate,
  MONTHLY_REVENUE_TARGET,
} from './lib/goalProgress'
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
import { fetchProfitData, mapProfitToSummary, type ProfitData } from './lib/profitData'
import {
  buildJsuWebinarReport, buildWhyCourseNotSelling, buildJsuFunnelReport,
  buildCompareJsuWebinars, buildDeliverabilityReport, buildMailingDiagnosis,
  buildAttendanceRateReport, buildWhoAttendedAndBought,
  wrapResponse,
  type JsuCommandKey,
  type GieniuResponse,
  type InsightChartSpec,
} from './brain/responses'
import { fetchCampaignRows } from './lib/campaignDiagnosis'
import { resolveIntent } from './brain/intent'
import {
  speak, stopAudio, prewarmAudio, isElevenLabsPaused, resetElevenLabs,
  getAvailableVoices, selectBrowserVoice,
  resetVoiceState,
} from './voice/tts'
import { fetchGieniuCommand, type GieniuCommandContext } from './lib/gieniuCommand'
import {
  startListening, type SttResult,
} from './voice/stt'
import { isSpeaking as sttIsStanleySpeaking, onSpeechChange } from './lib/speechGate'

import { RangeSwitcher } from './components/RangeSwitcher'
import { rangeDates, rangeSubLabel, RANGE_LABELS, type TimeRange } from './lib/timeRange'

// ── Constants ─────────────────────────────────────────────────────────────────

const OPENING_TEXT = "At your service, sir. One gesture and I shall commence the operational report."

// ── Time range (panel-wide) — aggregation helpers over the daily performance view ─

// Sum a numeric field across rows (nulls treated as 0).
function sumField(rows: DailyPerformance[], f: keyof DailyPerformance): number {
  return rows.reduce((s, r) => s + (Number(r[f] ?? 0) || 0), 0)
}

// Aggregate up to 7 recent days into one DailyPerformance-shaped total.
function aggregatePerf(rows: DailyPerformance[]): DailyPerformance | null {
  if (rows.length === 0) return null
  const orders  = sumField(rows, 'wix_orders')
  const revenue = sumField(rows, 'wix_revenue')
  const spend   = sumField(rows, 'meta_spend')
  const sorted  = [...rows].sort((a, b) => a.date.localeCompare(b.date))
  return {
    date: `${sorted[0].date} → ${sorted[sorted.length - 1].date}`,
    wix_orders: orders,
    wix_revenue: revenue,
    meta_spend: spend,
    real_cpa:  orders > 0 ? spend / orders : null,
    real_roas: spend > 0 ? revenue / spend : null,
    impressions: sumField(rows, 'impressions'),
    clicks:      sumField(rows, 'clicks'),
    link_clicks: sumField(rows, 'link_clicks'),
    ads_count:   0,
    meta_purchases:      sumField(rows, 'meta_purchases'),
    meta_purchase_value: sumField(rows, 'meta_purchase_value'),
  }
}

// Resolve the performance row for the selected range from today's row + the recent
// daily rows (all Warsaw-tz). Filters by the SAME rangeDates() bounds the campaign
// data uses, so Command Center KPIs and the Campaigns panel can never drift apart.
function resolveRangePerf(
  range: TimeRange,
  today: DailyPerformance | null,
  rows: DailyPerformance[],
): DailyPerformance | null {
  const { from, to } = rangeDates(range)
  if (range === 'today') {
    // Fall back to the latest available day (stale note shown separately).
    return today ?? (rows.length > 0 ? rows[0] : null)
  }
  if (range === 'yesterday') {
    return rows.find(r => r.date === from) ?? null
  }
  // week / month — aggregate every day inside [from, to]
  return aggregatePerf(rows.filter(r => r.date >= from && r.date <= to))
}

// Detect queries about today's performance — only these trigger day reactions
function isDayResultQuery(q: string): boolean {
  return /\b(today|dzisiaj|morning brief|brief|how are we doing|wyniki|roas dnia|jak idzie|jak posz|podsumowanie|results|how did we do|daily|dziś)\b/i.test(q)
}

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
function fmtPct(n: number | null | undefined, decimals = 2): string {
  if (n == null) return '—'
  return n.toFixed(decimals) + '%'
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
        {/* Wordmark only — the duck lives once, in the STANLEY SAYS panel */}
        <div>
          <div style={{ fontFamily: 'var(--font-display)', fontSize: '0.92rem', fontWeight: 700, color: 'var(--gold)', letterSpacing: '0.1em' }}>
            STANLEY
          </div>
          <div style={{ fontFamily: 'var(--font-mono)', fontSize: '0.55rem', color: 'var(--muted)', letterSpacing: '0.1em', textTransform: 'uppercase' }}>
            HQ Command
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
            ⬇ Install STANLEY
          </button>
        </div>
      )}

      <div style={{ padding: '14px 16px', borderTop: '1px solid var(--border)', display: 'flex', alignItems: 'center', gap: '10px' }}>
        <GieniuAvatar size={52} />
        <div>
          <div style={{ fontFamily: 'var(--font-serif)', fontSize: '0.82rem', color: 'var(--gold)', fontWeight: 600 }}>Stanley</div>
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
  status, loading, lastRefresh, isStale, onRefresh, theme, onToggleTheme,
  ambientOn, onToggleAmbient,
}: {
  status: DataStatus
  loading: boolean
  lastRefresh: Date | null
  isStale: boolean
  onRefresh: () => void
  theme: 'dark' | 'light'
  onToggleTheme: () => void
  ambientOn: boolean
  onToggleAmbient: () => void
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
          <h1 style={{ fontFamily: 'var(--font-display)', fontSize: '1.35rem', fontWeight: 700, color: 'var(--gold)', letterSpacing: '0.14em' }}>
            STANLEY HQ
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
          <button
            className="btn-sm"
            onClick={onToggleTheme}
            title={theme === 'dark' ? 'Switch to light mode (auto follows the clock until you override)' : 'Switch to dark mode (auto follows the clock until you override)'}
            style={{ fontSize: '0.95rem', padding: '7px 10px', minWidth: '36px' }}
          >
            {theme === 'dark' ? '☀' : '🌙'}
          </button>
          <button
            className="btn-sm"
            onClick={onToggleAmbient}
            title={ambientOn ? 'Ambient nature sound: on — tap to mute' : 'Ambient nature sound: off — tap to enable'}
            style={{ fontSize: '0.95rem', padding: '7px 10px', minWidth: '36px', opacity: ambientOn ? 1 : 0.42, borderColor: ambientOn ? 'var(--border-gold)' : 'var(--border)' }}
          >
            🍃
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

function getFallbackBanner(elevenError: string): string {
  if (!elevenError) return 'ElevenLabs paused locally — tap "Try ElevenLabs again" to retest (function not called).'
  if (/paused locally/i.test(elevenError))
    return elevenError
  if (/missing_api_key|api key missing|src:missing|len:0\b/i.test(elevenError))
    return 'API key missing in env: ELEVENLABS_API_KEY not set in Netlify (keyLen 0). Set it, then "Try ElevenLabs again". Using Browser TTS.'
  if (/elevenStatus 401/i.test(elevenError))
    return 'ElevenLabs: API key rejected (401) — update ELEVENLABS_API_KEY in Netlify env. Using Browser TTS.'
  if (/elevenStatus 429/i.test(elevenError))
    return 'ElevenLabs quota exhausted (429) — wait for monthly reset or upgrade. Using Browser TTS.'
  if (/elevenStatus 404/i.test(elevenError))
    return 'ElevenLabs: Voice not found (404) — check voice ID. Using Browser TTS.'
  if (/elevenStatus 422/i.test(elevenError))
    return 'ElevenLabs: Bad request (422) — check voice ID / model. Using Browser TTS.'
  if (/elevenStatus (\d+)/i.test(elevenError)) {
    const m = elevenError.match(/elevenStatus (\d+)/i)
    return `ElevenLabs HTTP ${m?.[1] ?? '?'} — switched to Browser TTS.`
  }
  return `ElevenLabs error — switched to Browser TTS.`
}

function getTtsErrorMessage(err: string): string {
  if (!err) return ''
  if (err === 'no-pl-voice')
    return 'Brak głosu PL w systemie — tekst dostępny, głos niedostępny. Zainstaluj głos polski lub przełącz na EN.'
  if (/NotAllowedError|play\(\) failed|autoplay|interrupted/i.test(err))
    return 'Browser blocked autoplay — click "Start voice" once to unlock.'
  if (/missing_api_key/i.test(err))
    return 'Voice unavailable: No API key found in Netlify env. Check ELEVENLABS_API_KEY.'
  if (/elevenStatus 401/i.test(err)) {
    if (/bearerPrefix/i.test(err))
      return 'Voice: API key has "Bearer" prefix — stripped. Update key if still failing.'
    if (/quotedKey/i.test(err))
      return 'Voice: API key was quoted — stripped. Update key if still failing.'
    if (/len:0|len:1[0-9]$/i.test(err))
      return 'Voice: API key too short. Check ELEVENLABS_API_KEY in Netlify env vars.'
    return 'Voice: API key rejected (401). Check ELEVENLABS_API_KEY — scope must be "All".'
  }
  if (/elevenStatus 422/i.test(err))
    return 'Voice: TTS request rejected (422). Voice ID or model may be wrong.'
  if (/browser tts:/i.test(err))
    return `Browser TTS error: ${err.replace(/browser tts:\s*/i, '').slice(0, 100)}`
  if (/elevenlabs_http_error|HTTP [45]\d\d/i.test(err))
    return `Voice unavailable: ${err.replace(/^HTTP \d+: /, '').slice(0, 120)}`
  return 'Tab may be muted. Unmute the tab in browser settings, then click Speak again.'
}

function RightPanel({
  response,
  chart,
  lastQuery,
  voiceUnlocked,
  onStartStanleyVoice,
  onWake,
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
  ttsLastElevenError,
  ttsFallbackActive,
  onRetryElevenLabs,
  browserVoiceInfo,
  englishVoiceCount,
  onResetVoiceState,
  sttStatus,
  sttConfidence,
  sttRejectionReason,
  sttPrefillInput,
}: {
  response: string
  chart?: InsightChartSpec
  lastQuery?: string
  voiceUnlocked?: boolean
  onStartStanleyVoice?: () => void
  onWake?: () => void
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
  ttsLastElevenError: string
  ttsFallbackActive: boolean
  onRetryElevenLabs: () => void
  browserVoiceInfo: { name: string; lang: string } | null
  englishVoiceCount: number
  onResetVoiceState: () => void
  sttStatus: 'idle' | 'accepted' | 'rejected'
  sttConfidence: number | null
  sttRejectionReason: string
  sttPrefillInput: string
}) {
  const [inputVal, setInputVal] = useState('')

  // Fill input when STT rejects — lets user edit and re-send manually
  useEffect(() => {
    if (sttPrefillInput) setInputVal(sttPrefillInput)
  }, [sttPrefillInput])

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
            Stanley Says
          </div>
          {/* Mic state only — the duck below shows Speaking…/Thinking… itself */}
          {listening && (
            <div style={{ fontFamily: 'var(--font-mono)', fontSize: '0.72rem', color: 'var(--teal)', display: 'flex', alignItems: 'center', gap: '5px' }}>
              <span style={{ display: 'inline-block', width: 6, height: 6, borderRadius: '50%', background: 'var(--teal)', animation: 'pulse-mic 1.2s infinite' }} />
              Listening...
            </div>
          )}
        </div>

        {/* The ONE talking Stanley — always present at the TOP of the panel, above
            the response text. Pulses + glow + "Speaking…" when active, calm breathing
            when idle. Tap to quack. */}
        <StanleyOwl state={speaking ? 'speaking' : thinking ? 'thinking' : 'idle'} />

        {/* Response text */}
        {response ? (
          <>
            {lastQuery && (
              <div style={{ fontFamily: 'var(--font-mono)', fontSize: '0.7rem', color: 'var(--muted2)', marginBottom: '10px', padding: '4px 8px', background: 'var(--surface)', borderLeft: '2px solid var(--border)', borderRadius: '2px' }}>
                ↑ {lastQuery}
              </div>
            )}

            <pre key={response} className="gieniu-response-text" style={{ whiteSpace: 'pre-wrap', fontFamily: 'var(--font-mono)', fontSize: '1.05rem', lineHeight: 1.85, color: 'var(--text)', margin: 0, marginBottom: chart ? '8px' : '14px' }}>
              {response}
            </pre>

            {chart && <InsightChart spec={chart} />}

            {/* Voice controls */}
            {!voiceUnlocked ? (
              <div style={{ marginTop: chart ? '14px' : '4px' }}>
                <button
                  className="wake-btn-illuminate"
                  onClick={onWake ?? onStartStanleyVoice}
                  style={{
                    display: 'block', width: '100%',
                    background: 'transparent',
                    border: '1.5px solid var(--gold)', borderRadius: '4px',
                    color: 'var(--gold)', fontFamily: 'var(--font-serif)',
                    fontSize: '1.05rem', fontWeight: 700,
                    padding: '14px 0', cursor: 'pointer',
                    letterSpacing: '0.05em',
                  }}
                >
                  🎙 Wake STANLEY
                </button>
                <div style={{ fontFamily: 'var(--font-mono)', fontSize: '0.68rem', color: 'var(--muted2)', marginTop: '6px', textAlign: 'center' }}>
                  One tap · unlocks voice &amp; mic
                </div>
              </div>
            ) : (
            <div style={{ marginTop: chart ? '10px' : '4px' }}>
              {/* Controls row — the duck itself lives at the top of the panel now */}
              <div style={{ display: 'flex', gap: '8px', alignItems: 'center', justifyContent: 'center', flexWrap: 'wrap', marginTop: '4px' }}>
                {speaking ? (
                  <button
                    className="btn-sm"
                    onClick={onSpeak}
                    style={{ borderColor: 'var(--teal)', color: 'var(--teal)' }}
                  >
                    ⏹ Stop
                  </button>
                ) : (
                  <button className="btn-sm" onClick={onSpeak}>
                    ▶ Speak again
                  </button>
                )}

                {ttsFallbackActive && !ttsError && (
                  <span style={{ fontFamily: 'var(--font-mono)', fontSize: '0.68rem', color: 'var(--muted)', lineHeight: 1.4 }}>
                    Browser TTS
                  </span>
                )}

                {ttsFallbackActive && (
                  <button
                    className="btn-sm"
                    onClick={onRetryElevenLabs}
                    style={{ fontSize: '0.65rem', padding: '4px 10px', borderColor: 'var(--muted2)', color: 'var(--muted2)' }}
                    title="Try ElevenLabs again — if quota still exhausted, will stay on Browser TTS"
                  >
                    Try ElevenLabs again
                  </button>
                )}

                {ttsError && !ttsFallbackActive && (
                  <span style={{ fontFamily: 'var(--font-mono)', fontSize: '0.7rem', color: 'var(--orange)', lineHeight: 1.4, maxWidth: '220px' }}>
                    {getTtsErrorMessage(ttsError)}
                  </span>
                )}
              </div>
            </div>
            )}

            {/* Browser voice info — shown when fallback is active */}
            {ttsFallbackActive && (
              <div style={{ marginTop: '10px', display: 'flex', flexDirection: 'column', gap: '6px' }}>
                <div style={{ display: 'flex', gap: '6px', alignItems: 'center', flexWrap: 'wrap' }}>
                  <button
                    className="btn-sm"
                    onClick={onResetVoiceState}
                    style={{ fontSize: '0.62rem', padding: '2px 8px', color: 'var(--muted2)', borderColor: 'var(--border)' }}
                    title="Clears all voice localStorage state"
                  >
                    Reset voice
                  </button>
                </div>
                {browserVoiceInfo && (
                  <div style={{ fontFamily: 'var(--font-mono)', fontSize: '0.63rem', color: 'var(--muted2)' }}>
                    {browserVoiceInfo.name} ({browserVoiceInfo.lang})
                  </div>
                )}
                {englishVoiceCount === 0 && (
                  <div style={{ fontFamily: 'var(--font-mono)', fontSize: '0.63rem', color: 'var(--orange)', lineHeight: 1.4 }}>
                    No English browser voice found. Install an English voice or use ElevenLabs.
                  </div>
                )}
              </div>
            )}

            {/* Fallback status notice — shows real error reason */}
            {ttsFallbackActive && (
              <div style={{ marginTop: '8px', fontFamily: 'var(--font-mono)', fontSize: '0.68rem', color: 'var(--muted2)', padding: '5px 8px', background: 'rgba(100,100,100,0.08)', borderRadius: '3px', borderLeft: '2px solid var(--border)' }}>
                {getFallbackBanner(ttsLastElevenError)}
              </div>
            )}
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

        {/* STT transcript display */}
        {transcript && (
          <div
            className="transcript-display"
            style={{
              marginBottom: '10px',
              borderColor: sttStatus === 'rejected' ? 'var(--orange)' : sttStatus === 'accepted' ? 'var(--teal)' : 'var(--border)',
            }}
          >
            {sttStatus === 'rejected'
              ? <>I heard: &ldquo;{transcript}&rdquo; — {sttRejectionReason}. Tap again and repeat, or edit below.</>
              : <>Heard: &ldquo;{transcript}&rdquo;{sttConfidence !== null ? ` (${(sttConfidence * 100).toFixed(0)}%)` : ''}</>
            }
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
            title={speaking ? 'Interrupt Stanley' : listening ? 'Stop listening' : 'Start voice input'}
          >
            {listening ? '⏹' : speaking ? '✋' : '🎙'}
          </button>
          <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'flex-start', gap: '5px' }}>
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
  const { theme, toggleTheme } = useTheme()
  const [section, setSection] = useState<NavSection>('command-center')
  const [range, setRange] = useState<TimeRange>('today')   // panel-wide time range

  // Subtle, SILENT mood accent for result queries — information always comes first;
  // this is a quiet visual background signal, never audio, never a full-screen event.
  const [resultMood, setResultMood]     = useState<'good' | 'bad' | null>(null)
  const [resultMoodSeq, setResultMoodSeq] = useState(0)
  const moodTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null)
  const showResultMood = useCallback((roas: number | null) => {
    // ≥2.5 → good (gold), <1.5 → bad (muted), 1.5–2.5 → neutral (no accent).
    const mood = roas == null ? null : roas >= 2.5 ? 'good' : roas < 1.5 ? 'bad' : null
    setResultMood(mood)
    setResultMoodSeq(s => s + 1)
    if (moodTimerRef.current) clearTimeout(moodTimerRef.current)
    if (mood) moodTimerRef.current = setTimeout(() => setResultMood(null), 2800)
  }, [])

  // Track the current range in a ref so range-agnostic loaders (profit) can read it.
  const rangeRef = useRef(range)
  useEffect(() => { rangeRef.current = range }, [range])

  // Per-range campaign rows for the campaign inspector dropdown.
  const [campaignRows, setCampaignRows] = useState<MetaAdDaily[]>([])
  const [campaignRowsLoading, setCampaignRowsLoading] = useState(true)
  useEffect(() => {
    setCampaignRowsLoading(true)
    fetchCampaignRows(rangeDates(range))
      .then(r => setCampaignRows(r.rows))
      .catch(() => setCampaignRows([]))
      .finally(() => setCampaignRowsLoading(false))
  }, [range])

  // Ambient nature bed — default ON, session-memory toggle (not localStorage).
  const [ambientOn, setAmbientOn] = useState(true)
  useEffect(() => { initAmbient() }, [])
  function toggleAmbient() {
    setAmbientOn(prev => { const next = !prev; setAmbientEnabled(next); return next })
  }

  // Manual theme toggle also switches the ambient bed: dark → night, light → day.
  function handleToggleTheme() {
    const next: 'dark' | 'light' = theme === 'dark' ? 'light' : 'dark'
    toggleTheme()
    setAmbientPeriod(next === 'dark' ? 'night' : 'day')
  }

  // Dashboard data
  const [perf, setPerf]               = useState<DailyPerformance | null>(null)
  const [trend, setTrend]             = useState<DailyPerformance[]>([])
  const [monthTrend, setMonthTrend]   = useState<DailyPerformance[]>([])
  const [ads, setAds]                 = useState<MetaAdDaily[]>([])
  const [runs, setRuns]               = useState<AutomationRun[]>([])
  const [metaStats, setMetaStats]     = useState<MetaStatsToday>({ meta_purchases: 0, latestDate: '', isStale: false })
  const [status, setStatus]           = useState<DataStatus>('NO_DATA')
  const [loading, setLoading]         = useState(true)
  const [, setAdsLoading]             = useState(true)
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

  // Profit data (backend, service role — contribution margin minus ad spend)
  const [profitData, setProfitData] = useState<ProfitData | null>(null)

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
  const [ttsFallbackActive, setTtsFallbackActive] = useState(() => isElevenLabsPaused())
  const [ttsLastElevenError, setTtsLastElevenError] = useState('')
  const [voiceUnlocked, setVoiceUnlocked] = useState(false)

  // Intent gateway diagnostics
  const [lastIntent, setLastIntent]               = useState('')
  const [lastIntentConfidence, setLastIntentConfidence] = useState(0)
  const [llmConnected, setLlmConnected]           = useState<boolean | null>(null)

  // STT (speech-to-text) state
  const [sttLastFinal, setSttLastFinal]       = useState('')
  const [sttInterim, setSttInterim]           = useState('')
  const [sttConfidence, setSttConfidence]     = useState<number | null>(null)
  const [sttStatus, setSttStatus]             = useState<'idle' | 'accepted' | 'rejected'>('idle')
  const [sttRejectionReason, setSttRejectionReason] = useState('')
  const [sttPrefillInput, setSttPrefillInput] = useState('')

  // Browser voice info — refreshed when voices are loaded
  const [englishVoiceCount, setEnglishVoiceCount] = useState(0)
  const [browserVoiceInfo, setBrowserVoiceInfo]   = useState<{ name: string; lang: string } | null>(null)
  const [lastQuery, setLastQuery]         = useState('')
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const recognitionRef    = useRef<any>(null)
  const debounceRef       = useRef<ReturnType<typeof setTimeout> | null>(null)
  const ttsSessionRef     = useRef(0)
  // Tracks voiceUnlocked synchronously so speakAnswer sees the latest value
  // even when called immediately after setVoiceUnlocked(true) in the same tick.
  const voiceUnlockedRef  = useRef(false)

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

  // Month-to-date trend (up to 31 days) — drives the monthly-revenue goal bar.
  // Same read-only view as `trend`, just a wider window; summed by current month.
  const loadMonthTrend = useCallback(async () => {
    setMonthTrend(await fetchRecentPerformance(31))
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

  const loadProfitData = useCallback(async () => {
    try {
      // Profit KPIs follow the selected panel range (same bounds as everything else).
      setProfitData(await fetchProfitData(rangeDates(rangeRef.current)))
    } catch (e) {
      // eslint-disable-next-line no-console
      console.warn('GIENIU profit-data failed:', e)
    }
  }, [])

  // Reload profit whenever the range changes.
  useEffect(() => { loadProfitData() }, [range, loadProfitData])

  const refreshVoiceInfo = useCallback(() => {
    setEnglishVoiceCount(getAvailableVoices().length)
    const sel = selectBrowserVoice()
    setBrowserVoiceInfo(sel ? { name: sel.name, lang: sel.lang } : null)
  }, [])

  useEffect(() => { voiceUnlockedRef.current = voiceUnlocked }, [voiceUnlocked])

  useEffect(() => {
    refreshVoiceInfo()
    window.speechSynthesis?.addEventListener('voiceschanged', refreshVoiceInfo)
    return () => window.speechSynthesis?.removeEventListener('voiceschanged', refreshVoiceInfo)
  }, [refreshVoiceInfo])

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
    loadProfitData()
    loadMonthTrend()
    const interval = setInterval(() => { loadData(); loadAds(); loadProfitData(); loadOrdersData(); loadMonthTrend() }, 60 * 1000)
    return () => clearInterval(interval)
  }, [loadData, loadAds, loadRuns, loadJsuFunnel, loadJsuParticipants, loadOpsWeekReport, loadOrdersData, loadProfitData, loadMonthTrend])

  // ── Reaction triggers ────────────────────────────────────────────────────────

  // Micro-sale: watch latest_20_orders for new JSU/JZK orders since last seen
  useEffect(() => {
    if (!ordersData?.latest_20_orders) return
    tryTriggerMicroSales(ordersData.latest_20_orders)
  }, [ordersData])

  // Webinar full-house: only fires when real attendance data is present
  useEffect(() => {
    if (!jsuSummary) return
    const sessionDate = jsuSummary._debug?.latestSessionDate ?? ''
    tryTriggerWebinarFull(
      jsuSummary.totals.attendees,
      jsuSummary._debug?.attendanceStatus,
      sessionDate,
    )
  }, [jsuSummary])

  // ── Opening greeting ─────────────────────────────────────────────────────────

  useEffect(() => {
    setResponse(OPENING_TEXT)
    setResponseSpoken(OPENING_TEXT)
    // Voice unlocks only on explicit Wake tap — never auto-speak on mount
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
    if (muted || !voiceUnlockedRef.current || !gr.spokenText.trim()) return
    setSpeaking(true)
    const result = await speak(gr.spokenText)
    if (ttsSessionRef.current !== session) return
    setSpeaking(false)
    if (result.ok && result.provider === 'browser') {
      setTtsFallbackActive(true)
      if (result.elevenError) setTtsLastElevenError(result.elevenError)
      else if (result.error) setTtsLastElevenError(result.error)
    } else if (!result.ok && !result.aborted) {
      if (result.provider === 'elevenlabs') setTtsLastElevenError(result.error ?? '')
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
      if (res.ok && res.provider === 'browser') {
        setTtsFallbackActive(true)
        if (res.elevenError) setTtsLastElevenError(res.elevenError)
        else if (res.error) setTtsLastElevenError(res.error)
        if (!voiceUnlocked) setVoiceUnlocked(true)
      } else if (res.ok) {
        if (!voiceUnlocked) {
          setVoiceUnlocked(true)
          // eslint-disable-next-line no-console
          console.log('GIENIU voice unlocked', true)
        }
      } else if (!res.aborted) {
        if (res.provider === 'elevenlabs') setTtsLastElevenError(res.error ?? '')
        setTtsError(res.error ?? 'unknown error')
        // eslint-disable-next-line no-console
        console.log('GIENIU TTS error detail', res.error)
      }
    })
  }

  // ── Context snapshot for gieniu-command API ───────────────────────────────────

  function buildCommandContext(): GieniuCommandContext {
    const today = new Date().toLocaleDateString('en-CA', { timeZone: 'Europe/Warsaw' })
    const latestMetaDate = ads[0]?.date ?? trend.find(r => r.meta_spend > 0)?.date ?? '—'
    const latestWixDate  = trend[0]?.date ?? '—'
    return {
      todayKPIs: perf ? {
        wix_orders: perf.wix_orders,
        wix_revenue: perf.wix_revenue,
        meta_spend: perf.meta_spend,
        real_cpa: perf.real_cpa,
        real_roas: perf.real_roas,
        date: perf.date,
      } : null,
      profitData: profitData?.ok ? {
        ok: true,
        marginBeforeAds: profitData.marginBeforeAds,
        adSpend: profitData.adSpend,
        estimatedProfitAfterAds: profitData.estimatedProfitAfterAds,
        estimatedProfitPerOrder: profitData.estimatedProfitPerOrder,
        unknownRevenue: profitData.unknownRevenue,
        ordersCount: profitData.ordersCount,
      } : null,
      dataHealth: {
        metaFresh: latestMetaDate === today,
        wixFresh:  latestWixDate === today,
        latestMetaDate,
        latestWixDate,
        today,
      },
      jsuSummary: jsuSummary ? {
        bottleneck: jsuSummary.bottleneck,
        diagnosis:  jsuSummary.diagnosis,
        totals: jsuSummary.totals,
        rates:  jsuSummary.rates,
      } : null,
      recentTrend: trend.map(r => ({
        date: r.date,
        meta_spend: r.meta_spend,
        wix_orders: r.wix_orders,
        wix_revenue: r.wix_revenue,
        real_cpa: r.real_cpa,
        real_roas: r.real_roas,
        meta_purchases: r.meta_purchases ?? null,
        meta_purchase_value: r.meta_purchase_value ?? null,
      })),
      topCampaigns: ads.slice(0, 10).map(a => ({
        name: a.campaign_name ?? a.campaign_id ?? '?',
        ad_name: a.ad_name ?? undefined,
        spend: a.spend,
        clicks: a.clicks ?? 0,
        link_clicks: a.link_clicks ?? 0,
        impressions: a.impressions ?? 0,
        purchases: a.meta_purchases ?? a.purchases ?? 0,
      })),
      metaEfficiency: (() => {
        const totalClicks      = ads.reduce((s, a) => s + (a.clicks ?? 0), 0)
        const totalLinkClicks  = ads.reduce((s, a) => s + (a.link_clicks ?? 0), 0)
        const totalImpressions = ads.reduce((s, a) => s + (a.impressions ?? 0), 0)
        const totalSpend       = ads.reduce((s, a) => s + a.spend, 0)
        return {
          clicks:      totalClicks,
          link_clicks: totalLinkClicks,
          impressions: totalImpressions,
          spend:       totalSpend,
          ctr:         totalImpressions > 0 ? totalLinkClicks / totalImpressions * 100 : null,
          cpc:         totalClicks > 0      ? totalSpend / totalClicks : null,
          cpm:         totalImpressions > 0 ? totalSpend / totalImpressions * 1000 : null,
        }
      })(),
      todayByProduct: ordersData?.today_classified ?? null,
      currentRoute: section,
    }
  }

  // ── Intent handler ────────────────────────────────────────────────────────────

  async function handleIntentQuery(query: string) {
    setLastQuery(query)
    stopSpeaking()
    setThinking(true)

    try {
      const ctx = buildCommandContext()
      const cmdResult = await fetchGieniuCommand(query, ctx)
      setLastIntent(cmdResult.intent)
      setLastIntentConfidence(cmdResult.confidence)
      if (cmdResult.llm !== undefined) {
        setLlmConnected(cmdResult.llm.active)
      } else if (cmdResult.warnings.includes('LLM not configured')) {
        setLlmConnected(false)
      } else if (cmdResult.llmUsed) {
        setLlmConnected(true)
      }
      // Information first — the answer text/voice is delivered by speakAnswer above.
      speakAnswer({ displayText: cmdResult.answerText, spokenText: cmdResult.speechText })
      // Then a subtle, silent visual mood accent (never audio, never blocking).
      if (isDayResultQuery(query) && perf?.real_roas != null) showResultMood(perf.real_roas)
    } catch (err) {
      // eslint-disable-next-line no-console
      console.warn('gieniu-command failed — falling back to local intent resolve:', err)
      const result = resolveIntent(query, { perf, status, ads, metaStats, jsuSummary, trend, opsWeekReport, ordersData, profitData })
      speakAnswer(result)
      if (isDayResultQuery(query) && perf?.real_roas != null) showResultMood(perf.real_roas)
    } finally {
      setThinking(false)
    }
  }

  // ── Start Stanley voice ───────────────────────────────────────────────────────

  async function handleStartStanleyVoice() {
    prewarmAudio()
    setTtsError('')
    // eslint-disable-next-line no-console
    console.log('GIENIU Start voice — endpoint: /.netlify/functions/gieniu-tts')
    const testText = isElevenLabsPaused()
      ? 'Stanley voice is active.'
      : (responseSpoken || response || OPENING_TEXT)
    const session = ++ttsSessionRef.current
    setSpeaking(true)
    const result = await speak(testText)
    if (ttsSessionRef.current !== session) return
    setSpeaking(false)
    if (result.ok && result.provider === 'browser') {
      setTtsFallbackActive(true)
      if (result.elevenError) setTtsLastElevenError(result.elevenError)
      else if (result.error) setTtsLastElevenError(result.error)
      setVoiceUnlocked(true)
    } else if (result.ok) {
      setVoiceUnlocked(true)
      // eslint-disable-next-line no-console
      console.log('GIENIU voice unlocked', true)
    } else if (!result.aborted) {
      if (result.provider === 'elevenlabs') setTtsLastElevenError(result.error ?? '')
      setTtsError(result.error ?? 'unknown error')
      // eslint-disable-next-line no-console
      console.log('GIENIU TTS error detail', result.error)
    }
  }

  // ── Wake GIENIU: one tap → unlock voice + morning brief + mic ────────────────

  async function handleWakeAndBrief() {
    prewarmAudio()
    setTtsError('')
    setVoiceUnlocked(true)
    voiceUnlockedRef.current = true  // update ref immediately so speakAnswer sees it
    await handleIntentQuery('morning brief')
    // Activate the mic for hands-free follow-up — but ONLY once Stanley has finished
    // speaking, otherwise the mic catches his own voice and cuts the brief short.
    if (!listening) {
      if (sttIsStanleySpeaking()) {
        const unsub = onSpeechChange(sp => { if (!sp) { unsub(); handleMic() } })
      } else {
        handleMic()
      }
    }
  }

  // ── Retry ElevenLabs ─────────────────────────────────────────────────────────

  async function handleRetryElevenLabs() {
    resetElevenLabs()
    setTtsFallbackActive(false)
    setTtsError('')
    prewarmAudio()
    const session = ++ttsSessionRef.current
    setSpeaking(true)
    const result = await speak(responseSpoken || response || OPENING_TEXT)
    if (ttsSessionRef.current !== session) return
    setSpeaking(false)
    if (result.ok && result.provider === 'browser') {
      // ElevenLabs still quota'd — browser fallback kicked in again silently
      setTtsFallbackActive(true)
    } else if (result.ok && result.provider === 'elevenlabs') {
      // ElevenLabs working again
      setTtsFallbackActive(false)
    } else if (!result.aborted) {
      if (result.provider === 'elevenlabs') setTtsLastElevenError(result.error ?? '')
      setTtsError(result.error ?? 'unknown error')
    }
  }

  // ── Reset all voice state ─────────────────────────────────────────────────────

  function handleResetVoiceState() {
    resetVoiceState()
    setTtsFallbackActive(false)
    setTtsError('')
    setTtsLastElevenError('')
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

    setSttStatus('idle')
    setSttInterim('')
    setSttPrefillInput('')
    setTranscript('')

    const controller = startListening({
      onInterim: (text) => {
        setSttInterim(text)
        setTranscript(text)
      },
      onFinal: (result: SttResult) => {
        setListening(false)
        setSttLastFinal(result.transcript)
        setSttInterim('')
        setTranscript(result.transcript)
        setSttConfidence(result.confidence)
        // eslint-disable-next-line no-console
        console.log('GIENIU STT final', result)

        if (!result.accepted) {
          setSttStatus('rejected')
          setSttRejectionReason(result.rejectionReason ?? 'unknown')
          setSttPrefillInput(result.transcript)
          setThinking(false)
          return
        }

        setSttStatus('accepted')
        setSttRejectionReason('')

        const normalized = normalizeSpeech(result.transcript)
        if (isStopCommand(normalized)) {
          stopSpeaking()
          return
        }

        // Guard against self-interruption: if Stanley is still speaking, this final
        // is almost certainly his own voice/echo caught by the mic. Ignore it so he
        // is never cut off mid-sentence. (To interrupt on purpose, tap the mic — that
        // path calls stopSpeaking explicitly.)
        if (sttIsStanleySpeaking()) {
          setThinking(false)
          return
        }

        setThinking(true)
        if (debounceRef.current) clearTimeout(debounceRef.current)
        debounceRef.current = setTimeout(() => {
          void handleIntentQuery(result.transcript)
        }, 750)
      },
      onError: (msg) => {
        setListening(false)
        setThinking(false)
        // eslint-disable-next-line no-console
        console.warn('GIENIU STT error:', msg)
      },
      onEnd: () => {
        setListening(false)
      },
    })

    if (!controller) {
      speakAnswer(wrapResponse('Voice input is not supported in this browser. Use Chrome or Edge.'))
      return
    }

    recognitionRef.current = controller
    setListening(true)
  }

  // ── Derived ──────────────────────────────────────────────────────────────────

  // Panel-wide time range — every KPI below reads the same range so the panel is
  // never a mix of periods. monthTrend (≤31 days) feeds week AND month; fall back
  // to the 7-day trend before it loads.
  const rangeRows    = monthTrend.length > 0 ? monthTrend : trend
  const displayPerf  = resolveRangePerf(range, perf, rangeRows)
  const rangeSub     = rangeSubLabel(range)
  const isToday      = range === 'today'
  const perfIsStale  = isToday && !perf && trend.length > 0
  const cpaHigh      = displayPerf?.real_cpa != null && displayPerf.real_cpa > 50
  const jsuAlert     = !!jsuSummary && jsuSummary.bottleneck !== 'OK' && jsuSummary.bottleneck !== 'NO_DATA' && jsuSummary.bottleneck !== 'NO_SOURCES'

  // ── Goal progress (Command Center bars) ──────────────────────────────────────
  const goalToday   = new Date().toLocaleDateString('en-CA', { timeZone: 'Europe/Warsaw' }) // YYYY-MM-DD
  const goalYyyymm  = goalToday.slice(0, 7)
  const goalDayNum  = parseInt(goalToday.slice(8, 10), 10)
  const goalDaysIn  = daysInMonthOf(goalYyyymm)
  const mtdRevenue  = sumMonthToDate(monthTrend, goalYyyymm)
  const ppOrdersToday = ordersData?.today_classified?.memory_pack?.count ?? null
  const ppGoal      = ppOrdersGoal(ppOrdersToday)
  const revGoal     = monthlyRevenueGoal(mtdRevenue, goalDayNum, goalDaysIn)
  const cpaGoalRes  = cpaGoal(displayPerf?.real_cpa ?? null)
  const roasGoalRes = roasGoal(displayPerf?.real_roas ?? null)

  // Profit KPI derived states — via mapProfitToSummary for canonical ProfitSummary shape
  const profitSummary     = profitData?.ok ? mapProfitToSummary(profitData) : null
  const profitEst         = profitSummary?.estimatedProfit ?? null
  const profitPositive    = profitEst != null && profitEst > 100
  const profitWarning     = profitEst != null && profitEst >= 0 && profitEst <= 100
  const profitDanger      = profitEst != null && profitEst < 0
  const hasUnknownRevenue = (profitData?.unknownRevenue ?? 0) > 0
  const profitMismatch    = profitData?.ok && profitData.ordersCount === 0 && (ordersData?.totals.today_orders ?? 0) > 0

  // ── Render ───────────────────────────────────────────────────────────────────

  return (
    <div className="hud-layout">

      {/* Subtle animated pond backdrop — under the content, switches with theme */}
      <PondBackground theme={theme} />

      {/* Epic pond-at-dusk intro — plays once per app open, in sync with the fanfare */}
      <IntroSplash />

      <Sidebar active={section} onNavigate={setSection} jsuAlert={jsuAlert} onInstall={installPrompt ? handleInstall : undefined} />

      <div className="hud-main">
        <TopBar
          status={status}
          loading={loading}
          lastRefresh={lastRefresh}
          isStale={metaStats.isStale}
          onRefresh={() => { loadData(); loadAds(); loadRuns(); loadJsuFunnel(); loadOrdersData(); loadProfitData(); loadMonthTrend() }}
          theme={theme}
          onToggleTheme={handleToggleTheme}
          ambientOn={ambientOn}
          onToggleAmbient={toggleAmbient}
        />

        <div style={{ flex: 1, padding: '28px 32px', display: 'flex', flexDirection: 'column', gap: '28px', overflowY: 'auto' }}>

          {/* ── COMMAND CENTER ─────────────────────────────────────── */}
          {section === 'command-center' && (
            <>
              {/* Time-range switcher — governs every KPI in this panel (Warsaw tz) */}
              <RangeSwitcher range={range} onChange={setRange} />

              {/* Subtle, silent result-mood accent — appears AFTER the answer, fades out */}
              {resultMood && (
                <div key={resultMoodSeq} className={`result-mood result-mood--${resultMood}`} aria-hidden="true" />
              )}

              {loading ? (
                <div style={{ color: 'var(--muted)', fontFamily: 'var(--font-mono)', fontSize: '0.8rem' }}>Loading data…</div>
              ) : (
                <>
                  {perfIsStale && (
                    <div style={{ fontFamily: 'var(--font-mono)', fontSize: '0.76rem', color: 'var(--amber)', padding: '8px 14px', background: 'rgba(251,191,36,0.06)', border: '1px solid rgba(251,191,36,0.2)', borderRadius: '3px' }}>
                      No data for today yet — showing latest available: {trend[0]?.date}
                    </div>
                  )}
                  {!perfIsStale && !displayPerf && (
                    <div style={{ fontFamily: 'var(--font-mono)', fontSize: '0.76rem', color: 'var(--muted)', padding: '8px 14px', background: 'var(--surface2)', border: '1px solid var(--border)', borderRadius: '3px' }}>
                      Brak danych dla zakresu: {RANGE_LABELS[range]}{rangeSub ? ` (${rangeSub})` : ''}.
                    </div>
                  )}
                  {/* Row 1: core metrics + profit */}
                  <div className="kpi-grid" style={{ display: 'flex', flexWrap: 'wrap', gap: '10px' }}>
                    <KPICard label="Wix Orders" value={fmtNum(displayPerf?.wix_orders)} sublabel={perfIsStale ? trend[0]?.date : undefined} />
                    <KPICard label="Wix Revenue" value={fmtPln(displayPerf?.wix_revenue)} accent sublabel={perfIsStale ? trend[0]?.date : undefined} />
                    <KPICard label="Ad Spend" value={fmtPln(displayPerf?.meta_spend)} sublabel={perfIsStale ? trend[0]?.date : undefined} />
                    <KPICard
                      label="Est. Profit"
                      value={profitEst != null ? fmtPln(profitEst) : '—'}
                      positive={profitPositive}
                      warning={profitWarning}
                      danger={profitDanger}
                      sublabel="Margin − ad spend"
                    />
                    <KPICard label="Real CPA" value={displayPerf?.real_cpa != null ? fmtPln(displayPerf.real_cpa) : '—'} warning={cpaHigh} sublabel="Meta spend / Wix orders" />
                    <KPICard label="Real ROAS" value={fmtRoas(displayPerf?.real_roas)} sublabel="Wix revenue / Meta spend" />
                  </div>

                  {/* Goal progress bars — KPI realization vs business targets */}
                  <div className="panel-illuminate card">
                    <div className="section-title section-title-gold" style={{ marginBottom: '14px' }}>Goal Progress</div>
                    <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(260px, 1fr))', gap: '18px 28px' }}>
                      <GoalBar
                        label="PP orders today"
                        valueText={`${ppOrdersToday ?? '—'} / 18`}
                        pct={ppGoal.pct}
                        status={ppGoal.status}
                        note={ppGoal.note}
                      />
                      <GoalBar
                        label="Monthly revenue"
                        valueText={`${fmtNum(Math.round(mtdRevenue))} / ${fmtNum(MONTHLY_REVENUE_TARGET)} PLN`}
                        pct={revGoal.pct}
                        status={revGoal.status}
                        note={revGoal.note}
                      />
                      <GoalBar
                        label="Real CPA (cel <40)"
                        valueText={displayPerf?.real_cpa != null ? `${fmtPln(displayPerf.real_cpa)}` : '—'}
                        pct={cpaGoalRes.pct}
                        status={cpaGoalRes.status}
                        note={cpaGoalRes.note}
                      />
                      <GoalBar
                        label="Real ROAS (cel ≥2x)"
                        valueText={fmtRoas(displayPerf?.real_roas)}
                        pct={roasGoalRes.pct}
                        status={roasGoalRes.status}
                        note={roasGoalRes.note}
                      />
                    </div>
                    <div style={{ marginTop: '12px', fontFamily: 'var(--font-mono)', fontSize: '0.66rem', color: 'var(--muted2)' }}>
                      PP = Pakiet Pamięciowy (daily orders). Monthly revenue is month-to-date vs the 30 000 PLN target, paced by days elapsed. CPA/ROAS are blended (all products).
                    </div>
                  </div>

                  {/* Row 2: margin/profit detail — now range-aware (profit endpoint
                      accepts from/to), so it shows for every range. */}
                  <div className="kpi-grid" style={{ display: 'flex', flexWrap: 'wrap', gap: '10px', marginTop: '4px' }}>
                    <KPICard
                      label="Margin Before Ads"
                      value={profitSummary ? fmtPln(profitSummary.marginBeforeAds) : '—'}
                      sublabel="Known contribution margin"
                    />
                    <KPICard
                      label="Profit / Order"
                      value={profitSummary && (profitData?.ordersCount ?? 0) > 0 ? fmtPln(profitSummary.profitPerOrder) : '—'}
                      positive={profitPositive}
                      danger={profitDanger}
                      sublabel="After ad spend"
                    />
                    <KPICard
                      label="True CPA"
                      value={profitSummary?.realCpa != null ? fmtPln(profitSummary.realCpa) : '—'}
                      warning={profitSummary?.realCpa != null && profitSummary.realCpa > 50}
                      sublabel="Ad spend ÷ paid orders"
                    />
                    <KPICard
                      label="Margin ROAS"
                      value={profitSummary?.realRoas != null ? `${profitSummary.realRoas.toFixed(2)}×` : '—'}
                      sublabel="Revenue ÷ ad spend"
                    />
                    <KPICard
                      label="Unmapped Revenue"
                      value={profitData?.ok ? fmtPln(profitData.unknownRevenue) : '—'}
                      warning={hasUnknownRevenue}
                      sublabel={hasUnknownRevenue ? 'Needs margin mapping' : 'All products mapped'}
                    />
                  </div>

                  {/* Row 3: Meta ad efficiency — range-aware, derived from the daily
                      performance view (impressions/clicks/spend) for the chosen range. */}
                  {displayPerf && (displayPerf.impressions > 0 || displayPerf.clicks > 0) && (() => {
                    const totalClicks      = displayPerf.clicks ?? 0
                    const totalLinkClicks  = displayPerf.link_clicks ?? 0
                    const totalImpressions = displayPerf.impressions ?? 0
                    const totalSpend       = displayPerf.meta_spend ?? 0
                    const ctr  = totalImpressions > 0 ? totalLinkClicks / totalImpressions * 100 : null
                    const cpc  = totalClicks > 0      ? totalSpend / totalClicks : null
                    const cpm  = totalImpressions > 0 ? totalSpend / totalImpressions * 1000 : null
                    return (
                      <div className="kpi-grid" style={{ display: 'flex', flexWrap: 'wrap', gap: '10px', marginTop: '4px' }}>
                        <KPICard label="CTR" value={fmtPct(ctr)} sublabel="Link clicks / impressions" />
                        <KPICard label="CPC" value={fmtPln(cpc)} sublabel="Spend / clicks" />
                        <KPICard label="CPM" value={fmtPln(cpm)} sublabel="Spend / 1 000 impr." />
                        <KPICard label="Total Clicks" value={fmtNum(totalClicks)} dim sublabel="All Meta campaigns" />
                        <KPICard label="Impressions" value={fmtNum(totalImpressions)} dim sublabel="All Meta campaigns" />
                        <KPICard label="Meta Attr." value={fmtNum(displayPerf.meta_purchases ?? 0)} dim sublabel="Meta-reported purchases" />
                      </div>
                    )
                  })()}

                  {/* Profit data warnings — today-scoped like the profit endpoint */}
                  {isToday && profitMismatch && (
                    <div style={{ fontFamily: 'var(--font-mono)', fontSize: '0.72rem', color: 'var(--orange)', padding: '6px 12px', background: 'rgba(251,146,60,0.06)', border: '1px solid rgba(251,146,60,0.2)', borderRadius: '3px' }}>
                      ⚠ Profit endpoint returned 0 orders but ordersData shows orders today — filter mismatch or stale cache.
                    </div>
                  )}
                  {hasUnknownRevenue && !profitMismatch && (
                    <div style={{ fontFamily: 'var(--font-mono)', fontSize: '0.72rem', color: 'var(--orange)', padding: '6px 12px', background: 'rgba(251,146,60,0.06)', border: '1px solid rgba(251,146,60,0.2)', borderRadius: '3px' }}>
                      ⚠ {fmtPln(profitData!.unknownRevenue)} revenue from unmapped products — contribution margin not included in Est. Profit.
                    </div>
                  )}
                  {(profitData?.emailNormReclassified ?? 0) > 0 && (
                    <div style={{ fontFamily: 'var(--font-mono)', fontSize: '0.72rem', color: 'var(--muted2)', padding: '6px 12px', background: 'rgba(99,211,199,0.06)', border: '1px solid rgba(99,211,199,0.2)', borderRadius: '3px' }}>
                      ℹ {profitData!.emailNormReclassified} order(s) classified via email→webinar match — treated as JSU.
                    </div>
                  )}
                </>
              )}

              {/* Campaign inspector — pick a campaign (or All) for the selected range */}
              <CampaignInspector
                rows={campaignRows}
                loading={campaignRowsLoading}
                rangeLabel={RANGE_LABELS[range]}
              />

              <div className="panel-illuminate card">
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
            <div className="panel-illuminate card">
              <CampaignsPanel />
            </div>
          )}

          {/* ── WEBINARS ──────────────────────────────────────────── */}
          {section === 'webinars' && (
            <div className="panel-illuminate card">
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
            <div className="panel-illuminate card">
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
              ttsLastElevenError={ttsLastElevenError}
              ttsFallbackActive={ttsFallbackActive}
              browserVoiceInfo={browserVoiceInfo}
              englishVoiceCount={englishVoiceCount}
              lastIntent={lastIntent}
              lastIntentConfidence={lastIntentConfidence}
              llmConnected={llmConnected}
              sttLastFinal={sttLastFinal}
              sttInterim={sttInterim}
              sttConfidence={sttConfidence}
              sttStatus={sttStatus}
              sttRejectionReason={sttRejectionReason}
              lastRefresh={lastRefresh}
              profitDataDate={profitData?.ok ? profitData.dateWarsaw ?? null : null}
              profitDataOrders={profitData?.ok ? profitData.ordersCount : null}
            />
          )}

        </div>
      </div>

      <RightPanel
        response={response}
        chart={responseChart}
        lastQuery={lastQuery}
        voiceUnlocked={voiceUnlocked}
        onStartStanleyVoice={handleStartStanleyVoice}
        onWake={handleWakeAndBrief}
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
        ttsLastElevenError={ttsLastElevenError}
        ttsFallbackActive={ttsFallbackActive}
        onRetryElevenLabs={handleRetryElevenLabs}
        browserVoiceInfo={browserVoiceInfo}
        englishVoiceCount={englishVoiceCount}
        onResetVoiceState={handleResetVoiceState}
        sttStatus={sttStatus}
        sttConfidence={sttConfidence}
        sttRejectionReason={sttRejectionReason}
        sttPrefillInput={sttPrefillInput}
      />

      {/* Mobile bottom nav */}
      <MobileNav active={section} onNavigate={setSection} jsuAlert={jsuAlert} />

      {/* Build stamp — always visible, bottom-right */}
      <div className="build-stamp">
        STANLEY build: {__BUILD_HASH__}
      </div>

      {/* Emotional reaction system — fixed overlay, one animation at a time */}
      <ReactionSystem />

    </div>
  )
}
