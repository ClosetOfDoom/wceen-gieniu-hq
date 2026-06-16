// Gieniu's personality: sharp, English-speaking, addresses user as Lifidi.
// Uses phrase pools to avoid repetition. Recent picks stored in localStorage.

const STORAGE_KEY = 'gieniu_recent_picks'
const MAX_RECENT = 3

function getRecent(): string[] {
  try {
    return JSON.parse(localStorage.getItem(STORAGE_KEY) ?? '[]')
  } catch {
    return []
  }
}

function saveRecent(picks: string[]): void {
  localStorage.setItem(STORAGE_KEY, JSON.stringify(picks.slice(-MAX_RECENT)))
}

export function pickPhrase(pool: string[]): string {
  const recent = getRecent()
  const available = pool.filter(p => !recent.includes(p))
  const source = available.length > 0 ? available : pool
  const pick = source[Math.floor(Math.random() * source.length)]
  saveRecent([...recent, pick])
  return pick
}

export const OPENERS = [
  'Good morning, Lifidi. I have the numbers.',
  'Lifidi, I ran the data. Here is what I see.',
  'Operational snapshot ready.',
  'No sugarcoating, Lifidi. Here it is.',
  'Numbers are in. Interpretation included.',
  'Lifidi — quick debrief.',
  'Got a minute? I have something for you, Lifidi.',
  'Data pulled. Signal is clear.',
]

export const GOOD_VERDICTS = [
  'Situation is under control.',
  'Numbers look respectable.',
  'Green light for now.',
  'Machine is running. Do not break it.',
  'CPA is within range. Keep going.',
]

export const HIGH_CPA_VERDICTS = [
  'CPA is out of control. Act now.',
  'Acquisition cost too high — ads are eating the margin.',
  'Watch it: ads getting expensive, sales not keeping up.',
  'Too much per customer. Check the creatives.',
]

export const SALES_WARNING_VERDICTS = [
  'Spending on ads, but no cash coming in. Bad day or bad funnel?',
  'Meta is charging, Wix is silent. Check the landing, checkout, and pixel.',
  'Money going out, zero orders. That is a red flag, Lifidi.',
]

export const NO_DATA_VERDICTS = [
  'Nothing to analyze — no data for today.',
  'Supabase is empty. Check the Make scenarios.',
  'Zero data. Either Make did not run or the day is too young.',
]

export const NEXT_MOVES = [
  'Check creatives — do you have at least 3 active videos?',
  'Verify retargeting: ATC and IC as separate ad sets?',
  'Tuesday: JZK webinar. Thursday: JSU webinar. Promote both.',
  'Is your email list getting segmented campaigns or a spray-and-pray blast?',
  'Make sure one ad is not eating more than 70% of the budget.',
  'New creatives? If nothing fresh in 7 days — that is a problem.',
  'Confirm buyers are getting an upsell, not the same product they already own.',
]

export const META_NOT_LIVE_NOTES = [
  'Meta spend today: zero. Campaigns off or not started yet.',
  'Ads were not running. Wix is live, Meta is sleeping.',
  'No Meta spend — organic only, or campaigns paused?',
]

// ── JSU Webinar Funnel phrases ────────────────────────────────────────────────

export const JSU_OPENERS = [
  'Lifidi, I checked the JSU funnel. Here are the results.',
  'Dug into the webinar data. Here is what I found, Lifidi.',
  'The 549 PLN course is not selling — let us deal with that, Lifidi.',
  'JSU funnel under the microscope. No sugarcoating.',
  'Lifidi, time to diagnose the Thursday webinar funnel.',
  'JSU webinar data — straight diagnosis, no filler.',
]

export const JSU_BOTTLENECK_CLOSES = [
  'Fix this one stage — the rest of the funnel does not matter until it works.',
  'One bottleneck is blocking all revenue. Start there.',
  'Do not optimize later stages until this one is fixed.',
  'This stage needs immediate attention — everything else can wait.',
]

export const JSU_OK_CLOSES = [
  'Funnel is technically OK — check list segmentation and the webinar offer.',
  'Numbers check out. Problem might be a shortage of new leads, not conversion.',
  'Funnel is working. Question: are you reaching the right people?',
  'All indicators green. Dig deeper into the product and the pitch.',
]
