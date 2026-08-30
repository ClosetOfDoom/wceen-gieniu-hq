// THE refusal validator. One implementation, one call site.
//
// Every answer Stanley renders or speaks — model, local fallback, JSU command
// buttons, error notices — passes through speakAnswer() in App.tsx, and that is
// where this runs. There is deliberately no second copy on the server: two
// parallel guards drifted apart once already, and only one of them ever ran on
// any given answer.
//
// A refusal is only allowed to reach the UI when it says BOTH:
//   (a) which table and column is missing  — orders.payment_method
//   (b) where the data actually lives, or why it is not collected — from a
//       closed list of real sources
// Anything else is rewritten. Non-refusals are returned untouched.
//
// The guard errs towards LETTING AN ANSWER THROUGH. Deleting a correct answer is
// worse than leaving a weak refusal, so every replacement needs positive
// evidence that the answer does not address the question.

/**
 * Payment providers that actually process WCEEN money: Wix + Stripe, with some
 * PayPal. Przelewy24 is deliberately ABSENT — it is still in KYC and settles
 * nothing, so citing it as a source would be a fabrication.
 */
export const REAL_SOURCES = [
  'Wix',
  'Stripe',
  'PayPal',
  'Meta Ads',
  'ClickMeeting',
  'not collected by the Wix→Supabase sync',
] as const

/** Tables that exist in Supabase — a "table.column" naming one of these counts. */
const KNOWN_TABLES = [
  'orders',
  'meta_ads_daily',
  'v_daily_wix_meta_performance',
  'webinar_attendance',
  'webinar_sessions',
  'webinar_participants',
  'v_webinar_funnel',
  'v_webinar_buyers',
  'email_campaigns',
  'email_recipient_events',
  'funding_checks',
  'automation_runs',
]

// ── detection ───────────────────────────────────────────────────────────────

/** Does this text refuse / plead missing data at all? */
export const REFUSAL_RE = new RegExp(
  [
    'do(?: not|es not|n\'t)\\s+(?:have|include|contain|track|record|capture|store)',
    'not available',
    'unavailable',
    'no data',
    'cannot be (?:determined|known|computed|attributed|provided)',
    'i lack',
    'is not (?:in|stored|recorded|tracked|captured|collected)',
    'are not (?:in|stored|recorded|tracked|captured|collected)',
    'not (?:currently )?collected',
    'those particulars',
    'no information',
    'lacks?\\s+(?:the\\s+)?(?:data|information|detail)',
    'does not exist',
    'do(?:es)? not exist',
    'no such (?:column|field|table)',
    "(?:cannot|can't|could not|couldn't|unable to)\\s+(?:tell|say|report|answer|provide|give|show|break down)",
  ].join('|'),
  'i',
)

/** Named blacklist patterns — each one alone invalidates a refusal. */
export const BLACKLIST: { name: string; re: RegExp }[] = [
  {
    // WCEEN has no teams. There is only Fifi; deferring to anyone is a dead end.
    name: 'referral-to-person-or-team',
    re: /\b(?:finance|accounting|marketing|sales|support|dev|data)\s+(?:team|department|dept)\b|\byour\s+(?:accountant|bookkeeper|developer|team|staff)\b|\bthe\s+team\b|\bask\s+(?:someone|somebody|your|the)\b|\bcontact\s+(?:someone|somebody|your|the\s+\w+\s+team)\b|\bconsult\s+(?:with\s+)?(?:someone|your|the)\b|\breach\s+out\s+to\b/i,
  },
  {
    // Vague deferral to a future that nobody has scheduled.
    name: 'vague-future-promise',
    re: /future\s+(?:reports?|analys[ei]s|analytics|updates?)|if\s+(?:that|this|the)\s+data\s+(?:is|were|becomes)\s+(?:made\s+)?available|once\s+(?:this|that|it)\s+(?:is|becomes)\s+available|may\s+be\s+possible\s+to\s+analy[sz]e|in\s+future\s+analys[ei]s|when\s+(?:this|that)\s+becomes\s+available/i,
  },
  {
    name: 'contentless-formula',
    re: /those particulars are not available|that information is not available|i lack the data\b|no data (?:is )?available/i,
  },
]

/** A concrete table.column naming a table that exists. */
export const TABLE_COLUMN_RE = new RegExp(
  `\\b(?:${KNOWN_TABLES.join('|')})\\.[a-z_][a-z0-9_]*\\b`,
  'i',
)

const SOURCE_RE = new RegExp(
  REAL_SOURCES.map((s) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&').replace(/→/g, '\\u2192')).join('|'),
  'i',
)

// ── known gaps ──────────────────────────────────────────────────────────────

/** Why the field cannot answer the question — each phrases the refusal differently. */
type GapState =
  | 'missing-column'  // the column is not in the schema at all
  | 'column-empty'    // the column exists but nothing ever writes it
  | 'frozen'          // it was fed once and the feed stopped

export interface KnownGap {
  key: string
  /** Question patterns. Word-bounded throughout — an unbounded /utm/ matches "autumn". */
  match: RegExp
  /** Vocabulary of the topic, used to spot a real answer about it. */
  topic: RegExp
  column: string
  state: GapState
  source: string
  action: string
  /** false ⇒ reported as DO POTWIERDZENIA; not verifiable from code or schema. */
  confirmed: boolean
}

export const KNOWN_GAPS: KnownGap[] = [
  {
    key: 'payment_method',
    // methods? / types? — "payment methods" is how the question is actually asked.
    match: /\bpayment\s+(?:methods?|types?)\b|\bpayment_method\b|\bhow\s+(?:did|do)\s+(?:they|customers|people)\s+pay\b|\bpaid\s+(?:by|with)\b|\bblik\b|\bprzelewy\b/i,
    topic: /\bpayment\b|\bpaid\b|\bpay\b|\bcard\b|\bblik\b|\btransfer\b|\bstripe\b|\bpaypal\b/i,
    column: 'orders.payment_method',
    state: 'missing-column',
    // Verified: the column is absent from orders. Providers per Fifi — Wix
    // storefront, Stripe settlement, some PayPal. NOT Przelewy24: still in KYC.
    source: 'Wix records the payment method at checkout and Stripe settles the transaction',
    action: 'add the payment-method field to the Make → Wix mapping and create a payment_method column on orders',
    confirmed: true,
  },
  {
    key: 'ad_frequency',
    match: /\bfrequency\b|\bhow\s+often\s+(?:did|do)\s+people\s+see\b/i,
    topic: /\bfrequency\b|\bimpressions?\b|\breach\b/i,
    column: 'meta_ads_daily.frequency',
    state: 'missing-column',
    source: 'Meta Ads reports it per ad set',
    action: 'add frequency to the Meta Ads → Make field mapping and create a frequency column on meta_ads_daily',
    confirmed: true,
  },
  {
    key: 'refunds',
    match: /\brefunds?\b|\brefunded\b|\bchargebacks?\b|\bzwrot(?:y|ów|u)?\b/i,
    topic: /\brefunds?\b|\brefunded\b|\bchargebacks?\b/i,
    column: 'orders.refund_status',
    state: 'missing-column',
    source: 'Wix holds the refund state on the order',
    action: 'add refund status to the Make → Wix mapping and create a refund_status column on orders',
    confirmed: false,   // no code or schema evidence that Wix refunds are tracked
  },
  {
    key: 'utm_attribution',
    match: /\butm\b|\brevenue\s+(?:per|by|from\s+each)\s+creative\b|\bwhich\s+creative\s+(?:drove|brought|generated)\b.*\b(?:revenue|sales?)\b/i,
    topic: /\butm\b|\battribut\w*\b|\bcreatives?\b|\bcampaigns?\b/i,
    column: 'orders.utm_source',
    // The column EXISTS on orders but nothing in this codebase reads or writes
    // it, so per-creative revenue still cannot be attributed.
    state: 'column-empty',
    source: 'Meta Ads passes it in the landing-page URL, but it is not collected by the Wix→Supabase sync',
    action: 'capture the UTM parameters at checkout in Make so utm_source and utm_campaign on orders are actually populated',
    confirmed: false,   // column exists; whether any row carries a value is unverified
  },
  {
    key: 'email_engagement',
    match: /\bemail\s+(?:opens?|clicks?|deliver\w*)\b|\bopen\s+rate\b|\bmailing\s+(?:stats|results)\b|\bnewsletter\b/i,
    topic: /\bemails?\b|\bopens?\b|\bclicks?\b|\bmailing\b|\bnewsletter\b/i,
    column: 'email_recipient_events.event_type',
    state: 'column-empty',
    source: 'the mailing provider holds it; it is not collected by the Wix→Supabase sync',
    action: 'connect the mailing provider webhook in Make so it writes open and click events into email_recipient_events',
    confirmed: false,   // table and column exist; row count not readable with the anon key
  },
  {
    key: 'customer_lifetime',
    match: /\blifetime\s+value\b|\bltv\b|\bclv\b|\brepeat\s+(?:purchase|customer)s?\b|\breturning\s+customers?\b/i,
    topic: /\blifetime\b|\bltv\b|\bclv\b|\brepeat\b|\breturning\b|\bcustomers?\b/i,
    column: 'orders.customer_id',
    // The column EXISTS but nothing reads it, so purchases still cannot be
    // grouped per person.
    state: 'column-empty',
    source: 'Wix issues a contact id per buyer',
    action: 'populate customer_id from the Wix contact id in the Make mapping so purchases can be grouped per person',
    confirmed: false,   // column exists; population unverified
  },
  {
    // Age and city are separate gaps: one entry covering both named the wrong
    // column ("average age" answered with orders.city).
    key: 'customer_age',
    match: /\b(?:ages?|wiek)\b|\bhow\s+old\b/i,
    topic: /\bages?\b|\bold\b|\bcustomers?\b/i,
    column: 'orders.customer_age',
    state: 'missing-column',
    source: 'Wix holds the buyer contact record',
    action: 'add the birth-date field to the Make → Wix mapping and create a customer_age column on orders',
    confirmed: true,
  },
  {
    key: 'customer_city',
    // Verified absent from orders: city, customer_city, country, phone,
    // first_name. Nothing about the buyer beyond their e-mail.
    match: /\bcit(?:y|ies)\b|\bmiasto\b|\bdemograph\w*\b|\bwhere\s+(?:do|are)\s+(?:our\s+)?customers?\b/i,
    topic: /\bcit(?:y|ies)\b|\bdemograph\w*\b|\bcustomers?\b/i,
    column: 'orders.city',
    state: 'missing-column',
    source: 'Wix holds the buyer contact record',
    action: 'add the address fields to the Make → Wix mapping and create a city column on orders',
    confirmed: true,
  },
  {
    key: 'attendance',
    // No bare "attend": "what should I attend to today?" is an agenda question,
    // not a webinar-attendance one. Only the noun forms count.
    match: /\battendance\b|\battendees?\b|\battended\b|\bshow.?up\b|\bfrekwencj\w*\b|\bwho\s+was\s+(?:at|in)\s+the\s+webinar\b/i,
    topic: /\battend\w*\b|\bshow.?up\b|\bwebinars?\b|\bsessions?\b/i,
    column: 'webinar_attendance.attended',
    state: 'frozen',
    source: 'ClickMeeting stopped feeding it on 2026-08-14',
    action: 'restore the ClickMeeting → Make → webinar_attendance sync if attendance is needed again',
    confirmed: true,
  },
]

/** Generic fallback when the question does not match a known gap. */
const GENERIC_GAP: KnownGap = {
  key: 'generic',
  match: /.^/,
  topic: /.^/,
  column: 'orders',
  state: 'missing-column',
  source: 'not collected by the Wix→Supabase sync',
  action: 'name the exact field you need so it can be added to the Make mapping and given a column in Supabase',
  confirmed: true,
}

/** The known gap this question asks about, if any. */
export function knownGapFor(question: string): KnownGap | null {
  return KNOWN_GAPS.find((g) => g.match.test(question)) ?? null
}

// ── validation ──────────────────────────────────────────────────────────────

export interface RefusalVerdict {
  isRefusal: boolean
  valid: boolean
  /** Blacklist rule names and/or 'missing-table-column' / 'missing-source'. */
  reasons: string[]
}

export function validateRefusal(text: string): RefusalVerdict {
  if (!text || !REFUSAL_RE.test(text)) return { isRefusal: false, valid: true, reasons: [] }

  const reasons: string[] = []
  for (const b of BLACKLIST) if (b.re.test(text)) reasons.push(b.name)
  if (!TABLE_COLUMN_RE.test(text)) reasons.push('missing-table-column')
  if (!SOURCE_RE.test(text)) reasons.push('missing-source')

  return { isRefusal: true, valid: reasons.length === 0, reasons }
}

/**
 * Does this answer actually engage with the topic — either by naming the column,
 * or by carrying a figure alongside the topic's own vocabulary?
 *
 * This is the conservative half of the off-topic check. Matching the question
 * pattern alone is not enough to delete an answer: "which campaign pays for
 * itself?" trips the payment vocabulary while being a perfectly answerable ROAS
 * question, and the answer to it carries numbers next to campaign words.
 */
export function answerAddressesTopic(text: string, gap: KnownGap): boolean {
  if (!text) return false
  if (new RegExp(gap.column.replace(/\./g, '\\.'), 'i').test(text)) return true

  const re = new RegExp(gap.topic.source, 'gi')
  let m: RegExpExecArray | null
  while ((m = re.exec(text)) !== null) {
    const start = Math.max(0, m.index - 60)
    const end = Math.min(text.length, m.index + m[0].length + 60)
    if (/\d/.test(text.slice(start, end))) return true
    if (m.index === re.lastIndex) re.lastIndex++   // zero-length match guard
  }
  return false
}

/** The replacement refusal — Stanley's voice, and always complete. */
export function buildRefusal(question: string): string {
  const g = KNOWN_GAPS.find((x) => x.match.test(question)) ?? GENERIC_GAP
  const state =
    g.state === 'missing-column'
      ? `${g.column} does not exist`
      : g.state === 'column-empty'
        ? `${g.column} exists but nothing writes to it`
        : `${g.column} stops on 2026-08-14`
  return (
    `That field is not in the database, sir — ${state}. ` +
    `${g.source[0].toUpperCase()}${g.source.slice(1)}. ` +
    `To have it on the dashboard, Fifi must ${g.action}.`
  )
}

/**
 * THE guard. Returns the text unchanged unless it must not ship.
 *
 * Two ways an answer fails:
 *   1. The question asks for a field that cannot answer it, AND the answer does
 *      not engage with the topic at all — the local fallback does this, reporting
 *      today's revenue when asked about payment methods. Both halves are
 *      required: a question match on its own never deletes an answer.
 *   2. It refuses, but without naming a table.column and a real source.
 */
export function enforceRefusal(text: string, question = ''): string {
  const gap = question ? knownGapFor(question) : null
  if (gap && !answerAddressesTopic(text, gap)) return buildRefusal(question)

  const v = validateRefusal(text)
  if (!v.isRefusal || v.valid) return text
  return buildRefusal(question)
}
