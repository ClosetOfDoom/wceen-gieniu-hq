import { cleanForTTS } from './textClean'

export const DEFAULT_VOICE_ID = 'CwhRBWXzGAHq8TQ4Fs17' // Roger
const STORAGE_KEY = 'gieniu_voice_id'

export function getVoiceId(): string {
  return localStorage.getItem(STORAGE_KEY) ?? DEFAULT_VOICE_ID
}

export function setVoiceId(id: string): void {
  localStorage.setItem(STORAGE_KEY, id)
}

export function resetVoice(): void {
  localStorage.removeItem(STORAGE_KEY)
}

let currentAudio: HTMLAudioElement | null = null

export function stopAudio(): void {
  if (currentAudio) {
    currentAudio.pause()
    currentAudio.src = ''
    currentAudio = null
  }
  window.speechSynthesis?.cancel()
}

export interface TTSResult {
  ok: boolean
  source: 'elevenlabs' | 'browser'
  error?: string
}

export async function speak(text: string): Promise<TTSResult> {
  stopAudio()
  const cleaned = cleanForTTS(text)

  try {
    const voiceId = getVoiceId()
    const res = await fetch('/.netlify/functions/eleven-tts', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ text: cleaned, voiceId }),
    })

    if (res.ok) {
      const blob = await res.blob()
      const url = URL.createObjectURL(blob)
      currentAudio = new Audio(url)
      currentAudio.onended = () => URL.revokeObjectURL(url)
      await currentAudio.play()
      return { ok: true, source: 'elevenlabs' }
    }
  } catch {
    // fall through to browser TTS
  }

  return speakBrowser(cleaned)
}

export function speakBrowser(text: string): TTSResult {
  if (!window.speechSynthesis) {
    return { ok: false, source: 'browser', error: 'speechSynthesis not supported' }
  }
  const utt = new SpeechSynthesisUtterance(text)
  utt.lang = 'pl-PL'
  utt.rate = 1.05
  window.speechSynthesis.speak(utt)
  return { ok: true, source: 'browser' }
}

export interface ElevenVoice {
  voice_id: string
  name: string
}

export async function fetchVoices(): Promise<ElevenVoice[]> {
  const res = await fetch('/.netlify/functions/eleven-voices')
  if (!res.ok) throw new Error('eleven-voices function error')
  const json = await res.json() as { voices: ElevenVoice[] }
  return json.voices ?? []
}

export async function testVoice(voiceId: string, text = 'Cześć Lifidi, tu Gieniu.'): Promise<TTSResult> {
  stopAudio()
  const cleaned = cleanForTTS(text)
  try {
    const res = await fetch('/.netlify/functions/eleven-voice-test', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ text: cleaned, voiceId }),
    })
    if (res.ok) {
      const blob = await res.blob()
      const url = URL.createObjectURL(blob)
      currentAudio = new Audio(url)
      currentAudio.onended = () => URL.revokeObjectURL(url)
      await currentAudio.play()
      return { ok: true, source: 'elevenlabs' }
    }
    return { ok: false, source: 'elevenlabs', error: 'function error' }
  } catch (e) {
    return { ok: false, source: 'elevenlabs', error: String(e) }
  }
}
