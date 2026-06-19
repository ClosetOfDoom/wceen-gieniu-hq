import { classifyWebinarBySchedule } from './webinarSchedule'

export type ProductTag = 'JSU' | 'JZK' | 'OTHER'

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

const JZK_PATTERNS = [
  'nauka jezykow', 'nauka jezykow', 'jezyk', 'jezykozak', 'language', 'jzk',
]
const JSU_PATTERNS = [
  'jak sie uczyc', 'pamiec', 'pamieci', 'test pamieci', 'pamiec czwartek', 'jsu',
]

export function normalizeProduct(session: {
  product_tag?: string | null
  session_name?: string | null
  scheduled_at?: string | null
}): ProductClassification {
  // Schedule rule is PRIMARY when scheduled_at is available
  if (session.scheduled_at) {
    const classified = classifyWebinarBySchedule(session)
    return { canonicalTag: classified.product_tag, productName: classified.product_name, reason: classified.reason }
  }

  const nameNorm = norm(session.session_name ?? '')
  const tagNorm  = norm(session.product_tag  ?? '')

  // Session name always takes precedence over product_tag
  for (const pat of JZK_PATTERNS) {
    if (nameNorm.includes(norm(pat))) {
      const overridden = tagNorm.includes('jsu')
      return {
        canonicalTag: 'JZK',
        productName: 'Językozak AI',
        reason: overridden
          ? `session_name matches JZK pattern "${pat}"; product_tag "${session.product_tag}" overridden`
          : `session_name matches JZK pattern "${pat}"`,
      }
    }
  }

  for (const pat of JSU_PATTERNS) {
    if (nameNorm.includes(norm(pat))) {
      return {
        canonicalTag: 'JSU',
        productName: 'Jak się uczyć',
        reason: `session_name matches JSU pattern "${pat}"`,
      }
    }
  }

  // Fall back to product_tag
  if (tagNorm.includes('jzk') || tagNorm.includes('jezyk')) {
    return { canonicalTag: 'JZK', productName: 'Językozak AI', reason: `product_tag is "${session.product_tag}"` }
  }
  if (tagNorm.includes('jsu')) {
    return { canonicalTag: 'JSU', productName: 'Jak się uczyć', reason: `product_tag is "${session.product_tag}"` }
  }

  return {
    canonicalTag: 'OTHER',
    productName: session.session_name ?? 'Unknown webinar',
    reason: 'no matching pattern',
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
