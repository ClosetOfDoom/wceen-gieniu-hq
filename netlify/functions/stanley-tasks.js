// Netlify Function (Functions API v2): stanley-tasks — the "Dziś" list and Stanley's tasks (behind the shared password).
//
//   GET  ?date=YYYY-MM-DD                         → { date, filarDnia, items } (day rhythm + tasks; default: today in Warsaw)
//   POST { action: 'command', message }           → a Q&A answer for "dodaj zadanie …", "zrobione …", "co dziś?"
//   POST { action: 'toggle', id, date? }          → tick / untick a rhythm item (rytm-…) or a task
//   POST { action: 'add', tytul, godzina?, dzien?, filar? }
//
// Store: createKvStore('stanley') from webinarMailStore.js (the one access path to Blobs; v2 for strong consistency).

import { withStanleyAuthV2 } from '../shared/auth.js'
import { createKvStore } from '../shared/webinarMailStore.js'
import { loadKnowledge } from '../shared/stanleyKnowledge.js'
import { warsawParts } from '../shared/webinarMail.js'
import {
  TASK_STATUS, addTask, dayPlan, getDayTicks, listTasks, parseTaskCommand, runTaskCommand, setTaskStatus, toggleRhythmTick,
} from '../shared/stanleyTasks.js'

const json = (status, body) => new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json', 'Cache-Control': 'no-store' } })
const isDate = (d) => /^\d{4}-\d{2}-\d{2}$/.test(String(d ?? ''))

export default withStanleyAuthV2(async (req) => {
  try {
    const kv = createKvStore()
    const { rhythm } = await loadKnowledge()
    const now = new Date()
    const today = warsawParts(now).date
    if (req.method === 'GET') {
      const date = new URL(req.url).searchParams.get('date') ?? today
      if (!isDate(date)) return json(400, { error: 'date: RRRR-MM-DD' })
      return json(200, dayPlan({ date, rhythm, tasks: await listTasks(kv), ticks: await getDayTicks(kv, date) }))
    }
    if (req.method !== 'POST') return json(405, { error: 'GET albo POST' })
    let body
    try { body = JSON.parse((await req.text()) || '{}') } catch { return json(400, { error: 'ciało nie jest JSON-em' }) }
    switch (body.action) {
      case 'command': {
        const command = parseTaskCommand(String(body.message ?? ''), today)
        if (!command) return json(400, { error: 'to nie jest polecenie zadania' })
        return json(200, await runTaskCommand({ kv, command, now, rhythm }))
      }
      case 'toggle': {
        const date = body.date ?? today
        if (!isDate(date)) return json(400, { error: 'date: RRRR-MM-DD' })
        const id = String(body.id ?? '')
        if (id.startsWith('rytm-')) return json(200, { id, done: await toggleRhythmTick(kv, date, id) })
        const cur = (await listTasks(kv)).find((t) => t.id === id)
        if (!cur) return json(404, { error: 'nie ma takiego zadania' })
        const next = await setTaskStatus(kv, id, cur.status === TASK_STATUS.DONE ? TASK_STATUS.OPEN : TASK_STATUS.DONE, now)
        return json(200, { id, done: next.status === TASK_STATUS.DONE })
      }
      case 'add': {
        try {
          return json(200, { task: await addTask(kv, { tytul: body.tytul, godzina: body.godzina ?? null, dzien: body.dzien ?? null, filar: body.filar ?? null }, now) })
        } catch (e) {
          return json(400, { error: e.message })
        }
      }
      default:
        return json(400, { error: `nieznana akcja: ${body.action}` })
    }
  } catch (e) {
    console.error('[stanley-tasks]', String(e?.message ?? e).slice(0, 300))
    return json(500, { error: String(e?.message ?? e).slice(0, 300) })
  }
})
