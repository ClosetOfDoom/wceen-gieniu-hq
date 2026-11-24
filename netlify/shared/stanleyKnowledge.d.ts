export const KNOWLEDGE_DIR: string
export const STRATEGIC_MONTHLY_GOAL: number
export interface Pillar { readonly slug: string; readonly name: string }
export const PILLARS: readonly Pillar[]
export const PRODUCT_PILLARS: Readonly<Record<string, string>>
export function pillarOfProduct(productKey: string): string
export function normalizePl(text: unknown): string
export function pillarFromText(text: unknown): string | null
export interface RhythmEntry { id: string; start: string; end: string | null; days: number[]; title: string; pillarOfDay: string | null }
export function parseRhythm(md: string): RhythmEntry[]
export function rhythmFor(weekday: number, rhythm: RhythmEntry[]): RhythmEntry[]
export function pillarOfDay(weekday: number, rhythm: RhythmEntry[]): string | null
export function missingDataOf(md: string): string[]
export function questionsForDay(questions: string[], date: string, n?: number): string[]
export interface Knowledge { strategia: string; rytm: string; rhythm: RhythmEntry[]; pillars: (Pillar & { text: string; missing: string[] })[] }
export function loadKnowledge(): Promise<Knowledge>
export function allMissingQuestions(knowledge: Knowledge): string[]
export function knowledgeContext(knowledge: Knowledge): string
