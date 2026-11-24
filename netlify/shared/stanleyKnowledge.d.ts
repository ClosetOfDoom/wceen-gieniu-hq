export * from './stanleyPillars.js'
import type { Pillar, RhythmEntry } from './stanleyPillars.js'
export const KNOWLEDGE_DIR: string
export interface Knowledge { strategia: string; rytm: string; rhythm: RhythmEntry[]; pillars: (Pillar & { text: string; missing: string[] })[] }
export function loadKnowledge(): Promise<Knowledge>
export function allMissingQuestions(knowledge: Knowledge): string[]
export function knowledgeContext(knowledge: Knowledge): string
