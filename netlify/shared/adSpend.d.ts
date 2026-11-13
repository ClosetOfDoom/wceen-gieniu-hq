export type AdScope = 'memory' | 'language' | 'cogni' | 'unknown'

export const AD_SCOPES: AdScope[]
/** Scopes whose spend is kept OUT of the Wix-blended CPA / ROAS / profit. */
export const EXCLUDED_FROM_WIX_BLENDED: AdScope[]
export const EXCLUDED_GAP: Partial<Record<AdScope, string>>
export const EXCLUDED_REASON: Partial<Record<AdScope, string>>

export function adScopeOf(campaignName?: string | null, adName?: string | null): AdScope
export function isExcludedFromWixBlended(scope: AdScope | string): boolean

export interface AdSpendRow {
  campaign_name?: string | null
  ad_name?: string | null
  spend?: number | string | null
  date?: string | null
}

export interface ExcludedCampaign { campaign: string; scope: AdScope; spend: number }

export interface AdSpendSplit {
  /** Everything Meta spent. */
  total: number
  /** The part allowed to be a denominator for Wix orders. */
  blended: number
  /** The part kept out (Cogni). total = blended + excluded, to the grosz. */
  excluded: number
  byScope: Partial<Record<AdScope, number>>
  excludedCampaigns: ExcludedCampaign[]
}

export function splitAdSpend(rows: AdSpendRow[] | null | undefined): AdSpendSplit
export function splitAdSpendByDay(rows: AdSpendRow[] | null | undefined): Array<AdSpendSplit & { date: string }>
export function formatZl(n: number | null | undefined): string
export function excludedSpendLines(split: AdSpendSplit | null | undefined): string[]
export function excludedSpendSentence(split: AdSpendSplit | null | undefined): string
