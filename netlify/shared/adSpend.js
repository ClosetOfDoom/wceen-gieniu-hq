// Which ad spend is allowed to be a denominator for Wix orders — one place.
//
// CPA and ROAS on this dashboard are "ad spend ÷ Wix orders" and "Wix revenue
// ÷ ad spend". Both are only meaningful if the spend is spend that could have
// produced a Wix order. Cogni's cannot: Cogni is sold through Stripe, so its
// revenue never appears in `orders`, and a złoty spent on a COGNI-* campaign
// divided into Wix orders is not a cost of acquiring them — it is a cost of
// acquiring something this system cannot see.
//
// It did not matter until COGNI-TEST-09.11 started on 2026-11-09. For the week
// 2026-11-06…12 the campaigns were:
//
//     PP-22.06.2026      3 754,50 zł   ÷ 87 orders = 43,16 zł   (amber)
//     COGNI-TEST-09.11     953,91 zł
//     both together      4 708,41 zł   ÷ 87 orders = 54,12 zł   (RED)
//
// Same shop, same orders, and a red alarm that was entirely Cogni's money.
//
// WSZTP is excluded from the PRODUCT side of the blended figures for the same
// reason (the camp is off the ad funnel); this is its mirror image on the SPEND
// side. Neither is "wrong" data — both are money that belongs to a different
// question than the one the blended figure answers — so neither is dropped:
// each is reported on its own line, by name.
//
// THIS FILE IS THE ONLY PLACE the rule lives. profit-data, the daily-spend
// endpoint, the weekly ops report, the campaign panel and Stanley all take
// their numbers from splitAdSpend(); nothing else compares a campaign name to
// a prefix, and assert:ad-spend-scope fails the build if anything does.

/**
 * Campaign-name prefix → scope. Case-insensitive; a hyphen or a space ends the
 * prefix, so "PP-22.06.2026" and "pp 22.06" are memory but "PPC-test" is not.
 *
 * Unrecognised names are 'unknown' and are NOT excluded: a new campaign stays
 * in the blended figures until somebody says otherwise, which is the behaviour
 * this dashboard had before Cogni existed.
 */
const PREFIXES = [
  [/^pp(?:[-\s]|$)/i,    'memory'],
  [/^3t(?:[-\s]|$)/i,    'language'],
  [/^cogni(?:[-\s]|$)/i, 'cogni'],
]

/** Every scope a campaign can have, in display order. */
export const AD_SCOPES = ['memory', 'language', 'cogni', 'unknown']

/**
 * Scopes whose spend is kept OUT of the Wix-blended figures.
 *
 * To exclude another funnel, add it here and give it a prefix above. Nothing
 * else needs to know.
 */
export const EXCLUDED_FROM_WIX_BLENDED = ['cogni']

/** What is missing, said the same way everywhere it is mentioned. */
export const EXCLUDED_GAP = {
  cogni: 'brak przychodu Stripe w bazie',
}

/** The one-line reason, for the reports. */
export const EXCLUDED_REASON = {
  cogni: 'przychód Cogni w Stripe, poza Stanleyem',
}

/**
 * The scope of a campaign, from its NAME.
 *
 * Falls back to the ad name only when the campaign name is empty, which is the
 * rule the campaign panel already used (`campaign_name || ad_name`).
 */
export function adScopeOf(campaignName, adName) {
  const name = String(campaignName ?? '').trim() || String(adName ?? '').trim()
  for (const [re, scope] of PREFIXES) if (re.test(name)) return scope
  return 'unknown'
}

export function isExcludedFromWixBlended(scope) {
  return EXCLUDED_FROM_WIX_BLENDED.includes(scope)
}

const cents = (n) => Math.round((Number(n) || 0) * 100)

/**
 * Split ad rows into the spend that is blended and the spend that is not.
 *
 * Works in whole grosze: Meta rows carry float noise (130.98000000000002), and
 * summing those directly drifts a cent off from the view that the dashboard has
 * always been reconciled against.
 *
 * @param {Array<{campaign_name?: string|null, ad_name?: string|null, spend?: number|string|null}>} rows
 * @returns {{
 *   total: number, blended: number, excluded: number,
 *   byScope: Record<string, number>,
 *   excludedCampaigns: Array<{campaign: string, scope: string, spend: number}>,
 * }}
 */
export function splitAdSpend(rows) {
  let blendedC = 0, excludedC = 0
  const byScopeC = {}
  const exclC = new Map()

  for (const r of rows ?? []) {
    const c = cents(r.spend)
    if (c === 0) continue
    const scope = adScopeOf(r.campaign_name, r.ad_name)
    byScopeC[scope] = (byScopeC[scope] ?? 0) + c
    if (isExcludedFromWixBlended(scope)) {
      excludedC += c
      const campaign = String(r.campaign_name ?? '').trim() || String(r.ad_name ?? '').trim() || '—'
      const e = exclC.get(campaign) ?? { campaign, scope, cents: 0 }
      e.cents += c
      exclC.set(campaign, e)
    } else {
      blendedC += c
    }
  }

  const byScope = {}
  for (const [k, v] of Object.entries(byScopeC)) byScope[k] = v / 100
  return {
    total: (blendedC + excludedC) / 100,
    blended: blendedC / 100,
    excluded: excludedC / 100,
    byScope,
    excludedCampaigns: [...exclC.values()]
      .sort((a, b) => b.cents - a.cents)
      .map(e => ({ campaign: e.campaign, scope: e.scope, spend: e.cents / 100 })),
  }
}

/**
 * The same split, one entry per Meta date, oldest first.
 *
 * `date` is Meta's own day (the ad account's timezone), exactly as
 * meta_ads_daily.date and v_daily_wix_meta_performance carry it.
 */
export function splitAdSpendByDay(rows) {
  const byDate = new Map()
  for (const r of rows ?? []) {
    if (!r.date) continue
    if (!byDate.has(r.date)) byDate.set(r.date, [])
    byDate.get(r.date).push(r)
  }
  return [...byDate.entries()]
    .sort((a, b) => a[0].localeCompare(b[0]))
    .map(([date, list]) => ({ date, ...splitAdSpend(list) }))
}

/** 953.91 → "953,91 zł" — the form the reports and Stanley both use. */
export function formatZl(n) {
  return `${Number(n ?? 0).toLocaleString('pl-PL', { minimumFractionDigits: 2, maximumFractionDigits: 2 })} zł`
}

/**
 * The report line for spend that was kept out, one per campaign. Empty when
 * nothing was excluded, so a range without Cogni says nothing about it.
 */
export function excludedSpendLines(split) {
  return (split?.excludedCampaigns ?? []).map(c =>
    `WYKLUCZONE z blended: ${c.campaign} — ${formatZl(c.spend)} `
    + `(${EXCLUDED_REASON[c.scope] ?? 'poza zasięgiem Stanleya'})`)
}

/**
 * What Stanley says when asked about CPA, ROAS or profit and some spend was
 * excluded. Names the gap instead of just reporting a smaller number.
 *
 * Accepts a full split, or just `{ excluded }` when the caller has the amount
 * but not the campaign names (a seven-day trend carries totals only) — then the
 * scope is named instead of the campaign.
 */
export function excludedSpendSentence(split) {
  const list = split?.excludedCampaigns ?? []
  const amount = Number(split?.excluded ?? list.reduce((t, c) => t + c.spend, 0)) || 0
  if (!(amount > 0)) return ''
  const what = list.length > 0
    ? list.map(c => `${c.campaign} (${formatZl(c.spend)})`).join(', ')
    : `kampanii ${EXCLUDED_FROM_WIX_BLENDED.map(x => x.toUpperCase()).join(', ')} (${formatZl(amount)})`
  const scopes = list.length > 0 ? [...new Set(list.map(c => c.scope))] : EXCLUDED_FROM_WIX_BLENDED
  const gaps = [...new Set(scopes.map(sc => EXCLUDED_GAP[sc]).filter(Boolean))].join('; ')
  return `CPA, ROAS i zysk są liczone BEZ wydatku ${what}: to kampania, której przychód `
    + 'nie przechodzi przez Wix, więc nie może być mianownikiem dla zamówień Wix. '
    + `Luka, której nie umiem zamknąć: ${gaps || 'brak przychodu w bazie'}.`
}

// ── Creative alarms: which campaigns' rows they may read ─────────────────────
//
// The creative alarms (top-spender CTR, frequency, click→checkout) have ONE set
// of thresholds each, in ALERT_RULES — and those thresholds were measured on PP
// (memory). Applying them to a campaign from another funnel is a verdict made
// with a yardstick that was never calibrated on it: Cogni's audience, offer and
// checkout (Stripe) differ, so a CTR floor taken from PP says nothing about it.
//
//   memory    thresholds exist                       → read
//   language  no creative thresholds exist (3T has CPA bands only) → not read
//   cogni     no thresholds, revenue outside Stanley  → not read
//   unknown   unrecognised name → NOT dropped: a new campaign keeps its alarms
//             until somebody says otherwise, and silencing what we cannot name
//             would hide exactly the campaign nobody is watching yet.
//
// The scope itself still comes from adScopeOf() above — this is only the list of
// scopes that have no creative thresholds. Nothing is deleted: rows that are not
// read are counted and reported by creativeAlarmRows().

/** Scopes with no creative-alarm thresholds of their own. */
export const CREATIVE_ALARM_EXCLUDED_SCOPES = ['cogni', 'language']

/** Said the same way on the dashboard and in the report. */
export const CREATIVE_ALARM_NOTE = 'Alarmy kreacji: tylko kampanie z progami (Cogni poza progami)'

/**
 * The ad-day rows a creative alarm may read, and what was left out.
 *
 * @param {Array<{campaign_name?: string|null, ad_name?: string|null}>} adDays
 * @returns {{ rows: Array, leftOut: Record<string, number> }}  leftOut: scope → rows
 */
export function creativeAlarmRows(adDays) {
  const rows = []
  const leftOut = {}
  for (const r of adDays ?? []) {
    const scope = adScopeOf(r.campaign_name, r.ad_name)
    if (CREATIVE_ALARM_EXCLUDED_SCOPES.includes(scope)) leftOut[scope] = (leftOut[scope] ?? 0) + 1
    else rows.push(r)
  }
  return { rows, leftOut }
}
