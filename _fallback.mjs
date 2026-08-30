// Drive the real app with gieniu-command blocked so handleIntentQuery falls into
// the local resolveIntent path, and print the RAW rendered answer.
import puppeteer from 'puppeteer-core'

const CHROME = 'C:/Program Files/Google/Chrome/Application/chrome.exe'
const URL = 'http://localhost:4173/'
const QUESTION = process.argv[2] ?? 'what payment methods did customers use?'
const scenario = process.argv[3] ?? 'data-loaded'

const browser = await puppeteer.launch({
  executablePath: CHROME,
  headless: 'new',
  args: ['--no-sandbox', '--disable-dev-shm-usage'],
})
const page = await browser.newPage()
await page.setViewport({ width: 1440, height: 900 })
await page.setRequestInterception(true)

let blocked = 0
page.on('request', (req) => {
  const u = req.url()
  const isCommand = u.includes('/.netlify/functions/gieniu-command')
  const isAnyBackend = u.includes('/.netlify/functions/') || u.includes('supabase.co')
  const kill = scenario === 'no-data' ? isAnyBackend : isCommand
  if (kill) { blocked++; req.abort('failed'); return }
  req.continue()
})

if (scenario === 'no-data') {
  await page.evaluateOnNewDocument(() => {
    Object.defineProperty(navigator, 'serviceWorker', {
      value: { register: () => Promise.reject(new Error('off')), getRegistrations: () => Promise.resolve([]), controller: null },
      configurable: true,
    })
    if (window.caches) window.caches.open = () => Promise.reject(new Error('off'))
  })
}

await page.goto(URL, { waitUntil: 'domcontentloaded', timeout: 30000 })
await page.waitForSelector('.hud-right .gieniu-input', { timeout: 30000 })
await new Promise((r) => setTimeout(r, 6000))

await page.click('.hud-right .gieniu-input')
await page.type('.hud-right .gieniu-input', QUESTION, { delay: 5 })
await page.evaluate(() => {
  const btn = [...document.querySelectorAll('button')].find((b) => b.textContent.trim() === 'Ask')
  btn.click()
})
await new Promise((r) => setTimeout(r, 6000))

const answer = await page.evaluate(() => {
  const pre = document.querySelector('.gieniu-response-text')
  return pre ? pre.innerText : '(no response rendered)'
})

console.log('─────────────────────────────────────────────────────────────')
console.log('QUESTION: ' + QUESTION)
console.log('PATH    : LOCAL FALLBACK (resolveIntent) | scenario=' + scenario + ' | blocked=' + blocked)
console.log('RAW rendered answer:')
console.log(JSON.stringify(answer))

await browser.close()
