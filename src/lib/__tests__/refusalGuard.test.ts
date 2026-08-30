import { describe, it, expect } from 'vitest'
import {
  validateRefusal, enforceRefusal, buildRefusal,
  BLACKLIST, TABLE_COLUMN_RE, REFUSAL_RE,
} from '../refusalGuard'

const PAYMENT_Q = 'what payment methods did customers use?'

// ── the three ways a refusal is rejected ────────────────────────────────────

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
    const v = validateRefusal(bad)
    expect(v.valid).toBe(false)
    expect(v.reasons).toContain('vague-future-promise')
  })

  it('3. rejects the contentless formula', () => {
    const bad = "I'm afraid those particulars are not available to me, sir."
    const v = validateRefusal(bad)
    expect(v.valid).toBe(false)
    expect(v.reasons).toContain('contentless-formula')
    expect(v.reasons).toContain('missing-table-column')
  })

  it('4. rejects a refusal that names no table.column — the real-world case', () => {
    // Verbatim from the live model before this guard existed.
    const bad = 'I do not have information regarding payment methods used by customers, sir — the orders table does not include this detail.'
    const v = validateRefusal(bad)
    expect(v.isRefusal).toBe(true)
    expect(v.valid).toBe(false)
    expect(v.reasons).toContain('missing-table-column')
  })

  it('5. rejects a refusal that names a column but no real source', () => {
    const bad = 'orders.payment_method does not exist, sir, so I cannot tell you.'
    const v = validateRefusal(bad)
    expect(v.valid).toBe(false)
    expect(v.reasons).toContain('missing-source')
  })
})

// ── refusals that must pass through untouched ───────────────────────────────

describe('valid refusals — both elements present', () => {
  const good = [
    'Payment method is not in the database, sir — orders.payment_method does not exist. Wix records it at checkout and Przelewy24 settles the transaction.',
    'I do not have meta_ads_daily.frequency, sir. Meta Ads reports it per ad set but the field is not mapped.',
    'Revenue cannot be attributed per creative, sir — orders.utm_source does not exist and is not collected by the Wix→Supabase sync.',
  ]
  for (const [i, text] of good.entries()) {
    it(`${i + 1}. passes and is returned byte-for-byte`, () => {
      const v = validateRefusal(text)
      expect(v.isRefusal).toBe(true)
      expect(v.reasons).toEqual([])
      expect(v.valid).toBe(true)
      expect(enforceRefusal(text, PAYMENT_Q)).toBe(text)
    })
  }
})

// ── non-refusals are none of the guard's business ───────────────────────────

describe('answers that are not refusals', () => {
  const answers = [
    'Today: 10 Wix orders, 1344.00 PLN revenue, 316.58 PLN Meta ad spend.',
    'Real CPA: 31.66 PLN. Real ROAS: 4.25x. Green light for now.',
    'PP orders today: 9 of a paced target of 9 — on pace, sir.',
    'Revenue month-to-date stands at 24,180 PLN against the 30,000 PLN target, sir.',
  ]
  for (const a of answers) {
    it(`untouched: ${a.slice(0, 42)}…`, () => {
      expect(REFUSAL_RE.test(a)).toBe(false)
      expect(enforceRefusal(a, 'how are we doing today?')).toBe(a)
    })
  }
})

// ── the rewrite ─────────────────────────────────────────────────────────────

describe('buildRefusal', () => {
  it('produces a refusal that its own validator accepts', () => {
    const out = buildRefusal(PAYMENT_Q)
    const v = validateRefusal(out)
    expect(v.isRefusal).toBe(true)
    expect(v.valid).toBe(true)
  })

  it('names the column, the real source, and what Fifi must do', () => {
    const out = buildRefusal(PAYMENT_Q)
    expect(out).toContain('orders.payment_method')
    expect(out).toMatch(/Wix|Przelewy24/)
    expect(out).toContain('Fifi must')
    expect(TABLE_COLUMN_RE.test(out)).toBe(true)
  })

  it('trips no blacklist rule', () => {
    for (const q of [PAYMENT_Q, 'what was the frequency?', 'what is our LTV?', 'refund rate?', 'something unmapped']) {
      const out = buildRefusal(q)
      for (const b of BLACKLIST) expect(b.re.test(out), `${b.name} fired on: ${out}`).toBe(false)
    }
  })

  it('picks the right column per topic', () => {
    expect(buildRefusal('what was the frequency on our creatives?')).toContain('meta_ads_daily.frequency')
    expect(buildRefusal('what is the refund rate?')).toContain('orders.refund_status')
    expect(buildRefusal('what is our customer lifetime value?')).toContain('orders.customer_id')
  })
})

describe('enforceRefusal replaces rather than annotates', () => {
  it('drops the bad wording entirely', () => {
    const bad = 'I do not have information regarding payment methods used by customers, sir — the orders table does not include this detail. It may be possible to analyze this in future reports.'
    const out = enforceRefusal(bad, PAYMENT_Q)
    expect(out).not.toContain('future reports')
    expect(out).not.toContain('I do not have information regarding')
    expect(out).toContain('orders.payment_method')
    expect(validateRefusal(out).valid).toBe(true)
  })
})
