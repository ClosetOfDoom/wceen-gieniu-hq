// Stanley emotional reaction system — one state at a time, keyed on the day's ROAS.
// ONE animation at a time (queue). All anti-spam lives in module-level session
// memory — never localStorage. Sharp thresholds, never overlapping:
//   ROAS ≥ 2.5   → GOOD DAY  : confetti + coins + duck parade + celebrate.mp3
//   ROAS 1.5–2.5 → NEUTRAL   : nothing (Stanley reports plainly)
//   ROAS 1.0–1.5 → BAD DAY   : rain + greyed scenery, worried Stanley (NO audio)
//   ROAS < 1.0   → TRAGEDY   : tumbleweed + darkness + sad.mp3 from 1:23 (83 s)
// prefers-reduced-motion → static banner only, no particles/audio.

import { useState, useEffect, useRef, useCallback } from 'react'

// ── Public types ──────────────────────────────────────────────────────────────

export type ReactionEvent =
  | { kind: 'good-day'; roas: number }
  | { kind: 'bad-day'; roas: number }
  | { kind: 'tragedy' }
  | { kind: 'micro-sale'; product: 'JSU_COURSE' | 'JZK_LANGUAGE'; amount: number }
  | { kind: 'webinar-full'; count: number }

// ── Session memory (module-scope, NOT localStorage) ───────────────────────────

const celebratedDates   = new Set<string>()   // dates where ROAS≥2.5 was celebrated
const badDayDates       = new Set<string>()   // dates where ROAS 1–1.5 rain was shown
const tragedyDates      = new Set<string>()   // dates where ROAS<1 tragedy was shown
const webinarCelebrated = new Set<string>()   // key = `${sessionDate}:≥20`
let   seenOrderIds: Set<string> | null = null // null = first load, skip celebration

// ── Module-level pub/sub event bus ────────────────────────────────────────────

type Listener = (ev: ReactionEvent) => void
const _listeners: Listener[] = []

export function triggerReaction(ev: ReactionEvent): void {
  _listeners.forEach(fn => fn(ev))
}

function _subscribe(fn: Listener): () => void {
  _listeners.push(fn)
  return () => { const i = _listeners.indexOf(fn); if (i >= 0) _listeners.splice(i, 1) }
}

// ── Public guard helpers (called from App.tsx) ────────────────────────────────

// Sharp, non-overlapping thresholds — exactly one state fires per day:
//   ≥2.5 celebrate · 1.5–2.5 neutral (nothing) · 1.0–1.5 rain · <1.0 tragedy.
export function tryTriggerDayReaction(roas: number | null, today: string): void {
  if (roas == null) return
  if (roas >= 2.5) {
    if (celebratedDates.has(today)) return
    celebratedDates.add(today)
    triggerReaction({ kind: 'good-day', roas })
  } else if (roas >= 1.5) {
    // Neutral band — Stanley just reports the numbers, no animation or sound.
    return
  } else if (roas >= 1.0) {
    if (badDayDates.has(today)) return
    badDayDates.add(today)
    triggerReaction({ kind: 'bad-day', roas })
  } else {
    if (tragedyDates.has(today)) return
    tragedyDates.add(today)
    triggerReaction({ kind: 'tragedy' })
  }
}

// Watch latest_20_orders. First call initializes set without celebrating.
export function tryTriggerMicroSales(orders: ReadonlyArray<{
  external_order_id: string
  classified_product: string
  amount: number
}>): void {
  if (seenOrderIds === null) {
    seenOrderIds = new Set(orders.map(o => o.external_order_id))
    return
  }
  for (const order of orders) {
    if (seenOrderIds.has(order.external_order_id)) continue
    seenOrderIds.add(order.external_order_id)
    if (order.classified_product === 'JSU_COURSE') {
      triggerReaction({ kind: 'micro-sale', product: 'JSU_COURSE', amount: order.amount })
    } else if (order.classified_product === 'JZK_LANGUAGE') {
      triggerReaction({ kind: 'micro-sale', product: 'JZK_LANGUAGE', amount: order.amount })
    }
  }
}

// Only fires when attendanceStatus === 'populated' (real ClickMeeting data present).
export function tryTriggerWebinarFull(
  attendees: number | null | undefined,
  attendanceStatus: 'populated' | 'not_populated' | undefined,
  sessionDate: string,
): void {
  if (attendanceStatus !== 'populated') return
  if (attendees == null || attendees < 20) return
  const key = `${sessionDate}:${attendees}`
  if (webinarCelebrated.has(key)) return
  webinarCelebrated.add(key)
  triggerReaction({ kind: 'webinar-full', count: attendees })
}

// ── Particle generators ───────────────────────────────────────────────────────

interface ConfettiPiece { id: number; x: number; color: string; circle: boolean; size: number; delay: number; dur: number }
interface CoinPiece     { id: number; x: number; delay: number; label: string }
interface RainDrop      { id: number; x: number; delay: number; dur: number; h: number; op: number }

// Blue-pond confetti: gold + water-blues + cream/white (no green).
const CONFETTI_COLORS = ['#ee9d00','#f5b500','#6cb6dc','#57c8e0','#eaf3f8','#93cce9','#ffffff','#5cc7d6']

function makeConfetti(n: number): ConfettiPiece[] {
  return Array.from({ length: n }, (_, i) => ({
    id: i,
    x: Math.random() * 100,
    color: CONFETTI_COLORS[Math.floor(Math.random() * CONFETTI_COLORS.length)],
    circle: Math.random() < 0.38,
    size: 6 + Math.random() * 8,
    delay: Math.random() * 2.9,
    dur: 2.8 + Math.random() * 1.9,
  }))
}

function makeCoins(n: number): CoinPiece[] {
  const labels = ['💰','zł','PLN','🪙','zł','PLN','💰','zł']
  return Array.from({ length: n }, (_, i) => ({
    id: i,
    x: 12 + Math.random() * 76,
    delay: i * 0.16,
    label: labels[i % labels.length],
  }))
}

function makeRain(n: number): RainDrop[] {
  return Array.from({ length: n }, (_, i) => ({
    id: i,
    x: Math.random() * 100,
    delay: Math.random() * 3.6,
    dur: 0.7 + Math.random() * 0.55,
    h: 10 + Math.random() * 19,
    op: 0.18 + Math.random() * 0.28,
  }))
}

// ── SVG Tumbleweed (pure CSS/SVG, no external assets) ────────────────────────

function Tumbleweed({ size = 70 }: { size?: number }) {
  return (
    <svg width={size} height={size} viewBox="0 0 70 70" aria-hidden="true">
      <circle cx="35" cy="35" r="31" fill="none" stroke="#8B6B4A" strokeWidth="2.5" />
      {[0, 36, 72, 108, 144].map(deg => (
        <line key={deg}
          x1="35" y1="35"
          x2={35 + 29 * Math.cos(deg * Math.PI / 180)}
          y2={35 + 29 * Math.sin(deg * Math.PI / 180)}
          stroke="#8B6B4A" strokeWidth="1.8" strokeLinecap="round"
        />
      ))}
      <circle cx="22" cy="22" r="4.5" fill="none" stroke="#A0855A" strokeWidth="1.5" />
      <circle cx="50" cy="20" r="3.5" fill="none" stroke="#A0855A" strokeWidth="1.5" />
      <circle cx="48" cy="50" r="5"   fill="none" stroke="#A0855A" strokeWidth="1.5" />
      <circle cx="20" cy="50" r="3"   fill="none" stroke="#A0855A" strokeWidth="1.5" />
      <path d="M35 8 Q46 22 35 35 Q22 22 35 8"  fill="none" stroke="#B8906A" strokeWidth="1.5" />
      <path d="M8 35 Q22 25 35 35 Q22 45 8 35"  fill="none" stroke="#B8906A" strokeWidth="1.5" />
    </svg>
  )
}

// ── Audio: seek-aware factory ─────────────────────────────────────────────────

function makeAudio(src: string, seekSec?: number): HTMLAudioElement {
  const audio = new Audio(src)
  if (seekSec != null) {
    // Apply seek on whichever event fires first (mobile needs canplay)
    const seek = () => { audio.currentTime = seekSec }
    audio.addEventListener('loadedmetadata', seek, { once: true })
    audio.addEventListener('canplay', seek, { once: true })
  }
  return audio
}

// ── Active state ──────────────────────────────────────────────────────────────

interface ActiveState {
  event: ReactionEvent
  confetti?: ConfettiPiece[]
  coins?: CoinPiece[]
  rain?: RainDrop[]
}

function buildActive(ev: ReactionEvent): ActiveState {
  switch (ev.kind) {
    case 'good-day':     return { event: ev, confetti: makeConfetti(50), coins: makeCoins(9) }
    case 'bad-day':      return { event: ev, rain: makeRain(46) }
    case 'tragedy':      return { event: ev }
    case 'micro-sale':   return { event: ev, coins: makeCoins(6) }
    case 'webinar-full': return { event: ev }
  }
}

function getDuration(ev: ReactionEvent): number {
  switch (ev.kind) {
    case 'good-day':     return 8500
    case 'bad-day':      return 8000
    case 'tragedy':      return 8000
    case 'micro-sale':   return 3800
    case 'webinar-full': return 4200
  }
}

// ── Component ─────────────────────────────────────────────────────────────────

export function ReactionSystem() {
  const reduced = useRef(
    typeof window !== 'undefined' && window.matchMedia('(prefers-reduced-motion: reduce)').matches
  )

  const [active,  setActive]  = useState<ActiveState | null>(null)
  const [, setQueue]          = useState<ReactionEvent[]>([])
  const [exiting, setExiting] = useState(false)
  const [muted,   setMuted]   = useState(false)

  const audioRef = useRef<HTMLAudioElement | null>(null)
  const timerRef = useRef<ReturnType<typeof setTimeout> | null>(null)
  const mutedRef = useRef(false)
  useEffect(() => { mutedRef.current = muted }, [muted])

  const stopAudio = useCallback(() => {
    if (!audioRef.current) return
    audioRef.current.pause()
    audioRef.current.currentTime = 0
    audioRef.current = null
  }, [])

  const dismiss = useCallback(() => {
    setExiting(true)
    stopAudio()
    if (timerRef.current) { clearTimeout(timerRef.current); timerRef.current = null }
    setTimeout(() => {
      setActive(null)
      setExiting(false)
      setQueue(prev => {
        if (prev.length === 0) return prev
        const [next, ...rest] = prev
        // Small gap before next reaction so it feels intentional
        setTimeout(() => triggerReaction(next), 320)
        return rest
      })
    }, 480)
  }, [stopAudio])

  // Subscribe to event bus
  useEffect(() => _subscribe(ev => {
    setActive(cur => {
      if (cur) {
        setQueue(q => {
          // Max 2 pending; drop duplicate kinds
          if (q.length >= 2) return q
          if (q.some(e => e.kind === ev.kind)) return q
          return [...q, ev]
        })
        return cur
      }
      return buildActive(ev)
    })
  }), [])

  // Auto-dismiss
  useEffect(() => {
    if (!active) return
    if (timerRef.current) clearTimeout(timerRef.current)
    timerRef.current = setTimeout(dismiss, getDuration(active.event))
    return () => { if (timerRef.current) clearTimeout(timerRef.current) }
  }, [active, dismiss])

  // Audio — keyed on reaction kind so it restarts only when type changes
  useEffect(() => {
    if (!active || reduced.current) return

    let audio: HTMLAudioElement | null = null

    if (active.event.kind === 'good-day') {
      audio = makeAudio('/celebrate.mp3')
      audio.volume = mutedRef.current ? 0 : 0.65
      audio.play().catch(() => {/* autoplay blocked — user must interact first */})
      audioRef.current = audio
    } else if (active.event.kind === 'tragedy') {
      // sad.mp3 starting at 1:23 (83 seconds)
      audio = makeAudio('/sad.mp3', 83)
      audio.volume = mutedRef.current ? 0 : 0.6
      audio.play().catch(() => {})
      audioRef.current = audio
    }

    return () => {
      if (audio) { audio.pause(); audio.currentTime = 0 }
    }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [active?.event.kind])

  // Volume sync
  useEffect(() => {
    if (audioRef.current) audioRef.current.volume = muted ? 0 : 0.65
  }, [muted])

  if (!active) return null

  const ev       = active.event
  const red      = reduced.current
  const hasAudio = ev.kind === 'good-day' || ev.kind === 'tragedy'

  // ── Render ───────────────────────────────────────────────────────────────────

  return (
    <>
      {/* pointer-events: none — everything inside is decorative */}
      <div
        className={`reaction-layer${exiting ? ' reaction-layer--exit' : ''}`}
        role="status"
        aria-live="polite"
        aria-atomic="true"
        aria-label={
          ev.kind === 'good-day'     ? `Celebration: ROAS ${ev.roas.toFixed(2)}x` :
          ev.kind === 'bad-day'      ? `A weak day: ROAS ${ev.roas.toFixed(2)}x` :
          ev.kind === 'tragedy'      ? 'Bleak day: ROAS below 1' :
          ev.kind === 'micro-sale'   ? 'Sale detected' :
          'Webinar full house'
        }
      >

        {/* ════ GOOD DAY ════ */}
        {ev.kind === 'good-day' && !red && (
          <>
            {/* Subtle gold wash at top */}
            <div style={{ position: 'absolute', inset: 0, background: 'linear-gradient(to bottom, rgba(238,157,0,0.11) 0%, transparent 32%)', pointerEvents: 'none' }} />

            {/* Confetti */}
            {active.confetti?.map(p => (
              <div key={p.id} style={{
                position: 'absolute', left: `${p.x}%`, top: 0,
                width: p.size, height: p.circle ? p.size : p.size * 0.44,
                background: p.color, borderRadius: p.circle ? '50%' : '2px',
                animation: `confetti-fall ${p.dur}s ${p.delay}s ease-in both`,
                willChange: 'transform, opacity',
              }} />
            ))}

            {/* Coins */}
            {active.coins?.map(c => (
              <div key={c.id} style={{
                position: 'absolute', bottom: '16%', left: `${c.x}%`,
                fontSize: c.label.length === 1 ? '2.1rem' : '0.88rem',
                fontFamily: 'var(--font-mono)', fontWeight: 700,
                color: '#ee9d00', textShadow: '0 0 10px rgba(238,157,0,0.85)',
                animation: `coin-rise 1.65s ${c.delay}s ease-out both`,
                willChange: 'transform, opacity',
              }}>
                {c.label}
              </div>
            ))}

            {/* Duck parade — only own stanley-duck.png, 3 ducks from sides */}
            {([
              { side: 'left',  delay: '0.2s',  size: 86  },
              { side: 'right', delay: '0.6s',  size: 108 },
              { side: 'left',  delay: '1.05s', size: 72  },
            ] as const).map((d, i) => (
              <img key={i}
                src="/stanley-duck.png" alt="" aria-hidden="true"
                style={{
                  position: 'absolute', bottom: '26%',
                  [d.side === 'left' ? 'left' : 'right']: '7%',
                  width: d.size, height: d.size,
                  borderRadius: '50%', objectFit: 'cover', objectPosition: 'center',
                  animation: `${d.side === 'left' ? 'duck-enter-left' : 'duck-enter-right'} 5.8s ${d.delay} ease-in-out both`,
                  filter: 'drop-shadow(0 0 16px rgba(238,157,0,0.6))',
                  willChange: 'transform, opacity',
                }}
              />
            ))}

            {/* Victory banner */}
            <div style={{
              position: 'absolute', top: '14%', left: '50%',
              transform: 'translateX(-50%)',
              background: 'rgba(11,30,46,0.94)', border: '2px solid var(--gold)',
              borderRadius: '6px', padding: '18px 36px', textAlign: 'center',
              animation: 'reaction-banner-in 0.5s ease forwards',
              boxShadow: '0 0 40px rgba(238,157,0,0.32)',
              minWidth: '310px',
            }}>
              <div style={{ fontFamily: 'var(--font-serif)', fontSize: '1.18rem', color: 'var(--gold)', marginBottom: '6px', letterSpacing: '0.07em' }}>
                A most excellent day, sir.
              </div>
              <div style={{ fontFamily: 'var(--font-mono)', fontSize: '0.84rem', color: 'var(--text2)' }}>
                ROAS {ev.roas.toFixed(2)}× — the machine is running.
              </div>
            </div>
          </>
        )}

        {/* Good day — reduced motion: static banner only */}
        {ev.kind === 'good-day' && red && (
          <div style={{
            position: 'absolute', top: '10%', left: '50%', transform: 'translateX(-50%)',
            background: 'rgba(11,30,46,0.95)', border: '2px solid var(--gold)',
            borderRadius: '6px', padding: '16px 30px', textAlign: 'center', minWidth: '290px',
            boxShadow: '0 0 24px rgba(238,157,0,0.25)',
          }}>
            <div style={{ fontFamily: 'var(--font-serif)', fontSize: '1.1rem', color: 'var(--gold)', letterSpacing: '0.06em' }}>
              A most excellent day, sir. ROAS {ev.roas.toFixed(2)}×
            </div>
          </div>
        )}

        {/* ════ BAD DAY (ROAS 1.0–1.5) — rain + grey, worried Stanley, NO audio ════ */}
        {ev.kind === 'bad-day' && !red && (
          <>
            {/* Desaturating grey wash — overcast, not the tragedy's blackout */}
            <div style={{
              position: 'absolute', inset: 0,
              background: 'linear-gradient(to bottom, rgba(40,54,66,0.34) 0%, rgba(24,34,44,0.42) 100%)',
              animation: 'reaction-fade-in 1s ease forwards',
            }} />

            {/* Rain — the signal of a bad (not tragic) day */}
            {active.rain?.map(r => (
              <div key={r.id} style={{
                position: 'absolute', left: `${r.x}%`, top: 0,
                width: 1.5, height: r.h,
                background: `rgba(150,185,210,${r.op})`,
                animation: `rain-drop ${r.dur}s ${r.delay}s linear infinite`,
                willChange: 'transform, opacity',
              }} />
            ))}

            {/* Worried banner */}
            <div style={{
              position: 'absolute', top: '16%', left: '50%', transform: 'translateX(-50%)',
              background: 'rgba(14,24,34,0.94)',
              border: '1px solid rgba(120,150,175,0.4)', borderRadius: '5px',
              padding: '17px 34px', textAlign: 'center', minWidth: '316px',
              animation: 'reaction-banner-in 0.5s ease forwards',
              boxShadow: '0 0 26px rgba(0,0,0,0.5)',
            }}>
              <div style={{ fontFamily: 'var(--font-serif)', fontSize: '1.08rem', color: 'var(--text2)', marginBottom: '6px', letterSpacing: '0.04em' }}>
                A soggy sort of day, sir.
              </div>
              <div style={{ fontFamily: 'var(--font-mono)', fontSize: '0.8rem', color: 'var(--muted)', lineHeight: 1.55 }}>
                ROAS {ev.roas.toFixed(2)}× — barely above water. Worth a closer look.
              </div>
            </div>
          </>
        )}

        {/* Bad day — reduced motion */}
        {ev.kind === 'bad-day' && red && (
          <div style={{
            position: 'absolute', top: '10%', left: '50%', transform: 'translateX(-50%)',
            background: 'rgba(14,24,34,0.95)', border: '1px solid rgba(120,150,175,0.35)',
            borderRadius: '5px', padding: '16px 30px', textAlign: 'center', minWidth: '292px',
          }}>
            <div style={{ fontFamily: 'var(--font-serif)', fontSize: '1.04rem', color: 'var(--text2)' }}>
              A soggy sort of day, sir. ROAS {ev.roas.toFixed(2)}× — worth a closer look.
            </div>
          </div>
        )}

        {/* ════ TRAGEDY (ROAS < 1.0) — tumbleweed + darkness + sad.mp3 from 1:23 ════ */}
        {ev.kind === 'tragedy' && !red && (
          <>
            {/* Deep darkness — the blackout that sets tragedy apart from a bad day */}
            <div style={{
              position: 'absolute', inset: 0,
              background: 'rgba(2,5,8,0.72)',
              animation: 'reaction-fade-in 1.1s ease forwards',
            }} />

            {/* Tumbleweed — CSS/SVG only, no external asset */}
            <div style={{
              position: 'absolute', bottom: '20%', left: 0,
              animation: 'tumbleweed-roll 5s 1.3s ease-in-out both',
              willChange: 'transform, opacity',
            }}>
              <Tumbleweed size={74} />
            </div>

            {/* Melancholy banner */}
            <div style={{
              position: 'absolute', top: '18%', left: '50%', transform: 'translateX(-50%)',
              background: 'rgba(2,5,8,0.97)',
              border: '1px solid rgba(90,110,130,0.32)', borderRadius: '4px',
              padding: '18px 34px', textAlign: 'center', minWidth: '320px',
              boxShadow: '0 0 30px rgba(0,0,0,0.8)',
            }}>
              <div style={{ fontFamily: 'var(--font-serif)', fontSize: '1.06rem', color: 'var(--muted)', marginBottom: '6px', letterSpacing: '0.04em', fontStyle: 'italic' }}>
                A rather bleak day, sir.
              </div>
              <div style={{ fontFamily: 'var(--font-mono)', fontSize: '0.79rem', color: 'var(--muted2)', lineHeight: 1.55 }}>
                The ads cost more than they returned.
              </div>
            </div>
          </>
        )}

        {/* Tragedy — reduced motion */}
        {ev.kind === 'tragedy' && red && (
          <div style={{
            position: 'absolute', top: '10%', left: '50%', transform: 'translateX(-50%)',
            background: 'rgba(2,5,8,0.96)', border: '1px solid rgba(90,110,130,0.28)',
            borderRadius: '4px', padding: '16px 30px', textAlign: 'center', minWidth: '286px',
          }}>
            <div style={{ fontFamily: 'var(--font-serif)', fontSize: '1.04rem', color: 'var(--muted)', fontStyle: 'italic' }}>
              A rather bleak day, sir. The ads cost more than they returned.
            </div>
          </div>
        )}

        {/* ════ MICRO-SALE ════ */}
        {ev.kind === 'micro-sale' && !red && (
          <>
            {active.coins?.map(c => (
              <div key={c.id} style={{
                position: 'absolute', bottom: '26%', left: `${c.x}%`,
                fontSize: c.label.length === 1 ? '1.85rem' : '0.83rem',
                fontFamily: 'var(--font-mono)', fontWeight: 700,
                color: '#ee9d00', textShadow: '0 0 8px rgba(238,157,0,0.8)',
                animation: `coin-rise 1.35s ${c.delay}s ease-out both`,
                willChange: 'transform, opacity',
              }}>
                {c.label}
              </div>
            ))}
            <div style={{
              position: 'absolute', top: '20%', left: '50%', transform: 'translateX(-50%)',
              background: 'rgba(11,30,46,0.94)', border: '1.5px solid var(--gold)',
              borderRadius: '4px', padding: '13px 28px', textAlign: 'center', minWidth: '274px',
              animation: 'reaction-banner-in 0.42s ease forwards',
              boxShadow: '0 0 22px rgba(238,157,0,0.22)',
            }}>
              <div style={{ fontFamily: 'var(--font-serif)', fontSize: '1rem', color: 'var(--gold)', letterSpacing: '0.06em' }}>
                {ev.product === 'JSU_COURSE' ? 'A course sale, sir!' : 'A language pack sale, sir!'}
              </div>
              <div style={{ fontFamily: 'var(--font-mono)', fontSize: '0.79rem', color: 'var(--text2)', marginTop: '4px' }}>
                {ev.amount.toFixed(0)} zł — very good, sir.
              </div>
            </div>
          </>
        )}
        {ev.kind === 'micro-sale' && red && (
          <div style={{
            position: 'absolute', top: '10%', left: '50%', transform: 'translateX(-50%)',
            background: 'rgba(11,30,46,0.95)', border: '1.5px solid var(--gold)',
            borderRadius: '4px', padding: '12px 26px', textAlign: 'center', minWidth: '248px',
          }}>
            <div style={{ fontFamily: 'var(--font-serif)', fontSize: '0.95rem', color: 'var(--gold)' }}>
              {ev.product === 'JSU_COURSE' ? 'A course sale, sir!' : 'A language pack sale, sir!'} {ev.amount.toFixed(0)} zł
            </div>
          </div>
        )}

        {/* ════ WEBINAR FULL HOUSE ════ */}
        {ev.kind === 'webinar-full' && (
          <div style={{
            position: 'absolute', top: '14%', left: '50%', transform: 'translateX(-50%)',
            background: 'rgba(11,30,46,0.94)', border: '1.5px solid var(--teal)',
            borderRadius: '4px', padding: '16px 30px', textAlign: 'center', minWidth: '290px',
            animation: red ? undefined : 'reaction-banner-in 0.46s ease forwards',
            boxShadow: '0 0 22px rgba(52,211,153,0.2)',
          }}>
            <div style={{ fontFamily: 'var(--font-serif)', fontSize: '1.06rem', color: 'var(--teal)', letterSpacing: '0.06em' }}>
              Full house, sir!
            </div>
            <div style={{ fontFamily: 'var(--font-mono)', fontSize: '0.79rem', color: 'var(--text2)', marginTop: '4px' }}>
              {ev.count}+ attendees at the webinar.
            </div>
          </div>
        )}
      </div>

      {/* Stop / Mute controls — outside the layer so pointer-events work */}
      {hasAudio && (
        <div className="reaction-controls">
          <button
            className={`reaction-stop-btn${muted ? ' reaction-stop-btn--dim' : ''}`}
            onClick={() => setMuted(m => !m)}
            title={muted ? 'Unmute' : 'Mute music'}
          >
            {muted ? '🔇 Muted' : '🔊 Mute'}
          </button>
          <button
            className="reaction-stop-btn reaction-stop-btn--dim"
            onClick={dismiss}
            title="Close"
          >
            ✕ Close
          </button>
        </div>
      )}
    </>
  )
}
