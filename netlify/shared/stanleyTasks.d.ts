import type { KvStore } from './webinarMailStore.js'
import type { RhythmEntry } from './stanleyPillars.js'

export const TASK_STATUS: { readonly OPEN: 'otwarte'; readonly DONE: 'zrobione' }
export interface Task { id: string; tytul: string; filar: string | null; godzina: string | null; dzien: string | null; status: 'otwarte' | 'zrobione'; createdAt: string; doneAt: string | null }
export type TaskCommand =
  | { action: 'add'; tytul: string; godzina: string | null; dzien: string | null; filar: string | null }
  | { action: 'done'; query: string }
  | { action: 'today' }
export function addDays(date: string, n: number): string
export function parseTaskDetails(text: string, today: string): { tytul: string; godzina: string | null; dzien: string | null; filar: string | null }
export function parseTaskCommand(message: string, today?: string): TaskCommand | null
export function isTaskCommand(message: string): boolean
export function listTasks(kv: KvStore): Promise<Task[]>
export function addTask(kv: KvStore, t: { tytul: string; filar?: string | null; godzina?: string | null; dzien?: string | null }, now?: Date): Promise<Task>
export function setTaskStatus(kv: KvStore, id: string, status: string, now?: Date): Promise<Task>
export function matchTasks(tasks: Task[], query: string, today: string): Task[]
export function getDayTicks(kv: KvStore, date: string): Promise<string[]>
export function toggleRhythmTick(kv: KvStore, date: string, id: string): Promise<boolean>
export interface DayItem { id: string; kind: 'rytm' | 'zadanie'; time: string | null; end: string | null; title: string; filar: string | null; done: boolean; overdue?: boolean }
export interface DayPlan { date: string; filarDnia: string | null; items: DayItem[] }
export function dayPlan(args: { date: string; rhythm: RhythmEntry[]; tasks: Task[]; ticks?: string[] }): DayPlan
export function dayPlanText(plan: DayPlan): string
export function runTaskCommand(args: { kv: KvStore; command: TaskCommand; now?: Date; rhythm: RhythmEntry[] }): Promise<{ answerText: string; speechText: string; intent: string; confidence: number; language: 'pl'; dataSourcesUsed: string[]; warnings: string[]; llmUsed: boolean; plan?: DayPlan; task?: Task }>
