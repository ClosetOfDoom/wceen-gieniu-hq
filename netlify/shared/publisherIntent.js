// publisherIntent.js — which chat messages belong to the reel Publisher path. Pure (no imports): the server
// (gieniu-command) decides with it, and the browser uses the same words to give such a turn the long timeout.

const FOLD = { ą: 'a', ć: 'c', ę: 'e', ł: 'l', ń: 'n', ó: 'o', ś: 's', ź: 'z', ż: 'z' }
export const norm = (s) => String(s ?? '').toLowerCase().replace(/[ąćęłńóśźż]/g, (c) => FOLD[c]).replace(/\s+/g, ' ').trim()

const AFFIRM = /^(yes|yep|yeah|yup|confirm|confirmed|do it|go ahead|proceed|please do|sure|ok|okay|tak|potwierdzam|zatwierdzam|dawaj|zrob to)\b[\s.!,]*(sir)?[\s.!]*$/
const NEGATE = /^(no|nope|cancel|abort|stop|never mind|nevermind|nie|anuluj|zostaw)\b[\s.!,]*(sir)?[\s.!]*$/
/** Words that make a message a reel / publication question on their own. */
const KEYWORDS = /\b(reel|reels|rolk\w*|rolek|publisher|publikacj\w*|publication|posting schedule)\b/
/** Change commands; they belong to the Publisher only when they name a reel word that is in the queue. */
const VERB_START = /^(move|swap|pause|resume|reschedule|przesun\w*|zamien\w*|wstrzymaj\w*|wznow\w*|przeloz\w*)\b/

export const isAffirmation = (message) => AFFIRM.test(norm(message))
export const isNegation = (message) => NEGATE.test(norm(message))
export const hasPublisherKeyword = (message) => KEYWORDS.test(norm(message))
export const startsWithPublisherVerb = (message) => VERB_START.test(norm(message))

/** Browser side: could this turn be ours? (decides only the timeout; the server decides for real.) */
export const mayBePublisherTurn = (message, hasPending) =>
  hasPublisherKeyword(message) || startsWithPublisherVerb(message) || (hasPending && (isAffirmation(message) || isNegation(message)))
