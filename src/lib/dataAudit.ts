// Inspect what Wix order data is actually available in Supabase.
// Used by DiagnosticsPanel to show data contract status.
// Table is "orders" (not "wix_orders"). Primary classification column is product_name_raw.

import { supabase } from '../services/supabase'
import { PRODUCT_CLASSIFICATION_REASON } from './productClassifier'

export interface DataContractReport {
  wixOrdersTableExists: boolean
  hasProductNameRaw: boolean
  classificationAvailable: boolean
  sampleRowCount: number
  checkedAt: string
  error: string | null
  classificationBlockReason: string
}

export async function fetchDataContract(): Promise<DataContractReport> {
  const checkedAt = new Date().toISOString()

  const { data, error } = await supabase
    .from('orders')
    .select('product_name_raw')
    .limit(1)

  if (error) {
    return {
      wixOrdersTableExists: false,
      hasProductNameRaw: false,
      classificationAvailable: false,
      sampleRowCount: 0,
      checkedAt,
      error: error.message,
      classificationBlockReason: PRODUCT_CLASSIFICATION_REASON,
    }
  }

  const row = data?.[0] ?? {}
  const hasProductNameRaw = 'product_name_raw' in row
  const classificationAvailable = hasProductNameRaw

  return {
    wixOrdersTableExists: true,
    hasProductNameRaw,
    classificationAvailable,
    sampleRowCount: data?.length ?? 0,
    checkedAt,
    error: null,
    classificationBlockReason: classificationAvailable
      ? ''
      : PRODUCT_CLASSIFICATION_REASON,
  }
}
