import { useEffect, useRef } from 'react'
import { getAudioAnalyser } from '../voice/tts'

export type OwlState = 'idle' | 'thinking' | 'speaking'

interface StanleyOwlProps {
  state: OwlState
  size?: number
}

export function StanleyOwl({ state, size = 100 }: StanleyOwlProps) {
  const wrapRef  = useRef<HTMLDivElement>(null)
  const rafRef   = useRef(0)
  const stateRef = useRef(state)

  useEffect(() => { stateRef.current = state }, [state])

  useEffect(() => {
    const wrap = wrapRef.current
    if (!wrap) return

    const prefersReduced = window.matchMedia('(prefers-reduced-motion: reduce)').matches
    if (prefersReduced) {
      // Static glow — no animation
      wrap.style.filter = 'drop-shadow(0 0 6px rgba(238,157,0,0.30))'
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

      let glowPx: number
      let glowAlpha: number
      let brightness: number
      let scale: number

      if (s === 'speaking') {
        // ElevenLabs: amplitude-driven; Browser TTS: amp≈0 → time-based fallback
        const drive = amp > 0.025
          ? amp
          : 0.10 + Math.sin(t * 7.1) * 0.08 + Math.sin(t * 13.5) * 0.04
        glowPx     = 8  + drive * 28
        glowAlpha  = 0.35 + drive * 0.55
        brightness = 1  + drive * 0.18
        scale      = 1  + drive * 0.065
      } else if (s === 'thinking') {
        const pulse = 0.5 + Math.sin(t * 1.9) * 0.5
        glowPx     = 4  + pulse * 12
        glowAlpha  = 0.22 + pulse * 0.28
        brightness = 0.92 + pulse * 0.13
        scale      = 1  + pulse * 0.022
      } else {
        // idle — slow breathing
        const pulse = 0.5 + Math.sin(t * 1.05) * 0.5
        glowPx     = 2  + pulse * 6
        glowAlpha  = 0.12 + pulse * 0.15
        brightness = 0.86 + pulse * 0.10
        scale      = 1  + pulse * 0.014
      }

      el.style.filter    = `drop-shadow(0 0 ${glowPx.toFixed(1)}px rgba(238,157,0,${glowAlpha.toFixed(2)})) brightness(${brightness.toFixed(3)})`
      el.style.transform = `scale(${scale.toFixed(4)})`
    }

    rafRef.current = requestAnimationFrame(frame)
    return () => cancelAnimationFrame(rafRef.current)
  // Run once — state changes tracked via stateRef
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  return (
    <div
      style={{
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        width: '100%',
        height: '110px',
      }}
      aria-label={`Stanley — ${state}`}
    >
      <div
        ref={wrapRef}
        style={{
          width:           size,
          height:          size,
          transformOrigin: 'center center',
          willChange:      'filter, transform',
          transition:      'none',
        }}
      >
        <img
          src="/stanley-duck.png"
          alt="Stanley"
          width={size}
          height={size}
          style={{ width: '100%', height: '100%', objectFit: 'contain', display: 'block' }}
          draggable={false}
        />
      </div>
    </div>
  )
}
