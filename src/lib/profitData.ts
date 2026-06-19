// Frontend lib for profit-data backend endpoint.
// Caches for 2 minutes — same TTL as ordersData.

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
  sourceTable: string
  errors?: string[]
  error?: string
}

let _cache: { data: ProfitData; ts: number } | null = null
const CACHE_TTL = 2 * 60 * 1000

export async function fetchProfitData(): Promise<ProfitData | null> {
  if (_cache && Date.now() - _cache.ts < CACHE_TTL) return _cache.data
  try {
    const res = await fetch('/.netlify/functions/profit-data', {
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
