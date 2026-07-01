// Epic intro splash — a pond at dusk, revealed in layers, with Stanley as the
// hero of the scene. Plays ONCE per app open (module-scope session memory, NOT
// localStorage), in sync with the startup fanfare (both fire on mount). Layers:
// water → reeds/cattails → moon+stars+mist → Stanley medallion → "STANLEY HQ".
// Total ~4 s, then a smooth fade to the dashboard. Skippable by tap/click.
// prefers-reduced-motion → static title + Stanley, quick auto-dismiss, no motion.

import { useState, useEffect, useRef, useCallback } from 'react'

// Once-per-open guard. Module scope = reset only on a full page load, never on
// data refresh or tab navigation within the SPA.
let alreadyPlayed = false

// ── Nadwodne rośliny — cattails (pałki wodne / typha) + reeds, as dark
//    silhouettes. Green appears ONLY here, as natural waterside plants. ──────────
function Cattails({ side }: { side: 'left' | 'right' }) {
  const flip = side === 'right'
  return (
    <svg
      viewBox="0 0 200 320" width="200" height="320" aria-hidden="true"
      style={{ transform: flip ? 'scaleX(-1)' : undefined, display: 'block' }}
    >
      {/* thin reed blades — dark waterside green */}
      <g stroke="#0e2119" strokeWidth="3" fill="none" strokeLinecap="round">
        <path d="M40 320 Q30 190 58 70" />
        <path d="M70 320 Q70 180 60 56" />
        <path d="M20 320 Q16 220 36 128" />
        <path d="M96 320 Q104 210 126 108" />
        <path d="M120 320 Q128 240 150 170" />
      </g>
      {/* cattail stems + brown heads (pałki) */}
      <g>
        <line x1="55" y1="320" x2="52" y2="92"  stroke="#14291f" strokeWidth="4" strokeLinecap="round" />
        <rect x="45" y="62"  width="14" height="46" rx="7" fill="#33240f" />
        <line x1="52" y1="62" x2="52" y2="40" stroke="#14291f" strokeWidth="3" strokeLinecap="round" />
        <line x1="86" y1="320" x2="90" y2="122" stroke="#14291f" strokeWidth="4" strokeLinecap="round" />
        <rect x="83" y="96"  width="12" height="40" rx="6" fill="#33240f" />
        <line x1="90" y1="96" x2="90" y2="76" stroke="#14291f" strokeWidth="3" strokeLinecap="round" />
      </g>
    </svg>
  )
}

const STARS = [
  { top: '12%', left: '18%', s: 2.0, d: '0.2s' },
  { top: '9%',  left: '34%', s: 1.4, d: '1.1s' },
  { top: '17%', left: '55%', s: 1.8, d: '0.6s' },
  { top: '8%',  left: '68%', s: 1.3, d: '1.5s' },
  { top: '22%', left: '82%', s: 2.2, d: '0.9s' },
  { top: '14%', left: '46%', s: 1.2, d: '1.8s' },
  { top: '25%', left: '28%', s: 1.6, d: '1.3s' },
]

export function IntroSplash() {
  const reduced = typeof window !== 'undefined'
    && window.matchMedia('(prefers-reduced-motion: reduce)').matches

  const [visible, setVisible] = useState(() => {
    if (alreadyPlayed) return false
    alreadyPlayed = true
    return true
  })
  const [exiting, setExiting] = useState(false)
  const doneRef = useRef(false)

  const finish = useCallback(() => {
    if (doneRef.current) return
    doneRef.current = true
    setExiting(true)
    // matches .intro-splash--exit fade-out duration (0.6 s)
    setTimeout(() => setVisible(false), 600)
  }, [])

  useEffect(() => {
    if (!visible) return
    // Synced with Fanfares.mp3 (first 6 s): both start on mount and end together.
    // hold + 0.6 s fade ≈ 6 s total. Reduced motion: short still frame.
    const hold = reduced ? 1400 : 5400
    const t = setTimeout(finish, hold)
    return () => clearTimeout(t)
  }, [visible, reduced, finish])

  if (!visible) return null

  // Per-element animation strings — disabled entirely under reduced motion.
  const a = (s: string) => (reduced ? undefined : s)

  return (
    <div
      className={`intro-splash${exiting ? ' intro-splash--exit' : ''}${reduced ? ' intro-splash--static' : ''}`}
      onClick={finish}
      role="button"
      tabIndex={0}
      aria-label="Intro — tap to enter"
      onKeyDown={e => { if (e.key === 'Enter' || e.key === ' ') finish() }}
    >
      {/* Moon — top-right, soft cream glow */}
      <div className="intro-moon" style={{ animation: a('intro-soft-in 1.4s ease 0.5s both') }} />

      {/* Stars */}
      {STARS.map((st, i) => (
        <span
          key={i}
          className="intro-star"
          style={{
            top: st.top, left: st.left, width: st.s, height: st.s,
            animation: a(`intro-twinkle 2.6s ease-in-out ${st.d} infinite`),
            opacity: reduced ? 0.7 : undefined,
          }}
        />
      ))}

      {/* Drifting mist over the water */}
      <div className="intro-mist intro-mist--a" style={{ animation: a('intro-mist-drift 9s ease-in-out infinite alternate, intro-soft-in 1.6s ease 0.7s both') }} />
      <div className="intro-mist intro-mist--b" style={{ animation: a('intro-mist-drift 12s ease-in-out infinite alternate-reverse, intro-soft-in 1.6s ease 1s both') }} />

      {/* Water surface — lower band with a moon-reflection streak */}
      <div className="intro-water" style={{ animation: a('intro-water-in 1.1s ease 0.15s both') }}>
        <div className="intro-water-glint" />
      </div>

      {/* Reeds / cattails — silhouettes rising from the shoreline */}
      <div className="intro-reeds intro-reeds--left"  style={{ animation: a('intro-reed-in 1s cubic-bezier(0.22,1,0.36,1) 0.7s both') }}>
        <Cattails side="left" />
      </div>
      <div className="intro-reeds intro-reeds--right" style={{ animation: a('intro-reed-in 1s cubic-bezier(0.22,1,0.36,1) 0.9s both') }}>
        <Cattails side="right" />
      </div>

      {/* Hero — Stanley emerges in the centre with ring + gold glow */}
      <div className="intro-hero">
        <div className="intro-duck" style={{ animation: a('intro-duck-reveal 1.5s cubic-bezier(0.22,1,0.36,1) 1s both') }}>
          <img src="/stanley-duck.png" alt="Stanley" draggable={false} />
        </div>
        {/* faint reflection of the duck on the water below */}
        <div className="intro-duck-reflection" style={{ animation: a('intro-soft-in 1.6s ease 1.6s both') }}>
          <img src="/stanley-duck.png" alt="" aria-hidden="true" draggable={false} />
        </div>

        <div className="intro-title" style={{ animation: a('intro-title-in 1.2s cubic-bezier(0.22,1,0.36,1) 1.7s both') }}>
          STANLEY HQ
        </div>
        <div className="intro-subtitle" style={{ animation: a('intro-soft-in 1.1s ease 2.2s both') }}>
          Revenue &amp; Ops Command Center
        </div>
      </div>

      <div className="intro-skip-hint" style={{ animation: a('intro-soft-in 1s ease 2.8s both') }}>
        tap to enter
      </div>
    </div>
  )
}
