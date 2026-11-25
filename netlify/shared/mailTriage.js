// mailTriage.js — Stanley's inbox triage and the approved replies. Pure logic; Gmail, the order lookup and the KV are injected.
//
// POLICY (hard rules, tested):
//   • Stanley reads headers and the snippet only (never the body), and never deletes or trashes anything.
//   • A reply is sent ONLY after an explicit approval request for that one message, and the server re-reads the message
//     itself: the browser sends a message id + a template id (+ the activation code), never an address or a text.
//   • Automated senders, system / authority / billing senders and sensitive topics (invoices, refunds, complaints,
//     GDPR, tax) are never answered with a template.
//   • The sender must be a verified buyer (a matching order), or Filip must confirm that explicitly.
//   • One reply per message: a claim written before sending, plus the label STANLEY/replied.
//   • The Językozak AI template needs the customer's own activation code, typed by Filip.

import { REPLY_TEMPLATES, REPLY_TEMPLATE_IDS, renderReply } from './replyTemplates.js'

export const LABELS = Object.freeze({ replied: 'STANLEY/replied', skipped: 'STANLEY/skipped' })
export const INBOX_QUERY = `in:inbox -category:promotions -category:social -category:forums -label:${LABELS.replied} -label:${LABELS.skipped} newer_than:21d`

export const KIND = Object.freeze({ AUTOMATED: 'automated', PROTECTED: 'protected', SENSITIVE: 'sensitive', ACCESS: 'access-request', HUMAN: 'human' })

/** Lower case, no diacritics (ł included), for matching Polish and English text. */
export const norm = (s) => String(s ?? '').normalize('NFD').replace(/[̀-ͯ]/g, '').replace(/ł/g, 'l').replace(/Ł/g, 'l').toLowerCase()

const AUTOMATED_LOCAL = /(^|[._+-])(no-?reply|do-?not-?reply|mailer-daemon|postmaster|bounces?|notifications?|notify|newsletter|alerts?|system)([._+@-]|$)/
const AUTOMATED_LABELS = ['CATEGORY_PROMOTIONS', 'CATEGORY_SOCIAL', 'CATEGORY_FORUMS']

// System, bank, authority, billing and security-alert senders: matched on the domain (and its subdomains).
const PROTECTED_DOMAINS = [
  'wix.com', 'wixanswers.com', 'wixstatic.com', 'stripe.com', 'przelewy24.pl', 'paypal.com', 'paypal.pl', 'payu.pl', 'blik.com',
  'facebookmail.com', 'facebook.com', 'meta.com', 'instagram.com', 'google.com', 'googlemail.com', 'youtube.com',
  'netlify.com', 'supabase.io', 'supabase.com', 'github.com', 'anthropic.com', 'elevenlabs.io', 'make.com', 'integromat.com', 'clickmeeting.com',
  'pkobp.pl', 'mbank.pl', 'ing.pl', 'ingbank.pl', 'santander.pl', 'pekao.com.pl', 'aliorbank.pl', 'bankmillennium.pl', 'bnpparibas.pl',
  'credit-agricole.pl', 'velobank.pl', 'citibankonline.pl', 'revolut.com',
  'gov.pl', 'zus.pl', 'uodo.gov.pl', 'podatki.gov.pl', 'krs.ms.gov.pl', 'epuap.gov.pl', 'mf.gov.pl',
]
const SENSITIVE_RE = /\b(faktur\w*|rachunek|rachunki|zwrot\w*|reklamacj\w*|odstap\w*|rezygnacj\w*|uodo|rodo|urzad\w*|zus|krs|podatk\w*|windykac\w*|wezwanie|sad|prawnik\w*|adwokat\w*|chargeback|refund|invoice|complaint|gdpr|lawyer|legal)\b/
const ACCESS_RE = /\b(dostep\w*|link\w*|pobra\w*|nie (dostal\w*|otrzymal\w*|mam|przyszl\w*|dotarl\w*|moge|widze)|brak\w*|nie ma|kod\w*|aktywacj\w*|aktywacyjn\w*|logowan\w*|zalogowac|haslo|materialy|materialow|access|download|did ?n[o']?t (get|receive)|not received|missing|activation|login)\b/

// First match wins when several products are named, but then the confidence is 'low' and Filip picks in the panel.
const PRODUCT_RULES = [
  ['jzk', /jezykozak|\bjzk\b|aplikacj\w*|kod\w* aktywacyjn\w*|activation code|\bthe app\b/],
  ['tech', /zadziwiajac\w*|techniki nauki jezykow|3 techniki|nauki jezykow|language techniques/],
  ['wsztp', /wsztp|wakacyjn\w* szkol\w*|szkol\w* treningu pamieci|turnus|karta kwalifikacyjn\w*/],
  ['pp', /pakiet\w* pamiec\w*|pamiec\.? trening|materialy cyfrow\w*|e-?book\w*|audycj\w*|\bmp3\b|\b119\b|mapy mysli|memory pack\w*/],
  ['kurs', /\bkurs\w*|\bcourse\b|jak sie uczyc|\b549\b|modul\w*/],
]

const domainOf = (address) => String(address).split('@')[1] ?? ''
const inDomains = (domain, list) => list.some((d) => domain === d || domain.endsWith(`.${d}`))

/**
 * Classifies one normalised message ({ id, from, replyTo, subject, snippet, labelIds, bulk }).
 * Returns { kind, reason, template, confidence, candidates }.  `template` is a suggestion only, never an action.
 */
export function classify(msg) {
  const text = norm(`${msg.subject} ${msg.snippet}`)
  const domain = domainOf(msg.from)
  const none = { template: null, confidence: 'none', candidates: [] }

  if (!msg.from) return { kind: KIND.AUTOMATED, reason: 'no sender address', ...none }
  if (inDomains(domain, PROTECTED_DOMAINS)) return { kind: KIND.PROTECTED, reason: 'system, bank, authority or billing sender', ...none }
  if (msg.bulk || AUTOMATED_LOCAL.test(norm(msg.from.split('@')[0])) || (msg.labelIds ?? []).some((l) => AUTOMATED_LABELS.includes(l))) {
    return { kind: KIND.AUTOMATED, reason: 'automated sender', ...none }
  }
  if (SENSITIVE_RE.test(text)) return { kind: KIND.SENSITIVE, reason: 'invoice, refund, complaint, legal or tax topic: needs Filip', ...none }

  const candidates = PRODUCT_RULES.filter(([, re]) => re.test(text)).map(([id]) => id)
  if (ACCESS_RE.test(text) && candidates.length > 0) {
    return { kind: KIND.ACCESS, reason: 'asks about access to a product', template: candidates[0], confidence: candidates.length === 1 ? 'high' : 'low', candidates }
  }
  if (ACCESS_RE.test(text)) return { kind: KIND.HUMAN, reason: 'looks like an access question, but the product is unclear', template: null, confidence: 'none', candidates: [] }
  return { kind: KIND.HUMAN, reason: 'a person wrote; no template fits', ...none }
}

/** Where a reply would go: Reply-To when it is a plain person address, else From. */
export const recipientOf = (msg) => msg.replyTo || msg.from

const maskAddress = (a) => { const [l, d] = String(a).split('@'); return `${l.slice(0, 1)}***@${d ?? ''}` }

async function buyerCheck(findOrders, address) {
  if (!findOrders) return { status: 'unknown', orders: [] }
  try {
    const orders = await findOrders(address)
    return orders.length ? { status: 'verified', orders: orders.slice(0, 3) } : { status: 'unverified', orders: [] }
  } catch {
    return { status: 'unknown', orders: [] }
  }
}

async function inBatches(items, size, fn) {
  const out = []
  for (let i = 0; i < items.length; i += size) out.push(...(await Promise.all(items.slice(i, i + size).map(fn))))
  return out
}

/**
 * Reads the inbox and sorts it. Returns counts + the messages that wait for Filip (human mails), each with a suggested template.
 */
export async function triageInbox({ gmail, findOrders, max = 30 }) {
  const ids = await gmail.listIds(INBOX_QUERY, max)
  const metas = await inBatches(ids, 6, (id) => gmail.getMeta(id))
  const counts = { scanned: metas.length, automated: 0, protected: 0, sensitive: 0, access: 0, human: 0 }
  const items = []
  for (const m of metas) {
    const c = classify(m)
    if (c.kind === KIND.AUTOMATED) { counts.automated++; continue }
    if (c.kind === KIND.PROTECTED) { counts.protected++; continue }
    if (c.kind === KIND.SENSITIVE) counts.sensitive++
    else if (c.kind === KIND.ACCESS) counts.access++
    else counts.human++
    items.push({ m, c })
  }
  const out = await inBatches(items, 4, async ({ m, c }) => {
    const to = recipientOf(m)
    const buyer = c.kind === KIND.ACCESS ? await buyerCheck(findOrders, to) : { status: 'n/a', orders: [] }
    return {
      id: m.id, threadId: m.threadId, kind: c.kind, reason: c.reason,
      fromName: m.fromName, from: m.from, to, toMasked: maskAddress(to),
      subject: m.subject, snippet: m.snippet, date: m.internalDate,
      template: c.template, confidence: c.confidence, candidates: c.candidates,
      buyer,
      canReply: c.kind === KIND.ACCESS || c.kind === KIND.HUMAN,
    }
  })
  out.sort((a, b) => (a.kind === KIND.ACCESS ? 0 : 1) - (b.kind === KIND.ACCESS ? 0 : 1) || String(a.date).localeCompare(String(b.date)))
  return { counts, items: out, oldest: out.map((i) => i.date).filter(Boolean).sort()[0] ?? null, templates: templateList() }
}

export function templateList() {
  return REPLY_TEMPLATE_IDS.map((id) => ({ id, label: REPLY_TEMPLATES[id].label, needsCode: REPLY_TEMPLATES[id].needsCode, subject: REPLY_TEMPLATES[id].subject }))
}

/** The draft shown before approval. The activation code may be a placeholder here; sending requires the real one. */
export function previewReply(templateId, code) {
  const t = REPLY_TEMPLATES[templateId]
  if (!t) throw new Error('unknown template')
  const c = String(code ?? '').trim()
  const real = /^[A-Za-z0-9][A-Za-z0-9_-]{5,63}$/.test(c)
  const r = renderReply(templateId, { code: t.needsCode && !real ? 'JZK-XXXX-XXXX' : c })
  return { id: templateId, subject: r.subject, plain: r.plain, html: r.html, needsCode: t.needsCode, codeReady: !t.needsCode || real }
}

export class MailPolicyError extends Error {
  constructor(message, code) { super(message); this.name = 'MailPolicyError'; this.code = code }
}

const logKey = (now, id) => `mail/log/${new Date(now).toISOString()}-${id}`

/**
 * Sends ONE approved reply. Everything about the message is re-read from Gmail here.
 * Throws MailPolicyError (never sends) when a rule is not met.
 */
export async function sendApprovedReply({ gmail, kv, findOrders, messageId, templateId, code, confirmUnverified = false, now = Date.now() }) {
  if (!messageId || typeof messageId !== 'string' || !/^[A-Za-z0-9_-]{6,64}$/.test(messageId)) throw new MailPolicyError('invalid message id', 'bad_request')
  if (!REPLY_TEMPLATES[templateId]) throw new MailPolicyError('unknown template', 'bad_request')

  const m = await gmail.getMeta(messageId)
  if ((m.labelIds ?? []).includes('TRASH') || (m.labelIds ?? []).includes('SPAM')) throw new MailPolicyError('the message is in Trash or Spam', 'not_allowed')
  const c = classify(m)
  if (c.kind !== KIND.ACCESS && c.kind !== KIND.HUMAN) throw new MailPolicyError(`no template reply to this message (${c.reason})`, 'not_allowed')

  const to = recipientOf(m)
  if (classify({ ...m, from: to, replyTo: '' }).kind === KIND.AUTOMATED || inDomainsProtected(to)) throw new MailPolicyError('the reply address is an automated or system address', 'not_allowed')

  const preview = previewReply(templateId, code)
  if (!preview.codeReady) throw new MailPolicyError('this template needs the customer’s activation code', 'code_required')

  const buyer = await buyerCheck(findOrders, to)
  if (buyer.status !== 'verified' && confirmUnverified !== true) throw new MailPolicyError(`no matching paid order found (${buyer.status}): confirm explicitly to send anyway`, 'unverified_buyer')

  if (await alreadyReplied(gmail, m)) throw new MailPolicyError('this message was already answered', 'already_replied')
  const claimKey = `mail/claim/${messageId}`
  if (!(await kv.setJSONIfNew(claimKey, { at: new Date(now).toISOString(), templateId }))) throw new MailPolicyError('this message was already answered', 'already_replied')

  let sent
  try {
    sent = await gmail.send({ to, subject: preview.subject, plain: preview.plain, html: preview.html, threadId: m.threadId, inReplyTo: m.messageId, references: m.references })
  } catch (e) {
    await kv.delete(claimKey) // nothing was sent: the message can be tried again
    throw e
  }
  let labelError = null
  try { await gmail.modifyLabels(messageId, { add: [LABELS.replied] }) } catch (e) { labelError = e.message }
  await kv.setJSON(logKey(now, messageId), { messageId, templateId, at: new Date(now).toISOString(), buyer: buyer.status, sentId: sent.id, toDomain: to.split('@')[1], labelError })
  return { sent: true, sentId: sent.id, templateId, buyer: buyer.status, labelError }
}

const inDomainsProtected = (address) => classify({ from: address, replyTo: '', subject: '', snippet: '', labelIds: [], bulk: false }).kind === KIND.PROTECTED

async function alreadyReplied(gmail, m) {
  const labelId = await gmail.labelId(LABELS.replied, { create: false })
  return Boolean(labelId && (m.labelIds ?? []).includes(labelId))
}

export async function skipMessage({ gmail, messageId }) {
  if (!/^[A-Za-z0-9_-]{6,64}$/.test(String(messageId ?? ''))) throw new MailPolicyError('invalid message id', 'bad_request')
  await gmail.modifyLabels(messageId, { add: [LABELS.skipped] })
  return { skipped: true }
}

/** The numbers the daily brief speaks (no addresses, no subjects). */
export async function inboxSummary({ gmail, findOrders }) {
  const t = await triageInbox({ gmail, findOrders, max: 40 })
  const unverified = t.items.filter((i) => i.kind === KIND.ACCESS && i.buyer.status !== 'verified').length
  return { connected: true, ...t.counts, waiting: t.items.length, oldest: t.oldest, unverified }
}
