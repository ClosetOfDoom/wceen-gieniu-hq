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

/** Sources that actually exist in this business. Nothing else may be cited. */
export const REAL_SOURCES = [
  'Wix',
  'Stripe',
  'PayPal',
  'Przelewy24',
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
    // "orders.payment_method does not exist, so I cannot tell you" is a refusal
    // too — it was slipping past undetected and therefore unvalidated.
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
// What we actually know about the fields people ask for and the pipeline does
// not carry. Each entry produces a refusal that satisfies (a) and (b) and tells
// Fifi the one thing to do about it.

interface KnownGap {
  match: RegExp
  column: string
  source: string
  action: string
}

const KNOWN_GAPS: KnownGap[] = [
  {
    match: /payment method|payment_method|how (?:did|do) (?:they|customers) pay|paid (?:by|with)|przelewy|blik|payment type/i,
    column: 'orders.payment_method',
    source: 'Wix records it at checkout and Przelewy24 settles the transaction',
    action: 'add the payment-method field to the Make → Wix mapping and create a payment_method column on orders',
  },
  {
    match: /frequency|impression frequency|how often (?:did|do) people see/i,
    column: 'meta_ads_daily.frequency',
    source: 'Meta Ads reports it per ad set',
    action: 'add frequency to the Meta Ads → Make field mapping and create a frequency column on meta_ads_daily',
  },
  {
    match: /refund|chargeback|zwrot/i,
    column: 'orders.refund_status',
    source: 'Wix holds refund state on the order',
    action: 'add refund status to the Make → Wix mapping and create a refund_status column on orders',
  },
  {
    match: /utm|which creative (?:drove|brought|generated).*(?:revenue|sale)|revenue (?:per|by|from each) creative|attribut/i,
    column: 'orders.utm_source',
    source: 'Meta Ads passes it in the landing-page URL, but it is not collected by the Wix→Supabase sync',
    action: 'capture the UTM parameters at checkout in Make and add utm_source / utm_campaign columns on orders',
  },
  {
    match: /email (?:open|click|deliver)|open rate|mailing (?:stats|results)|newsletter/i,
    column: 'email_recipient_events.event_type',
    source: 'the mailing provider holds it; it is not collected by the Wix→Supabase sync',
    action: 'connect the mailing provider webhook in Make so it writes open and click events into email_recipient_events',
  },
  {
    match: /lifetime value|\bltv\b|\bclv\b|repeat (?:purchase|customer)|returning customer/i,
    column: 'orders.customer_id',
    source: 'Wix issues a contact id per buyer',
    action: 'add the Wix contact id to the Make mapping and create a customer_id column on orders so purchases can be grouped per person',
  },
  {
    // Word-bounded: an unanchored /attend/ also matches "what needs attention?".
    match: /\battend(?:ance|ed|ees|ing)?\b|\bshow.?up\b|frekwencj|who was (?:at|in) the webinar/i,
    column: 'webinar_attendance.attended',
    source: 'ClickMeeting stopped feeding it on 2026-08-14',
    action: 'restore the ClickMeeting → Make → webinar_attendance sync if attendance is needed again',
  },
]

/** Generic fallback when the question does not match a known gap. */
const GENERIC_GAP: KnownGap = {
  match: /.^/,
  column: 'orders',
  source: 'not collected by the Wix→Supabase sync',
  action:
    'name the exact field you need so it can be added to the Make mapping and given a column in Supabase',
}

function gapFor(question: string): KnownGap {
  return KNOWN_GAPS.find((g) => g.match.test(question)) ?? GENERIC_GAP
}

/** The known gap this question asks about, if any. */
export function knownGapFor(question: string): KnownGap | null {
  return KNOWN_GAPS.find((g) => g.match.test(question)) ?? null
}

// ── validation ──────────────────────────────────────────────────────────────

export interface RefusalVerdict {
  isRefusal: boolean
  valid: boolean
  /** Why it was rejected — blacklist rule names and/or 'missing-table-column' / 'missing-source'. */
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

/** The replacement refusal — Stanley's voice, and always complete. */
export function buildRefusal(question: string): string {
  const g = gapFor(question)
  return (
    `That field is not in the database, sir — ${g.column} does not exist. ` +
    `${g.source[0].toUpperCase()}${g.source.slice(1)}. ` +
    `To have it on the dashboard, Fifi must ${g.action}.`
  )
}

/**
 * THE guard. Returns the text unchanged unless it must not ship, in which case
 * it is replaced outright — the bad wording is the thing being removed, so
 * annotating it would not help.
 *
 * Two ways an answer fails:
 *   1. The question asks for a field that does not exist, and the answer does
 *      not say so. The local fallback does this loudly: asked about payment
 *      methods it does not recognise the question and returns today's revenue
 *      instead — an answer to something else, which is worse than a refusal.
 *   2. It refuses, but without naming a table.column and a real source.
 */
export function enforceRefusal(text: string, question = ''): string {
  const gap = question ? knownGapFor(question) : null
  if (gap && !new RegExp(gap.column.replace('.', '\\.'), 'i').test(text)) {
    return buildRefusal(question)
  }

  const v = validateRefusal(text)
  if (!v.isRefusal || v.valid) return text
  return buildRefusal(question)
}
