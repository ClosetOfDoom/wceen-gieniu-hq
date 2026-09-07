import { createClient } from '@supabase/supabase-js'

const supabaseUrl = import.meta.env.VITE_SUPABASE_URL as string
const supabaseAnonKey = import.meta.env.VITE_SUPABASE_ANON_KEY as string

if (!supabaseUrl || !supabaseAnonKey) {
  console.error('Supabase env vars missing — check .env')
}

export const supabase = createClient(supabaseUrl, supabaseAnonKey)

/**
 * PostgREST's hard per-response row cap. It is silent: ask for 5000 rows and you
 * get 1000 and a 200 OK, in physical table order if no ORDER BY was given.
 *
 * That is what broke Est. Profit — see netlify/shared/supabaseRead.js, which
 * enforces the same rules for the Netlify Functions. This is a SECOND
 * implementation of one rule, and deliberately so: the browser reads through
 * supabase-js with the RLS-limited anon key, while the functions read over raw
 * REST with the service role. Sharing one module would mean giving up
 * supabase-js in the browser or shipping the service-role fetch path to the
 * client. One helper per runtime — not one per call site.
 */
export const PAGE = 1000

export interface PagedResult<T> {
  rows: T[]
  /** Non-null when a page failed. Callers must decide what to SAY, not swallow it. */
  error: string | null
  /** PostgREST error code, e.g. PGRST205 for a missing table. */
  code: string | null
}

/**
 * A paged, explicitly ordered SELECT.
 *
 * `order` is required for the same reason it is required server-side: without
 * ORDER BY, a capped response is a silent, arbitrary subset. Pass `limit` to cap
 * the total on purpose; omit it to read everything, page by page.
 *
 * The error is RETURNED, never logged and dropped: a panel that cannot read its
 * table has to say so rather than render an empty state that looks like real
 * data. Partial rows are returned alongside the error so a caller can show what
 * it did get and label it.
 */
export async function pagedSelect<T>(
  table: string,
  opts: {
    order: { column: string; ascending?: boolean; nullsFirst?: boolean }
    select?: string
    limit?: number
    /** Applied to the query builder before ordering — .gte/.lte/.eq etc. */
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    filter?: (q: any) => any
  },
): Promise<PagedResult<T>> {
  const { order, select = '*', limit, filter } = opts
  const want = limit ?? Infinity
  const rows: T[] = []

  for (let from = 0; rows.length < want; from += PAGE) {
    const pageSize = Math.min(PAGE, want - rows.length)
    let q = supabase.from(table).select(select)
    if (filter) q = filter(q)
    q = q.order(order.column, { ascending: order.ascending ?? false, nullsFirst: order.nullsFirst ?? false })
       .range(from, from + pageSize - 1)

    const { data, error } = await q
    if (error) return { rows, error: error.message, code: error.code ?? null }

    const page = (data ?? []) as T[]
    rows.push(...page)
    // A short page is the real end. A full page might be the cap, so ask again.
    if (page.length < pageSize) break
  }
  return { rows, error: null, code: null }
}
