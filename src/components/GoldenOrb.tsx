import { useEffect, useRef } from 'react'
import { getAudioAnalyser } from '../voice/tts'

export type OrbState = 'idle' | 'thinking' | 'speaking'

interface GoldenOrbProps {
  state: OrbState
}

const GOLD = [238, 157, 0] as const

function rgba(r: number, g: number, b: number, a: number) {
  return `rgba(${r},${g},${b},${a})`
}

export function GoldenOrb({ state }: GoldenOrbProps) {
  const canvasRef = useRef<HTMLCanvasElement>(null)
  const rafRef    = useRef(0)
  const wavesRef  = useRef<{ r: number; alpha: number; speed: number }[]>([])
  const lastWave  = useRef(0)
  const stateRef  = useRef(state)

  // Keep stateRef current without restarting the animation loop
  useEffect(() => { stateRef.current = state }, [state])

  useEffect(() => {
    const canvas = canvasRef.current
    if (!canvas) return
    const rawCtx = canvas.getContext('2d')
    if (!rawCtx) return
    const ctx: CanvasRenderingContext2D = rawCtx

    const prefersReduced = window.matchMedia('(prefers-reduced-motion: reduce)').matches

    const dpr = Math.min(window.devicePixelRatio || 1, 2)
    const rect = canvas.getBoundingClientRect()
    const W = (rect.width  || 200) * dpr
    const H = (rect.height || 110) * dpr
    canvas.width  = W
    canvas.height = H

    const cx = W / 2
    const cy = H / 2
    const BASE_R = Math.min(W, H) * 0.19

    // Static reduced-motion version
    if (prefersReduced) {
      const gr = ctx.createRadialGradient(cx, cy, 0, cx, cy, BASE_R * 1.3)
      gr.addColorStop(0,   rgba(255, 228, 80,  0.92))
      gr.addColorStop(0.4, rgba(...GOLD, 0.85))
      gr.addColorStop(1,   rgba(...GOLD, 0))
      ctx.beginPath()
      ctx.arc(cx, cy, BASE_R, 0, Math.PI * 2)
      ctx.fillStyle = gr
      ctx.fill()
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

    function drawOrb(scale: number, glow: number) {
      const r = BASE_R * scale
      const gr = ctx.createRadialGradient(cx, cy, 0, cx, cy, r * 1.45)
      gr.addColorStop(0,    rgba(255, 235, 100, 0.96))
      gr.addColorStop(0.30, rgba(...GOLD, 0.92))
      gr.addColorStop(0.60, rgba(160,  80,   0, 0.55))
      gr.addColorStop(1,    rgba(...GOLD, 0))

      ctx.shadowColor = rgba(...GOLD, 0.22 + glow * 0.55)
      ctx.shadowBlur  = 8 + glow * 38
      ctx.beginPath()
      ctx.arc(cx, cy, r, 0, Math.PI * 2)
      ctx.fillStyle = gr
      ctx.fill()
      ctx.shadowBlur = 0
    }

    function frame(now: number) {
      rafRef.current = requestAnimationFrame(frame)
      ctx.clearRect(0, 0, W, H)

      const s   = stateRef.current
      const t   = now / 1000
      const amp = getAmplitude()

      // Compute orb scale + glow based on state
      let scale: number
      let glow: number
      let waveInterval: number
      let waveStrength: number

      if (s === 'speaking') {
        // Real amplitude from ElevenLabs AnalyserNode,
        // or time-based fallback for browser SpeechSynthesis (analyser unavailable)
        const drive = amp > 0.02
          ? amp
          : (0.10 + Math.sin(t * 7.3) * 0.07 + Math.sin(t * 13.1) * 0.04)
        scale = 1 + drive * 0.30 + Math.sin(t * 3.2) * 0.012
        glow  = 0.3 + drive * 0.8
        waveInterval = amp > 0.08 ? 90 : 260
        waveStrength = 0.35 + drive * 0.55
      } else if (s === 'thinking') {
        scale = 1 + Math.sin(t * 2.4) * 0.052 + Math.sin(t * 0.9) * 0.018
        glow  = 0.20 + Math.sin(t * 2.4) * 0.14
        waveInterval = 2200
        waveStrength = 0.22
      } else {
        scale = 1 + Math.sin(t * 1.1) * 0.022
        glow  = 0.07 + Math.sin(t * 1.1) * 0.04
        waveInterval = 4800
        waveStrength = 0.10
      }

      // Spawn ring waves
      if (now - lastWave.current > waveInterval) {
        wavesRef.current.push({
          r:     BASE_R * scale,
          alpha: waveStrength,
          speed: s === 'speaking' ? 2.2 : 1.1,
        })
        lastWave.current = now
      }

      // Update + draw ring waves
      wavesRef.current = wavesRef.current.filter(w => w.alpha > 0.006)
      for (const w of wavesRef.current) {
        w.r     += w.speed
        w.alpha *= s === 'speaking' ? 0.935 : 0.968
        ctx.beginPath()
        ctx.arc(cx, cy, w.r, 0, Math.PI * 2)
        ctx.strokeStyle = rgba(...GOLD, w.alpha)
        ctx.lineWidth   = 1.4 / dpr
        ctx.stroke()
      }

      drawOrb(scale, glow)
    }

    rafRef.current = requestAnimationFrame(frame)
    return () => { cancelAnimationFrame(rafRef.current); wavesRef.current = [] }
  // Run once — state changes are tracked via stateRef
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  return (
    <canvas
      ref={canvasRef}
      aria-hidden="true"
      style={{ display: 'block', width: '100%', height: '110px' }}
    />
  )
}
