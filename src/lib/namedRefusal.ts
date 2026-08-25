// Named-refusal guard for the LOCAL fallback path.
//
// netlify/functions/gieniu-command.js runs the same guard on every LLM answer,
// but resolveIntent() answers in the browser and never touches that function —
// which makes it the likeliest source of a contentless refusal, because the case
// that triggers it (the backend is unreachable) is exactly the case with the
// least data behind the answer.
//
// BARE_REFUSAL_RE is kept byte-identical to the copy in gieniu-command.js;
// src/lib/__tests__/namedRefusal.test.ts fails the build if the two ever drift.

/** Contentless refusal formulas. A refusal that already names a table, field or
 *  reason passes through untouched. */
export const BARE_REFUSAL_RE =
  /those particulars are not available|that information is not available|i lack the data|no data (?:is )?available|i (?:do not|don't) have (?:that|those|the) (?:information|particulars|details|data)(?![^.]*\b(?:for|in|from|about|because|since|on)\b)|not available to me(?!\s*[—,;:-]\s*\S)/i

/**
 * Any answer that tells the user something is missing — not just the contentless
 * formulas. resolveIntent's own "No data for today yet" is specific enough to
 * pass BARE_REFUSAL_RE, yet it still never mentions the reason it is answering
 * locally at all: the backend was unreachable. Those answers get the cause too.
 */
export const DEGRADED_RE =
  /\bno data\b|\bnot available\b|\bunavailable\b|did not load|could not load|\bbrak danych\b|\bnie ma danych\b|cannot be (?:determined|known|computed)/i

/** The slices of local state the fallback answers from. */
export interface LocalGapContext {
  perf?: unknown
  ads?: unknown[] | null
  trend?: unknown[] | null
  profitData?: { ok?: boolean } | null
  ordersData?: unknown
  today?: string
}

/** Names the local sources that are genuinely empty right now. */
export function localGaps(ctx: LocalGapContext): string[] {
  const today = ctx.today ?? 'today'
  const gaps: string[] = []
  if (!ctx.perf) gaps.push(`no daily-performance row loaded for ${today}`)
  if (!ctx.ads || ctx.ads.length === 0) gaps.push(`no Meta ad rows loaded for ${today}`)
  if (!ctx.trend || ctx.trend.length === 0) gaps.push('the daily trend is empty')
  if (!ctx.profitData?.ok) gaps.push('profit data did not load, so margin is unknown')
  if (!ctx.ordersData) gaps.push('orders data did not load')
  return gaps
}

/** "17:42" in Warsaw time, or null when nothing has loaded yet. */
export function loadedAtLabel(loadedAt: Date | null): string | null {
  if (!loadedAt) return null
  try {
    return loadedAt.toLocaleTimeString('pl-PL', { hour: '2-digit', minute: '2-digit', timeZone: 'Europe/Warsaw' })
  } catch {
    return null
  }
}

/**
 * Appends the reason whenever an offline answer admits to missing something.
 *
 * A complete answer built from loaded data is left alone — the numbers are just
 * as true whether the backend replied or not. But the moment the answer says
 * anything is absent, it must also say WHY it is degraded: no connection to
 * gieniu-command, answering from data loaded at <time>, plus the specific empty
 * sources when they can be worked out.
 */
export function enforceNamedRefusalLocal(
  text: string,
  ctx: LocalGapContext,
  loadedAt: Date | null,
): string {
  if (!text) return text
  if (!BARE_REFUSAL_RE.test(text) && !DEGRADED_RE.test(text)) return text

  const at = loadedAtLabel(loadedAt)
  const cause = at
    ? `nie mam połączenia z gieniu-command, odpowiadam z danych wczytanych o ${at}`
    : 'nie mam połączenia z gieniu-command, a żadne dane nie zdążyły się wczytać'

  const gaps = localGaps(ctx)
  const detail = gaps.length ? `${cause}. Brakuje: ${gaps.join('; ')}.` : `${cause}.`

  return `${text.trim()}\n\n${detail}`
}
