// mailBuyer.js — "is the sender a paying customer?": looks the reply address up in the Wix orders table (Supabase).
// Read only, through readTable (explicit order, paged). Returns [{ date, product }]; never raw rows, never an address.

import { readTable } from './supabaseRead.js'
import { isCountableOrder } from './productCatalog.js'

const escapeLike = (s) => String(s).replace(/[*%\\]/g, '')

export function createOrderLookup({ supabaseUrl, serviceKey, read = readTable }) {
  if (!supabaseUrl || !serviceKey) return null
  return async function findOrders(address) {
    const email = String(address ?? '').trim().toLowerCase()
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) return []
    let lastError = null
    for (const table of ['orders', 'wix_orders']) {
      try {
        const rows = await read(supabaseUrl, serviceKey, table, { select: '*', order: 'order_created_at.desc.nullslast', limit: 50, filters: { email: [`ilike.${escapeLike(email)}`] } })
        return rows
          .filter((r) => String(r.email ?? '').trim().toLowerCase() === email && isCountableOrder(r))
          .map((r) => ({ date: String(r.order_created_at ?? r.created_at ?? '').slice(0, 10) || null, product: String(r.product_name_raw ?? r.product_name ?? 'order').slice(0, 80) }))
      } catch (e) {
        lastError = e
      }
    }
    throw lastError ?? new Error('orders table unreachable')
  }
}
