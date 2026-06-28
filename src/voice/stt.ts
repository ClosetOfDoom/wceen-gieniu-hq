// Speech-to-text wrapper — English only (en-US).

const CONFIDENCE_THRESHOLD = 0.65

// Known command terms — used for the "< 2 words" sanity check.
const COMMAND_VOCAB = new Set([
  'profit', 'revenue', 'orders', 'campaigns', 'ads', 'roas', 'cpa', 'sales', 'spend',
  'funnel', 'jsu', 'meta', 'wix', 'data', 'health', 'flag', 'flags', 'performance',
  'stop', 'webinar', 'email', 'how', 'what', 'are', 'is', 'today', 'update', 'fresh',
  'stale', 'show', 'yesterday', 'week', 'campaign', 'mailing', 'margin', 'cost',
  'click', 'impression', 'attendance', 'retargeting', 'kill', 'scale',
])

export interface SttResult {
  transcript: string
  confidence: number | null
  accepted: boolean
  rejectionReason?: string
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
function pickBestAlternative(result: any): { transcript: string; confidence: number | null } {
  const first = result[0]
  return {
    transcript: first.transcript as string,
    confidence: typeof first.confidence === 'number' && first.confidence > 0 ? first.confidence : null,
  }
}

function validateTranscript(transcript: string, confidence: number | null): SttResult {
  const t = transcript.trim()

  if (t.length < 3) {
    return { transcript: t, confidence, accepted: false, rejectionReason: 'too short (< 3 characters)' }
  }

  const words = t.toLowerCase().split(/\s+/).filter(w => /[a-zA-Z]/.test(w))

  if (words.length < 2) {
    const hasKnown = words.some(w => COMMAND_VOCAB.has(w))
    if (!hasKnown) {
      return {
        transcript: t, confidence, accepted: false,
        rejectionReason: 'too few words and no recognized command term',
      }
    }
  }

  if (confidence !== null && confidence < CONFIDENCE_THRESHOLD) {
    return {
      transcript: t, confidence, accepted: false,
      rejectionReason: `confidence ${(confidence * 100).toFixed(0)}% below ${(CONFIDENCE_THRESHOLD * 100).toFixed(0)}% threshold`,
    }
  }

  return { transcript: t, confidence, accepted: true }
}

export interface StartListeningOptions {
  onInterim: (text: string) => void
  onFinal: (result: SttResult) => void
  onError: (msg: string) => void
  onEnd?: () => void
}

export interface SttController {
  stop: () => void
}

export function startListening(opts: StartListeningOptions): SttController | null {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const w = window as any
  const SR = w.SpeechRecognition ?? w.webkitSpeechRecognition
  if (!SR) return null

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const rec: any = new SR()
  rec.lang = 'en-US'
  rec.continuous = false
  rec.interimResults = true
  rec.maxAlternatives = 3

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  rec.onresult = (event: any) => {
    let interim = ''
    for (let i = event.resultIndex; i < event.results.length; i++) {
      const r = event.results[i]
      if (!r.isFinal) {
        interim += r[0].transcript
      } else {
        const { transcript, confidence } = pickBestAlternative(r)
        const result = validateTranscript(transcript, confidence)
        opts.onFinal(result)
        return
      }
    }
    if (interim) opts.onInterim(interim)
  }

  rec.onerror = (e: { error: string }) => {
    let msg = `STT error: ${e.error}`
    if (e.error === 'no-speech')   msg = 'No speech detected.'
    if (e.error === 'not-allowed') msg = 'Microphone access denied. Allow microphone in browser settings.'
    if (e.error === 'aborted')     return
    opts.onError(msg)
  }

  rec.onend = () => opts.onEnd?.()

  rec.start()
  return { stop: () => rec.stop() }
}

export function isSpeechRecognitionAvailable(): boolean {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const w = window as any
  return !!(w.SpeechRecognition ?? w.webkitSpeechRecognition)
}
