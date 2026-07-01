// Tiny speech gate — a shared signal for "Stanley is speaking right now".
// TTS raises it for the whole utterance (playback start → end / interrupt), and
// other audio layers (ambient bed, reaction/celebration music) subscribe so they
// can duck under his voice. Speech (information) always outranks music (ambience).
//
// Ref-counted so overlapping utterances behave; module scope only (no storage).

type Cb = (speaking: boolean) => void

let count = 0
const listeners = new Set<Cb>()

function emit(): void {
  const speaking = count > 0
  listeners.forEach(fn => fn(speaking))
}

export function beginSpeech(): void {
  count++
  if (count === 1) emit()
}

export function endSpeech(): void {
  count = Math.max(0, count - 1)
  if (count === 0) emit()
}

export function isSpeaking(): boolean {
  return count > 0
}

export function onSpeechChange(cb: Cb): () => void {
  listeners.add(cb)
  return () => { listeners.delete(cb) }
}
