// Client of stanley-tasks (the "Dziś" list) — behind the shared password like every function.
import { stanleyFetch } from '../lib/stanleyAuth'
import type { DayPlan } from '../../netlify/shared/stanleyTasks.js'

export type { DayPlan, DayItem } from '../../netlify/shared/stanleyTasks.js'

export async function fetchDayPlan(date?: string): Promise<DayPlan> {
  const res = await stanleyFetch(`/.netlify/functions/stanley-tasks${date ? `?date=${encodeURIComponent(date)}` : ''}`)
  if (!res.ok) throw new Error(`stanley-tasks ${res.status}`)
  return res.json() as Promise<DayPlan>
}

export async function toggleDayItem(id: string, date: string): Promise<boolean> {
  const res = await stanleyFetch('/.netlify/functions/stanley-tasks', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ action: 'toggle', id, date }),
  })
  if (!res.ok) throw new Error(`stanley-tasks ${res.status}`)
  return ((await res.json()) as { done: boolean }).done
}
