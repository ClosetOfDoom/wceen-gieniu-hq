import { describe, it, expect } from 'vitest'
import {
  validateRefusal, enforceRefusal, buildRefusal, knownGapFor, answerAddressesTopic,
  BLACKLIST, TABLE_COLUMN_RE, REFUSAL_RE, KNOWN_GAPS, REAL_SOURCES,
} from '../refusalGuard'

const PAYMENT_Q = 'what payment methods did customers use?'

// ── the ways a refusal is rejected ──────────────────────────────────────────

describe('invalid refusals — one per blacklist rule', () => {
  it('1. rejects a referral to a person or team (WCEEN has no teams)', () => {
    const bad = 'Payment method is not stored in orders.payment_method, sir. Wix holds it — I would suggest asking your accountant for the breakdown.'
    const v = validateRefusal(bad)
    expect(v.isRefusal).toBe(true)
    expect(v.valid).toBe(false)
    expect(v.reasons).toContain('referral-to-person-or-team')
  })

  it('2. rejects a vague promise about the future', () => {
    const bad = 'Payment method is not stored in orders.payment_method, sir — Wix records it at checkout. It may be possible to analyze this in future reports.'
    expect(validateRefusal(bad).reasons).toContain('vague-future-promise')
  })

  it('3. rejects the contentless formula', () => {
    const v = validateRefusal("I'm afraid those particulars are not available to me, sir.")
    expect(v.valid).toBe(false)
    expect(v.reasons).toContain('contentless-formula')
    expect(v.reasons).toContain('missing-table-column')
  })

  it('4. rejects a refusal that names no table.column — the real-world case', () => {
    const bad = 'I do not have information regarding payment methods used by customers, sir — the orders table does not include this detail.'
    expect(validateRefusal(bad).reasons).toContain('missing-table-column')
  })

  it('5. rejects a refusal that names a column but no real source', () => {
    const bad = 'orders.payment_method does not exist, sir, so I cannot tell you.'
    expect(validateRefusal(bad).reasons).toContain('missing-source')
  })
})

describe('valid refusals — both elements present', () => {
  const good: [string, string][] = [
    [PAYMENT_Q,
      'Payment method is not in the database, sir — orders.payment_method does not exist. Wix records it at checkout and Stripe settles the transaction.'],
    ['what was the frequency on our creatives?',
      'I do not have meta_ads_daily.frequency, sir. Meta Ads reports it per ad set but the field is not mapped.'],
    ['how much revenue came from each creative?',
      'Revenue cannot be attributed per creative, sir — orders.utm_source is never written and is not collected by the Wix→Supabase sync.'],
  ]
  for (const [i, [question, text]] of good.entries()) {
    it(`${i + 1}. passes and is returned byte-for-byte`, () => {
      expect(validateRefusal(text).valid).toBe(true)
      expect(enforceRefusal(text, question)).toBe(text)
    })
  }
})

// ── ZADANIE B — sources ─────────────────────────────────────────────────────

describe('payment source is Stripe, never Przelewy24', () => {
  it('Przelewy24 is not an accepted source — it is still in KYC', () => {
    expect(REAL_SOURCES).not.toContain('Przelewy24')
    expect(JSON.stringify(KNOWN_GAPS.map((g) => g.source))).not.toMatch(/przelewy/i)
  })

  it('the payment refusal cites Wix and Stripe', () => {
    const out = buildRefusal(PAYMENT_Q)
    expect(out).toContain('Wix')
    expect(out).toContain('Stripe')
    expect(out).not.toMatch(/przelewy/i)
  })

  it('a refusal citing Przelewy24 no longer validates as sourced', () => {
    const bad = 'orders.payment_method does not exist, sir — Przelewy24 settles the transaction.'
    expect(validateRefusal(bad).reasons).toContain('missing-source')
  })
})

// ── ZADANIE A — every topic pattern is word-bounded ─────────────────────────

describe('topic patterns are word-bounded', () => {
  it('no gap pattern matches inside a longer word', () => {
    // /utm/ unbounded matches "autumn"; /attend/ unbounded matches "attention".
    const traps = ['autumn campaign review', 'what needs attention?', 'paypal payments overview']
    expect(knownGapFor('autumn campaign review')).toBeNull()
    expect(knownGapFor('what needs attention?')).toBeNull()
    for (const t of traps) {
      for (const g of KNOWN_GAPS) {
        if (g.match.test(t)) {
          // A hit is only acceptable if it is on a whole word.
          expect(g.match.source, `${g.key} matched "${t}" without a boundary`).toMatch(/\\b/)
        }
      }
    }
  })

  it('every gap pattern declares at least one word boundary', () => {
    for (const g of KNOWN_GAPS) {
      expect(g.match.source, `${g.key} has no \\b`).toContain('\\b')
      expect(g.topic.source, `${g.key} topic has no \\b`).toContain('\\b')
    }
  })
})

describe('off-topic replacement needs BOTH conditions', () => {
  // (a) question matches a gap, (b) answer engages with neither column nor a
  // topic-adjacent number. Either one alone must not delete an answer.
  const gap = knownGapFor(PAYMENT_Q)!

  it('replaces only when the answer ignores the topic entirely', () => {
    const offTopic = 'Numbers are in.\n\nToday: 5 Wix orders, 591.00 PLN revenue, 408.68 PLN Meta ad spend.'
    expect(answerAddressesTopic(offTopic, gap)).toBe(false)
    expect(enforceRefusal(offTopic, PAYMENT_Q)).not.toBe(offTopic)
  })

  it('passes an answer that carries a figure next to the topic vocabulary', () => {
    const onTopic = 'Customers paid 118.20 PLN on average today, sir, across 5 orders.'
    expect(answerAddressesTopic(onTopic, gap)).toBe(true)
    expect(enforceRefusal(onTopic, PAYMENT_Q)).toBe(onTopic)
  })

  it('passes an answer that names the column', () => {
    const named = 'orders.payment_method is empty, sir — Wix and Stripe hold it.'
    expect(enforceRefusal(named, PAYMENT_Q)).toBe(named)
  })

  it('question match alone never deletes an answer', () => {
    const withNumbers = 'Attendance for the last session was 27 people, sir.'
    expect(enforceRefusal(withNumbers, 'how did attendance look?')).toBe(withNumbers)
  })
})

// ── TEST 1 — regression battery, 15+ answerable questions ───────────────────

describe('regression: questions Stanley HAS data for pass byte-for-byte', () => {
  const answerable: [string, string][] = [
    ['what needs attention?', 'Real CPA stands at 81.74 PLN today, sir — above the 50 PLN threshold for Pakiet Pamięciowy.'],
    ['what should I attend to today?', 'Two matters, sir: CPA at 81.74 PLN and a single creative taking 68% of spend.'],
    ['how did the webinar convert?', 'The 6 August session drew 34 people and produced 5 sales for 1,999 PLN, sir.'],
    ['which campaign pays for itself?', 'PP-VID<2> returns 4.25x on 94.55 PLN of spend, sir — it pays for itself twice over.'],
    ['what did customers pay on average?', 'Customers paid 118.20 PLN on average today, sir, across 5 orders.'],
    ['how much did we take today?', 'Revenue today stands at 591.00 PLN from 5 Wix orders, sir.'],
    ['how many PP orders today?', 'Five Pakiet Pamięciowy orders today, sir, for 591.00 PLN.'],
    ['what is our CPA today?', 'Real CPA stands at 81.74 PLN today, sir.'],
    ['what is revenue this month?', 'Revenue month-to-date is 4,392 PLN, sir.'],
    ['what is our ROAS?', 'Real ROAS is 1.45x today, sir — below the 2.0x target.'],
    ['how was yesterday?', 'Yesterday: 6 orders, 714.00 PLN revenue, 438.40 PLN spend, sir.'],
    ['this week so far', 'This week: 16 orders and 2,058.00 PLN against 754.98 PLN of spend, sir.'],
    ['what is the margin before ads?', 'Margin before ads is 950 PLN today, sir, on 11 orders.'],
    ['how many clicks did we get?', 'Meta delivered 305 clicks on 8,566 impressions today, sir.'],
    ['which creative is burning money?', 'PP-COLD-NOWE-WIDEO runs a 55.51 PLN CPA, sir — above the 50 PLN alarm.'],
    ['how is the JSU course selling?', 'Seven JSU courses sold in the last 30 days, sir, for 3,843 PLN.'],
    ['what is the profit per order?', 'Profit per order sits at 57.58 PLN, sir.'],
  ]

  it(`covers at least 15 questions (has ${answerable.length})`, () => {
    expect(answerable.length).toBeGreaterThanOrEqual(15)
  })

  for (const [q, a] of answerable) {
    it(`untouched: ${q}`, () => {
      expect(enforceRefusal(a, q), `guard altered the answer to "${q}"`).toBe(a)
    })
  }
})

// ── TEST 2 — negative battery ───────────────────────────────────────────────

describe('questions with no data return a sourced refusal', () => {
  const unanswerable: [string, string][] = [
    ['what payment methods did customers use?', 'orders.payment_method'],
    ['show me the utm source per order', 'orders.utm_source'],
    ['how many attended the webinar last week?', 'webinar_attendance.attended'],
    ['what is the average age of our customers?', 'orders.customer_age'],
    ['which city do most customers come from?', 'orders.city'],
  ]

  for (const [q, expectedColumn] of unanswerable) {
    it(`refuses with a column + source: ${q}`, () => {
      // The local fallback's off-topic revenue dump, as it really behaves.
      const offTopic = 'Today: 5 Wix orders, 591.00 PLN revenue, 408.68 PLN Meta ad spend.'
      const out = enforceRefusal(offTopic, q)
      expect(out).toContain(expectedColumn)
      expect(TABLE_COLUMN_RE.test(out) || out.includes('orders')).toBe(true)
      const v = validateRefusal(out)
      expect(v.isRefusal).toBe(true)
      expect(v.valid, `invalid refusal: ${v.reasons.join(', ')}`).toBe(true)
      for (const b of BLACKLIST) expect(b.re.test(out), `${b.name} fired`).toBe(false)
    })
  }
})

// ── TEST 3 — non-data answers must survive the guard ────────────────────────

describe('non-data answers pass through speakAnswer untouched', () => {
  it('STT error notice', () => {
    const stt = 'Voice input is not supported in this browser. Use Chrome or Edge.'
    expect(enforceRefusal(stt, '')).toBe(stt)
  })

  it('JSU command report (question is the command key)', () => {
    const jsu = '— JSU WEBINAR —\n\nLatest session 2026-08-13: 27 present, average 39 min, 2 buyers for 1,098 PLN.'
    expect(enforceRefusal(jsu, 'webinar jak się uczyć')).toBe(jsu)
  })

  it('JSU command with no data still keeps its own wording', () => {
    const jsu = 'Webinar funnel data ends on 2026-08-14 and is no longer collected. For sales, ask who bought the course — that comes from orders.'
    expect(enforceRefusal(jsu, 'czemu kurs się nie sprzedaje')).toBe(jsu)
  })
})

// ── buildRefusal ────────────────────────────────────────────────────────────

describe('buildRefusal', () => {
  it('produces a refusal its own validator accepts', () => {
    expect(validateRefusal(buildRefusal(PAYMENT_Q)).valid).toBe(true)
  })

  it('names the column, a real source, and what Fifi must do', () => {
    const out = buildRefusal(PAYMENT_Q)
    expect(out).toContain('orders.payment_method')
    expect(out).toMatch(/Wix|Stripe/)
    expect(out).toContain('Fifi must')
    expect(TABLE_COLUMN_RE.test(out)).toBe(true)
  })

  it('trips no blacklist rule for any known gap', () => {
    const samples = [
      'what payment methods were used?', 'what was the frequency?', 'what is the refund rate?',
      'show me the utm per order', 'what was the email open rate?', 'what is our LTV?',
      'which city do customers come from?', 'how old are our customers?', 'how many attended?', 'something unmapped entirely',
    ]
    // Every known gap must be exercised by at least one sample.
    for (const g of KNOWN_GAPS) {
      expect(samples.some((s) => g.match.test(s)), `no sample covers ${g.key}`).toBe(true)
    }
    for (const s of samples) {
      const out = buildRefusal(s)
      for (const b of BLACKLIST) expect(b.re.test(out), `${b.name} on "${s}"`).toBe(false)
    }
  })

  it('phrases the state correctly per gap', () => {
    expect(buildRefusal('what payment method was used?')).toContain('does not exist')
    expect(buildRefusal('show me the utm per order')).toContain('nothing writes to it')
    expect(buildRefusal('how many attended?')).toContain('stops on 2026-08-14')
  })
})

describe('non-refusals are none of the guard business', () => {
  for (const a of [
    'Today: 10 Wix orders, 1344.00 PLN revenue, 316.58 PLN Meta ad spend.',
    'PP orders today: 9 of a paced target of 9 — on pace, sir.',
  ]) {
    it(`untouched: ${a.slice(0, 40)}…`, () => {
      expect(REFUSAL_RE.test(a)).toBe(false)
      expect(enforceRefusal(a, 'how are we doing today?')).toBe(a)
    })
  }
})
