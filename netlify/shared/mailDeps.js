// mailDeps.js — the real dependencies of the mail feature (Blobs KV, Google session, Gmail client, order lookup).

import { createKvStore } from './webinarMailStore.js'
import { createGoogleSession } from './googleAuth.js'
import { createGmailClient } from './gmailClient.js'
import { createOrderLookup } from './mailBuyer.js'

export function realMailDeps(env = process.env) {
  const kv = createKvStore()
  const session = createGoogleSession({ kv, env })
  const gmail = createGmailClient({ getToken: () => session.getAccessToken() })
  const findOrders = createOrderLookup({ supabaseUrl: env.SUPABASE_URL, serviceKey: env.SUPABASE_SERVICE_ROLE_KEY })
  return { kv, session, gmail, findOrders }
}
