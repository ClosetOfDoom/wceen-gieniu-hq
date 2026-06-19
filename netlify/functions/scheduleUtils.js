// Shared schedule classifier for WCEEN webinars.
// Thursday 18:00 Europe/Warsaw = JSU / Jak się uczyć
// Tuesday  18:00 Europe/Warsaw = JZK / Językozak AI
//
// This rule is STRONGER than product_tag and session_name.
// Supabase stores scheduled_at in UTC — this module converts to Warsaw before deciding.

function getWarsawParts(scheduledAt) {
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

function normText(s) {
  return String(s ?? '')
    .toLowerCase()
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .replace(/[^a-z0-9\s]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()
}

const JZK_NAME = ['jezykozak', 'nauka jezykow', 'jzk', 'language', 'jezyk']
const JSU_NAME = ['jak sie uczyc', 'pamiec', 'pamieci', 'test pamieci', 'jsu', 'memory']

function classifyByName(name) {
  const n = normText(name)
  for (const pat of JZK_NAME) {
    if (n.includes(pat)) return { product_tag: 'JZK', product_name: 'Językozak AI', reason: `session_name matches JZK "${pat}"` }
  }
  for (const pat of JSU_NAME) {
    if (n.includes(pat)) return { product_tag: 'JSU', product_name: 'Jak się uczyć', reason: `session_name matches JSU "${pat}"` }
  }
  return null
}

function classifyByTag(tag) {
  const n = normText(tag)
  if (n.includes('jzk') || n.includes('jezyk')) {
    return { product_tag: 'JZK', product_name: 'Językozak AI', reason: `product_tag "${tag}" (last resort)` }
  }
  if (n.includes('jsu')) {
    return { product_tag: 'JSU', product_name: 'Jak się uczyć', reason: `product_tag "${tag}" (last resort)` }
  }
  return { product_tag: 'OTHER', product_name: tag || 'Unknown webinar', reason: 'no schedule, name, or tag match' }
}

/**
 * Classify a webinar session by the fixed WCEEN weekly schedule.
 * @param {{ scheduled_at?: string, session_name?: string, product_tag?: string }} session
 * @returns {{ product_tag: 'JSU'|'JZK'|'OTHER', product_name: string, reason: string, warsaw_weekday: string, warsaw_time: string }}
 */
export function classifyBySchedule(session) {
  // 1. Schedule is PRIMARY
  if (session.scheduled_at) {
    const w = getWarsawParts(session.scheduled_at)
    if (w) {
      if (w.weekday === 'Thursday' && w.hour === 18) {
        return { product_tag: 'JSU', product_name: 'Jak się uczyć', reason: 'fixed schedule: Thursday 18:00 Warsaw', warsaw_weekday: w.weekday, warsaw_time: w.timeStr }
      }
      if (w.weekday === 'Tuesday' && w.hour === 18) {
        return { product_tag: 'JZK', product_name: 'Językozak AI', reason: 'fixed schedule: Tuesday 18:00 Warsaw', warsaw_weekday: w.weekday, warsaw_time: w.timeStr }
      }
      // Has timestamp but not on a scheduled slot — try name, then tag
      const byName = classifyByName(session.session_name ?? '')
      if (byName) return { ...byName, warsaw_weekday: w.weekday, warsaw_time: w.timeStr }
      const byTag = classifyByTag(session.product_tag ?? '')
      return { ...byTag, warsaw_weekday: w.weekday, warsaw_time: w.timeStr, reason: `${byTag.reason} (unscheduled: ${w.weekday} ${w.timeStr})` }
    }
  }
  // 2. No scheduled_at — try name, then tag
  const byName = classifyByName(session.session_name ?? '')
  if (byName) return { ...byName, warsaw_weekday: '', warsaw_time: '' }
  return { ...classifyByTag(session.product_tag ?? ''), warsaw_weekday: '', warsaw_time: '' }
}
