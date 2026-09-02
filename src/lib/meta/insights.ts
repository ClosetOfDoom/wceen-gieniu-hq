// Meta Ads Insights → Supabase. THE single source of Meta ingest logic.
//
// The daily/intraday ingest ran in Make (Facebook Insights → HTTP → Supabase
// REST). This module replaces the API half of that. Both callers — the backfill
// CLI (scripts/meta-backfill.ts) and the scheduled function
// (netlify/functions/meta-daily-ingest.ts) — MUST import from here. No second
// copy of this logic anywhere in the repo.
//
// Target table: meta_ads_daily (existing — nothing new is created).
// Grain: one row per ad per day, matching what the Make "Daily" scenario writes.
//
// No mocks, no empty-array fallbacks: every failure throws, so a broken ingest
// is loud in the logs rather than silently writing nothing.

// ── configuration ───────────────────────────────────────────────────────────

/**
 * Graph API version. NOT verified against Meta's current release — this
 * environment has no access to Meta's docs or API, so the default is a version
 * known to exist rather than a confirmed "latest stable". Override with
 * META_GRAPH_VERSION once the current one is confirmed.
 */
const DEFAULT_GRAPH_VERSION = 'v21.0'

export interface MetaConfig {
  accessToken: string
  adAccountId: string
  graphVersion: string
  supabaseUrl: string
  serviceRoleKey: string
}

function required(name: string, value: string | undefined): string {
  if (!value || !value.trim()) {
    throw new Error(
      `Missing environment variable ${name}. Meta ingest cannot run without it.`,
    )
  }
  return value.trim()
}

/**
 * Reads config from the environment, using the variable names already in this
 * repo. The environment is passed in rather than read from `process` so this
 * module stays free of Node globals — it is typechecked as part of `src/`,
 * which has no @types/node, and staying pure keeps it testable.
 */
export type Env = Record<string, string | undefined>

export function loadConfig(env: Env): MetaConfig {
  const account = required('META_AD_ACCOUNT_ID', env.META_AD_ACCOUNT_ID)
  return {
    accessToken: required('META_ACCESS_TOKEN', env.META_ACCESS_TOKEN),
    // Graph wants the act_ prefix; accept the id with or without it.
    adAccountId: account.startsWith('act_') ? account : `act_${account}`,
    graphVersion: env.META_GRAPH_VERSION?.trim() || DEFAULT_GRAPH_VERSION,
    supabaseUrl: required('SUPABASE_URL', env.SUPABASE_URL),
    serviceRoleKey: required('SUPABASE_SERVICE_ROLE_KEY', env.SUPABASE_SERVICE_ROLE_KEY),
  }
}

// ── Graph API types ─────────────────────────────────────────────────────────

interface MetaAction {
  action_type: string
  value: string
}

export interface MetaInsightRow {
  date_start: string
  campaign_id?: string
  campaign_name?: string
  adset_id?: string
  adset_name?: string
  ad_id?: string
  ad_name?: string
  spend?: string
  impressions?: string
  clicks?: string
  reach?: string
  actions?: MetaAction[]
  action_values?: MetaAction[]
}

/** Row shape written to meta_ads_daily. Only columns that exist in the table. */
export interface MetaAdsDailyRow {
  date: string
  campaign_id: string | null
  campaign_name: string | null
  adset_id: string | null
  adset_name: string | null
  ad_id: string | null
  ad_name: string | null
  spend: number
  impressions: number
  clicks: number
  link_clicks: number
  meta_purchases: number
  meta_purchase_value: number
}

export const INSIGHT_FIELDS = [
  'date_start',
  'campaign_id',
  'campaign_name',
  'adset_id',
  'adset_name',
  'ad_id',
  'ad_name',
  'spend',
  'impressions',
  'clicks',
  'reach',
  'actions',
  'action_values',
] as const

/** The row key the upsert conflicts on. Requires a matching UNIQUE constraint. */
export const CONFLICT_TARGET = 'date,ad_id'

// ── rate limiting ───────────────────────────────────────────────────────────

/**
 * Meta rate-limit error codes:
 *   4   — application request limit reached
 *   17  — user request limit reached
 *   613 — calls to this api have exceeded the rate limit
 * Everything else is a real error and is rethrown immediately.
 */
const RATE_LIMIT_CODES = new Set([4, 17, 613])
const MAX_RETRIES = 5

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms))

export class MetaApiError extends Error {
  constructor(
    message: string,
    readonly code: number | null,
    readonly status: number,
    readonly body: string,
  ) {
    super(message)
    this.name = 'MetaApiError'
  }
}

/** One GET with backoff on rate-limit codes only. Throws on anything else. */
async function graphGet(url: string): Promise<Record<string, unknown>> {
  let attempt = 0
  for (;;) {
    const res = await fetch(url)
    const text = await res.text()

    let json: Record<string, unknown>
    try {
      json = JSON.parse(text) as Record<string, unknown>
    } catch {
      throw new MetaApiError(`Graph API returned non-JSON (HTTP ${res.status})`, null, res.status, text.slice(0, 500))
    }

    const err = json.error as { code?: number; message?: string } | undefined
    if (!res.ok || err) {
      const code = typeof err?.code === 'number' ? err.code : null
      const message = err?.message ?? `HTTP ${res.status}`

      if (code !== null && RATE_LIMIT_CODES.has(code) && attempt < MAX_RETRIES) {
        // 2s, 4s, 8s, 16s, 32s — Meta's limits are per-hour, so this only rides
        // out short bursts; a sustained limit still fails loudly.
        const wait = 2000 * 2 ** attempt
        attempt++
        console.warn(`[meta] rate limit (code ${code}), retry ${attempt}/${MAX_RETRIES} in ${wait}ms`)
        await sleep(wait)
        continue
      }

      throw new MetaApiError(`Graph API error: ${message}`, code, res.status, text.slice(0, 500))
    }

    return json
  }
}

// ── fetching ────────────────────────────────────────────────────────────────

/**
 * Every insight row for [since, until] at ad level, one row per ad per day,
 * following paging.next to the end.
 */
export async function fetchInsights(
  cfg: MetaConfig,
  since: string,
  until: string,
): Promise<MetaInsightRow[]> {
  const url = new URL(`https://graph.facebook.com/${cfg.graphVersion}/${cfg.adAccountId}/insights`)
  url.searchParams.set('level', 'ad')
  url.searchParams.set('time_increment', '1')
  url.searchParams.set('time_range', JSON.stringify({ since, until }))
  url.searchParams.set('fields', INSIGHT_FIELDS.join(','))
  url.searchParams.set('limit', '200')
  url.searchParams.set('access_token', cfg.accessToken)

  const out: MetaInsightRow[] = []
  let next: string | null = url.toString()
  let page = 0

  while (next) {
    const json = await graphGet(next)
    const data = json.data
    if (!Array.isArray(data)) {
      throw new MetaApiError('Graph API response has no data array', null, 200, JSON.stringify(json).slice(0, 500))
    }
    out.push(...(data as MetaInsightRow[]))
    page++

    const paging = json.paging as { next?: string } | undefined
    next = paging?.next ?? null
    if (next) console.log(`[meta] page ${page} → ${out.length} rows so far, following paging.next`)
  }

  return out
}

// ── mapping ─────────────────────────────────────────────────────────────────

const num = (v: string | undefined): number => {
  if (v == null || v === '') return 0
  const n = Number(v)
  return Number.isFinite(n) ? n : 0
}

/** Purchase action types Meta reports; the pixel one is what the Wix store fires. */
const PURCHASE_TYPES = new Set(['purchase', 'offsite_conversion.fb_pixel_purchase'])

function sumActions(actions: MetaAction[] | undefined, match: (t: string) => boolean): number {
  if (!Array.isArray(actions)) return 0
  let total = 0
  for (const a of actions) {
    if (match(a.action_type)) total += num(a.value)
  }
  return total
}

/**
 * Meta insight row → meta_ads_daily row.
 *
 * `date` takes date_start: at ad level with time_increment=1 each row already
 * carries its own day, so there is no ambiguity to resolve here. (The Make
 * INTRADAY scenario deliberately overrides this with the Warsaw date — that
 * scenario is campaign-level and is not what this module replaces.)
 *
 * Deliberately NOT written: ctr, cpc, cpm, engine, raw_payload. They exist on
 * the table but the requested field set does not produce them, and filling them
 * with zeros would be inventing data. On upsert PostgREST only touches the
 * columns present in the payload, so existing values are left alone.
 * `reach` is fetched per the spec but has no column to land in.
 */
export function mapInsightRow(r: MetaInsightRow): MetaAdsDailyRow {
  return {
    date: r.date_start,
    campaign_id: r.campaign_id ?? null,
    campaign_name: r.campaign_name ?? null,
    adset_id: r.adset_id ?? null,
    adset_name: r.adset_name ?? null,
    ad_id: r.ad_id ?? null,
    ad_name: r.ad_name ?? null,
    spend: num(r.spend),
    impressions: num(r.impressions),
    clicks: num(r.clicks),
    link_clicks: sumActions(r.actions, (t) => t === 'link_click'),
    meta_purchases: sumActions(r.actions, (t) => PURCHASE_TYPES.has(t)),
    meta_purchase_value: sumActions(r.action_values, (t) => PURCHASE_TYPES.has(t)),
  }
}

// ── upsert ──────────────────────────────────────────────────────────────────

const UPSERT_CHUNK = 500

/**
 * Upsert into meta_ads_daily on (date, ad_id).
 *
 * Requires a UNIQUE constraint on those two columns — without it PostgREST
 * fails with 42P10 rather than silently inserting duplicates, which is the
 * behaviour we want. See supabase/migrations/add_meta_ads_daily_unique.sql.
 *
 * Rows with no ad_id are refused: they cannot participate in the conflict key,
 * so they would insert a fresh duplicate on every run.
 */
export async function upsertRows(cfg: MetaConfig, rows: MetaAdsDailyRow[]): Promise<number> {
  if (rows.length === 0) return 0

  const bad = rows.filter((r) => !r.ad_id || !r.date)
  if (bad.length > 0) {
    throw new Error(
      `${bad.length} row(s) missing date or ad_id — refusing to upsert, they would duplicate on every run.`,
    )
  }

  let written = 0
  for (let i = 0; i < rows.length; i += UPSERT_CHUNK) {
    const chunk = rows.slice(i, i + UPSERT_CHUNK)
    const res = await fetch(
      `${cfg.supabaseUrl}/rest/v1/meta_ads_daily?on_conflict=${CONFLICT_TARGET}`,
      {
        method: 'POST',
        headers: {
          apikey: cfg.serviceRoleKey,
          Authorization: `Bearer ${cfg.serviceRoleKey}`,
          'Content-Type': 'application/json',
          Prefer: 'resolution=merge-duplicates,return=minimal',
        },
        body: JSON.stringify(chunk),
      },
    )

    if (!res.ok) {
      const body = await res.text().catch(() => '')
      throw new Error(`Supabase upsert failed (HTTP ${res.status}) on ${chunk.length} rows: ${body.slice(0, 500)}`)
    }
    written += chunk.length
  }

  return written
}

// ── one day, end to end ─────────────────────────────────────────────────────

export interface IngestDayResult {
  day: string
  fetched: number
  written: number
}

/** Fetch and upsert a single day. Throws on any API or database failure. */
export async function ingestDay(cfg: MetaConfig, day: string): Promise<IngestDayResult> {
  const insights = await fetchInsights(cfg, day, day)
  const rows = insights.map(mapInsightRow)
  const written = await upsertRows(cfg, rows)
  return { day, fetched: insights.length, written }
}

/** Inclusive list of YYYY-MM-DD days between two dates. */
export function eachDay(from: string, to: string): string[] {
  const start = Date.parse(`${from}T12:00:00Z`)
  const end = Date.parse(`${to}T12:00:00Z`)
  if (!Number.isFinite(start) || !Number.isFinite(end)) {
    throw new Error(`Invalid date range: ${from} → ${to} (expected YYYY-MM-DD)`)
  }
  if (start > end) throw new Error(`Range is backwards: ${from} is after ${to}`)

  const days: string[] = []
  for (let t = start; t <= end; t += 86_400_000) {
    days.push(new Date(t).toISOString().slice(0, 10))
  }
  return days
}
