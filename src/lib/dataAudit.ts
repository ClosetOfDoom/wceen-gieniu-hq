// Inspect what Wix order data is actually available in Supabase.
// Used by DiagnosticsPanel to show data contract status.
// If wix_orders table does not exist or has no product columns,
// product classification is impossible and must be reported honestly.

import { supabase } from '../services/supabase'
import { PRODUCT_CLASSIFICATION_REASON } from './productClassifier'

export interface DataContractReport {
  wixOrdersTableExists: boolean
  hasProductName: boolean
  hasItemName: boolean
  hasLineItems: boolean
  classificationAvailable: boolean
  sampleRowCount: number
  checkedAt: string
  error: string | null
  classificationBlockReason: string
}

export async function fetchDataContract(): Promise<DataContractReport> {
  const checkedAt = new Date().toISOString()

  const { data, error } = await supabase
    .from('wix_orders')
    .select('*')
    .limit(1)

  if (error) {
    return {
      wixOrdersTableExists: false,
      hasProductName: false,
      hasItemName: false,
      hasLineItems: false,
      classificationAvailable: false,
      sampleRowCount: 0,
      checkedAt,
      error: error.message,
      classificationBlockReason: PRODUCT_CLASSIFICATION_REASON,
    }
  }

  const row = data?.[0] ?? {}
  const hasProductName = 'product_name' in row
  const hasItemName = 'item_name' in row
  const hasLineItems = 'line_items' in row
  const classificationAvailable = hasProductName || hasItemName || hasLineItems

  return {
    wixOrdersTableExists: true,
    hasProductName,
    hasItemName,
    hasLineItems,
    classificationAvailable,
    sampleRowCount: data?.length ?? 0,
    checkedAt,
    error: null,
    classificationBlockReason: classificationAvailable
      ? ''
      : PRODUCT_CLASSIFICATION_REASON,
  }
}
