import { useEffect, useRef } from 'react'
import { getAudioAnalyser } from '../voice/tts'

export type OwlState = 'idle' | 'thinking' | 'speaking'

interface StanleyOwlProps {
  state: OwlState
  size?: number
}

export function StanleyOwl({ state, size = 130 }: StanleyOwlProps) {
  const wrapRef  = useRef<HTMLDivElement>(null)
  const rafRef   = useRef(0)
  const stateRef = useRef(state)

  useEffect(() => { stateRef.current = state }, [state])

  useEffect(() => {
    const wrap = wrapRef.current
    if (!wrap) return

    const prefersReduced = window.matchMedia('(prefers-reduced-motion: reduce)').matches
    if (prefersReduced) {
      // Static but clearly visible — prominent ring + soft glow
      wrap.style.boxShadow = '0 0 0 2.5px rgba(238,157,0,0.80), 0 0 20px 5px rgba(238,157,0,0.45)'
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

      if (s === 'speaking') {
        // ElevenLabs: amplitude-driven; Browser TTS: amp≈0 → time-based fallback
        const drive = amp > 0.025
          ? amp
          : 0.18 + Math.sin(t * 7.1) * 0.12 + Math.sin(t * 13.5) * 0.06
        glowPx     = 12 + drive * 44
        glowSpread = 3  + drive * 14
        glowAlpha  = 0.55 + drive * 0.40
        ringAlpha  = 0.75 + drive * 0.25
        scale      = 1   + drive * 0.10
      } else if (s === 'thinking') {
        const pulse = 0.5 + Math.sin(t * 1.9) * 0.5
        glowPx     = 8  + pulse * 18
        glowSpread = 0  + pulse * 5
        glowAlpha  = 0.28 + pulse * 0.30
        ringAlpha  = 0.45 + pulse * 0.25
        scale      = 1   + pulse * 0.028
      } else {
        // idle — slow breathing
        const pulse = 0.5 + Math.sin(t * 1.05) * 0.5
        glowPx     = 5  + pulse * 14
        glowSpread = 0
        glowAlpha  = 0.18 + pulse * 0.22
        ringAlpha  = 0.38 + pulse * 0.22
        scale      = 1   + pulse * 0.018
      }

      // Circular box-shadow = perfect round glow (not drop-shadow which is alpha-contour based)
      el.style.boxShadow = `0 0 0 2.5px rgba(238,157,0,${ringAlpha.toFixed(2)}), 0 0 ${glowPx.toFixed(0)}px ${glowSpread.toFixed(0)}px rgba(238,157,0,${glowAlpha.toFixed(2)})`
      el.style.transform = `scale(${scale.toFixed(4)})`
    }

    rafRef.current = requestAnimationFrame(frame)
    return () => cancelAnimationFrame(rafRef.current)
  // Run once — state tracked via stateRef
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  return (
    <div
      style={{
        display:         'flex',
        alignItems:      'center',
        justifyContent:  'center',
        width:           '100%',
        padding:         '14px 0 8px',
      }}
      aria-label={`Stanley — ${state}`}
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
          }}
          draggable={false}
        />
      </div>
    </div>
  )
}
