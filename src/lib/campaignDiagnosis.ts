import type { MetaAdDaily } from '../services/data'
import { bustUrl } from '../utils/cacheBust'

// ── Types ─────────────────────────────────────────────────────────────────────

export type CampaignScope = 'JSU' | 'JZK' | 'ALL'
export type CampaignStatus = 'efficient' | 'expensive' | 'zero-attribution' | 'needs-watch' | 'unclassified'

export interface CampaignEntry {
  campaign_id: string
  campaign_name: string
  ad_name: string        // ad_name when available, falls back to campaign_name
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
  // Language funnel (JZK scope): Językozak AI + the 3T-TRIPWIRE language tripwire
  // ("3 Zadziwiające Techniki Nauki Języków"). Prefix/pattern based so new
  // creatives (3T-*, JZK-*) are picked up without a hardcoded name list.
  const jzkPatterns = [
    'jezykozak', 'jzk', 'language', 'jezyk', 'nauka jezykow', 'nauka jezyk',
    '3t', 'tripwire', 'zadziwiajace', 'techniki nauki',
  ]
  if (/(?:^| )3t(?:$| |-)/.test(n) || jzkPatterns.some(p => n.includes(p))) return 'JZK'
  // Memory funnel (JSU/Memory scope): Pakiet Pamięciowy + JSU course. PP-* prefix.
  const jsuPatterns = ['pamiec', 'memory', 'pakiet pamiec', 'jsu', 'jak sie uczyc']
  if (/(?:^| )pp(?:$| |-)/.test(n) || jsuPatterns.some(p => n.includes(p))) return 'JSU'
  return 'ALL'
}

// ── Status classifier ─────────────────────────────────────────────────────────

function classifyStatus(
  spend: number,
  purchases: number,
  metaCpa: number | null,
  spendShare: number,
  scope: CampaignScope = 'ALL',
): CampaignStatus {
  if (spend > 10 && purchases === 0) return 'zero-attribution'
  if (purchases > 0 && metaCpa !== null) {
    // Efficient/expensive boundary = the scope's CPA alarm, not PP's 50 for all.
    // Language (PL/JZK) alarms at ~35; Memory (PP) alarms at ~50.
    const alarmCpa = scope === 'JZK' ? 35 : 50
    if (metaCpa < alarmCpa) return 'efficient'
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
  const totalPurchases = allRows.reduce((s, r) => s + (r.meta_purchases ?? r.purchases ?? 0), 0)

  // Build all entries
  const allEntries: CampaignEntry[] = allRows.map(r => {
    const spend     = r.spend     ?? 0
    const purchases = r.meta_purchases ?? r.purchases ?? 0
    const lc  = r.link_clicks ?? 0
    const imp = r.impressions ?? 0
    const ctr = r.ctr ?? (lc > 0 && imp > 0 ? (lc / imp) * 100 : null)
    const cpc = r.cpc ?? (lc > 0 && spend > 0 ? spend / lc : null)
    const metaCpa    = purchases > 0 ? spend / purchases : null
    const spendShare = totalSpend > 0 ? spend / totalSpend : 0
    const purchaseShare = totalPurchases > 0 ? purchases / totalPurchases : 0
    const campaignName = r.campaign_name ?? r.campaign_id ?? '?'
    const adName = r.ad_name && r.ad_name !== r.campaign_name ? r.ad_name : campaignName
    // Scope from ad AND campaign name (a 3T ad may sit under a language campaign).
    const scope = classifyCampaignScope(`${r.ad_name ?? ''} ${r.campaign_name ?? ''}`)
    return {
      campaign_id:        r.campaign_id    ?? '',
      campaign_name:      campaignName,
      ad_name:            adName,
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
      scope,
      status:            classifyStatus(spend, purchases, metaCpa, spendShare, scope),
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
      lines.push(`Best: "${bestCampaign.ad_name}" — ${bestCampaign.purchases} purchases at ${(bestCampaign.metaCpa ?? 0).toFixed(0)} PLN CPA.`)
    }
    if (worstCampaign && worstCampaign !== bestCampaign) {
      lines.push(`Most expensive: "${worstCampaign.ad_name}" — CPA ${(worstCampaign.metaCpa ?? 0).toFixed(0)} PLN.`)
    }
    if (zeroAttribution.length > 0) {
      lines.push(`Zero-attribution: ${zeroAttribution.map(e => `"${e.ad_name}"`).join(', ')} — spending ${zeroAttribution.reduce((s, e) => s + e.spend, 0).toFixed(0)} PLN with 0 Meta purchases.`)
    }
    if (totPurch === 0 && totSpend > 0) {
      lines.push(`Meta has spend rows but reports zero purchases. This is zero-attribution, not missing data.`)
      lines.push(`Ranked by spend: ${filtered.slice(0, 3).map(e => `"${e.ad_name}" (${e.spend.toFixed(0)} PLN)`).join(', ')}.`)
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
  fetchError: string | null  // null = success or empty; non-null = network/auth error
  datesPresent?: string[]     // real dates in the data (range mode) — fixes header mismatch
  rangeFrom?: string
  rangeTo?: string
}

// Pass { from, to } (Warsaw YYYY-MM-DD) to aggregate a range per creative; omit
// for the legacy today/latest single-day behaviour.
export async function fetchCampaignRows(range?: { from: string; to: string }): Promise<CampaignFetchResult> {
  const today = new Date().toLocaleDateString('en-CA', { timeZone: 'Europe/Warsaw' })
  const empty: CampaignFetchResult = {
    rows: [], usedDate: '', requestedDate: today,
    aggregateMetaSpendExists: false, aggregateLatestDate: null,
    aggregateSpendTotal: 0, sourceMismatch: false, sourceMismatchExplanation: null,
    fetchError: null,
  }

  try {
    const base = range
      ? `/.netlify/functions/campaign-data?from=${range.from}&to=${range.to}`
      : '/.netlify/functions/campaign-data'
    const res = await fetch(bustUrl(base), {
      headers: { Accept: 'application/json', 'Cache-Control': 'no-store' },
    })
    if (!res.ok) {
      const errMsg = `HTTP ${res.status}`
      console.warn('campaign-data HTTP error:', errMsg)
      return { ...empty, fetchError: errMsg }
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
      datesPresent?: string[]
      rangeFrom?: string
      rangeTo?: string
      errors?: { meta_ads_daily?: string | null; v_daily_wix_meta_performance?: string | null }
    }
    if (!json.ok) {
      console.warn('campaign-data returned ok=false')
      return { ...empty, fetchError: 'Backend returned ok: false' }
    }
    // Surface a silent DB error (e.g. column not found in meta_ads_daily)
    const dbError = json.errors?.meta_ads_daily ?? null
    if (dbError) {
      console.warn('campaign-data meta_ads_daily error:', dbError)
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
      datesPresent:              json.datesPresent,
      rangeFrom:                 json.rangeFrom,
      rangeTo:                   json.rangeTo,
      fetchError:                (json.rows ?? []).length === 0 && dbError ? dbError : null,
    }
  } catch (e) {
    const errMsg = e instanceof Error ? e.message : String(e)
    console.warn('fetchCampaignRows backend error:', errMsg)
    return { ...empty, fetchError: errMsg }
  }
}
