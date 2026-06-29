import { GIENIU_VOICE_ID, GIENIU_VOICE_NAME } from '../config/gieniuVoice'
import { cleanForTTS, cleanForEnglishTTS } from './textClean'

console.log(`GIENIU voice: ${GIENIU_VOICE_NAME} ${GIENIU_VOICE_ID}`)

// ── localStorage keys ─────────────────────────────────────────────────────────

export const LS_TTS_PROVIDER   = 'gieniuTtsProvider'
export const LS_ELEVEN_PAUSED  = 'gieniuElevenLabsPaused'
export const LS_ELEVEN_REASON  = 'gieniuElevenLabsPausedReason'
export const LS_VOICE_NAME     = 'gieniuVoiceName'

// ── Voice selection (English only) ───────────────────────────────────────────

export function getAvailableVoices(): SpeechSynthesisVoice[] {
  try {
    return (window.speechSynthesis?.getVoices() ?? []).filter(v => v.lang.startsWith('en'))
  } catch { return [] }
}

export function selectBrowserVoice(): SpeechSynthesisVoice | null {
  try {
    const voices = window.speechSynthesis?.getVoices() ?? []
    const enVoices = voices.filter(v => v.lang.startsWith('en'))
    const cached = getCachedVoiceName()
    if (cached) {
      const cv = voices.find(v => v.name === cached)
      if (cv && cv.lang.startsWith('en')) return cv
      try { localStorage.removeItem(LS_VOICE_NAME) } catch { /* non-fatal */ }
    }
    return (
      enVoices.find(v => /google/i.test(v.name)) ??
      enVoices.find(v => /microsoft/i.test(v.name)) ??
      enVoices.find(v => v.lang === 'en-US') ??
      enVoices[0] ??
      null
    )
  } catch { return null }
}

function getCachedVoiceName(): string | null {
  try { return localStorage.getItem(LS_VOICE_NAME) } catch { return null }
}

export function getCurrentVoiceInfo(): { name: string; lang: string } | null {
  const voice = selectBrowserVoice()
  if (!voice) return null
  return { name: voice.name, lang: voice.lang }
}

// ── ElevenLabs state ──────────────────────────────────────────────────────────

export function isElevenLabsPaused(): boolean {
  try { return localStorage.getItem(LS_ELEVEN_PAUSED) === 'true' } catch { return false }
}

export function getElevenLabsPausedReason(): string {
  try { return localStorage.getItem(LS_ELEVEN_REASON) ?? '' } catch { return '' }
}

export function resetElevenLabs(): void {
  try {
    localStorage.removeItem(LS_ELEVEN_PAUSED)
    localStorage.removeItem(LS_ELEVEN_REASON)
    localStorage.setItem(LS_TTS_PROVIDER, 'elevenlabs')
  } catch { /* non-fatal */ }
}

function markElevenLabsPaused(reason: string): void {
  try {
    localStorage.setItem(LS_TTS_PROVIDER,  'browser')
    localStorage.setItem(LS_ELEVEN_PAUSED, 'true')
    localStorage.setItem(LS_ELEVEN_REASON, reason)
  } catch { /* non-fatal */ }
}

// ── Voice state reset ─────────────────────────────────────────────────────────

export function resetVoiceState(): void {
  try {
    for (const k of [LS_VOICE_NAME, LS_TTS_PROVIDER, LS_ELEVEN_PAUSED,
      LS_ELEVEN_REASON, 'gieniuVoiceLang', 'gieniuVoiceLanguage',
      'gieniuVoiceRate', 'gieniuVoicePitch', 'gieniuSttLanguage']) {
      localStorage.removeItem(k)
    }
  } catch { /* non-fatal */ }
}

// ── Module-level audio state ──────────────────────────────────────────────────

let currentAudio: HTMLAudioElement | null = null
let currentFetchAbort: AbortController | null = null
let currentUtterance: SpeechSynthesisUtterance | null = null

let _warmCtx: AudioContext | null = null
let _analyser: AnalyserNode | null = null

/** Returns the live AnalyserNode when ElevenLabs audio is playing, null otherwise. */
export function getAudioAnalyser(): AnalyserNode | null {
  return _analyser
}

export function prewarmAudio(): void {
  try {
    type WebkitWindow = Window & { webkitAudioContext?: typeof AudioContext }
    const AC = window.AudioContext ?? (window as WebkitWindow).webkitAudioContext
    if (!AC) return
    if (!_warmCtx || _warmCtx.state === 'closed') _warmCtx = new AC()
    if (_warmCtx.state !== 'running') void _warmCtx.resume()
  } catch { /* non-fatal */ }
}

export function stopAudio(): void {
  if (currentFetchAbort) {
    currentFetchAbort.abort()
    currentFetchAbort = null
  }
  if (currentAudio) {
    currentAudio.pause()
    currentAudio.currentTime = 0
    currentAudio.src = ''
    currentAudio = null
  }
  try {
    window.speechSynthesis?.cancel()
  } catch { /* non-fatal */ }
  currentUtterance = null
  _analyser = null
  // eslint-disable-next-line no-console
  console.log('GIENIU interrupted')
}

// ── TTSResult ─────────────────────────────────────────────────────────────────

export interface TTSResult {
  ok: boolean
  provider: 'elevenlabs' | 'browser'
  aborted?: boolean
  error?: string
  fallbackFrom?: 'elevenlabs'
  reason?: string
  elevenError?: string
}

// ── Duck quack SFX — synthesized via Web Audio, plays after each utterance ────

function playQuack(volume = 0.28): void {
  try {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const AudioCtx = window.AudioContext ?? (window as any).webkitAudioContext
    if (!AudioCtx) return
    const ctx = new AudioCtx() as AudioContext
    const now = ctx.currentTime
    const dur = 0.30

    // Sawtooth oscillator: pitch glide 680 → 210 Hz (quack shape)
    const osc = ctx.createOscillator()
    osc.type = 'sawtooth'
    osc.frequency.setValueAtTime(680, now)
    osc.frequency.exponentialRampToValueAtTime(210, now + 0.20)

    // Noise burst for nasal texture
    const nBuf = ctx.createBuffer(1, Math.ceil(ctx.sampleRate * dur), ctx.sampleRate)
    const nd   = nBuf.getChannelData(0)
    for (let i = 0; i < nd.length; i++) nd[i] = Math.random() * 2 - 1
    const noise = ctx.createBufferSource()
    noise.buffer = nBuf

    const bpf = ctx.createBiquadFilter()
    bpf.type = 'bandpass'
    bpf.frequency.value = 1100
    bpf.Q.value = 4

    // Gain envelopes — sharp attack, quick decay
    const oscGain   = ctx.createGain()
    const noiseGain = ctx.createGain()

    oscGain.gain.setValueAtTime(0,           now)
    oscGain.gain.linearRampToValueAtTime(volume,         now + 0.012)
    oscGain.gain.setValueAtTime(volume,      now + 0.07)
    oscGain.gain.exponentialRampToValueAtTime(0.001,     now + dur)

    noiseGain.gain.setValueAtTime(0,                 now)
    noiseGain.gain.linearRampToValueAtTime(volume * 0.32, now + 0.008)
    noiseGain.gain.exponentialRampToValueAtTime(0.001,    now + dur * 0.65)

    osc.connect(oscGain);    oscGain.connect(ctx.destination)
    noise.connect(bpf);      bpf.connect(noiseGain);    noiseGain.connect(ctx.destination)

    osc.start(now);   osc.stop(now + dur)
    noise.start(now); noise.stop(now + dur)

    setTimeout(() => { try { void ctx.close() } catch { /* ignore */ } }, 1500)
  } catch { /* non-fatal */ }
}

// ── Error classification ──────────────────────────────────────────────────────

function isQuotaOrAuthError(err: string): boolean {
  return (
    /elevenStatus (401|402|403|429)/i.test(err) ||
    /quota_exceeded|quota exhausted|insufficient.credits|voice.unavailable/i.test(err) ||
    /HTTP (401|402|403|429)/i.test(err) ||
    /subscription|billing|limit reached|character.*limit/i.test(err)
  )
}

// ── Browser TTS ───────────────────────────────────────────────────────────────

async function speakBrowser(text: string): Promise<TTSResult> {
  const synth = window.speechSynthesis
  if (!synth) {
    return { ok: false, provider: 'browser', error: 'speechSynthesis not supported in this browser' }
  }

  synth.cancel()
  currentUtterance = null

  // Wait up to 800 ms for voices to load if the list is empty
  if (synth.getVoices().length === 0) {
    await new Promise<void>(resolve => {
      synth.addEventListener('voiceschanged', () => resolve(), { once: true })
      setTimeout(resolve, 800)
    })
  }

  const voice = selectBrowserVoice()
  const utt = new SpeechSynthesisUtterance(text)
  utt.lang = 'en-US'
  if (voice) utt.voice = voice
  currentUtterance = utt

  // eslint-disable-next-line no-console
  console.log(`GIENIU TTS browser: ${voice?.name ?? 'system default'} (${voice?.lang ?? utt.lang})`)

  return new Promise<TTSResult>(resolve => {
    utt.onend = () => {
      if (currentUtterance === utt) currentUtterance = null
      playQuack()
      resolve({ ok: true, provider: 'browser' })
    }
    utt.onerror = (e) => {
      if (currentUtterance === utt) currentUtterance = null
      const err = e.error ?? 'unknown'
      if (err === 'interrupted' || err === 'canceled') {
        resolve({ ok: false, provider: 'browser', aborted: true })
      } else {
        resolve({ ok: false, provider: 'browser', error: `browser tts: ${err}` })
      }
    }
    synth.speak(utt)
  })
}

// ── Main speak() ──────────────────────────────────────────────────────────────

export async function speak(text: string): Promise<TTSResult> {
  stopAudio()

  // If ElevenLabs is paused from a prior quota/auth error, go straight to browser TTS.
  // NOTE: in this state the Netlify function is NOT called, so no fresh logs are
  // produced and the real ElevenLabs status can't be re-checked until the pause is
  // cleared (Reset voice / "Try ElevenLabs again" / clear site data). We surface the
  // stored reason so the UI shows WHY instead of a generic "unavailable".
  if (isElevenLabsPaused()) {
    const pausedReason = getElevenLabsPausedReason()
    // eslint-disable-next-line no-console
    console.log(`GIENIU TTS: ElevenLabs paused (${pausedReason || 'unknown reason'}) — using browser TTS directly, function NOT called`)
    const browserResult = await speakBrowser(cleanForEnglishTTS(text))
    return {
      ...browserResult,
      fallbackFrom: 'elevenlabs',
      reason:       pausedReason || 'paused',
      elevenError:  `ElevenLabs paused locally (reason: ${pausedReason || 'unknown'}) — function not called. Tap "Try ElevenLabs again" to retest.`,
    }
  }

  const elevenText = cleanForTTS(text)
  if (!elevenText.trim()) return { ok: false, provider: 'elevenlabs', error: 'empty text' }

  // eslint-disable-next-line no-console
  console.log(`GIENIU frontend requested voice: ${GIENIU_VOICE_NAME} ${GIENIU_VOICE_ID}`)

  const ac = new AbortController()
  currentFetchAbort = ac

  try {
    const res = await fetch('/.netlify/functions/gieniu-tts', {
      method:  'POST',
      headers: { 'Content-Type': 'application/json' },
      body:    JSON.stringify({ text: elevenText }),
      signal:  ac.signal,
    })
    currentFetchAbort = null

    if (res.ok) {
      const blob  = await res.blob()
      const url   = URL.createObjectURL(blob)
      const audio = new Audio(url)
      currentAudio = audio

      // Connect to Web Audio analyser for real-time amplitude (GoldenOrb visualization)
      try {
        const ctx = _warmCtx
        if (ctx && ctx.state !== 'closed') {
          if (ctx.state === 'suspended') void ctx.resume()
          const src = ctx.createMediaElementSource(audio)
          const an  = ctx.createAnalyser()
          an.fftSize = 128
          an.smoothingTimeConstant = 0.75
          src.connect(an)
          an.connect(ctx.destination)
          _analyser = an
        }
      } catch { _analyser = null }

      audio.onended = () => {
        URL.revokeObjectURL(url)
        if (currentAudio === audio) currentAudio = null
        _analyser = null
        playQuack()
      }

      try {
        await audio.play()
        // eslint-disable-next-line no-console
        console.log(`GIENIU TTS audio playing (ElevenLabs ${GIENIU_VOICE_NAME})`)
        return { ok: true, provider: 'elevenlabs' }
      } catch (playErr) {
        URL.revokeObjectURL(url)
        if (currentAudio === audio) currentAudio = null
        const msg = String(playErr)
        // eslint-disable-next-line no-console
        console.warn('GIENIU TTS play failed:', msg)
        return { ok: false, provider: 'elevenlabs', error: msg }
      }

    } else {
      let errorMsg: string
      try {
        const json = await res.json() as {
          stage?: string; elevenStatus?: number; message?: string
          hasApiKey?: boolean; keyLength?: number; keyLooksQuoted?: boolean
          keyHasBearerPrefix?: boolean; keyHasWhitespace?: boolean; apiKeySource?: string
        }
        // eslint-disable-next-line no-console
        console.log('GIENIU TTS error detail', json)
        const stage  = json.stage ?? 'unknown_stage'
        const status = json.elevenStatus ?? res.status
        const msg    = json.message ?? ''
        const keyInfo = [
          json.keyHasBearerPrefix && 'bearerPrefix',
          json.keyLooksQuoted     && 'quotedKey',
          json.keyHasWhitespace   && 'whitespace',
          json.apiKeySource       && `src:${json.apiKeySource}`,
          json.keyLength != null  && `len:${json.keyLength}`,
        ].filter(Boolean).join(',')
        errorMsg = `HTTP ${res.status}: ${stage} / elevenStatus ${status} — ${msg}${keyInfo ? ` [${keyInfo}]` : ''}`
      } catch {
        const errText = await res.text().catch(() => res.status.toString())
        // eslint-disable-next-line no-console
        console.log('GIENIU TTS error detail (non-JSON)', errText.slice(0, 200))
        errorMsg = `HTTP ${res.status}: ${errText.slice(0, 200)}`
      }

      // ── Silent failover for quota / auth errors ───────────────────────────
      if (isQuotaOrAuthError(errorMsg)) {
        // eslint-disable-next-line no-console
        console.warn('GIENIU TTS error — switching to browser TTS:', errorMsg)
        markElevenLabsPaused('quota_or_api_error')
        const browserResult = await speakBrowser(cleanForEnglishTTS(text))
        return {
          ...browserResult,
          fallbackFrom: 'elevenlabs',
          reason:       'quota_or_api_error',
          elevenError:  errorMsg,
        }
      }

      return { ok: false, provider: 'elevenlabs', error: errorMsg }
    }
  } catch (err) {
    currentFetchAbort = null
    if ((err as Error)?.name === 'AbortError') {
      // eslint-disable-next-line no-console
      console.log('GIENIU TTS fetch aborted')
      return { ok: false, provider: 'elevenlabs', aborted: true }
    }
    // eslint-disable-next-line no-console
    console.warn('GIENIU TTS network error:', err)
    return { ok: false, provider: 'elevenlabs', error: String(err) }
  }
}
