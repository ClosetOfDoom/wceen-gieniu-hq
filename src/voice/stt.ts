// Speech-to-text language control and recognition wrapper.
// STT language (gieniuSttLanguage) is a separate setting from TTS output voice language.

export type SttLanguage = 'en-US' | 'pl-PL'

export const LS_STT_LANG = 'gieniuSttLanguage'

const CONFIDENCE_THRESHOLD = 0.65

// Known command terms — used for the "< 2 words" sanity check.
const COMMAND_VOCAB = new Set([
  // English
  'profit', 'revenue', 'orders', 'campaigns', 'ads', 'roas', 'cpa', 'sales', 'spend',
  'funnel', 'jsu', 'meta', 'wix', 'data', 'health', 'flag', 'flags', 'performance',
  'stop', 'webinar', 'email', 'how', 'what', 'are', 'is', 'today', 'update', 'fresh',
  'stale', 'show', 'yesterday', 'week', 'campaign', 'mailing', 'margin', 'cost',
  'click', 'impression', 'attendance', 'retargeting', 'profit', 'kill', 'scale',
  // Polish (diacritic-normalized)
  'ile', 'jak', 'czy', 'co', 'czemu', 'kto', 'nie', 'sie', 'jest', 'zysk',
  'zamowienia', 'kampanie', 'reklamy', 'dane', 'marza', 'wydatki', 'przychod',
  'dzisiaj', 'wczoraj', 'skalowac', 'ubic',
])

// Characters that only appear in Polish. Presence in English mode = likely wrong language.
const POLISH_CHARS = /[ąćęłńóśźżÄÖÜ]/

function normalizeForVocab(s: string): string {
  return s
    .toLowerCase()
    .replace(/ą/g, 'a').replace(/ć/g, 'c').replace(/ę/g, 'e')
    .replace(/ł/g, 'l').replace(/ń/g, 'n').replace(/ó/g, 'o')
    .replace(/ś/g, 's').replace(/ź/g, 'z').replace(/ż/g, 'z')
}

export interface SttResult {
  transcript: string
  confidence: number | null   // null if browser did not report confidence
  accepted: boolean
  rejectionReason?: string
}

export function getSttLanguage(): SttLanguage {
  const stored = localStorage.getItem(LS_STT_LANG)
  return stored === 'pl-PL' ? 'pl-PL' : 'en-US'
}

export function setSttLanguage(lang: SttLanguage): void {
  localStorage.setItem(LS_STT_LANG, lang)
}

// Pick the best alternative from a SpeechRecognitionResult (up to maxAlternatives).
// In English mode, skip alternatives that contain Polish characters.
// eslint-disable-next-line @typescript-eslint/no-explicit-any
function pickBestAlternative(result: any, language: SttLanguage): { transcript: string; confidence: number | null } {
  for (let i = 0; i < result.length; i++) {
    const alt = result[i]
    const confidence: number | null = typeof alt.confidence === 'number' && alt.confidence > 0 ? alt.confidence : null
    if (language === 'en-US' && POLISH_CHARS.test(alt.transcript)) continue
    return { transcript: alt.transcript as string, confidence }
  }
  // Fallback: return first alternative even if it failed the language check
  const first = result[0]
  return {
    transcript: first.transcript as string,
    confidence: typeof first.confidence === 'number' && first.confidence > 0 ? first.confidence : null,
  }
}

function validateTranscript(transcript: string, confidence: number | null, language: SttLanguage): SttResult {
  const t = transcript.trim()

  if (t.length < 3) {
    return { transcript: t, confidence, accepted: false, rejectionReason: 'too short (< 3 characters)' }
  }

  // Polish characters in English mode = wrong recognition language
  if (language === 'en-US' && POLISH_CHARS.test(t)) {
    return {
      transcript: t, confidence, accepted: false,
      rejectionReason: 'Polish characters detected in English mode — switch STT to Polish or speak English',
    }
  }

  const words = t.toLowerCase().split(/\s+/).filter(w => /[a-zA-Z]/.test(w))

  // Fewer than 2 real words — only accept if it contains a known command term
  if (words.length < 2) {
    const norm = normalizeForVocab(words.join(' '))
    const hasKnown = words.some(w => COMMAND_VOCAB.has(normalizeForVocab(w)))
    if (!hasKnown && !COMMAND_VOCAB.has(norm)) {
      return {
        transcript: t, confidence, accepted: false,
        rejectionReason: 'too few words and no recognized command term',
      }
    }
  }

  // Confidence below threshold (only when browser reports a real value)
  if (confidence !== null && confidence < CONFIDENCE_THRESHOLD) {
    return {
      transcript: t, confidence, accepted: false,
      rejectionReason: `confidence ${(confidence * 100).toFixed(0)}% below ${(CONFIDENCE_THRESHOLD * 100).toFixed(0)}% threshold`,
    }
  }

  return { transcript: t, confidence, accepted: true }
}

export interface StartListeningOptions {
  language: SttLanguage
  onInterim: (text: string) => void
  onFinal: (result: SttResult) => void
  onError: (msg: string) => void
  onEnd?: () => void
}

export interface SttController {
  stop: () => void
}

// Returns a controller to stop listening, or null if SpeechRecognition is unavailable.
export function startListening(opts: StartListeningOptions): SttController | null {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const w = window as any
  const SR = w.SpeechRecognition ?? w.webkitSpeechRecognition
  if (!SR) return null

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const rec: any = new SR()
  rec.lang = opts.language       // ← language-controlled, never hardcoded
  rec.continuous = false
  rec.interimResults = true
  rec.maxAlternatives = 3

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  rec.onresult = (event: any) => {
    let interim = ''
    for (let i = event.resultIndex; i < event.results.length; i++) {
      const r = event.results[i]
      if (!r.isFinal) {
        // Interim: show only as preview, never send to command gateway
        interim += r[0].transcript
      } else {
        const { transcript, confidence } = pickBestAlternative(r, opts.language)
        const result = validateTranscript(transcript, confidence, opts.language)
        opts.onFinal(result)
        return  // stop processing after final
      }
    }
    if (interim) opts.onInterim(interim)
  }

  rec.onerror = (e: { error: string }) => {
    let msg = `STT error: ${e.error}`
    if (e.error === 'no-speech')   msg = 'No speech detected.'
    if (e.error === 'not-allowed') msg = 'Microphone access denied. Allow microphone in browser settings.'
    if (e.error === 'aborted')     return  // deliberate stop() — not an error
    opts.onError(msg)
  }

  rec.onend = () => opts.onEnd?.()

  rec.start()
  return { stop: () => rec.stop() }
}

// Diagnostics helper — reports if SpeechRecognition is available in this browser.
export function isSpeechRecognitionAvailable(): boolean {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const w = window as any
  return !!(w.SpeechRecognition ?? w.webkitSpeechRecognition)
}
