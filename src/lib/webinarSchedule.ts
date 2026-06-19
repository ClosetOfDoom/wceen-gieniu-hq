// Fixed weekly schedule classifier for WCEEN webinars.
// Schedule rule (STRONGEST signal — overrides product_tag AND session_name):
//   Thursday 18:00 Europe/Warsaw = JSU / Jak się uczyć / memory webinar
//   Tuesday  18:00 Europe/Warsaw = JZK / Językozak AI
//
// Supabase stores scheduled_at in UTC.
// Example: Thursday 18:00 Warsaw in June (CEST +2) = 16:00:00 UTC.
// This module converts to Europe/Warsaw before deciding weekday/hour.

export type ScheduleProductTag = 'JSU' | 'JZK' | 'OTHER'

export interface ScheduleClassification {
  product_tag: ScheduleProductTag
  product_name: string
  reason: string
  warsaw_weekday: string
  warsaw_time: string
}

interface SessionInput {
  scheduled_at?: string | null
  session_name?: string | null
  product_tag?: string | null
}

// ── Warsaw time helper ────────────────────────────────────────────────────────

interface WarsawParts {
  weekday: string
  hour: number
  timeStr: string
}

function getWarsawParts(scheduledAt: string): WarsawParts | null {
  try {
    const d = new Date(scheduledAt)
    if (isNaN(d.getTime())) return null
    const parts = new Intl.DateTimeFormat('en-CA', {
      timeZone: 'Europe/Warsaw',
      weekday: 'long',
      hour: 'numeric',
      minute: '2-digit',
      hour12: false,
    }).formatToParts(d)
    const weekday = parts.find(p => p.type === 'weekday')?.value ?? ''
    const hour    = parseInt(parts.find(p => p.type === 'hour')?.value ?? '0', 10)
    const minute  = parts.find(p => p.type === 'minute')?.value ?? '00'
    const timeStr = `${String(hour).padStart(2, '0')}:${minute}`
    return { weekday, hour, timeStr }
  } catch {
    return null
  }
}

// ── Name patterns (second-priority fallback) ──────────────────────────────────

function norm(s: string): string {
  return String(s ?? '')
    .toLowerCase()
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .replace(/[^a-z0-9\s]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()
}

const JZK_NAME_PATTERNS = ['jezykozak', 'nauka jezykow', 'jzk', 'language', 'jezyk']
const JSU_NAME_PATTERNS = ['jak sie uczyc', 'pamiec', 'pamieci', 'test pamieci', 'jsu', 'memory']

type Partial3 = Omit<ScheduleClassification, 'warsaw_weekday' | 'warsaw_time'>

function classifyByName(name: string): Partial3 | null {
  const n = norm(name)
  for (const pat of JZK_NAME_PATTERNS) {
    if (n.includes(pat)) return { product_tag: 'JZK', product_name: 'Językozak AI', reason: `session_name matches JZK "${pat}"` }
  }
  for (const pat of JSU_NAME_PATTERNS) {
    if (n.includes(pat)) return { product_tag: 'JSU', product_name: 'Jak się uczyć', reason: `session_name matches JSU "${pat}"` }
  }
  return null
}

function classifyByTag(tag: string): Partial3 {
  const n = norm(tag)
  if (n.includes('jzk') || n.includes('jezyk')) return { product_tag: 'JZK', product_name: 'Językozak AI', reason: `product_tag "${tag}" (last resort)` }
  if (n.includes('jsu')) return { product_tag: 'JSU', product_name: 'Jak się uczyć', reason: `product_tag "${tag}" (last resort)` }
  return { product_tag: 'OTHER', product_name: tag || 'Unknown webinar', reason: 'no schedule, name, or tag match' }
}

// ── Main classifier ───────────────────────────────────────────────────────────

/**
 * Classify a webinar session using the WCEEN fixed weekly schedule.
 * Schedule is PRIMARY — it overrides product_tag and session_name.
 */
export function classifyWebinarBySchedule(session: SessionInput): ScheduleClassification {
  // 1. Schedule rule — strongest signal
  if (session.scheduled_at) {
    const w = getWarsawParts(session.scheduled_at)
    if (w) {
      if (w.weekday === 'Thursday' && w.hour === 18) {
        return { product_tag: 'JSU', product_name: 'Jak się uczyć', reason: 'fixed schedule: Thursday 18:00 Warsaw', warsaw_weekday: w.weekday, warsaw_time: w.timeStr }
      }
      if (w.weekday === 'Tuesday' && w.hour === 18) {
        return { product_tag: 'JZK', product_name: 'Językozak AI', reason: 'fixed schedule: Tuesday 18:00 Warsaw', warsaw_weekday: w.weekday, warsaw_time: w.timeStr }
      }
      // Has a timestamp but not on the fixed schedule — fall back to name
      const byName = classifyByName(session.session_name ?? '')
      if (byName) return { ...byName, warsaw_weekday: w.weekday, warsaw_time: w.timeStr }
      const byTag = classifyByTag(session.product_tag ?? '')
      return { ...byTag, warsaw_weekday: w.weekday, warsaw_time: w.timeStr, reason: `${byTag.reason} (unscheduled slot: ${w.weekday} ${w.timeStr})` }
    }
  }

  // 2. No scheduled_at — try name patterns
  const byName = classifyByName(session.session_name ?? '')
  if (byName) return { ...byName, warsaw_weekday: '', warsaw_time: '' }

  // 3. Last resort: product_tag from DB
  return { ...classifyByTag(session.product_tag ?? ''), warsaw_weekday: '', warsaw_time: '' }
}

/** Return Warsaw weekday label for a scheduled_at UTC timestamp. */
export function getWarsawWeekday(scheduledAt: string): string {
  const parts = getWarsawParts(scheduledAt)
  return parts?.weekday ?? ''
}

/** Return Warsaw time string (HH:MM) for a scheduled_at UTC timestamp. */
export function getWarsawTime(scheduledAt: string): string {
  const parts = getWarsawParts(scheduledAt)
  return parts?.timeStr ?? ''
}
