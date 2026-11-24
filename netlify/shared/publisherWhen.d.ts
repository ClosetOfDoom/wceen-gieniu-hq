export type ParsedWhen =
  | { ok: true; date: string; time: string | null; spec: string; note: string }
  | { ok: false; error: string }

export function weekdayName(date: string): string
export function addDays(date: string, n: number): string
export function parseWhen(input: string, now?: Date): ParsedWhen
export const PLAN_PERIODS: readonly string[]
export function periodRange(period: string | undefined, now?: Date): { od: string; do: string; label: string } | null
export function resolveRange(
  args?: { od?: string; do?: string; okres?: string },
  now?: Date,
): { ok: true; od: string; do: string; label: string } | { ok: false; error: string }
