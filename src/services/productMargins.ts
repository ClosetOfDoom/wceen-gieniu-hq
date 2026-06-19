// Product contribution margin configuration.
// These are per-unit operational margins — NOT accounting net profit after tax/fixed costs.
// See docs/profit_metrics.md for methodology.

export interface ProductMarginRule {
  productKey: string
  displayName: string
  expectedPrice: number         // PLN, used for amount-based matching
  contributionMargin: number | null   // PLN per order; null = unknown/configurable
  needsMapping: boolean
}

export const PRODUCT_MARGINS: ProductMarginRule[] = [
  {
    productKey:          'memory_pack',
    displayName:         'Pakiet pamięciowy',
    expectedPrice:       119,
    contributionMargin:  70,
    needsMapping:        false,
  },
  {
    productKey:          'language_pack',
    displayName:         'Pakiet językowy',
    expectedPrice:       114,
    contributionMargin:  40,
    needsMapping:        false,
  },
  {
    productKey:          'jsu_course',
    displayName:         'Kurs Jak się uczyć',
    expectedPrice:       549,
    contributionMargin:  null,
    needsMapping:        true,
  },
  {
    productKey:          'jzk_ai',
    displayName:         'Językozak AI',
    expectedPrice:       347,
    contributionMargin:  null,
    needsMapping:        true,
  },
]

export const UNKNOWN_MARGIN: ProductMarginRule = {
  productKey:          'unknown',
  displayName:         'Nieznany produkt',
  expectedPrice:       0,
  contributionMargin:  null,
  needsMapping:        true,
}

export function getMarginByAmount(amount: number): ProductMarginRule {
  return PRODUCT_MARGINS.find(r => r.expectedPrice === amount) ?? UNKNOWN_MARGIN
}
