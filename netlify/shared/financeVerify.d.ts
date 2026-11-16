// Types for financeVerify.js — number check, comment sections and rules (server side; the client uses extractNumbers).
export interface ExtractedNumber { value: number; decimals: number; index: number; text: string; after: string }
export interface CommentSectionData { id: string; title: string; items: string[] }
export const SECTIONS: string[]
export function extractNumbers(text: string): ExtractedNumber[]
