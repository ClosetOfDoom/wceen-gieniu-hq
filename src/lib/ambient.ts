// Ambient nature bed — very quiet, looping, day/night aware. LOWEST audio
// priority: it always yields to speech (TTS), fanfares, and reaction effects
// via a suppress ref-count, fading to silence and back (never hard cuts).
//
// Day (06:00–18:00) → /ambience-day.mp3, Night (18:00–06:00) → /ambience-night.mp3.
// Switching period crossfades between the two. On/off + all timing lives in
// module scope (session memory) — nothing is persisted to localStorage.
//
// System mute is respected implicitly: these are plain HTMLAudioElements, so the
// OS/device volume and mute switch apply as normal.

type Period = 'day' | 'night'

const SRC: Record<Period, string> = {
  day:   '/ambience-day.mp3',
  night: '/ambience-night.mp3',
}

const BASE_VOL = 0.13     // barely-there background bed
const FADE_MS = 900       // crossfade / duck fade length
const SEAM_SEC = 0.6      // fade near the loop seam to hide a hard file edge

interface Track {
  el: HTMLAudioElement
  gain: number                 // 0..1 fade level (driven by fades)
  seam: number                 // 0..1 loop-seam multiplier (driven by timeupdate)
  fade: ReturnType<typeof setInterval> | null
  playing: boolean
}

let tracks: Record<Period, Track> | null = null
let current: Period = 'day'
let enabled = true              // default ON
let started = false
let suppress = 0                // >0 → duck to silence (speech / effects active)
let periodTimer: ReturnType<typeof setInterval> | null = null
let periodOverride = false      // set once the user manually picks a theme/period

function periodForNow(): Period {
  const h = new Date().getHours()
  return h >= 6 && h < 18 ? 'day' : 'night'
}

function render(t: Track): void {
  // Single writer for volume: base × fade-gain × loop-seam, clamped.
  t.el.volume = Math.max(0, Math.min(1, BASE_VOL * t.gain * t.seam))
}

function fadeTo(t: Track, target: number, ms = FADE_MS): void {
  if (t.fade) { clearInterval(t.fade); t.fade = null }
  const steps = Math.max(1, Math.round(ms / 40))
  const from = t.gain
  const delta = target - from
  if (Math.abs(delta) < 0.001) { t.gain = target; render(t); return }
  let i = 0
  t.fade = setInterval(() => {
    i++
    t.gain = from + delta * (i / steps)
    render(t)
    if (i >= steps) {
      t.gain = target
      render(t)
      if (t.fade) { clearInterval(t.fade); t.fade = null }
      // Fully faded-out non-current tracks can stop to save resources.
      if (target === 0 && t.playing && tracks && t !== tracks[current]) {
        t.el.pause()
        t.playing = false
      }
    }
  }, 40)
}

function makeTrack(period: Period): Track {
  const el = new Audio(SRC[period])
  el.loop = true
  el.preload = 'auto'
  el.volume = 0
  const t: Track = { el, gain: 0, seam: 1, fade: null, playing: false }
  // Loop-seam fade: dip volume in the first/last SEAM_SEC so the wrap is inaudible.
  el.addEventListener('timeupdate', () => {
    const d = el.duration
    if (!isFinite(d) || d <= SEAM_SEC * 2) { t.seam = 1 }
    else {
      const ct = el.currentTime
      if (ct < SEAM_SEC) t.seam = ct / SEAM_SEC
      else if (ct > d - SEAM_SEC) t.seam = Math.max(0, (d - ct) / SEAM_SEC)
      else t.seam = 1
    }
    render(t)
  })
  return t
}

function play(t: Track): void {
  if (t.playing) return
  t.playing = true
  t.el.play().catch(() => {
    // Autoplay blocked — retry once on the first user gesture.
    t.playing = false
    const events: (keyof WindowEventMap)[] = ['pointerdown', 'keydown', 'touchstart']
    const onGesture = () => {
      events.forEach(e => window.removeEventListener(e, onGesture))
      if (enabled && tracks && t === tracks[current]) play(t)
    }
    events.forEach(e => window.addEventListener(e, onGesture, { once: true }))
  })
}

// Target gain for the active track given enabled + suppress state.
function activeTarget(): number {
  return enabled && suppress === 0 ? 1 : 0
}

function applyState(instant = false): void {
  if (!tracks) return
  const active = tracks[current]
  const ms = instant ? 0 : FADE_MS
  if (enabled) play(active)
  fadeTo(active, activeTarget(), ms)
  // Any non-current track fades out.
  ;(Object.keys(tracks) as Period[]).forEach(p => {
    if (p !== current) fadeTo(tracks![p], 0, ms)
  })
}

function setPeriod(next: Period, instant = false): void {
  if (!tracks) return
  if (next === current && started) return
  current = next
  applyState(instant)
}

// ── Public API ────────────────────────────────────────────────────────────────

export function initAmbient(): void {
  if (started) return
  started = true
  if (typeof window === 'undefined') return
  tracks = { day: makeTrack('day'), night: makeTrack('night') }
  current = periodForNow()
  applyState(true)
  // Re-check the clock each minute → crossfade at the day/night boundary,
  // UNLESS the user has manually chosen a theme/period this session.
  periodTimer = setInterval(() => {
    if (!periodOverride) setPeriod(periodForNow())
  }, 60 * 1000)
}

// Manually pin the ambient period (crossfades). Called when the user toggles the
// theme, so dark → night bed and light → day bed follow the manual choice, and
// the clock stops overriding it for the rest of the session.
export function setAmbientPeriod(period: 'day' | 'night'): void {
  periodOverride = true
  if (started) setPeriod(period)
  else current = period   // init hasn't run yet — remember the choice
}

export function setAmbientEnabled(on: boolean): void {
  enabled = on
  applyState()
}

export function isAmbientEnabled(): boolean {
  return enabled
}

// Ref-counted suppression. Each caller (TTS, fanfare, reaction audio) acquires
// one and releases it when done; ambient stays silent until the count hits zero.
export function suppressAmbient(): () => void {
  suppress++
  applyState()
  let released = false
  return () => {
    if (released) return
    released = true
    suppress = Math.max(0, suppress - 1)
    applyState()
  }
}

// Cleanup (not normally needed — app lives for the tab's lifetime).
export function stopAmbient(): void {
  if (periodTimer) { clearInterval(periodTimer); periodTimer = null }
  if (tracks) {
    (Object.keys(tracks) as Period[]).forEach(p => {
      const t = tracks![p]
      if (t.fade) clearInterval(t.fade)
      t.el.pause()
    })
  }
  started = false
}
