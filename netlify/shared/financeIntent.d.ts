// Types for financeIntent.js — which messages take the finance path.
export function normalize(s: string | null | undefined): string
export function isFinanceQuestion(message: string): boolean
export function isBankCostQuestion(message: string): boolean
