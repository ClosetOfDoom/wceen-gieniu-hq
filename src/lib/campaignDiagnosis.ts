import type { MetaAdDaily } from '../services/data'

// ── Types ─────────────────────────────────────────────────────────────────────

export type CampaignScope = 'JSU' | 'JZK' | 'ALL'
export type CampaignStatus = 'efficient' | 'expensive' | 'zero-attribution' | 'needs-watch' | 'unclassified'

export interface CampaignEntry {
  campaign_id: string
  campaign_name: string
  date: string
  spend: number
  purchases: number
  metaPurchaseValue: number
  impressions: number
  clicks: number
  linkClicks: number
  ctr: number | null
  cpc: number | null
  cpm: number | null
  metaCpa: number | null
  scope: CampaignScope
  status: CampaignStatus
  spendShare: number
  purchaseShare: number
}

export interface CampaignTotals {
  spend: number
  purchases: number
  metaPurchaseValue: number
  metaCpa: number | null
  impressions: number
  linkClicks: number
}

export interface CampaignDiagnosis {
  requestedDate: string
  usedDate: string
  isStale: boolean
  scope: CampaignScope
  rowCount: number
  allRowCount: number
  campaigns: CampaignEntry[]
  totals: CampaignTotals
  bestCampaign: CampaignEntry | null
  worstCampaign: CampaignEntry | null
  zeroAttribution: CampaignEntry[]
  diagnosisText: string
}

// ── Scope classifier ──────────────────────────────────────────────────────────

function normalizeForMatch(s: string): string {
  return s.toLowerCase()
    .replace(/ą/g, 'a').replace(/ę/g, 'e').replace(/ó/g, 'o')
    .replace(/ś/g, 's').replace(/ź/g, 'z').replace(/ż/g, 'z')
    .replace(/ć/g, 'c').replace(/ń/g, 'n').replace(/ł/g, 'l')
    .replace(/[^a-z0-9 ]/g, ' ')
}

export function classifyCampaignScope(name: string): CampaignScope {
  const n = normalizeForMatch(name)
  // JZK patterns first (language webinar)
  const jzkPatterns = ['jezykozak', 'jzk', 'language', 'jezyk', 'nauka jezykow', 'nauka jezyk']
  if (jzkPatterns.some(p => n.includes(p))) return 'JZK'
  // JSU patterns (memory course)
  const jsuPatterns = ['pamiec', 'memory', 'pakiet pamiec', 'jsu', 'jak sie uczyc']
  if (jsuPatterns.some(p => n.includes(p))) return 'JSU'
  if (/(?:^| )pp(?:$| )/.test(n)) return 'JSU'  // "pp" = Pakiet Pamięciowy
  return 'ALL'
}

// ── Status classifier ─────────────────────────────────────────────────────────

function classifyStatus(
  spend: number,
  purchases: number,
  metaCpa: number | null,
  spendShare: number,
): CampaignStatus {
  if (spend > 10 && purchases === 0) return 'zero-attribution'
  if (purchases > 0 && metaCpa !== null) {
    if (metaCpa < 50) return 'efficient'
    return 'expensive'
  }
  if (spendShare > 0.60) return 'needs-watch'
  return 'unclassified'
}

// ── Pure builder ──────────────────────────────────────────────────────────────

export function buildCampaignDiagnosis(
  allRows: MetaAdDaily[],
  scope: CampaignScope,
  requestedDate: string,
  usedDate: string,
): CampaignDiagnosis {
  const today = new Date().toLocaleDateString('en-CA', { timeZone: 'Europe/Warsaw' })
  const isStale = usedDate !== '' && usedDate < (requestedDate || today)

  const totalSpend     = allRows.reduce((s, r) => s + (r.spend ?? 0), 0)
  const totalPurchases = allRows.reduce((s, r) => s + (r.purchases ?? 0), 0)

  // Build all entries
  const allEntries: CampaignEntry[] = allRows.map(r => {
    const spend     = r.spend     ?? 0
    const purchases = r.purchases ?? 0
    const ctr = r.ctr ?? (r.link_clicks > 0 && r.impressions > 0 ? (r.link_clicks / r.impressions) * 100 : null)
    const cpc = r.cpc ?? (r.link_clicks > 0 && spend > 0 ? spend / r.link_clicks : null)
    const metaCpa    = purchases > 0 ? spend / purchases : null
    const spendShare = totalSpend > 0 ? spend / totalSpend : 0
    const purchaseShare = totalPurchases > 0 ? purchases / totalPurchases : 0
    return {
      campaign_id:        r.campaign_id    ?? '',
      campaign_name:      r.campaign_name  ?? r.campaign_id ?? '?',
      date:               r.date           ?? usedDate,
      spend,
      purchases,
      metaPurchaseValue:  r.meta_purchase_value ?? 0,
      impressions:        r.impressions    ?? 0,
      clicks:             r.clicks         ?? 0,
      linkClicks:         r.link_clicks    ?? 0,
      ctr,
      cpc,
      cpm:               r.cpm            ?? null,
      metaCpa,
      scope:             classifyCampaignScope(r.campaign_name ?? ''),
      status:            classifyStatus(spend, purchases, metaCpa, spendShare),
      spendShare,
      purchaseShare,
    }
  })

  // Filter by scope (unclassified 'ALL' entries are included in every view)
  const filtered = scope === 'ALL'
    ? allEntries
    : allEntries.filter(e => e.scope === scope || e.scope === 'ALL')

  const withPurchases = filtered.filter(e => e.purchases > 0 && e.spend > 0)
  const bestCampaign  = withPurchases.length > 0
    ? withPurchases.reduce((best, curr) => (curr.metaCpa ?? Infinity) < (best.metaCpa ?? Infinity) ? curr : best)
    : null
  const worstCampaign = withPurchases.length > 1
    ? withPurchases.reduce((worst, curr) => (curr.metaCpa ?? 0) > (worst.metaCpa ?? 0) ? curr : worst)
    : null
  const zeroAttribution = filtered.filter(e => e.status === 'zero-attribution')

  const totSpend    = filtered.reduce((s, e) => s + e.spend, 0)
  const totPurch    = filtered.reduce((s, e) => s + e.purchases, 0)
  const totValue    = filtered.reduce((s, e) => s + e.metaPurchaseValue, 0)
  const totImpress  = filtered.reduce((s, e) => s + e.impressions, 0)
  const totClicks   = filtered.reduce((s, e) => s + e.linkClicks, 0)

  const totals: CampaignTotals = {
    spend:              totSpend,
    purchases:          totPurch,
    metaPurchaseValue:  totValue,
    metaCpa:            totPurch > 0 ? totSpend / totPurch : null,
    impressions:        totImpress,
    linkClicks:         totClicks,
  }

  // Diagnosis text
  const lines: string[] = []
  if (filtered.length === 0) {
    lines.push('No Meta campaign rows found in meta_ads_daily.')
    lines.push(`latestMetaDate: none  rowCount: 0`)
  } else {
    if (isStale) lines.push(`Today's Meta campaign rows are not in yet. Showing latest available data from ${usedDate}.`)
    if (bestCampaign) {
      lines.push(`Best: "${bestCampaign.campaign_name}" — ${bestCampaign.purchases} purchases at ${(bestCampaign.metaCpa ?? 0).toFixed(0)} PLN CPA.`)
    }
    if (worstCampaign && worstCampaign !== bestCampaign) {
      lines.push(`Most expensive: "${worstCampaign.campaign_name}" — CPA ${(worstCampaign.metaCpa ?? 0).toFixed(0)} PLN.`)
    }
    if (zeroAttribution.length > 0) {
      lines.push(`Zero-attribution: ${zeroAttribution.map(e => `"${e.campaign_name}"`).join(', ')} — spending ${zeroAttribution.reduce((s, e) => s + e.spend, 0).toFixed(0)} PLN with 0 Meta purchases.`)
    }
    if (totPurch === 0 && totSpend > 0) {
      lines.push(`Meta has spend rows but reports zero purchases. This is zero-attribution, not missing data.`)
      lines.push(`Ranked by spend: ${filtered.slice(0, 3).map(e => `"${e.campaign_name}" (${e.spend.toFixed(0)} PLN)`).join(', ')}.`)
    }
    if (totPurch > 0) {
      lines.push(`Total: ${totSpend.toFixed(0)} PLN spend, ${totPurch} Meta purchases, avg CPA ${(totals.metaCpa ?? 0).toFixed(0)} PLN.`)
    }
  }

  return {
    requestedDate: requestedDate || today,
    usedDate,
    isStale,
    scope,
    rowCount: filtered.length,
    allRowCount: allEntries.length,
    campaigns: filtered,
    totals,
    bestCampaign,
    worstCampaign,
    zeroAttribution,
    diagnosisText: lines.join('\n'),
  }
}

// ── Async fetcher (backend, service role) ─────────────────────────────────────
// Uses /.netlify/functions/campaign-data so the anon key RLS restriction on
// meta_ads_daily does not affect Campaigns page.

export interface CampaignFetchResult {
  rows: MetaAdDaily[]
  usedDate: string
  requestedDate: string
  aggregateMetaSpendExists: boolean
  aggregateLatestDate: string | null
  aggregateSpendTotal: number
  sourceMismatch: boolean
  sourceMismatchExplanation: string | null
}

export async function fetchCampaignRows(): Promise<CampaignFetchResult> {
  const today = new Date().toLocaleDateString('en-CA', { timeZone: 'Europe/Warsaw' })
  const empty: CampaignFetchResult = {
    rows: [], usedDate: '', requestedDate: today,
    aggregateMetaSpendExists: false, aggregateLatestDate: null,
    aggregateSpendTotal: 0, sourceMismatch: false, sourceMismatchExplanation: null,
  }

  try {
    const res = await fetch('/.netlify/functions/campaign-data', {
      headers: { Accept: 'application/json' },
    })
    if (!res.ok) {
      console.warn('campaign-data HTTP error:', res.status)
      return empty
    }
    const json = await res.json() as {
      ok: boolean
      rows: MetaAdDaily[]
      usedDate: string
      requestedDate: string
      aggregateMetaSpendExists: boolean
      aggregateLatestDate: string | null
      aggregateSpendTotal: number
      sourceMismatch: boolean
      sourceMismatchExplanation: string | null
    }
    if (!json.ok) {
      console.warn('campaign-data returned ok=false')
      return empty
    }
    return {
      rows:                      json.rows ?? [],
      usedDate:                  json.usedDate ?? '',
      requestedDate:             json.requestedDate ?? today,
      aggregateMetaSpendExists:  json.aggregateMetaSpendExists ?? false,
      aggregateLatestDate:       json.aggregateLatestDate ?? null,
      aggregateSpendTotal:       json.aggregateSpendTotal ?? 0,
      sourceMismatch:            json.sourceMismatch ?? false,
      sourceMismatchExplanation: json.sourceMismatchExplanation ?? null,
    }
  } catch (e) {
    console.warn('fetchCampaignRows backend error:', e)
    return empty
  }
}
