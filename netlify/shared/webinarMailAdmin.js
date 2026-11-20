// webinarMailAdmin.js — what the "Maile webinarowe" tab reads and does. Pure, deps injected
// (deps = { store, wix, checkUrl, loadTemplates(slot) }), so it is tested without a network.

import {
  SLOT_NAMES, buildQueue, buildAlerts, ctrOf, nextVariant, nextWakeUp, renderCampaignHtml,
  runWebinarMail, slotForWeekday, warsawParts, warsawLocalToUtc,
  assertTestAudience, createAndPublish, testAudience, testSendAt,
} from './webinarMail.js'
import { WEBINAR_MAIL_CONFIG } from './webinarMailConfig.js'
import { LOG_STATUS, isProductionSend, isTestEntry, sendStatusView } from './webinarMailStatus.js'

const publicConfig = (c) => ({
  wakeHour: c.wakeHour, sendAtLocal: c.sendAtLocal, lowQueueThreshold: c.lowQueueThreshold, skipDates: [...c.skipDates], cron: c.cron, testRecipient: c.testRecipient, testLeadMinutes: c.testLeadMinutes,
  slots: Object.fromEntries(SLOT_NAMES.map((s) => [s, { label: c.slots[s].label, webinarTime: c.slots[s].webinarTime, fromName: c.slots[s].fromName, variants: { ...c.slots[s].variants } }])),
})

/** Everything the tab shows, in one object. */
export async function adminStatus({ deps, now = new Date(), config = WEBINAR_MAIL_CONFIG }) {
  const { store, wix } = deps
  const [state, log, lastRun, lastDryRun] = await Promise.all([store.getState(), store.getLog(), store.getLastRun(), store.getLastDryRun()])
  const queues = []
  for (const slot of SLOT_NAMES) {
    let templates = []
    let loadError = null
    try { templates = await deps.loadTemplates(slot) } catch (e) { loadError = e.message }
    const q = buildQueue(slot, templates, log, config)
    queues.push({
      slot, label: config.slots[slot].label, loadError,
      readyCount: q.readyCount, blockedCount: q.blockedCount, usedCount: q.usedCount, low: q.low || Boolean(loadError), empty: q.empty,
      nextVariant: nextVariant(slot, log, config),
      next: q.next ? { file: q.next.file, subject: q.next.subject, warnings: q.next.warnings } : null,
      entries: q.entries.map((e) => ({ file: e.file, subject: e.subject, blocked: e.blocked, warnings: e.warnings, used: e.used })),
    })
  }

  // CTR from Wix only for production sends: tests never enter the CTR / A/B statistics (webinarMailStatus.js).
  const sent = log.filter((e) => e.campaignId && isProductionSend(e))
  let stats = {}
  let statsError = null
  try { stats = await wix.campaignStats(sent.map((e) => e.campaignId)) } catch (e) { statsError = String(e.message).slice(0, 200) }
  const toRow = (e) => {
    const st = isProductionSend(e) ? stats[e.campaignId] : undefined
    return { key: e.key, date: e.date, slot: e.slot, variant: e.variant ?? null, campaignId: e.campaignId ?? null, templateFile: e.templateFile, subject: e.subject, status: e.status, test: isTestEntry(e), sendAt: e.sendAt ?? null, createdAt: e.createdAt ?? null, error: e.error ?? null, registrations: e.registrations ?? null, delivered: st?.delivered ?? null, clicked: st?.clicked ?? null, ctr: st ? ctrOf(st) : null }
  }
  const newestFirst = [...log].filter((e) => !e.dryRun).reverse()
  // "Wysyłki" = production only; "Testy" = the test publishes, shown apart and never counted.
  const rows = newestFirst.filter((e) => !isTestEntry(e)).map(toRow)
  const tests = newestFirst.filter((e) => isTestEntry(e)).map(toRow)

  const alerts = await currentAlerts({ store, state, lastRun, queues, now, config, log })
  const next = nextWakeUp(now, config)
  return { now: now.toISOString(), state, config: publicConfig(config), nextWakeUp: next ? { date: next.date, slot: next.slot, at: next.at.toISOString() } : null, queues, log: rows, tests, statsError, lastRun, lastDryRun, alerts }
}

/**
 * The alerts right now, the same for the tab (adminStatus) and the public health. queues: [{ slot, empty, low,
 * readyCount, loadError? }] (a slot whose templates cannot be read counts as empty).
 */
async function currentAlerts({ store, state, lastRun, queues, now, config, log = [] }) {
  const p = warsawParts(now)
  const slotToday = slotForWeekday(p.weekday, config)
  const runToday = slotToday ? await store.getRun(`${p.date}-${slotToday}`) : null
  return buildAlerts({ state, lastRun, runToday, queues: queues.map((q) => ({ slot: q.slot, empty: q.empty || Boolean(q.loadError), low: q.low, readyCount: q.readyCount })), now, log }, config)
}

/** The instant of the next 06:00 Warsaw wake-up of one slot (today if it is still ahead). */
export function nextWakeInstantOfSlot(slot, now, config = WEBINAR_MAIL_CONFIG) {
  for (let i = 0; i < 9; i++) {
    const p = warsawParts(new Date(now.getTime() + i * 86400e3))
    if (slotForWeekday(p.weekday, config) !== slot) continue
    const at = warsawLocalToUtc(p.date, `${String(config.wakeHour).padStart(2, '0')}:00`)
    if (at.getTime() > now.getTime()) return at
  }
  throw new Error(`Brak najbliższego terminu dla ${slot}`)
}

const isBool = (v) => typeof v === 'boolean'

/** POST actions. Returns { ok, ... } or { ok:false, error } (the function maps that to HTTP 400). */
export async function adminAction({ action, body, deps, now = new Date(), config = WEBINAR_MAIL_CONFIG }) {
  const { store, wix } = deps
  switch (action) {
    case 'set-state': {
      const patch = {}
      if ('auto' in body) { if (!isBool(body.auto)) return { ok: false, error: 'auto musi być true/false' }; patch.auto = body.auto }
      if ('pause' in body) { if (!isBool(body.pause)) return { ok: false, error: 'pause musi być true/false' }; patch.pause = body.pause }
      if (!Object.keys(patch).length) return { ok: false, error: 'brak pól auto/pause' }
      // The store stamps autoChangedAt only when AUTO really changes value; this gives it the request's clock.
      if ('auto' in patch) patch.autoChangedAt = now.toISOString()
      return { ok: true, state: await store.setState(patch) }
    }
    case 'ack': {
      const last = await store.getLastRun()
      return { ok: true, state: await store.setState({ ackedRunAt: last?.at ?? null }) }
    }
    case 'set-registrations': {
      const key = String(body.key ?? '')
      if (!/^\d{4}-\d{2}-\d{2}-(tuesday|thursday)$/.test(key)) return { ok: false, error: 'zły klucz wysyłki' }
      const v = body.value
      if (v !== null && !(Number.isInteger(v) && v >= 0 && v < 1e6)) return { ok: false, error: 'rejestracje: liczba całkowita ≥ 0 albo pusto' }
      try { await store.setRegistrations(key, v) } catch (e) { return { ok: false, error: e.message } }
      return { ok: true }
    }
    case 'dry-run': {
      const slot = String(body.slot ?? '')
      if (!SLOT_NAMES.includes(slot)) return { ok: false, error: 'slot: tuesday albo thursday' }
      const at = nextWakeInstantOfSlot(slot, now, config)
      const outcome = await runWebinarMail({ now: at, deps, dryRun: true, config })
      return { ok: true, outcome }
    }
    case 'send-test': {
      // "Wyślij test": the SAME Create + Publish as production (createAndPublish), sendAt = now + testLeadMinutes,
      // audience = exactly the one test contact. Does not use the template up, does not count for the link variant.
      const slot = String(body.slot ?? '')
      if (!SLOT_NAMES.includes(slot)) return { ok: false, error: 'slot: tuesday albo thursday' }
      const audience = testAudience(config)
      try {
        // A caller may not choose the audience; if one is sent at all it must be exactly the test contact.
        if ('audience' in body) assertTestAudience(body.audience, config)
        assertTestAudience(audience, config)
      } catch (e) {
        return { ok: false, error: e.message }
      }
      const [log, templates] = await Promise.all([store.getLog(), deps.loadTemplates(slot)])
      const q = buildQueue(slot, templates, log, config)
      if (!q.next) return { ok: false, error: 'kolejka tego slotu jest pusta' }
      const variants = config.slots[slot].variants
      const variant = body.variant === undefined ? nextVariant(slot, log, config) : String(body.variant)
      if (!(variant in variants)) return { ok: false, error: `wariant: ${Object.keys(variants).join(' albo ')}` }
      const url = variants[variant]
      const template = templates.find((t) => t.file === q.next.file)
      const { html, unresolved } = renderCampaignHtml(template.html, url, config)
      if (unresolved.length) return { ok: false, error: `BEZPIECZNIK TREŚCI: nierozwiązane znaczniki w finalnym HTML (${unresolved.join(', ')})` }
      const sendAt = testSendAt(now, config).toISOString()
      const { subject, preheader } = q.next
      const key = `TEST-${warsawParts(now).date}-${slot}-${variant}`
      let campaignId = null
      let sender = null
      try {
        ;({ campaignId, sender } = await createAndPublish({ wix, subject, preheader, html, sendAt, audience, fromName: config.slots[slot].fromName, test: true }, config))
      } catch (e) {
        campaignId = e.campaignId ?? null
        const error = String(e.message).slice(0, 300)
        await store.addLog({ key, date: warsawParts(now).date, slot, variant, url, campaignId, templateFile: template.file, subject, sendAt, status: LOG_STATUS.TEST_FAILED, error, sender: e.sender ?? null, test: true, createdAt: now.toISOString(), dryRun: false })
        return { ok: false, error, campaignId, sender: e.sender ?? null }
      }
      await store.addLog({ key, date: warsawParts(now).date, slot, variant, url, campaignId, templateFile: template.file, subject, sendAt, status: LOG_STATUS.TEST, sender, test: true, createdAt: now.toISOString(), dryRun: false })
      console.log('[webinar-mail TEST]', JSON.stringify({ slot, variant, template: template.file, campaignId, sendAt, contactId: config.testContactId, sender }))
      return { ok: true, test: true, slot, template: template.file, subject, variant, url, campaignId, sendAt, sender, to: config.testRecipient, contactId: config.testContactId }
    }
    default:
      return { ok: false, error: `nieznana akcja: ${action}` }
  }
}

/**
 * The next planned send (sendAtLocal, 07:00 Warsaw) of any slot that is still ahead of `now`, skipping skipDates.
 * It is the slot's time, not a promise: whether it goes out also depends on AUTO, PAUZA and the safeguards.
 */
export function nextPlannedSend(now, config = WEBINAR_MAIL_CONFIG) {
  for (let i = 0; i < 16; i++) {
    const p = warsawParts(new Date(now.getTime() + i * 86400e3))
    if (!slotForWeekday(p.weekday, config) || config.skipDates.includes(p.date)) continue
    const at = warsawLocalToUtc(p.date, config.sendAtLocal)
    if (at.getTime() > now.getTime()) return at
  }
  return null
}

const SLOT_PL = { tuesday: 'wtorek', thursday: 'czwartek' }

/**
 * The PUBLIC health summary (webinar-mail-health). Exactly these fields and nothing else: no template content or
 * names, no subjects, no campaign IDs, no e-mails, no secrets. Reads the store the same way webinar-mail-run does
 * (createBlobStore: getState, getLog, getLastRun, getRun). When the read fails: blobsRead "error" and the
 * store-derived fields are null (never a made-up false / count / empty list).
 *   alarmy        codes of the alerts active now (the same buildAlerts as the MAILE tab), e.g. ["MAILE_KOLEJKA_NISKA"]
 *   ostatnieWpisy the 5 newest send-log entries: { data, slot (wtorek|czwartek), status (sendStatusView code), test }
 *   nadawcy         sender NAME per slot from the config: { wtorek, czwartek }
 *   aktualnyNadawca the sender NAME Wix has right now (deps.wix.getSenderName), null when it cannot be read. Never an address.
 */
export async function healthSummary({ deps, build, now = new Date(), config = WEBINAR_MAIL_CONFIG }) {
  let state = null
  let log = null
  try {
    ;[state, log] = await Promise.all([deps.store.getState(), deps.store.getLog()])
  } catch (e) {
    console.error('[webinar-mail-health] blobs read failed:', String(e?.message ?? e).slice(0, 200))
  }
  const blobsRead = state && log ? 'ok' : 'error'
  const kolejka = {}
  const queues = []
  for (const slot of SLOT_NAMES) {
    let n = null
    if (log) {
      try {
        const q = buildQueue(slot, await deps.loadTemplates(slot), log, config)
        n = q.readyCount
        queues.push({ slot, empty: q.empty, low: q.low, readyCount: q.readyCount })
      } catch {
        queues.push({ slot, empty: true, low: true, readyCount: 0, loadError: true })
      }
    }
    kolejka[SLOT_PL[slot] ?? slot] = n
  }

  let alarmy = null
  if (state && log) {
    try {
      const lastRun = await deps.store.getLastRun()
      const alerts = await currentAlerts({ store: deps.store, state, lastRun, queues, now, config, log })
      alarmy = [...new Set(alerts.map((a) => a.rule))]
    } catch (e) {
      console.error('[webinar-mail-health] alerts failed:', String(e?.message ?? e).slice(0, 200))
    }
  }

  const ostatnieWpisy = log
    ? [...log]
        .filter((e) => !e.dryRun)
        .sort((a, b) => String(b.createdAt ?? b.date).localeCompare(String(a.createdAt ?? a.date)))
        .slice(0, 5)
        .map((e) => ({ data: String(e.date ?? ''), slot: SLOT_PL[e.slot] ?? String(e.slot ?? ''), status: sendStatusView(e, now).code, test: isTestEntry(e) }))
    : null

  let aktualnyNadawca = null
  try {
    const name = deps.wix?.getSenderName ? await deps.wix.getSenderName() : null
    aktualnyNadawca = typeof name === 'string' && !name.includes('@') ? name : null
  } catch (e) {
    console.error('[webinar-mail-health] sender read failed:', String(e?.message ?? e).slice(0, 200))
  }

  const next = nextPlannedSend(now, config)
  return {
    build: String(build ?? 'unknown'),
    blobsRead,
    auto: state ? Boolean(state.auto) : null,
    pauza: state ? Boolean(state.pause) : null,
    kolejka,
    nastepnaWysylka: next ? next.toISOString() : null,
    alarmy,
    ostatnieWpisy,
    nadawcy: Object.fromEntries(SLOT_NAMES.map((s) => [SLOT_PL[s] ?? s, config.slots[s].fromName])),
    aktualnyNadawca,
  }
}
