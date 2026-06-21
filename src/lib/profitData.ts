// Frontend lib for profit-data backend endpoint.
// Caches for 55 s — just under the 60 s auto-refresh interval.
import type { ProfitSummary } from '../services/productMargins'
import { bustUrl } from '../utils/cacheBust'

export interface ProductBreakdownItem {
  productKey: string
  displayName: string
  orders: number
  revenue: number
  contributionMargin: number | null
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
  marginBeforeAds: number
  estimatedProfitAfterAds: number
  estimatedProfitPerOrder: number
  productBreakdown: ProductBreakdownItem[]
  unmappedOrders: unknown[]
  emailNormReclassified?: number
  sourceTable: string
  errors?: string[]
  error?: string
}

// Maps a successful backend ProfitData response to the canonical ProfitSummary
// shape from productMargins.ts so UI can use one unified interface.
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

let _cache: { data: ProfitData; ts: number } | null = null
const CACHE_TTL = 55 * 1000  // 55 s — just under 60 s auto-refresh interval

export async function fetchProfitData(): Promise<ProfitData | null> {
  if (_cache && Date.now() - _cache.ts < CACHE_TTL) return _cache.data
  try {
    const res = await fetch(bustUrl('/.netlify/functions/profit-data'), {
      headers: { 'Cache-Control': 'no-store' },
    })
    if (!res.ok) return null
    const data = await res.json() as ProfitData
    if (!data.ok) return data   // return error payload so callers can inspect
    _cache = { data, ts: Date.now() }
    return data
  } catch {
    return null
  }
}
