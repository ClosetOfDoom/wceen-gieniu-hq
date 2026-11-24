// Client of stanley-brief (the 09:00 brief) — behind the shared password.
import { stanleyFetch } from '../lib/stanleyAuth'

export interface BriefSection { id: string; title: string; lines: string[] }
export interface DailyBrief {
  date: string
  createdAt: string
  title: string
  intro: string | null
  sections: BriefSection[]
  text: string
  speech: string
  alerts: string[]
  gaps: string[]
  llm: { used: boolean; provider: string | null; model: string | null; checked: number; removed: number; error: string | null }
}

/** The newest saved brief, or null when none exists yet (404). */
export async function fetchLatestBrief(): Promise<DailyBrief | null> {
  const res = await stanleyFetch('/.netlify/functions/stanley-brief')
  if (res.status === 404) return null
  if (!res.ok) throw new Error(`stanley-brief ${res.status}`)
  return res.json() as Promise<DailyBrief>
}
