// Frontend lib for profit-data backend endpoint.
// Caches for 55 s — just under the 60 s auto-refresh interval.
import { bustUrl } from '../utils/cacheBust'

// The canonical profit shape the UI reads. It used to live in a second module
// (src/services/productMargins.ts) that carried its own copy of the price and
// margin tables; that copy is gone — margins are defined once, in
// netlify/functions/productCatalog.js, and arrive here over the wire.
export interface ProfitSummary {
  marginBeforeAds: number
  estimatedProfit: number   // = marginBeforeAds − adSpend (NOT revenue − adSpend)
  profitPerOrder:  number
  realCpa:         number | null
  realRoas:        number | null
  unmappedRevenue: number
  unmappedCount:   number
  adSpend:         number
  paidCount:       number
}

export interface ProductBreakdownItem {
  productKey: string
  displayName: string
  scope?: 'memory' | 'language' | 'cogni'
  orders: number
  units?: number
  revenue: number
  contributionMargin: number | null
  marginTotal: number
}

export interface ScopeBreakdownItem {
  scope: 'memory' | 'language' | 'cogni'
  orders: number
  revenue: number
  marginTotal: number
}

export interface ProfitData {
  ok: boolean
  timestamp: string
  dateWarsaw: string
  ordersCount: number
  revenue: number
  adSpend: number
  adSpendSource: string
  knownMargin: number
  unknownRevenue: number
  unknownOrdersCount: number
  unknownMarginRevenue?: number       // WSZTP — known product, unknown margin
  unknownMarginOrdersCount?: number
  ambiguousRevenue?: number
  ambiguousOrdersCount?: number
  ambiguousMinMargin?: number
  // Every order in the range that contributed NO margin — unmapped, plus known
  // products whose margin is not in the catalog, plus ambiguous quantities.
  // Est. Profit must never look complete while this is above zero.
  noMarginOrdersCount?: number
  noMarginRevenue?: number
  /** The field(s) the match broke on, e.g. "amount (137 PLN not in PRICE_TO_PRODUCT)". */
  noMarginFields?: string[]
  orderRowsFetched?: number
  conflictsCount?: number             // PRICE/NAME CONFLICT rows
  conflicts?: Array<{ amount: number; product_name_raw: string; order_date: string; price_product: string; price_amount: number; name_product: string }>
  marginBeforeAds: number
  estimatedProfitAfterAds: number
  estimatedProfitPerOrder: number
  productBreakdown: ProductBreakdownItem[]
  scopeBreakdown?: ScopeBreakdownItem[]
  unmappedOrders: unknown[]
  emailNormReclassified?: number
  sourceTable: string
  errors?: string[]
  error?: string
}

// Maps a successful backend ProfitData response to the canonical ProfitSummary
// shape so every profit surface in the UI reads one interface.
export function mapProfitToSummary(pd: ProfitData): ProfitSummary {
  return {
    marginBeforeAds: pd.marginBeforeAds,
    estimatedProfit: pd.estimatedProfitAfterAds,
    profitPerOrder:  pd.estimatedProfitPerOrder,
    realCpa:         pd.ordersCount > 0 ? pd.adSpend / pd.ordersCount : null,
    realRoas:        pd.adSpend > 0 ? pd.revenue / pd.adSpend : null,
    unmappedRevenue: pd.unknownRevenue,
    unmappedCount:   pd.unknownOrdersCount,
    adSpend:         pd.adSpend,
    paidCount:       pd.ordersCount,
  }
}

const _cache = new Map<string, { data: ProfitData; ts: number }>()
const CACHE_TTL = 55 * 1000  // 55 s — just under 60 s auto-refresh interval

// Pass { from, to } (Warsaw YYYY-MM-DD) for a range; omit for today.
export async function fetchProfitData(range?: { from: string; to: string }): Promise<ProfitData | null> {
  const key = range ? `${range.from}_${range.to}` : 'today'
  const cached = _cache.get(key)
  if (cached && Date.now() - cached.ts < CACHE_TTL) return cached.data
  try {
    const base = range
      ? `/.netlify/functions/profit-data?from=${range.from}&to=${range.to}`
      : '/.netlify/functions/profit-data'
    const res = await fetch(bustUrl(base), { headers: { 'Cache-Control': 'no-store' } })
    if (!res.ok) return null
    const data = await res.json() as ProfitData
    if (!data.ok) return data   // return error payload so callers can inspect
    _cache.set(key, { data, ts: Date.now() })
    return data
  } catch {
    return null
  }
}
