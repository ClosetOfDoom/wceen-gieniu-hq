// Ad-spend scope and the Wix-blended split, for app code.
//
// Not a second implementation — the import path. The rule lives in
// netlify/shared/adSpend.js because profit-data, the daily-spend endpoint and
// gieniu-command need it server-side too. Same arrangement as alerts.ts and
// businessDay.ts.
export {
  AD_SCOPES,
  EXCLUDED_FROM_WIX_BLENDED,
  EXCLUDED_GAP,
  EXCLUDED_REASON,
  adScopeOf,
  isExcludedFromWixBlended,
  splitAdSpend,
  splitAdSpendByDay,
  formatZl,
  excludedSpendLines,
  excludedSpendSentence,
} from '../../netlify/shared/adSpend.js'
import type { ExcludedCampaign } from '../../netlify/shared/adSpend.js'
export type {
  AdScope, AdSpendRow, AdSpendSplit, ExcludedCampaign,
} from '../../netlify/shared/adSpend.js'

/**
 * What Meta actually spent on a day (or range) row: blended + excluded.
 *
 * `meta_spend` on a DailyPerformance row is BLENDED — right for anything
 * divided into Wix orders, wrong for anything about delivery. CPC and CPM are
 * spend per click and per impression, and the clicks and impressions on the
 * row include Cogni's, so they need the matching total. Without this a
 * Cogni-heavy day would show a CPC that is too low by exactly the Cogni share.
 */
export function totalSpendOf(row: { meta_spend?: number | null; meta_spend_excluded?: number | null }): number {
  return (row.meta_spend ?? 0) + (row.meta_spend_excluded ?? 0)
}

type DayBlend = {
  date: string
  blended: number
  excluded: number
  excludedCampaigns: ExcludedCampaign[]
}

type OverlayRow = {
  date: string
  meta_spend: number
  wix_orders?: number | null
  wix_revenue?: number | null
}

/**
 * Put splitAdSpendByDay()'s numbers onto the view's daily rows, row by row.
 *
 * The one place a daily row's meta_spend becomes blended. data.ts (the app) and
 * the report harness both call it with what /spend-split returned, so neither
 * carries its own copy of the formulas. `days === null` means the split could
 * not be fetched: rows are returned marked 'unavailable', which is NOT the same
 * as "nothing was excluded".
 */
export function applySpendSplit<T extends OverlayRow>(
  rows: T[],
  days: Map<string, DayBlend> | null,
): Array<T & {
  meta_spend_excluded?: number
  meta_spend_excluded_campaigns?: ExcludedCampaign[]
  spend_split: 'applied' | 'unavailable'
}> {
  if (!days) return rows.map(r => ({ ...r, spend_split: 'unavailable' as const }))
  return rows.map(r => {
    // A date with no ad rows had no spend. The view agrees: its meta CTE is
    // built from the same table.
    const d = days.get(r.date)
    const blended = d?.blended ?? 0
    const orders = Number(r.wix_orders ?? 0)
    const revenue = Number(r.wix_revenue ?? 0)
    return {
      ...r,
      meta_spend: blended,
      meta_spend_excluded: d?.excluded ?? 0,
      meta_spend_excluded_campaigns: d?.excludedCampaigns ?? [],
      spend_split: 'applied' as const,
      // The view computed these from the TOTAL. Same formulas, same rounding,
      // blended denominator.
      real_cpa: orders > 0 ? Math.round((blended / orders) * 100) / 100 : null,
      real_roas: blended > 0 ? Math.round((revenue / blended) * 100) / 100 : 0,
    }
  })
}
