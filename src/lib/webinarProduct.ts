export type ProductTag = 'JSU' | 'JZK' | 'UNKNOWN'

export interface ProductClassification {
  canonicalTag: ProductTag
  productName: string
  reason: string
}

function norm(s: string): string {
  return s
    .toLowerCase()
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .replace(/[^a-z0-9\s]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()
}

// SINGLE SOURCE OF TRUTH: webinar_sessions.product_tag. No session_name parsing,
// no schedule inference. The DB column is authoritative (JSU / JZK / UNKNOWN).
// Any value other than exactly JSU or JZK is UNKNOWN — never merged into either.
export function normalizeProduct(session: {
  product_tag?: string | null
  session_name?: string | null
  scheduled_at?: string | null
}): ProductClassification {
  const tag = String(session.product_tag ?? '').trim().toUpperCase()
  if (tag === 'JSU') return { canonicalTag: 'JSU', productName: 'Jak się uczyć', reason: 'product_tag = JSU' }
  if (tag === 'JZK') return { canonicalTag: 'JZK', productName: 'Językozak AI', reason: 'product_tag = JZK' }
  return {
    canonicalTag: 'UNKNOWN',
    productName: session.session_name ?? 'Unknown webinar',
    reason: `product_tag = ${session.product_tag ?? 'null'} (UNKNOWN — separate category)`,
  }
}

/** Map a free-text user query to a product filter. */
export function productFromQuery(query: string): ProductTag | 'ALL' {
  const q = norm(query)
  const jzkTerms = ['jzk', 'jezykozak', 'jezyk', 'language', 'nauka jezykow', 'linguistic']
  const jsuTerms = ['jsu', 'jak sie uczyc', 'pamiec', 'memory', 'pamieci']
  if (jzkTerms.some(t => q.includes(norm(t)))) return 'JZK'
  if (jsuTerms.some(t => q.includes(norm(t)))) return 'JSU'
  return 'ALL'
}
