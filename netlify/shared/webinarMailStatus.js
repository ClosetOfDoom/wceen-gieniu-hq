// webinarMailStatus.js — the ONE list of send-log statuses of the webinar mails and how they are shown.
// Shared by the backend (queue, link variant, idempotency, CTR, health) and the frontend (MAILE tab), so the two
// can never disagree again (19.11: a successful test, status "test", was shown as "błąd").
//
// Log statuses (what the store keeps):
//   scheduled    production publish accepted by Wix (sendAt 07:00)          → counts: uses the template, moves the variant
//   failed       production publish failed                                   → error
//   test         "Wyślij test" publish accepted by Wix (one test contact)    → never counts for anything
//   test-failed  "Wyślij test" publish failed                                → error, never counts
// Views (what a person sees): zaplanowany · wysłany · błąd (· nieznany for a status this list does not know).

export const LOG_STATUS = Object.freeze({ SCHEDULED: 'scheduled', FAILED: 'failed', TEST: 'test', TEST_FAILED: 'test-failed' })
export const LOG_STATUSES = Object.freeze(Object.values(LOG_STATUS))

export const STATUS_VIEW = Object.freeze({ ZAPLANOWANY: 'zaplanowany', WYSLANY: 'wysłany', BLAD: 'błąd', NIEZNANY: 'nieznany' })

const PUBLISHED = new Set([LOG_STATUS.SCHEDULED, LOG_STATUS.TEST])
const FAILED = new Set([LOG_STATUS.FAILED, LOG_STATUS.TEST_FAILED])

/** A "Wyślij test" entry (by flag, status or key: older entries are recognised too). */
export function isTestEntry(e) {
  if (!e) return false
  return e.test === true || e.status === LOG_STATUS.TEST || e.status === LOG_STATUS.TEST_FAILED || String(e.key ?? '').startsWith('TEST-')
}

/**
 * A real production send: the ONLY kind of entry that uses a template up, moves the link variant, takes the slot
 * (idempotency) and enters the CTR / A/B statistics. Tests and dry runs never do.
 */
export function isProductionSend(e) {
  return Boolean(e) && !e.dryRun && !isTestEntry(e) && e.status === LOG_STATUS.SCHEDULED
}

/**
 * How one log entry is shown. A publish accepted by Wix is "zaplanowany" until its sendAt and "wysłany" after it
 * (no sendAt = published for immediate sending = "wysłany"). Only a failed publish is "błąd".
 *   → { code: 'zaplanowany'|'wysłany'|'błąd'|'nieznany', label, tone: 'ok'|'pending'|'error'|'muted', test }
 */
export function sendStatusView(e, now = new Date()) {
  const test = isTestEntry(e)
  const status = e?.status
  if (FAILED.has(status)) return { code: STATUS_VIEW.BLAD, label: test ? 'TEST · błąd' : 'błąd', tone: 'error', test }
  if (!PUBLISHED.has(status)) return { code: STATUS_VIEW.NIEZNANY, label: `${test ? 'TEST · ' : ''}${String(status ?? '—')}`, tone: 'muted', test }
  const at = e.sendAt ? Date.parse(e.sendAt) : NaN
  const pending = Number.isFinite(at) && at > now.getTime()
  const code = pending ? STATUS_VIEW.ZAPLANOWANY : STATUS_VIEW.WYSLANY
  return { code, label: test ? `TEST · ${code}` : code, tone: pending ? 'pending' : 'ok', test }
}
