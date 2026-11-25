// Long speech: the browser voice speaks piece by piece (Chrome stops one long utterance after ~15 s) and a text that
// is too long for ElevenLabs is cut at a sentence end, never in the middle of a word.
import { describe, it, expect } from 'vitest'
import { splitForSpeech, cutAtSentence } from '../textClean'

const BRIEF = 'Brief for 2026-11-25. Yesterday sales were 4 321.00 PLN, sir. Month to date is 61.2% of the goal. '
  + 'Two matters need your attention: the CPA is above the threshold, and the Thursday webinar queue is low. '
  + 'Today at 09:00 the brief, at 11:00 a call to the printer, at 18:00 the language webinar. Shall I move the Italian reel to Friday?'

describe('splitForSpeech', () => {
  it('splits at sentence ends into pieces no longer than the limit', () => {
    const pieces = splitForSpeech(BRIEF, 120)
    expect(pieces.length).toBeGreaterThan(2)
    for (const p of pieces) expect(p.length).toBeLessThanOrEqual(120)
    expect(pieces.every((p) => /[.!?]$/.test(p))).toBe(true)          // every piece ends a sentence
  })
  it('loses and invents nothing: the pieces joined are the text', () => {
    const joined = splitForSpeech(BRIEF, 120).join(' ')
    expect(joined.replace(/\s+/g, ' ')).toBe(BRIEF.replace(/\s+/g, ' ').trim())
  })
  it('short text is one piece; empty text is none', () => {
    expect(splitForSpeech('Right you are, sir.')).toEqual(['Right you are, sir.'])
    expect(splitForSpeech('   ')).toEqual([])
  })
  it('an over-long sentence is split at a comma or a space, never mid-word', () => {
    const long = 'First the plan for the week, then the second thing to do, and also the third matter that takes a while to say out loud, finally the fourth.'
    const pieces = splitForSpeech(long, 60)
    for (const p of pieces) expect(p.length).toBeLessThanOrEqual(60)
    expect(pieces.join(' ')).toBe(long)
    expect(pieces.every((p) => !/^[a-z]/.test(p) || long.includes(p))).toBe(true)
  })
  it('text with no punctuation at all still gets split', () => {
    const pieces = splitForSpeech('word '.repeat(80).trim(), 100)
    expect(pieces.length).toBeGreaterThan(3); for (const p of pieces) expect(p.length).toBeLessThanOrEqual(100)
  })
})

describe('cutAtSentence', () => {
  it('leaves a short text alone', () => expect(cutAtSentence('Short one.', 100)).toBe('Short one.'))
  it('cuts at the last sentence end that fits', () => {
    const out = cutAtSentence(BRIEF, 200)
    expect(out.length).toBeLessThanOrEqual(200); expect(out.endsWith('.')).toBe(true); expect(BRIEF.startsWith(out)).toBe(true)
  })
  it('with no sentence end in reach it cuts at a space, not inside a word', () => {
    const out = cutAtSentence('alpha beta gamma delta epsilon zeta eta theta', 20)
    expect(out.length).toBeLessThanOrEqual(20); expect(['alpha beta gamma', 'alpha beta gamma delta'].some((x) => out.startsWith(x))).toBe(true); expect(out.endsWith(' ')).toBe(false)
  })
})
