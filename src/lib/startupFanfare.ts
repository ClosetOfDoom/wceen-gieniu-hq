// Startup fanfare — plays public/Fanfares.mp3 softly ONCE per app open, and only
// the first 6 seconds (short fade-out just before the cut so it never chops mid-note).
// Anti-repeat is module-scope session memory (NOT localStorage) — a page refresh
// re-opens the app and may play again; navigating within the SPA does not.
// If autoplay policy blocks playback (typically mobile), it arms a one-shot listener
// and plays on the first user gesture instead.

import { suppressAmbient } from './ambient'

let started = false // once-per-open guard (module scope = cleared on full reload)

const TARGET_VOL = 0.3      // subtle
const STOP_AT_SEC = 6       // play only the first 6 s
const FADE_MS = 300         // gentle fade-out length just before the hard stop

export function playStartupFanfare(): void {
  if (started) return
  started = true
  if (typeof window === 'undefined') return

  const audio = new Audio('/Fanfares.mp3')
  audio.volume = TARGET_VOL
  audio.preload = 'auto'

  let stopped = false
  let fadeTimer: ReturnType<typeof setInterval> | null = null
  let capTimer: ReturnType<typeof setTimeout> | null = null
  let ambientRelease: (() => void) | null = null   // duck ambient while fanfare plays

  const cleanup = () => {
    audio.removeEventListener('timeupdate', onTime)
    audio.removeEventListener('playing', onPlaying)
    audio.removeEventListener('ended', hardStop)
    if (fadeTimer) { clearInterval(fadeTimer); fadeTimer = null }
    if (capTimer) { clearTimeout(capTimer); capTimer = null }
  }

  const hardStop = () => {
    if (stopped) return
    stopped = true
    cleanup()
    audio.pause()
    try { audio.currentTime = 0 } catch { /* ignore */ }
    if (ambientRelease) { ambientRelease(); ambientRelease = null }
  }

  const beginFadeOut = () => {
    if (fadeTimer || stopped) return
    const steps = 12
    const stepMs = FADE_MS / steps
    const startVol = audio.volume
    let i = 0
    fadeTimer = setInterval(() => {
      i++
      audio.volume = Math.max(0, startVol * (1 - i / steps))
      if (i >= steps) hardStop()
    }, stepMs)
  }

  const onTime = () => {
    // Begin the fade so it completes right around the 6 s mark, then hard-stop.
    if (audio.currentTime >= STOP_AT_SEC - FADE_MS / 1000) beginFadeOut()
  }

  const onPlaying = () => {
    // Duck the ambient bed for the duration of the fanfare.
    if (!ambientRelease && !stopped) ambientRelease = suppressAmbient()
    // Safety net if timeupdate stalls — hard cap slightly past the 6 s window.
    if (!capTimer && !stopped) {
      capTimer = setTimeout(hardStop, (STOP_AT_SEC + 0.5) * 1000)
    }
  }

  audio.addEventListener('timeupdate', onTime)
  audio.addEventListener('playing', onPlaying)
  // Files shorter than 6 s just end naturally — no error, clean stop.
  audio.addEventListener('ended', hardStop)

  audio.play().catch(() => {
    // Autoplay blocked — play on the first user gesture instead.
    const events: (keyof WindowEventMap)[] = ['pointerdown', 'keydown', 'touchstart']
    const onGesture = () => {
      events.forEach(e => window.removeEventListener(e, onGesture))
      if (!stopped) audio.play().catch(() => {/* give up quietly */})
    }
    events.forEach(e => window.addEventListener(e, onGesture, { once: true }))
  })
}
