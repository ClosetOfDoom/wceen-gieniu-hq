// publisherIntent.js — which chat messages belong to the reel Publisher path. Pure (no imports): the server
// (gieniu-command) decides with it, and the browser uses the same words to give such a turn the long timeout.

const FOLD = { ą: 'a', ć: 'c', ę: 'e', ł: 'l', ń: 'n', ó: 'o', ś: 's', ź: 'z', ż: 'z' }
export const norm = (s) => String(s ?? '').toLowerCase().replace(/[ąćęłńóśźż]/g, (c) => FOLD[c]).replace(/\s+/g, ' ').trim()
export const wordCount = (s) => norm(s).split(/[^a-z0-9:.-]+/).filter(Boolean).length

const AFFIRM_START = /^(yes|yep|yeah|yup|confirm|confirmed|do it|go ahead|go|proceed|please do|sure|ok|okay|okej|tak|potwierdzam|zatwierdzam|zatwierdz|zgoda|dawaj|jasne|wykonaj|zrob to|zrob|akceptuje|w porzadku|dobrze)\b/
const NEGATE_START = /^(no|nope|cancel|abort|stop|never mind|nevermind|nie|anuluj|zostaw|odwolaj|rezygnuje|jednak nie)\b/
/** A word that turns an "ok …" into something else ("ok but …", "tak, ale …"). */
const TURN = /\b(nie|not|ale|but|however|wait|zaczekaj|czekaj)\b/
/** Weekday names, today / tomorrow, dates, clock times: what a change of date sounds like (EN + PL). */
const DATE_PHRASE = new RegExp([
  '\\b(mon|monday|tue|tuesday|wed|wednesday|thu|thursday|fri|friday|sat|saturday|sun|sunday)\\b',
  '\\b(poniedzial\\w*|wtor\\w*|srod\\w*|czwart\\w*|piat\\w*|sobot\\w*|niedziel\\w*)\\b',
  '\\b(tomorrow|today|jutro|pojutrze|dzis|dzisiaj)\\b',
  '\\b\\d{4}-\\d{1,2}-\\d{1,2}\\b',
  '\\b\\d{1,2}\\.\\d{1,2}(\\.\\d{2,4})?\\b',
  '\\b\\d{1,2}:\\d{2}\\b',
  '\\b\\d{1,2}\\s*(am|pm)\\b',
  '\\b(at|o|godz\\.?)\\s*\\d{1,2}\\b',
].join('|'))
/** Words that make a message a reel / publication question on their own. */
const KEYWORDS = /\b(reel|reels|rolk\w*|rolek|publisher|publikacj\w*|publication|posting schedule)\b/
/** Change commands; they belong to the Publisher only when they name a reel word that is in the queue. */
const VERB_START = /^(move|swap|pause|resume|reschedule|przesun\w*|zamien\w*|wstrzymaj\w*|wznow\w*|przeloz\w*)\b/

export const looksLikeDatePhrase = (message) => DATE_PHRASE.test(norm(message))

/**
 * A plain "yes": a short message that STARTS with an affirmation and carries no date and no "but". So "tak",
 * "tak, potwierdzam termin", "ok, zrób to" and "yes please" confirm; "tak, ale w sobotę" and "ok friday 18:00" do not
 * (those are a new request, handled with the memory of the conversation).
 */
export function isAffirmation(message) {
  const n = norm(message)
  const m = AFFIRM_START.exec(n)
  if (!m || wordCount(n) > 7 || DATE_PHRASE.test(n) || String(message).includes('?')) return false   // a question is not a yes
  return !TURN.test(n.slice(m[0].length))
}

/** A plain "no": a short message that starts with a refusal and carries no new date ("nie, sobota" is a revision). */
export function isNegation(message) {
  const n = norm(message)
  return NEGATE_START.test(n) && wordCount(n) <= 7 && !DATE_PHRASE.test(n)
}

export const hasPublisherKeyword = (message) => KEYWORDS.test(norm(message))
export const startsWithPublisherVerb = (message) => VERB_START.test(norm(message))

/**
 * Browser side: could this turn be ours? Decides only the (longer) timeout; the server decides for real.
 * `open` = a preview is waiting for the answer, or the last answer was a reel answer.
 */
export const mayBePublisherTurn = (message, open = false) =>
  hasPublisherKeyword(message) || startsWithPublisherVerb(message) || (open && (wordCount(message) <= 10 || DATE_PHRASE.test(norm(message))))
