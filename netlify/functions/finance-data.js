// GET /.netlify/functions/finance-data?months=2026-09,2026-10[&source=stripe|p24|paypal|meta]
//
// Returns the published monthly accounting aggregates (bucket "ksiegowosc") for the requested
// months, with statuses, change vs previous month and anomalies. All reading goes through
// netlify/shared/financeStore.js; the Supabase service-role key stays on the server and is
// never part of a response or an error message.
//
// NOTE: like every function in this site, this endpoint has no login in front of it.
// It returns aggregates only (no e-mails, names, order ids or descriptions).
import { FinanceError, RequestError, getFinance } from '../shared/financeStore.js'

const HEADERS = { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store' }

export const handler = async (event) => {
  if (event.httpMethod !== 'GET') return { statusCode: 405, headers: HEADERS, body: JSON.stringify({ error: 'Method Not Allowed' }) }
  const q = event.queryStringParameters ?? {}
  try {
    const view = await getFinance({ months: q.months, source: q.source })
    return { statusCode: 200, headers: HEADERS, body: JSON.stringify(view) }
  } catch (err) {
    if (err instanceof RequestError) return { statusCode: 400, headers: HEADERS, body: JSON.stringify({ error: err.message }) }
    // FinanceError messages are written without secrets; anything else is reported generically.
    const message = err instanceof FinanceError ? err.message : 'błąd odczytu danych finansowych'
    return { statusCode: 502, headers: HEADERS, body: JSON.stringify({ error: message }) }
  }
}
