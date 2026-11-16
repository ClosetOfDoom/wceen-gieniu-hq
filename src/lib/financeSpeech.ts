// What Stanley says aloud for a finance answer: one or two sentences of the conclusion — never the table, never a list of
// figures. The server already sends such a speechText; this is the client-side guard, and the ONE place that decides what to
// speak for a finance answer (Auto-speak, "speak again", retry). A finance answer never falls back to its full text.
import { extractNumbers } from '../../netlify/shared/financeVerify.js'
import type { FinanceBlock } from '../../netlify/shared/financeBlocks.js'

const MAX_SENTENCES = 2
const MAX_NUMBERS_PER_SENTENCE = 2
const MAX_CHARS = 260

/** At most two sentences, each with at most two figures, no table-like rows, no markup. */
export function safeFinanceSpeech(spoken: string): string {
  const text = String(spoken ?? '').replace(/\*\*/g, '').replace(/\r/g, '')
  const sentences = text
    .split(/\n+|(?<=[.!?…])\s+(?=[A-ZĄĆĘŁŃÓŚŹŻ"„(])/)
    .map((s) => s.trim())
    // not a table row / rule / bullet / heading (an upper-case run without a full stop: "SUMY (…)", "METRYKI POCHODNE (…)")
    .filter((s) => s !== '' && !/ {2,}|\||^-{3,}|^[-•]\s/.test(s) && !(/^[A-ZĄĆĘŁŃÓŚŹŻ]{4,}\b/.test(s) && !/[.!?…]$/.test(s)) && extractNumbers(s).length <= MAX_NUMBERS_PER_SENTENCE)
    .slice(0, MAX_SENTENCES)
  const joined = sentences.join(' ')
  return joined.length > MAX_CHARS ? (sentences[0] ?? '').slice(0, MAX_CHARS) : joined
}

/**
 * Text to speak. Finance answers (those with blocks) speak only their short speechText; any other answer keeps the old rule
 * (spoken text, else the displayed text).
 */
export function textToSpeak(spoken: string, display: string, blocks?: FinanceBlock[]): string {
  if (blocks && blocks.length > 0) return safeFinanceSpeech(spoken)
  return spoken || display
}
