// Live batteries against the deployed app, through the real UI.
// Captures BEFORE (raw backend answerText, pre-guard) and AFTER (what the guard
// let into the DOM), then compares them byte-for-byte.
import puppeteer from 'puppeteer-core'

const CHROME = 'C:/Program Files/Google/Chrome/Application/chrome.exe'
const URL = 'https://elegant-kelpie-6fdfc8.netlify.app/'
const mode = process.argv[2] ?? 'regression'

const REGRESSION = [
  'what needs attention?',
  'what should I attend to today?',
  'how did the webinar convert?',
  'which campaign pays for itself?',
  'what did customers pay on average?',
  'how much did we take today?',
  'how many PP orders today?',
  'what is our CPA today?',
  'what is revenue this month?',
  'what is our ROAS?',
  'how was yesterday?',
  'this week so far',
  'what is the margin before ads?',
  'how many clicks did we get?',
  'which creative is burning money?',
]

const NEGATIVE = [
  'what payment methods did customers use?',
  'show me the utm source per order',
  'how many attended the webinar last week?',
  'what is the average age of our customers?',
  'which city do most customers come from?',
]

const TABLE_COL = /\b(?:orders|meta_ads_daily|v_daily_wix_meta_performance|webinar_attendance|webinar_sessions|webinar_participants|v_webinar_funnel|v_webinar_buyers|email_campaigns|email_recipient_events|funding_checks|automation_runs)\.[a-z_][a-z0-9_]*\b/i
const SOURCE = /Wix|Stripe|PayPal|Meta Ads|ClickMeeting|not collected by the Wix→Supabase sync/i
const BLACK = [
  ['referral', /\b(?:finance|accounting|marketing|sales|support|dev|data)\s+(?:team|department|dept)\b|\byour\s+(?:accountant|bookkeeper|developer|team|staff)\b|\bthe\s+team\b|\bask\s+(?:someone|somebody|your|the)\b|\breach\s+out\s+to\b/i],
  ['future', /future\s+(?:reports?|analys[ei]s|analytics|updates?)|may\s+be\s+possible\s+to\s+analy[sz]e|once\s+(?:this|that|it)\s+(?:is|becomes)\s+available/i],
  ['contentless', /those particulars are not available|that information is not available|i lack the data\b|no data (?:is )?available/i],
]

const browser = await puppeteer.launch({
  executablePath: CHROME,
  headless: 'new',
  args: ['--no-sandbox', '--disable-dev-shm-usage'],
})
const page = await browser.newPage()
await page.setViewport({ width: 1440, height: 900 })

let raw = null
page.on('response', async (res) => {
  if (!res.url().includes('/.netlify/functions/gieniu-command')) return
  try { raw = (await res.json()).answerText } catch { /* ignore */ }
})

await page.goto(URL, { waitUntil: 'domcontentloaded', timeout: 45000 })
await page.waitForSelector('.hud-right .gieniu-input', { timeout: 45000 })
await new Promise((r) => setTimeout(r, 7000))

const stamp = await page.evaluate(() => {
  const el = document.querySelector('.build-stamp')
  return el ? el.textContent.trim() : '(none)'
})
console.log('LIVE BUILD STAMP: ' + stamp)
console.log('')

async function ask(q) {
  raw = null
  await page.evaluate(() => { document.querySelector('.hud-right .gieniu-input').value = '' })
  await page.click('.hud-right .gieniu-input')
  await page.keyboard.down('Control'); await page.keyboard.press('KeyA'); await page.keyboard.up('Control')
  await page.keyboard.press('Backspace')
  await page.type('.hud-right .gieniu-input', q, { delay: 3 })
  await page.evaluate(() => {
    const b = [...document.querySelectorAll('button')].find((x) => x.textContent.trim() === 'Ask')
    b.click()
  })
  await new Promise((r) => setTimeout(r, 8000))
  const after = await page.evaluate(() => {
    const pre = document.querySelector('.gieniu-response-text')
    return pre ? pre.innerText : '(none)'
  })
  return { before: raw, after }
}

let pass = 0
let fail = 0

if (mode === 'regression') {
  for (const q of REGRESSION) {
    const { before, after } = await ask(q)
    const identical = before !== null && before.trim() === after.trim()
    if (identical) pass++; else fail++
    console.log('─'.repeat(70))
    console.log((identical ? '✅ IDENTICAL' : '❌ ALTERED  ') + ' | ' + q)
    console.log('  BEFORE: ' + JSON.stringify(before))
    console.log('  AFTER : ' + JSON.stringify(after))
  }
  console.log('\nREGRESSION: ' + pass + '/' + REGRESSION.length + ' identical, ' + fail + ' altered')
}

if (mode === 'negative') {
  for (const q of NEGATIVE) {
    const { before, after } = await ask(q)
    const hasCol = TABLE_COL.test(after)
    const hasSrc = SOURCE.test(after)
    const blacks = BLACK.filter(([, re]) => re.test(after)).map(([n]) => n)
    const ok = hasCol && hasSrc && blacks.length === 0
    if (ok) pass++; else fail++
    console.log('─'.repeat(70))
    console.log((ok ? '✅ REFUSAL OK' : '❌ BAD       ') + ' | ' + q)
    console.log('  BEFORE: ' + JSON.stringify(before))
    console.log('  AFTER : ' + JSON.stringify(after))
    console.log('  column=' + (hasCol ? after.match(TABLE_COL)[0] : 'NONE') +
      ' | source=' + (hasSrc ? after.match(SOURCE)[0] : 'NONE') +
      ' | blacklist=' + (blacks.length ? blacks.join(',') : 'clean'))
  }
  console.log('\nNEGATIVE: ' + pass + '/' + NEGATIVE.length + ' sourced refusals')
}

if (mode === 'passthrough') {
  // JSU command buttons: navigate to Webinars and click one.
  await page.evaluate(() => {
    const n = [...document.querySelectorAll('button, a, div[role="button"], .nav-item, .mobile-nav-item')]
      .find((x) => /webinar/i.test(x.textContent || ''))
    if (n) n.click()
  })
  await new Promise((r) => setTimeout(r, 4000))
  const jsu = await page.evaluate(async () => {
    const b = [...document.querySelectorAll('button')].find((x) => /jak się uczyć|czemu kurs/i.test(x.textContent || ''))
    if (!b) return { clicked: false }
    b.click()
    await new Promise((r) => setTimeout(r, 2500))
    const pre = document.querySelector('pre')
    return { clicked: true, label: b.textContent.trim(), text: pre ? pre.innerText : '(none)' }
  })
  console.log('─'.repeat(70))
  console.log('JSU COMMAND BUTTON: ' + (jsu.clicked ? jsu.label : 'not found'))
  console.log('  RENDERED: ' + JSON.stringify(jsu.text))
  console.log('  is a refusal template? ' + (String(jsu.text).includes('That field is not in the database') ? 'YES — GUARD OVERWROTE IT' : 'no — passed through'))
}

await browser.close()
