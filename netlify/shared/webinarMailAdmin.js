// webinarMailAdmin.js — what the "Maile webinarowe" tab reads and does. Pure, deps injected
// (deps = { store, wix, checkUrl, loadTemplates(slot) }), so it is tested without a network.

import {
  SLOT_NAMES, buildQueue, buildAlerts, ctrOf, nextVariant, nextWakeUp, renderCampaignHtml,
  runWebinarMail, slotForWeekday, warsawParts, warsawLocalToUtc,
  assertTestAudience, createAndPublish, testAudience, testSendAt,
} from './webinarMail.js'
import { WEBINAR_MAIL_CONFIG } from './webinarMailConfig.js'

const publicConfig = (c) => ({
  wakeHour: c.wakeHour, sendAtLocal: c.sendAtLocal, lowQueueThreshold: c.lowQueueThreshold, skipDates: [...c.skipDates], cron: c.cron, testRecipient: c.testRecipient, testLeadMinutes: c.testLeadMinutes,
  slots: Object.fromEntries(SLOT_NAMES.map((s) => [s, { label: c.slots[s].label, webinarTime: c.slots[s].webinarTime, variants: { ...c.slots[s].variants } }])),
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

  // CTR from Wix for the sends that went out (statistics are unique clickers / delivered).
  const sent = log.filter((e) => e.campaignId && e.status === 'scheduled')
  let stats = {}
  let statsError = null
  try { stats = await wix.campaignStats(sent.map((e) => e.campaignId)) } catch (e) { statsError = String(e.message).slice(0, 200) }
  const rows = [...log].reverse().map((e) => {
    const st = stats[e.campaignId]
    return { key: e.key, date: e.date, slot: e.slot, variant: e.variant ?? null, campaignId: e.campaignId ?? null, templateFile: e.templateFile, subject: e.subject, status: e.status, sendAt: e.sendAt ?? null, error: e.error ?? null, registrations: e.registrations ?? null, delivered: st?.delivered ?? null, clicked: st?.clicked ?? null, ctr: st ? ctrOf(st) : null }
  })

  const p = warsawParts(now)
  const slotToday = slotForWeekday(p.weekday, config)
  const runToday = slotToday ? await store.getRun(`${p.date}-${slotToday}`) : null
  const alerts = buildAlerts({ state, lastRun, runToday, queues: queues.map((q) => ({ slot: q.slot, empty: q.empty || Boolean(q.loadError), low: q.low, readyCount: q.readyCount })), now }, config)
  const next = nextWakeUp(now, config)
  return { now: now.toISOString(), state, config: publicConfig(config), nextWakeUp: next ? { date: next.date, slot: next.slot, at: next.at.toISOString() } : null, queues, log: rows, statsError, lastRun, lastDryRun, alerts }
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
      const html = renderCampaignHtml(template.html, url, config)
      const sendAt = testSendAt(now, config).toISOString()
      const { subject, preheader } = q.next
      const key = `TEST-${warsawParts(now).date}-${slot}-${variant}`
      let campaignId = null
      try {
        campaignId = await createAndPublish({ wix, subject, preheader, html, sendAt, audience, test: true }, config)
      } catch (e) {
        campaignId = e.campaignId ?? null
        const error = String(e.message).slice(0, 300)
        await store.addLog({ key, date: warsawParts(now).date, slot, variant, url, campaignId, templateFile: template.file, subject, sendAt, status: 'test-failed', error, test: true, createdAt: now.toISOString(), dryRun: false })
        return { ok: false, error, campaignId }
      }
      await store.addLog({ key, date: warsawParts(now).date, slot, variant, url, campaignId, templateFile: template.file, subject, sendAt, status: 'test', test: true, createdAt: now.toISOString(), dryRun: false })
      console.log('[webinar-mail TEST]', JSON.stringify({ slot, variant, template: template.file, campaignId, sendAt, contactId: config.testContactId }))
      return { ok: true, test: true, slot, template: template.file, subject, variant, url, campaignId, sendAt, to: config.testRecipient, contactId: config.testContactId }
    }
    default:
      return { ok: false, error: `nieznana akcja: ${action}` }
  }
}
