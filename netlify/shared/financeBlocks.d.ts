// Types for financeBlocks.js — the structured finance answer (blocks) and its single text renderer.
export interface TableColumn { key: string; label: string; align: 'left' | 'right' }
export interface TableRow { cells: string[]; status?: string }
export interface TableBlock { type: 'table'; title?: string; lead?: boolean; columns: TableColumn[]; rows: TableRow[] }
export interface TextBlock { type: 'text'; lines: string[]; role?: 'notes' | 'meta' | 'warning' | 'footer' | 'note' }
export interface ListItem { text: string; kind?: 'warn' }
export interface ListBlock { type: 'list'; title: string; items: ListItem[] }
export interface CommentSection { id: string; title: string; items: string[] }
export interface CommentBlock { type: 'comment'; sections: CommentSection[]; fallback?: string }
export type FinanceBlock = TableBlock | TextBlock | ListBlock | CommentBlock
export function stripMarkup(s: string | null | undefined): string
export function blockLines(block: FinanceBlock): string[]
export function blocksToText(blocks: FinanceBlock[] | null | undefined): string
export function inlineParts(text: string | null | undefined): { text: string; bold: boolean }[]
