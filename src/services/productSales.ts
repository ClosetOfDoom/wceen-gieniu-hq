// JSU (549) / Językozak AI (347) sales, straight from the orders table via the
// canonical price table. Nothing here touches ClickMeeting, registrations or
// attendance — those feeds stopped, and a number derived from them would be a
// promise the data can no longer keep.

import { bustUrl } from '../utils/cacheBust'

/** Attendance and registration collection stopped on this date. */
export const ATTENDANCE_CUTOFF = '2026-08-14'

export interface SaleBuyer {
  email: string          // masked
  amount: number
  date: string           // Warsaw YYYY-MM-DD
  at: string             // raw timestamp
  product_name_raw: string | null
}

export interface ProductBucket {
  count: number
  revenue: number
  buyers: SaleBuyer[]
}

export interface SalesBucket {
  key: string            // day YYYY-MM-DD, or week-start Monday
  jsu: ProductBucket
  jzk: ProductBucket
}

export interface ProductSalesData {
  ok: boolean
  source_table: string
  today_warsaw: string
  from: string
  days: number
  ordersScannedInRange: number
  priceTable: Record<string, string>
  totals: { jsu: ProductBucket; jzk: ProductBucket }
  byDay: SalesBucket[]
  byWeek: SalesBucket[]
  error?: string
}

export async function fetchProductSales(days = 30): Promise<ProductSalesData | null> {
  try {
    const res = await fetch(bustUrl(`/.netlify/functions/product-sales?days=${days}`), {
      headers: { Accept: 'application/json', 'Cache-Control': 'no-store' },
    })
    if (!res.ok) return null
    return (await res.json()) as ProductSalesData
  } catch {
    return null
  }
}
