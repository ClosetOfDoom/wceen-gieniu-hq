// Client of stanley-brief (the 09:00 brief) — behind the shared password.
import { stanleyFetch } from '../lib/stanleyAuth'

export interface BriefSection { id: string; title: string; lines: string[] }
export interface DailyBrief {
  date: string
  /** 'en' for briefs written since Stanley's output became English-only; older saved briefs have none (Polish). */
  lang?: string
  createdAt: string
  title: string
  intro: string | null
  sections: BriefSection[]
  text: string
  speech: string
  alerts: string[]
  gaps: string[]
  llm: { used: boolean; provider: string | null; model: string | null; checked: number; removed: number; error: string | null; translated?: number }
}

/** Today's date in Warsaw, YYYY-MM-DD. */
export function warsawToday(now: Date = new Date()): string {
  return new Intl.DateTimeFormat('sv-SE', { timeZone: 'Europe/Warsaw' }).format(now)
}

/** Is a saved brief one that must be written again (today's, and not English yet)? */
export function needsEnglishRewrite(brief: Pick<DailyBrief, 'date' | 'lang'> | null, today: string = warsawToday()): boolean {
  return Boolean(brief) && brief!.date === today && brief!.lang !== 'en'
}

/** Today's brief written again in English and saved over the old one (the server does nothing when it is English already). */
export async function regenerateBrief(): Promise<DailyBrief> {
  const res = await stanleyFetch('/.netlify/functions/stanley-brief', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ action: 'regenerate' }),
  })
  if (!res.ok) throw new Error(`stanley-brief regenerate ${res.status}`)
  return res.json() as Promise<DailyBrief>
}

/**
 * The newest saved brief, or null when none exists yet (404). A brief from today that was saved before Stanley spoke
 * English only (no `lang: 'en'`) is written again on the spot; if that fails the saved one is returned as it is.
 */
async function loadLatestBrief(): Promise<DailyBrief | null> {
  const res = await stanleyFetch('/.netlify/functions/stanley-brief')
  if (res.status === 404) return null
  if (!res.ok) throw new Error(`stanley-brief ${res.status}`)
  const brief = await res.json() as DailyBrief
  if (needsEnglishRewrite(brief)) {
    try { return await regenerateBrief() } catch { /* keep the saved one */ }
  }
  return brief
}

let inflight: Promise<DailyBrief | null> | null = null

/** One load at a time: the HOME card and the automatic playback both ask on opening, and a rewrite must not run twice. */
export function fetchLatestBrief(): Promise<DailyBrief | null> {
  inflight ??= loadLatestBrief().finally(() => { inflight = null })
  return inflight
}
