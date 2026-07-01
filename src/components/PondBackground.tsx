// Subtle animated pond backdrop — drawn entirely in code (CSS keyframes + a
// handful of positioned <div>s). No images, no canvas, no requestAnimationFrame:
// everything animates via GPU-friendly transform/opacity only. Sits UNDER the
// content (z-index 0, pointer-events none) so KPIs stay perfectly readable.
//
// LIGHT ("pond in sun"): occasional expanding water ripples + a slow sun shimmer.
// DARK ("pond at dusk"): a field of faintly twinkling stars + moon glow + a soft
// water-reflection shimmer.
//
// prefers-reduced-motion → all animation disabled (static, calm backdrop).

import type { CSSProperties } from 'react'
import type { Theme } from '../hooks/useTheme'

// Fixed scatter — no Math.random at runtime (keeps it deterministic & cheap).
// LIGHT: 6 ripples staggered over a long window so only ~1–2 show at once.
const RIPPLES = [
  { top: '22%', left: '18%', size: 260, delay: '0s',   dur: '7.5s' },
  { top: '68%', left: '30%', size: 320, delay: '2.4s', dur: '8.5s' },
  { top: '40%', left: '58%', size: 220, delay: '4.1s', dur: '7s'   },
  { top: '80%', left: '72%', size: 300, delay: '5.6s', dur: '9s'   },
  { top: '14%', left: '80%', size: 240, delay: '3.2s', dur: '8s'   },
  { top: '54%', left: '44%', size: 280, delay: '6.8s', dur: '8.2s' },
]

// DARK: 20 stars (3 brighter), scattered, slow independent twinkle.
const STARS = [
  { top: '10%', left: '12%', s: 1.6, o: 0.5, d: '0.0s', dur: '4.2s' },
  { top: '16%', left: '28%', s: 2.4, o: 0.8, d: '1.1s', dur: '5.1s', bright: true },
  { top: '8%',  left: '44%', s: 1.3, o: 0.4, d: '2.3s', dur: '3.8s' },
  { top: '22%', left: '61%', s: 1.8, o: 0.6, d: '0.7s', dur: '4.7s' },
  { top: '12%', left: '78%', s: 2.6, o: 0.85,d: '1.8s', dur: '5.6s', bright: true },
  { top: '26%', left: '88%', s: 1.4, o: 0.45,d: '3.0s', dur: '4.0s' },
  { top: '34%', left: '20%', s: 1.7, o: 0.55,d: '2.0s', dur: '4.9s' },
  { top: '30%', left: '38%', s: 1.2, o: 0.4, d: '3.6s', dur: '3.6s' },
  { top: '38%', left: '52%', s: 1.9, o: 0.6, d: '0.4s', dur: '5.3s' },
  { top: '44%', left: '72%', s: 1.5, o: 0.5, d: '1.5s', dur: '4.4s' },
  { top: '48%', left: '9%',  s: 2.5, o: 0.8, d: '2.7s', dur: '5.8s', bright: true },
  { top: '52%', left: '84%', s: 1.3, o: 0.42,d: '3.3s', dur: '3.9s' },
  { top: '60%', left: '30%', s: 1.6, o: 0.5, d: '0.9s', dur: '4.6s' },
  { top: '64%', left: '48%', s: 1.4, o: 0.46,d: '2.2s', dur: '4.1s' },
  { top: '58%', left: '66%', s: 1.8, o: 0.58,d: '1.3s', dur: '5.0s' },
  { top: '72%', left: '16%', s: 1.3, o: 0.4, d: '3.1s', dur: '3.7s' },
  { top: '76%', left: '40%', s: 1.7, o: 0.54,d: '0.6s', dur: '4.8s' },
  { top: '70%', left: '80%', s: 1.5, o: 0.48,d: '2.5s', dur: '4.3s' },
  { top: '84%', left: '58%', s: 1.4, o: 0.44,d: '1.9s', dur: '4.0s' },
  { top: '88%', left: '26%', s: 1.6, o: 0.5, d: '3.4s', dur: '4.5s' },
]

export function PondBackground({ theme }: { theme: Theme }) {
  const reduced = typeof window !== 'undefined'
    && window.matchMedia('(prefers-reduced-motion: reduce)').matches

  return (
    <div className={`pond-bg pond-bg--${theme}${reduced ? ' pond-bg--reduced' : ''}`} aria-hidden="true">
      {theme === 'light' ? (
        <>
          {/* Slow sun shimmer on the water */}
          <div className="pond-shimmer" />
          {/* Expanding water ripples */}
          {RIPPLES.map((r, i) => (
            <span
              key={i}
              className="pond-ripple"
              style={{
                top: r.top, left: r.left, width: r.size, height: r.size,
                marginTop: -r.size / 2, marginLeft: -r.size / 2,
                animationDelay: r.delay, animationDuration: r.dur,
              }}
            />
          ))}
        </>
      ) : (
        <>
          {/* Moon glow + water reflection shimmer */}
          <div className="pond-moon-glow" />
          <div className="pond-reflection" />
          {/* Twinkling stars */}
          {STARS.map((st, i) => (
            <span
              key={i}
              className={`pond-star${st.bright ? ' pond-star--bright' : ''}`}
              style={{
                top: st.top, left: st.left, width: st.s, height: st.s,
                // base opacity — also the static value under reduced motion
                opacity: st.o,
                // custom property consumed by the twinkle keyframe
                '--star-o': st.o,
                animationDelay: st.d, animationDuration: st.dur,
              } as CSSProperties}
            />
          ))}
        </>
      )}
    </div>
  )
}
