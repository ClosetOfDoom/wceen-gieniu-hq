// webinarMailStore.js — state and log of the webinar mails, in Netlify Blobs (store "webinar-mail").
//
//   state                  { auto, pause, ackedRunAt, autoChangedAt, updatedAt }   AUTO / PAUZA switches (default: both OFF-safe);
//                          autoChangedAt = when AUTO last changed value (written on every change)
//   log/<key>              one entry per send  (key = <date>-<slot>; failures: <key>~<ts>)
//   claim/<key>            idempotency claim, written with onlyIfNew BEFORE the campaign is created
//   run/<key>              the last run record of that date-slot (also skips and failures)
//   last-run, last-dry-run the most recent real run / dry run
//   recipients             { count, at } e-mail subscribers of the last production publish (BEZPIECZNIK ODBIORCY baseline)
//
// The in-memory twin has the same interface and is what the tests use.

import { getStore } from '@netlify/blobs'
import { LOG_STATUS } from './webinarMailStatus.js'

export const DEFAULT_STATE = Object.freeze({ auto: false, pause: false, ackedRunAt: null, autoChangedAt: null, updatedAt: null })

function wrap(kv) {
  return {
    async getState() { return { ...DEFAULT_STATE, ...((await kv.getJSON('state')) ?? {}) } },
    async setState(patch) {
      const cur = await this.getState()
      const at = new Date().toISOString()
      const next = { ...cur, ...patch, updatedAt: at }
      // Every change of AUTO is stamped (the caller may pass its own clock as patch.autoChangedAt).
      if ('auto' in patch && Boolean(patch.auto) !== Boolean(cur.auto)) next.autoChangedAt = patch.autoChangedAt ?? at
      else if ('autoChangedAt' in patch) next.autoChangedAt = cur.autoChangedAt
      await kv.setJSON('state', next)
      return next
    },
    async getLog() {
      const keys = await kv.list('log/')
      const rows = await Promise.all(keys.map((k) => kv.getJSON(k)))
      return rows.filter(Boolean).sort((a, b) => String(a.date).localeCompare(String(b.date)) || String(a.createdAt).localeCompare(String(b.createdAt)))
    },
    async addLog(entry) {
      const suffix = entry.status === LOG_STATUS.SCHEDULED ? '' : `~${Date.now()}`
      await kv.setJSON(`log/${entry.key}${suffix}`, entry)
    },
    async updateLog(storageKey, patch) {
      const cur = await kv.getJSON(storageKey)
      if (!cur) throw new Error(`Brak wpisu ${storageKey}`)
      await kv.setJSON(storageKey, { ...cur, ...patch })
    },
    async setRegistrations(key, value) {
      const storageKey = `log/${key}`
      const cur = await kv.getJSON(storageKey)
      if (!cur) throw new Error(`Brak wysyłki ${key}`)
      await kv.setJSON(storageKey, { ...cur, registrations: value })
    },
    /** true if this call took the claim, false if it was already taken. */
    async claim(key) { return kv.setJSONIfNew(`claim/${key}`, { at: new Date().toISOString() }) },
    async getRun(key) { return kv.getJSON(`run/${key}`) },
    async setRun(key, record) { await kv.setJSON(`run/${key}`, record) },
    async getLastRun() { return kv.getJSON('last-run') },
    async setLastRun(record) { await kv.setJSON('last-run', record) },
    /** The last recorded number of e-mail subscribers a production send went to: { count, at } (BEZPIECZNIK ODBIORCY). */
    async getRecipients() { return kv.getJSON('recipients') },
    async setRecipients(value) { await kv.setJSON('recipients', value) },
    async getLastDryRun() { return kv.getJSON('last-dry-run') },
    async setLastDryRun(record) { await kv.setJSON('last-dry-run', record) },
  }
}

/** Blobs-backed store. `blobStore` can be injected; by default the real "webinar-mail" store. */
export function createBlobStore(blobStore = getStore({ name: 'webinar-mail', consistency: 'strong' })) {
  return wrap({
    async getJSON(key) { return (await blobStore.get(key, { type: 'json' })) ?? null },
    async setJSON(key, value) { await blobStore.setJSON(key, value) },
    async setJSONIfNew(key, value) { const r = await blobStore.setJSON(key, value, { onlyIfNew: true }); return r.modified !== false },
    async list(prefix) {
      const out = []
      let cursor
      do {
        const page = await blobStore.list({ prefix, ...(cursor ? { cursor } : {}) })
        out.push(...page.blobs.map((b) => b.key))
        cursor = page.cursor
      } while (cursor)
      return out
    },
  })
}

/** Same interface, in memory (tests). */
export function createMemoryStore(seed = {}) {
  const map = new Map(Object.entries(seed))
  return wrap({
    async getJSON(key) { return map.has(key) ? JSON.parse(JSON.stringify(map.get(key))) : null },
    async setJSON(key, value) { map.set(key, JSON.parse(JSON.stringify(value))) },
    async setJSONIfNew(key, value) { if (map.has(key)) return false; map.set(key, JSON.parse(JSON.stringify(value))); return true },
    async list(prefix) { return [...map.keys()].filter((k) => k.startsWith(prefix)) },
  })
}
