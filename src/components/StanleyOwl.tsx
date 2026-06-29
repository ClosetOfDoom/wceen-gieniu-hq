import { useEffect, useRef } from 'react'
import { getAudioAnalyser, playQuack } from '../voice/tts'

export type OwlState = 'idle' | 'thinking' | 'speaking'

interface StanleyOwlProps {
  state: OwlState
  size?: number
}

export function StanleyOwl({ state, size = 184 }: StanleyOwlProps) {
  const wrapRef  = useRef<HTMLDivElement>(null)
  const rafRef   = useRef(0)
  const stateRef = useRef(state)

  useEffect(() => { stateRef.current = state }, [state])

  useEffect(() => {
    const wrap = wrapRef.current
    if (!wrap) return

    const prefersReduced = window.matchMedia('(prefers-reduced-motion: reduce)').matches
    if (prefersReduced) {
      // Static but clearly present — prominent gold ring + oak ring + soft glow
      wrap.style.boxShadow = '0 0 0 3px rgba(238,157,0,0.85), 0 0 0 6px rgba(107,79,51,0.65), 0 0 24px 6px rgba(238,157,0,0.45)'
      return
    }

    const freqData = new Uint8Array(64)

    function getAmplitude(): number {
      const an = getAudioAnalyser()
      if (!an) return 0
      an.getByteFrequencyData(freqData)
      let sum = 0
      for (let i = 0; i < freqData.length; i++) sum += freqData[i]
      return (sum / freqData.length) / 255
    }

    function frame(now: number) {
      rafRef.current = requestAnimationFrame(frame)
      const el = wrapRef.current
      if (!el) return
      const s   = stateRef.current
      const t   = now / 1000
      const amp = getAmplitude()

      let glowPx:    number
      let glowSpread: number
      let glowAlpha: number
      let ringAlpha: number
      let scale:     number
      let bob = 0   // vertical bounce (px)

      if (s === 'speaking') {
        // ElevenLabs: amplitude-driven; Browser TTS: amp≈0 → time-based fallback
        const drive = amp > 0.025
          ? amp
          : 0.18 + Math.sin(t * 7.1) * 0.12 + Math.sin(t * 13.5) * 0.06
        glowPx     = 16 + drive * 52
        glowSpread = 4  + drive * 16
        glowAlpha  = 0.6 + drive * 0.4
        ringAlpha  = 0.8 + drive * 0.2
        scale      = 1   + drive * 0.11
        // Gentle bob in rhythm — clearly "speaking"
        bob = -Math.abs(Math.sin(t * 6.5)) * (4 + drive * 6)
      } else if (s === 'thinking') {
        const pulse = 0.5 + Math.sin(t * 1.9) * 0.5
        glowPx     = 10 + pulse * 22
        glowSpread = 0  + pulse * 6
        glowAlpha  = 0.30 + pulse * 0.32
        ringAlpha  = 0.5 + pulse * 0.25
        scale      = 1   + pulse * 0.03
      } else {
        // idle — slow breathing
        const pulse = 0.5 + Math.sin(t * 1.05) * 0.5
        glowPx     = 7  + pulse * 16
        glowSpread = 0
        glowAlpha  = 0.2 + pulse * 0.24
        ringAlpha  = 0.42 + pulse * 0.22
        scale      = 1   + pulse * 0.02
        bob        = -pulse * 1.5
      }

      // Circular box-shadow = perfect round glow. Middle oak ring seats the navy
      // duck into the forest palette; pulse drives the gold ring + glow.
      el.style.boxShadow = `0 0 0 3px rgba(238,157,0,${ringAlpha.toFixed(2)}), 0 0 0 6px rgba(107,79,51,0.55), 0 0 ${glowPx.toFixed(0)}px ${glowSpread.toFixed(0)}px rgba(238,157,0,${glowAlpha.toFixed(2)})`
      el.style.transform = `translateY(${bob.toFixed(1)}px) scale(${scale.toFixed(4)})`
    }

    rafRef.current = requestAnimationFrame(frame)
    return () => cancelAnimationFrame(rafRef.current)
  // Run once — state tracked via stateRef
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  const indicator =
    state === 'speaking' ? { text: 'Speaking…', color: 'var(--teal)' } :
    state === 'thinking' ? { text: 'Thinking…', color: 'var(--gold)' } :
    null

  return (
    <div
      style={{
        display:         'flex',
        flexDirection:   'column',
        alignItems:      'center',
        justifyContent:  'center',
        width:           '100%',
        padding:         '18px 0 10px',
        gap:             '12px',
      }}
      aria-label={`Stanley — ${state}`}
    >
      <button
        type="button"
        onClick={() => playQuack()}
        title="Quack!"
        aria-label="Stanley — tap to quack"
        style={{
          background: 'transparent', border: 'none', padding: 0, cursor: 'pointer',
          lineHeight: 0, borderRadius: '50%',
        }}
      >
        <div
          ref={wrapRef}
          style={{
            width:           size,
            height:          size,
            borderRadius:    '50%',
            overflow:        'hidden',
            transformOrigin: 'center center',
            willChange:      'transform, box-shadow',
            transition:      'none',
            flexShrink:      0,
          }}
        >
          <img
            src="/stanley-duck.png"
            alt="Stanley"
            width={size}
            height={size}
            style={{
              width:          '100%',
              height:         '100%',
              objectFit:      'cover',
              objectPosition: 'center',
              display:        'block',
              pointerEvents:  'none',
            }}
            draggable={false}
          />
        </div>
      </button>

      {/* "Speaking…/Thinking…" indicator — makes it clear the duck is the one talking */}
      <div style={{ minHeight: '20px', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
        {indicator && (
          <span style={{
            display: 'inline-flex', alignItems: 'center', gap: '7px',
            fontFamily: 'var(--font-mono)', fontSize: '0.74rem', letterSpacing: '0.06em',
            color: indicator.color,
            padding: '3px 12px', borderRadius: '12px',
            border: `1px solid ${indicator.color}`,
            background: 'var(--surface)',
          }}>
            <span style={{
              width: 7, height: 7, borderRadius: '50%', background: indicator.color,
              animation: 'pulse-mic 1.2s ease-in-out infinite', display: 'inline-block',
            }} />
            {indicator.text}
          </span>
        )}
      </div>
    </div>
  )
}
