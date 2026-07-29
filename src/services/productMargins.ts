// Product contribution margins (PLN per unit, before ad spend).
// Methodology: contribution margin = price − direct variable costs.
// See docs/profit_metrics.md for full explanation.
//
// ORDER MATTERS: Językozak (jzk_ai) must come before Pakiet Językowy (language_pack)
// because the name "Pakiet Językowy" also matches /język/, causing a false hit.
//
// KEEP IN SYNC with netlify/functions/profit-data.js MARGIN_RULES

export interface ProductMargin {
  productKey:          string
  displayName:         string
  priceExpected:       number       // PLN — primary matching key (absolute price)
  contributionMargin:  number       // PLN per unit (fully configured for all products)
  needsMapping:        boolean
  namePattern:         RegExp       // secondary: regex on product_name_raw
}

// Backward-compat alias used by existing callers
export type ProductMarginRule = ProductMargin

export const PRODUCT_MARGINS: ProductMargin[] = [
  {
    productKey:          'jsu_course',
    displayName:         'Kurs Jak się uczyć',
    priceExpected:       549,
    contributionMargin:  500,
    needsMapping:        false,
    // IMPORTANT: must NOT match "Jak się uczyć" appearing as a bonus in PP product names.
    // Require "kurs" before the phrase, or standalone "jsu" acronym.
    namePattern:         /kurs\s+(?:online\s+)?jak\s+si[eę]\s+uczy[cć]|kurs\s+jak|jsu/i,
  },
  {
    // Językozak BEFORE Pakiet Językowy — /j[eę]zyko/ would match both
    productKey:          'jzk_ai',
    displayName:         'Językozak AI',
    priceExpected:       347,
    contributionMargin:  320,
    needsMapping:        false,
    namePattern:         /j[eę]zykozak|jzk/i,
  },
  {
    productKey:          'memory_pack',
    displayName:         'Pakiet Pamięciowy',
    priceExpected:       119,
    contributionMargin:  70,
    needsMapping:        false,
    namePattern:         /pakiet\s+pami[eę][cć]|trening\s+interaktywny|memory/i,
  },
  {
    productKey:          'language_pack',
    displayName:         'Pakiet Językowy',
    priceExpected:       114,
    contributionMargin:  40,
    needsMapping:        false,
    // Pakiet Językowy incl. the 3T-TRIPWIRE language product
    // ("3 Zadziwiające Techniki Nauki Języków"), sold at 114 and 115 PLN.
    namePattern:         /pakiet\s+j[eę]zyko|zadziwiaj[aą]ce\s+techniki|techniki\s+nauki\s+j[eę]zyk/i,
  },
]

export const UNKNOWN_MARGIN: {
  productKey: string; displayName: string; priceExpected: number
  contributionMargin: null; needsMapping: true
} = {
  productKey:          'unknown',
  displayName:         'Nieznany produkt',
  priceExpected:       0,
  contributionMargin:  null,
  needsMapping:        true,
}

// ── Matching ──────────────────────────────────────────────────────────────────

export function matchMarginByAmount(amount: number): ProductMargin | null {
  return PRODUCT_MARGINS.find(r => r.priceExpected === amount) ?? null
}

export function matchMarginByName(name: string | null | undefined): ProductMargin | null {
  if (!name) return null
  for (const rule of PRODUCT_MARGINS) {
    if (rule.namePattern.test(name)) return rule
  }
  return null
}

// Combined: price is primary (absolute), name is fallback
export function matchMargin(
  productNameRaw: string | null | undefined,
  amount?: number,
): ProductMargin | null {
  if (amount != null) {
    const byAmount = matchMarginByAmount(amount)
    if (byAmount) return byAmount
  }
  return matchMarginByName(productNameRaw)
}

// Backward-compat: keeps old callers working
export function getMarginByAmount(amount: number): ProductMargin | typeof UNKNOWN_MARGIN {
  return matchMarginByAmount(amount) ?? UNKNOWN_MARGIN
}

// ── computeMargin ─────────────────────────────────────────────────────────────

export interface PaidOrder {
  product_name_raw?: string | null
  amount: number
}

export interface MarginBreakdown {
  revenue:            number
  contributionMargin: number
  unmappedRevenue:    number
  unmappedCount:      number
  byProduct: Record<string, {
    productKey:  string
    displayName: string
    orders:      number
    revenue:     number
    marginTotal: number
  }>
}

export function computeMargin(paidOrders: PaidOrder[]): MarginBreakdown {
  let revenue = 0, contributionMargin = 0, unmappedRevenue = 0, unmappedCount = 0
  const byProduct: MarginBreakdown['byProduct'] = {}

  for (const order of paidOrders) {
    const amt  = order.amount
    revenue   += amt
    const rule = matchMarginByAmount(amt) ?? matchMarginByName(order.product_name_raw)

    if (rule) {
      contributionMargin += rule.contributionMargin
      if (!byProduct[rule.productKey]) {
        byProduct[rule.productKey] = {
          productKey:  rule.productKey,
          displayName: rule.displayName,
          orders:      0,
          revenue:     0,
          marginTotal: 0,
        }
      }
      byProduct[rule.productKey].orders++
      byProduct[rule.productKey].revenue     += amt
      byProduct[rule.productKey].marginTotal += rule.contributionMargin
    } else {
      unmappedRevenue += amt
      unmappedCount++
    }
  }

  return { revenue, contributionMargin, unmappedRevenue, unmappedCount, byProduct }
}

// ── summarizeProfit ───────────────────────────────────────────────────────────

export interface ProfitSummary {
  marginBeforeAds: number
  estimatedProfit: number   // = marginBeforeAds - adSpend (NOT revenue - adSpend)
  profitPerOrder:  number
  realCpa:         number | null
  realRoas:        number | null
  unmappedRevenue: number
  unmappedCount:   number
  adSpend:         number
  paidCount:       number
}

export function summarizeProfit(
  breakdown: MarginBreakdown,
  adSpend:   number,
  paidCount: number,
): ProfitSummary {
  const marginBeforeAds = breakdown.contributionMargin
  const estimatedProfit = marginBeforeAds - adSpend      // margin − spend, NOT revenue − spend
  const profitPerOrder  = paidCount > 0 ? estimatedProfit / paidCount : 0
  const realCpa         = paidCount > 0 ? adSpend / paidCount : null
  const realRoas        = adSpend > 0   ? breakdown.revenue / adSpend : null

  return {
    marginBeforeAds,
    estimatedProfit,
    profitPerOrder,
    realCpa,
    realRoas,
    unmappedRevenue: breakdown.unmappedRevenue,
    unmappedCount:   breakdown.unmappedCount,
    adSpend,
    paidCount,
  }
}
