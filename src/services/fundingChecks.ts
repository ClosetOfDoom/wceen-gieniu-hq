// funding_checks — the one editable field on the funding radar.
//
// funding.ts is a build-time constant, so a checkBy date set in the browser has
// to live in the database. Every call degrades to "no overrides" rather than
// throwing: if the table has not been created yet (PGRST205), the radar still
// renders and simply grades every GO/MAYBE item as SPRAWDŹ TERAZ, which is the
// truthful reading of "nobody has scheduled a check".

import { supabase } from './supabase'
import type { CheckMap } from '../lib/fundingStatus'

export interface FundingChecksResult {
  checks: CheckMap
  /** Set when the table is missing or unreadable — the UI says so instead of pretending. */
  error: string | null
}

export async function fetchFundingChecks(): Promise<FundingChecksResult> {
  try {
    const { data, error } = await supabase.from('funding_checks').select('funding_id, check_by, note')
    if (error) return { checks: {}, error: humanise(error.message, error.code) }
    const checks: CheckMap = {}
    for (const row of data ?? []) {
      checks[row.funding_id as string] = {
        checkBy: (row.check_by as string | null) ?? null,
        note: (row.note as string | null) ?? null,
      }
    }
    return { checks, error: null }
  } catch (err) {
    return { checks: {}, error: String((err as Error)?.message ?? err) }
  }
}

export async function saveFundingCheck(
  fundingId: string,
  checkBy: string | null,
  note?: string | null,
): Promise<{ ok: boolean; error: string | null }> {
  try {
    const { error } = await supabase
      .from('funding_checks')
      .upsert({ funding_id: fundingId, check_by: checkBy, note: note ?? null }, { onConflict: 'funding_id' })
    if (error) return { ok: false, error: humanise(error.message, error.code) }
    return { ok: true, error: null }
  } catch (err) {
    return { ok: false, error: String((err as Error)?.message ?? err) }
  }
}

function humanise(message: string, code?: string): string {
  if (code === 'PGRST205' || /could not find the table/i.test(message)) {
    return 'Tabela funding_checks nie istnieje — uruchom supabase/migrations/add_funding_checks.sql'
  }
  if (code === '42501' || /row-level security|permission denied/i.test(message)) {
    return 'Brak uprawnień do funding_checks — sprawdź policy w add_funding_checks.sql'
  }
  return message
}
