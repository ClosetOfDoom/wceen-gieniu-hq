// webinarMail.js — the decision logic of the automatic webinar mails. Pure: every outside thing
// (Wix, the store, the clock, the link check, the template files) is passed in, so the tests can
// run the whole flow without a network and without ever publishing anything.
//
// Flow of one run (runWebinarMail):
//   Warsaw clock → send day? → wake hour? → idempotency (<date>-<slot>) → skipDates → PAUZA → AUTO
//   → next unsent, valid template → link variant → safeguards → claim → sender name of the slot → create campaign
//   → publish with sendAt 07:00. A DRY_RUN does everything except the claim, the create and the publish.

import { WEBINAR_MAIL_CONFIG } from './webinarMailConfig.js'
import { LOG_STATUS, isProductionSend } from './webinarMailStatus.js'

export const SLOT_NAMES = Object.freeze(['tuesday', 'thursday'])

// ── Warsaw clock ────────────────────────────────────────────────────────────────

const PARTS = new Intl.DateTimeFormat('en-GB', {
  timeZone: 'Europe/Warsaw', year: 'numeric', month: '2-digit', day: '2-digit',
  hour: '2-digit', minute: '2-digit', weekday: 'short', hourCycle: 'h23',
})
const WEEKDAY = { Sun: 0, Mon: 1, Tue: 2, Wed: 3, Thu: 4, Fri: 5, Sat: 6 }

/** Wall-clock parts of an instant in Europe/Warsaw: { date: 'YYYY-MM-DD', hour, minute, weekday 0..6 }. */
export function warsawParts(instant) {
  const p = Object.fromEntries(PARTS.formatToParts(instant).map((x) => [x.type, x.value]))
  return { date: `${p.year}-${p.month}-${p.day}`, hour: Number(p.hour), minute: Number(p.minute), weekday: WEEKDAY[p.weekday] }
}

/** The instant at which a Warsaw wall clock shows `date` `hh:mm` (handles CET and CEST). */
export function warsawLocalToUtc(date, hhmm) {
  const [y, m, d] = date.split('-').map(Number)
  const [hh, mm] = hhmm.split(':').map(Number)
  for (const offsetHours of [1, 2]) {
    const t = new Date(Date.UTC(y, m - 1, d, hh - offsetHours, mm))
    const p = warsawParts(t)
    if (p.date === date && p.hour === hh && p.minute === mm) return t
  }
  throw new Error(`Godzina ${hhmm} dnia ${date} nie istnieje w Europe/Warsaw`)
}

export function slotForWeekday(weekday, config = WEBINAR_MAIL_CONFIG) {
  return SLOT_NAMES.find((s) => config.slots[s].weekday === weekday) ?? null
}

/** Next Tue/Thu 06:00 Warsaw strictly after `now`: { date, slot, at (Date) }. For the app header. */
export function nextWakeUp(now, config = WEBINAR_MAIL_CONFIG) {
  for (let i = 0; i < 9; i++) {
    const probe = new Date(now.getTime() + i * 86400e3)
    const p = warsawParts(probe)
    const slot = slotForWeekday(p.weekday, config)
    if (!slot) continue
    const at = warsawLocalToUtc(p.date, `${String(config.wakeHour).padStart(2, '0')}:00`)
    if (at.getTime() > now.getTime()) return { date: p.date, slot, at }
  }
  return null
}

// ── Subject and template validation ──────────────────────────────────────────────

/**
 * Subject rules (sender reputation on the WP domains).
 *   BLOCKS:  "!", merge tags (${...}, {{...}}), prices ("zł", "%").
 *   WARNS:   any other digit.
 */
export function validateSubject(subject) {
  const s = String(subject ?? '').trim()
  const blocked = []
  const warnings = []
  if (!s) return { blocked: ['brak tematu'], warnings }
  if (s.includes('!')) blocked.push('wykrzyknik „!”')
  if (/\$\{[^}]*\}/.test(s) || /\{\{[^}]*\}\}/.test(s)) blocked.push('tag scalania (${...} albo {{...}})')
  if (s.includes('%')) blocked.push('znak „%” (cena / rabat)')
  if (/(^|[^\p{L}])zł($|[^\p{L}])/iu.test(s)) blocked.push('cena („zł”)')
  const withoutPrices = s.replace(/\d+(?:[.,]\d+)?\s*(?:zł|%)/giu, '')
  if (/\d/.test(withoutPrices)) warnings.push('cyfry w temacie')
  return { blocked, warnings }
}

function decodeEntities(text) {
  return text
    .replace(/&#x([0-9a-f]+);/gi, (_, h) => String.fromCodePoint(parseInt(h, 16)))
    .replace(/&#(\d+);/g, (_, n) => String.fromCodePoint(Number(n)))
    .replace(/&quot;/g, '"').replace(/&apos;/g, "'").replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&amp;/g, '&')
}

export function escapeHtml(text) {
  return String(text).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;')
}

/** Subject from <title>, preheader from <meta name="preheader" content="...">. */
export function parseTemplate(html) {
  const title = /<title[^>]*>([\s\S]*?)<\/title>/i.exec(html)
  const meta = /<meta\b[^>]*\bname=["']preheader["'][^>]*>/i.exec(html)
  const content = meta ? /\bcontent=["']([^"']*)["']/i.exec(meta[0]) : null
  return {
    subject: title ? decodeEntities(title[1]).replace(/\s+/g, ' ').trim() : '',
    preheader: content ? decodeEntities(content[1]).trim() : '',
  }
}

/** Everything that makes a template unusable (blocked) or worth a look (warnings). */
export function validateTemplate(file, html, config = WEBINAR_MAIL_CONFIG) {
  const { subject, preheader } = parseTemplate(html)
  const v = validateSubject(subject)
  const blocked = [...v.blocked]
  const warnings = [...v.warnings]
  if (!html.includes(config.placeholder)) blocked.push(`brak ${config.placeholder} (link zapisu)`)
  if (/https?:\/\/[^"'\s]*\/so\/[A-Za-z0-9_-]+\/(?:c|o)\b/i.test(html)) blocked.push('linki śledzące starej kampanii Wix (/so/…)')
  if (/<!--\s*TRACKING_PIXEL\s*-->|Ta wiadomość e-mail została wysłana z/i.test(html)) blocked.push('stopka wstrzyknięta przez Wix w treści szablonu')
  // The same render as the real send (with a stand-in URL): whatever tag survives it would reach the inbox raw.
  const { unresolved } = renderCampaignHtml(html, 'https://render-check.invalid/', config)
  if (unresolved.length) blocked.push(`nierozwiązane znaczniki po renderze: ${unresolved.join(', ')}`)
  return { file, subject, preheader, blocked, warnings }
}

/**
 * Tags that Wix does NOT replace in an HTML-editor campaign: {{...}} (e.g. {{unsubscribe}}) and ${...}
 * (e.g. ${contact.name.first}). Proven on 2026-11-19: both arrive raw. Wix adds its own footer with a working unsubscribe link.
 */
const UNRESOLVED_TAG = /\{\{[^{}]*\}\}|\$\{[^{}]*\}/g

/** Distinct unresolved tags in a final HTML. */
export function unresolvedTags(html) {
  return [...new Set(String(html).match(UNRESOLVED_TAG) ?? [])]
}

/**
 * THE render of the final campaign HTML (production, test and template validation): replaces {{WEBINAR_URL}}
 * with the chosen URL and reports every tag left over. Any leftover blocks the send.
 */
export function renderCampaignHtml(html, url, config = WEBINAR_MAIL_CONFIG) {
  const out = html.split(config.placeholder).join(url)
  return { html: out, unresolved: unresolvedTags(out) }
}

// ── Queue and variants ──────────────────────────────────────────────────────────

/**
 * Queue of one slot. Templates are used in file-name order, each exactly once, NO wrap-around:
 * when all are used the queue is empty. Blocked templates are skipped (and listed), DRY_RUN
 * entries and failed runs never use a template up.
 */
export function buildQueue(slot, templates, log, config = WEBINAR_MAIL_CONFIG) {
  // Only production sends use a template up; tests ("Wyślij test") and dry runs never do (webinarMailStatus.js).
  const used = new Set(log.filter((e) => e.slot === slot && isProductionSend(e)).map((e) => e.templateFile))
  const entries = [...templates]
    .sort((a, b) => a.file.localeCompare(b.file))
    .map((t) => ({ ...validateTemplate(t.file, t.html, config), used: used.has(t.file) }))
  const unsent = entries.filter((e) => !e.used)
  const ready = unsent.filter((e) => e.blocked.length === 0)
  return {
    slot,
    entries,
    next: ready[0] ?? null,
    readyCount: ready.length,
    blockedCount: unsent.length - ready.length,
    usedCount: entries.length - unsent.length,
    empty: ready.length === 0,
    low: ready.length <= config.lowQueueThreshold,
  }
}

/** Variants alternate per slot, starting with the first one; the log remembers the last one used. */
export function nextVariant(slot, log, config = WEBINAR_MAIL_CONFIG) {
  const names = Object.keys(config.slots[slot].variants)
  const done = log
    .filter((e) => e.slot === slot && isProductionSend(e) && e.variant)
    .sort((a, b) => String(a.date).localeCompare(String(b.date)))
  if (done.length === 0) return names[0]
  const i = names.indexOf(done[done.length - 1].variant)
  return names[(i + 1) % names.length]
}

// ── Safeguards ──────────────────────────────────────────────────────────────────

/**
 * Every check on its own, none short-circuits another: the report shows all that failed.
 *   ctx: { account, subject, link: {status, error?}, sendsToday: [], state, sendAt (Date), now (Date), unresolved: [] }
 */
export function evaluateSafeguards(ctx, config = WEBINAR_MAIL_CONFIG) {
  const checks = []
  const add = (id, ok, detail) => checks.push({ id, ok: Boolean(ok), detail })
  add('KONTO_ACTIVE', ctx.account?.status === 'ACTIVE', `status konta Wix: ${ctx.account?.status ?? 'brak odpowiedzi'}`)
  const subj = validateSubject(ctx.subject)
  add('TEMAT', subj.blocked.length === 0, subj.blocked.length ? `temat: ${subj.blocked.join(', ')}` : 'temat obecny i poprawny')
  add('LINK_200', ctx.link?.status === 200, ctx.link?.error ? `link nie odpowiada: ${ctx.link.error}` : `link zapisu zwrócił HTTP ${ctx.link?.status ?? '—'}`)
  add('BRAK_WYSYLKI_DZIS', (ctx.sendsToday ?? []).length === 0,
    (ctx.sendsToday ?? []).length ? `dziś już jest kampania tego webinaru: ${ctx.sendsToday.map((c) => String(c.campaignId).slice(0, 8)).join(', ')}` : 'dziś nie ma jeszcze kampanii tego webinaru')
  add('PAUZA_WYLACZONA', !ctx.state?.pause, ctx.state?.pause ? 'PAUZA włączona' : 'PAUZA wyłączona')
  const left = ctx.unresolved ?? []
  add('ZNACZNIKI_ROZWIAZANE', left.length === 0, left.length ? `w finalnym HTML zostały znaczniki: ${left.join(', ')}` : 'finalny HTML bez {{…}} i ${…}')
  const leadMin = (ctx.sendAt.getTime() - ctx.now.getTime()) / 60000
  add('SENDAT_W_PRZYSZLOSCI', leadMin >= config.minLeadMinutes && leadMin <= 365 * 24 * 60,
    `do wysyłki zostało ${Math.round(leadMin)} min (minimum ${config.minLeadMinutes})`)
  return checks
}

const PENDING = new Set(['SCHEDULED', 'IN_DETECTION', 'IN_MODERATION', 'SAMPLING', 'SENDING', 'PAUSED'])

/**
 * Campaigns of this slot that already go out today: still in flight (scheduled / sending...) or
 * published today (Warsaw date). Recognised by the slot's link fragments in the rendered mail.
 */
export async function findSendsToday({ slot, today, wix, knownIds = [] }, config = WEBINAR_MAIL_CONFIG) {
  const campaigns = await wix.listRecentCampaigns()
  const own = new Set(knownIds)
  const candidates = campaigns
    .filter((c) => !own.has(c.campaignId))
    .filter((c) => PENDING.has(c.distributionStatus) || (c.datePublished && warsawParts(new Date(c.datePublished)).date === today))
    .slice(0, 12)
  const markers = config.slots[slot].markers
  const hits = []
  for (const c of candidates) {
    const preview = await wix.previewCampaign(c.campaignId)
    const html = String(preview?.html ?? '')
    if (markers.some((m) => html.includes(m))) hits.push(c)
  }
  return hits
}

// ── The ONE publication path (production and "Wyślij test") ──────────────────────
//
// Production and the test differ ONLY in the audience: production = config.audience (contacts-all),
// test = exactly one contact (config.testContactId). Wix "Send Test Email" is not used anywhere.

/** The only audience a test may have: exactly the one test contact, nothing else. */
export function testAudience(config = WEBINAR_MAIL_CONFIG) {
  return Object.freeze({ contactIds: Object.freeze([config.testContactId]) })
}

/**
 * Hard safeguard of the test path. Throws unless the audience is EXACTLY { contactIds: [testContactId] }:
 * any label (contacts-all included), segment, activeContactsOnly, extra or different contact is rejected.
 */
export function assertTestAudience(audience, config = WEBINAR_MAIL_CONFIG) {
  const problems = []
  if (!/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/.test(String(config.testContactId ?? ''))) problems.push('brak poprawnego testContactId w konfiguracji')
  const a = audience && typeof audience === 'object' ? audience : {}
  const extra = Object.keys(a).filter((k) => k !== 'contactIds')
  if (extra.length) problems.push(`niedozwolone pola odbiorców: ${extra.join(', ')}`)
  const ids = Array.isArray(a.contactIds) ? a.contactIds : null
  if (!ids || ids.length !== 1 || ids[0] !== config.testContactId) problems.push('contactIds musi być dokładnie [kontakt testowy]')
  if (problems.length) throw new Error(`BEZPIECZNIK TESTU: odrzucono odbiorców (${problems.join('; ')})`)
  return true
}

/**
 * sendAt of a test: now + testLeadMinutes, rounded up to the full minute. A test cannot go out at once: Wix rejects
 * a publish without sendAt (HTTP 403, empty message; checked live 2026-11-19 23:0xZ, twice on the same draft).
 */
export function testSendAt(now, config = WEBINAR_MAIL_CONFIG) {
  return new Date(Math.ceil((now.getTime() + config.testLeadMinutes * 60000) / 60000) * 60000)
}

const hideEmails = (text) => String(text ?? '').replace(/[^\s@<>"'()]+@[^\s@<>"'()]+/g, '[e-mail]')

/**
 * BEZPIECZNIK NADAWCA: set the sender NAME of the slot in Wix and confirm it by a read. Never throws: a failure is
 * returned as { ok: false, error } and the send goes on anyway (under whatever name Wix has), with the amber
 * NADAWCA_NIE_USTAWIONY alert and a log entry. No e-mail address is ever returned or logged.
 */
export async function ensureSenderName(wix, fromName) {
  const expected = String(fromName ?? '').trim()
  try {
    if (!expected) throw new Error('brak fromName slotu w konfiguracji')
    if (typeof wix.setSenderName !== 'function' || typeof wix.getSenderName !== 'function') throw new Error('klient Wix nie obsługuje nazwy nadawcy')
    await wix.setSenderName(expected)
    const actual = await wix.getSenderName()
    if (actual !== expected) throw new Error(`odczyt po zmianie: „${actual ?? '—'}” zamiast „${expected}”`)
    return { expected, ok: true }
  } catch (e) {
    return { expected, ok: false, error: hideEmails(scrub(e?.message ?? e)).slice(0, 300) }
  }
}

/**
 * Create the HTML campaign and publish it with emailDistributionOptions. Used by the scheduled run AND by
 * "Wyślij test" (the same path). With test: true the audience must pass assertTestAudience BEFORE anything reaches Wix.
 * Order: safeguards → sender name of the slot (ensureSenderName, confirmed by a read) → create → publish.
 * Returns { campaignId, sender }. On a publish error the thrown error carries campaignId and sender.
 */
export async function createAndPublish({ wix, subject, preheader, html, sendAt, audience, fromName, test = false }, config = WEBINAR_MAIL_CONFIG) {
  if (test) assertTestAudience(audience, config)
  // Production always carries its 07:00 sendAt (SENDAT_W_PRZYSZLOSCI in the run); without one nothing reaches Wix.
  if (!sendAt || !Number.isFinite(Date.parse(sendAt))) throw new Error('BEZPIECZNIK WYSYŁKI: brak poprawnego sendAt (Wix odrzuca publikację bez sendAt, HTTP 403)')
  // Same check as the render: nothing with a raw {{...}} / ${...} ever reaches Wix, test or production.
  const left = unresolvedTags(html)
  if (left.length) throw new Error(`BEZPIECZNIK TREŚCI: nierozwiązane znaczniki w finalnym HTML (${left.join(', ')})`)
  const sender = await ensureSenderName(wix, fromName)
  let campaignId = null
  try {
    campaignId = await wix.createCampaign({ subject, preheader, html })
    await wix.publishCampaign(campaignId, { subject, sendAt, audience })
  } catch (e) {
    e.campaignId = campaignId
    e.sender = sender
    throw e
  }
  return { campaignId, sender }
}

// ── The run ─────────────────────────────────────────────────────────────────────

const scrub = (text) => String(text ?? '').replace(/(?:Bearer\s+)?[A-Za-z0-9_-]{40,}\.[A-Za-z0-9_.-]{20,}/g, '[ukryto]').slice(0, 600)

/**
 * One wake-up. deps = { store, wix, loadTemplates(slot), checkUrl(url) }.
 * Returns { status: 'skipped' | 'failed' | 'scheduled' | 'dry-run', reason, ... }.
 *   skipped  — a deliberate or ordinary no-op (not a send day, wrong hour, AUTO off, PAUZA, skipDate, already done)
 *   failed   — something is wrong and the owner must know (a red alert is derived from it)
 */
export async function runWebinarMail({ now, deps, dryRun = false, force = false, config = WEBINAR_MAIL_CONFIG }) {
  const { store, wix } = deps
  const parts = warsawParts(now)
  const slot = slotForWeekday(parts.weekday, config)
  if (!slot) return { status: 'skipped', reason: 'not-a-send-day', date: parts.date }
  if (!force && parts.hour !== config.wakeHour) return { status: 'skipped', reason: 'not-wake-hour', date: parts.date, slot }

  const key = `${parts.date}-${slot}`
  const finish = async (outcome) => {
    const record = { ...outcome, key, slot, date: parts.date, at: now.toISOString(), dryRun }
    try {
      if (dryRun) {
        await store.setLastDryRun(record)
      } else {
        await store.setRun(key, record)
        await store.setLastRun(record)
      }
    } catch (e) {
      record.storeError = scrub(e.message)
    }
    return record
  }

  try {
    const [state, log] = await Promise.all([store.getState(), store.getLog()])
    const gates = []

    if (!dryRun && log.some((e) => e.key === key && isProductionSend(e))) {
      return finish({ status: 'skipped', reason: 'already-done' })
    }
    if (config.skipDates.includes(parts.date)) gates.push({ id: 'SKIP_DATE', reason: 'skip-date' })
    if (state.pause) gates.push({ id: 'PAUZA', reason: 'pause' })
    if (!state.auto) gates.push({ id: 'AUTO_OFF', reason: 'auto-off' })
    if (gates.length && !dryRun) return finish({ status: 'skipped', reason: gates[0].reason, gates })

    const templates = await deps.loadTemplates(slot)
    const queue = buildQueue(slot, templates, log, config)
    if (!queue.next) {
      return finish({ status: 'failed', reason: 'queue-empty', detail: `kolejka szablonów (${config.slots[slot].label}) jest pusta: ${queue.usedCount} wykorzystanych, ${queue.blockedCount} zablokowanych`, gates })
    }

    const variant = nextVariant(slot, log, config)
    const url = config.slots[slot].variants[variant]
    const template = templates.find((t) => t.file === queue.next.file)
    const { html, unresolved } = renderCampaignHtml(template.html, url, config)
    const { subject, preheader } = queue.next
    const sendAt = warsawLocalToUtc(parts.date, config.sendAtLocal)

    const [account, link, sendsToday] = await Promise.all([
      wix.accountDetails().catch((e) => ({ status: `BŁĄD: ${scrub(e.message)}` })),
      deps.checkUrl(url).catch((e) => ({ status: 0, error: scrub(e.message) })),
      findSendsToday({ slot, today: parts.date, wix, knownIds: log.map((e) => e.campaignId).filter(Boolean) }, config).catch(() => null),
    ])
    const checks = evaluateSafeguards({ account, subject, link, sendsToday: sendsToday ?? [], state, sendAt, now, unresolved }, config)
    if (sendsToday === null) {
      const i = checks.findIndex((c) => c.id === 'BRAK_WYSYLKI_DZIS')
      checks[i] = { id: 'BRAK_WYSYLKI_DZIS', ok: false, detail: 'nie udało się sprawdzić, czy dziś jest już kampania (lista kampanii Wix niedostępna)' }
    }
    // In a DRY_RUN PAUZA is reported through `gates`, not as a failure of the plan.
    const failed = checks.filter((c) => !c.ok && !(dryRun && c.id === 'PAUZA_WYLACZONA'))
    const plan = { template: queue.next.file, subject, variant, url, sendAt: sendAt.toISOString(), readyBefore: queue.readyCount }

    if (failed.length) {
      return finish({ status: 'failed', reason: 'safeguard', detail: failed.map((c) => `${c.id}: ${c.detail}`).join(' | '), checks, plan, gates })
    }
    if (dryRun) return finish({ status: 'dry-run', reason: 'planned', checks, plan, gates, wouldPublish: gates.length === 0 })

    if (!(await store.claim(key))) return finish({ status: 'skipped', reason: 'already-claimed', plan })

    let campaignId = null
    let sender = null
    try {
      ;({ campaignId, sender } = await createAndPublish({ wix, subject, preheader, html, sendAt: sendAt.toISOString(), audience: config.audience, fromName: config.slots[slot].fromName }, config))
    } catch (e) {
      campaignId = e.campaignId ?? null
      await store.addLog({ key, date: parts.date, slot, variant, url, campaignId, templateFile: template.file, subject, sendAt: sendAt.toISOString(), status: LOG_STATUS.FAILED, error: scrub(e.message), sender: e.sender ?? null, createdAt: now.toISOString(), dryRun: false })
      return finish({ status: 'failed', reason: 'publish-failed', detail: scrub(e.message), campaignId, plan, checks, sender: e.sender ?? null })
    }
    await store.addLog({ key, date: parts.date, slot, variant, url, campaignId, templateFile: template.file, subject, sendAt: sendAt.toISOString(), status: LOG_STATUS.SCHEDULED, sender, createdAt: now.toISOString(), dryRun: false })
    return finish({ status: 'scheduled', reason: 'published', campaignId, plan, checks, sender, readyAfter: queue.readyCount - 1 })
  } catch (e) {
    return finish({ status: 'failed', reason: 'exception', detail: scrub(e.message) })
  }
}

// ── Alerts and statistics (for the app) ─────────────────────────────────────────

/** CTR = unique clickers / delivered, in percent with two decimals; null while nothing is delivered. */
export function ctrOf(stats) {
  const delivered = Number(stats?.delivered ?? 0)
  if (!delivered) return null
  return Math.round((Number(stats?.clicked ?? 0) / delivered) * 10000) / 100
}

/** Was AUTO already on before the planned run (wakeHour:00 Warsaw) of `date`? */
export function autoOnBeforeRun(state, date, config = WEBINAR_MAIL_CONFIG) {
  const plannedRun = warsawLocalToUtc(date, `${String(config.wakeHour).padStart(2, '0')}:00`).getTime()
  const stamped = Date.parse(state?.autoChangedAt ?? '')
  const since = Number.isFinite(stamped) ? stamped : Date.parse(config.autoChangedAtFallback)
  return Number.isFinite(since) && since < plannedRun
}

/**
 * What the app shows as alerts. red = needs the owner; amber = a warning.
 *   - the last real run failed (until a later run succeeds or the owner acknowledges it)
 *   - a send day passed 06:45 with AUTO on, PAUZA off, and no run record at all (the function never fired) —
 *     only when AUTO was already on BEFORE that day's planned run (06:00 Warsaw): state.autoChangedAt, or
 *     config.autoChangedAtFallback for a state written before the stamp existed. Turning AUTO on at 23:38 is not a missed run.
 *   - queue of a slot empty (red) or ≤ threshold (amber)
 *   - NADAWCA_NIE_USTAWIONY (amber): the newest send (production or test) could not set / confirm the sender name of
 *     its slot and went out under whatever name Wix had. Clears itself with the next send that sets the name.
 * Neutral states (AUTO off, PAUZA, skipDate) are NOT alerts.
 */
export function buildAlerts({ state, lastRun, runToday, queues, now, log = [] }, config = WEBINAR_MAIL_CONFIG) {
  const alerts = []
  if (lastRun && lastRun.status === 'failed' && !lastRun.dryRun && state.ackedRunAt !== lastRun.at) {
    alerts.push({ severity: 'red', rule: 'MAILE_AWARIA', message: `${config.slots[lastRun.slot]?.label ?? lastRun.slot}, ${lastRun.date}: ${lastRun.reason}${lastRun.detail ? ` — ${lastRun.detail}` : ''}`, runAt: lastRun.at })
  }
  const p = warsawParts(now)
  const slotToday = slotForWeekday(p.weekday, config)
  const late = p.hour > config.wakeHour || (p.hour === config.wakeHour && p.minute >= 45)
  if (slotToday && late && state.auto && !state.pause && !config.skipDates.includes(p.date) && !runToday && autoOnBeforeRun(state, p.date, config)) {
    alerts.push({ severity: 'red', rule: 'MAILE_NIE_ODPALILY', message: `${config.slots[slotToday].label}, ${p.date}: po 06:45 nie ma śladu uruchomienia funkcji (AUTO jest włączone)` })
  }
  const lastSend = [...(log ?? [])].filter((e) => !e.dryRun && e.sender && typeof e.sender === 'object')
    .sort((a, b) => String(a.createdAt ?? '').localeCompare(String(b.createdAt ?? ''))).pop()
  if (lastSend && lastSend.sender.ok === false) {
    alerts.push({ severity: 'amber', rule: 'NADAWCA_NIE_USTAWIONY', message: `${config.slots[lastSend.slot]?.label ?? lastSend.slot}, ${lastSend.date}${lastSend.test ? ' (test)' : ''}: nie udało się ustawić nadawcy „${lastSend.sender.expected}”, mail wyszedł z nazwą, jaką miał Wix (${lastSend.sender.error ?? 'bez szczegółów'})` })
  }
  for (const q of queues) {
    const label = config.slots[q.slot].label
    if (q.empty) alerts.push({ severity: 'red', rule: 'MAILE_KOLEJKA_PUSTA', message: `${label}: kolejka szablonów jest pusta — następny wtorek/czwartek nic nie wyjdzie` })
    else if (q.low) alerts.push({ severity: 'amber', rule: 'MAILE_KOLEJKA_NISKA', message: `${label}: w kolejce ${q.readyCount} gotowych szablonów (ostrzeżenie przy ≤ ${config.lowQueueThreshold})` })
  }
  return alerts
}
