// briefDeps.js — the real dependencies of the daily brief (Supabase, Wix, Blobs, knowledge, model), for daily-brief and stanley-brief.

import { profitDataFor } from '../functions/profit-data.js'
import { readTable } from './supabaseRead.js'
import { createWixClient } from './webinarMailWix.js'
import { createBlobStore, createKvStore } from './webinarMailStore.js'
import { loadTemplates } from './webinarMailTemplates.js'
import { WEBINAR_MAIL_CONFIG } from './webinarMailConfig.js'
import { loadKnowledge } from './stanleyKnowledge.js'
import { callLlm, llmChoice } from './stanleyLlm.js'
import { realMailDeps } from './mailDeps.js'
import { inboxSummary } from './mailTriage.js'

export async function realBriefDeps(env = process.env) {
  const supabaseUrl = env.SUPABASE_URL
  const serviceKey = env.SUPABASE_SERVICE_ROLE_KEY
  const noSupabase = async () => { throw new Error('brak SUPABASE_URL / SUPABASE_SERVICE_ROLE_KEY') }
  let wix = null
  try { wix = createWixClient({ apiKey: env.WIX_API_KEY, siteId: env.WIX_SITE_ID }) } catch { /* reported by the mail section */ }
  const knowledge = await loadKnowledge().catch(() => null)
  const mailbox = realMailDeps(env)
  return {
    deps: {
      sales: supabaseUrl && serviceKey ? (from, to) => profitDataFor(from, to) : noSupabase,
      adRows: supabaseUrl && serviceKey
        ? (from, to) => readTable(supabaseUrl, serviceKey, 'meta_ads_daily', {
          select: 'date,campaign_name,ad_name,ad_id,spend,meta_purchases',
          order: 'date.asc,ad_id.asc,campaign_id.asc',
          filters: { date: [`gte.${from}`, `lte.${to}`] },
        })
        : noSupabase,
      mail: { store: createBlobStore(), wix, loadTemplates: (slot) => loadTemplates(WEBINAR_MAIL_CONFIG.slots[slot].dir) },
      kv: createKvStore(),
      // Inbox numbers for the brief (counts only). Not connected: the section says so.
      inbox: async () => {
        const st = await mailbox.session.status()
        if (!st.connected || st.invalid) return { connected: false }
        return inboxSummary({ gmail: mailbox.gmail, findOrders: mailbox.findOrders })
      },
      knowledge,
    },
    llm: llmChoice(env) ? (system, user, opts) => callLlm(system, user, opts, env) : null,
  }
}
