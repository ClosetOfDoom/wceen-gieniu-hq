// Reading a Wix payments export — the ONE place that knows its shape.
//
// Two scripts need this file: reconcile-wix-export.mjs, which compares the
// export against Supabase, and backfill-order-numbers.mjs, which puts missing
// rows back. They used to disagree about what the file looks like, and the
// backfill lost on every count: it read the merged banner row as the header,
// it had no column named "Nazwa", and Date.parse() returns NaN for
// "19.10.2026, 10:05:54". One reader, one set of answers.
//
// WHAT THE FILE ACTUALLY LOOKS LIKE
// ---------------------------------------------------------------------------
//   · UTF-8 with a BOM.
//   · Row 1 is a merged banner ("Płatność", "Transakcja", …) with most cells
//     empty. Row 2 is the real header. Row 3 onwards is data.
//   · Fields are quoted and MAY CONTAIN NEWLINES — a product name wraps mid
//     line. 17 304 data rows arrive as 22 440 physical lines.
//   · Timestamps are wall clock in the offset named by the column itself:
//     "Data płatności GMT +02:00". The offset is read out of that header text
//     rather than assumed, and it is a FIXED offset stamped by Wix at export
//     time — it is not Europe/Warsaw, so rows from a winter month are labelled
//     +02:00 too. Within 2026-06-11…2026-10-19 Poland is on CEST and the two
//     agree exactly; reconcile-wix-export.mjs measures the residual and says
//     what it found.
//   · "Nazwa" is the order's line items joined with ", " — GRATIS bonuses and
//     the shipping line included. "Ilość" counts those lines, NOT units sold.

import { readFileSync } from 'fs'

/** A CSV parser that survives quoted fields containing commas and newlines. */
export function parseCsv(text) {
  const rows = []
  let row = [], field = '', quoted = false
  for (let i = 0; i < text.length; i++) {
    const c = text[i]
    if (quoted) {
      if (c === '"') {
        if (text[i + 1] === '"') { field += '"'; i++ } else quoted = false
      } else field += c
    } else if (c === '"') quoted = true
    else if (c === ',') { row.push(field); field = '' }
    else if (c === '\n') { row.push(field); rows.push(row); row = []; field = '' }
    else if (c !== '\r') field += c
  }
  if (field || row.length > 0) { row.push(field); rows.push(row) }
  return rows
}

/** Lowercase, strip accents, fold Polish ł — for comparing header spellings. */
export const norm = (s) => String(s ?? '').toLowerCase()
  .normalize('NFD').replace(/[̀-ͯ]/g, '').replace(/ł/g, 'l')
  .replace(/\s+/g, ' ').trim()

/**
 * The index of the FIRST column whose header matches one of these spellings.
 *
 * First, not any: the export carries "Imię", "Nazwisko" and "E-mail" twice —
 * once for billing and once for shipping — and "Status" twice. Billing comes
 * first and billing is what the order was placed with.
 */
export function columnIndex(header, ...candidates) {
  const h = header.map(norm)
  for (const c of candidates) {
    const want = norm(c)
    let i = h.indexOf(want)
    if (i >= 0) return i
    i = h.findIndex(x => x.startsWith(want))
    if (i >= 0) return i
  }
  return -1
}

/** "1 234,56 zł" → 1234.56. Returns null when there is no number in there. */
export function toNumber(s) {
  const cleaned = String(s ?? '').replace(/\s/g, '').replace(/[^\d,.-]/g, '')
  if (cleaned === '' || cleaned === '-') return null
  // Polish decimal comma; a dot is accepted too, because Wix switches on locale.
  const n = Number(cleaned.replace(',', '.'))
  return Number.isFinite(n) ? n : null
}

/**
 * Statuses in which money actually moved. A payment later refunded or charged
 * back WAS taken at the time, so the order existed and the sync should have
 * carried it; those are kept and flagged, not silently dropped.
 */
export const SETTLED_STATUSES = new Set(['zrealizowane', 'completed', 'paid'])
export const REVERSED_STATUSES = new Set([
  'zwrocona', 'czesciowo zwrocone', 'obciazenie zwrotne',
  'refunded', 'partially refunded', 'chargeback',
])

/**
 * Parse "DD.MM.YYYY, HH:MM:SS" at a fixed offset into a UTC instant.
 * Returns null rather than a wrong date — nothing here guesses.
 *
 * The day and month are NOT reliably zero-padded: the export writes
 * "09.10.2026" on some rows and "9.10.2026" on others, and a two-digit-only
 * pattern silently rejected 5 338 of 17 304 rows — 31% of the file, dropped
 * without a word if nobody counts what was skipped.
 */
export function parseExportTimestamp(text, offsetMinutes) {
  const m = String(text ?? '').trim()
    .match(/^(\d{1,2})\.(\d{1,2})\.(\d{4}),?\s+(\d{1,2}):(\d{2})(?::(\d{2}))?$/)
  if (!m) return null
  const [, dd, mm, yyyy, hh, mi, ss] = m
  const asUtc = Date.UTC(+yyyy, +mm - 1, +dd, +hh, +mi, ss == null ? 0 : +ss)
  if (!Number.isFinite(asUtc)) return null
  return new Date(asUtc - offsetMinutes * 60_000)
}

/** "Data płatności GMT +02:00" → 120. Null when the header names no offset. */
export function offsetFromHeader(text) {
  const m = String(text ?? '').match(/GMT\s*([+-])\s*(\d{1,2}):?(\d{2})?/i)
  if (!m) return null
  const sign = m[1] === '-' ? -1 : 1
  return sign * (Number(m[2]) * 60 + Number(m[3] == null ? 0 : m[3]))
}

/**
 * Read a Wix payments export.
 *
 * Throws when the file cannot be understood — header row not found, required
 * column missing, no timezone in the date header. A reconciliation run on a
 * misread file would report every order as lost, which is worse than refusing
 * to start.
 */
export function readWixPaymentsExport(path) {
  const rows = parseCsv(readFileSync(path, 'utf8').replace(/^﻿/, ''))
    .filter(r => r.some(x => String(x).trim() !== ''))

  // The header is the row that names the payment date — row 2 in every export
  // seen so far, but located rather than assumed.
  const headerRow = rows.findIndex(r => r.some(c => norm(c).startsWith('data platnosci')))
  if (headerRow < 0) {
    throw new Error('eksport Wix: nie znalazłem wiersza nagłówka (brak kolumny "Data płatności")')
  }
  const header = rows[headerRow]
  const data = rows.slice(headerRow + 1)

  const iDate   = columnIndex(header, 'data platnosci')
  const iAmount = columnIndex(header, 'kwota')
  const iStatus = columnIndex(header, 'status transakcji')
  const iNumber = columnIndex(header, 'nr zamowienia', 'numer zamowienia', 'order number')
  const iOper   = columnIndex(header, 'operator platnosci', 'payment provider')
  const iName   = columnIndex(header, 'nazwa', 'produkt', 'items')
  const iEmail  = columnIndex(header, 'e-mail', 'email')
  const iCur    = columnIndex(header, 'waluta', 'currency')
  const iKind   = columnIndex(header, 'rodzaj zamowienia')
  const iRefund = columnIndex(header, 'kwota zwrotu')
  // Wix Pricing Plans columns. "Status" appears twice in the header — the
  // subscription's own status and the chargeback's — and an exact match finds
  // the subscription one, because the other is spelled "Status transakcji".
  const iCycle  = columnIndex(header, 'cykl rozliczeniowy')
  const iFreq   = columnIndex(header, 'czestotliwosc')
  const iPeriod = columnIndex(header, 'okres')
  const iSubSt  = columnIndex(header, 'status')

  const missing = []
  if (iDate < 0)   missing.push('Data płatności')
  if (iAmount < 0) missing.push('Kwota')
  if (iStatus < 0) missing.push('Status transakcji')
  if (missing.length > 0) {
    throw new Error(`eksport Wix: brak kolumn ${missing.join(', ')}`
      + `\n  nagłówek: ${header.slice(0, 12).join(' | ')}`)
  }

  const offsetMinutes = offsetFromHeader(header[iDate])
  if (offsetMinutes == null) {
    throw new Error(`eksport Wix: nagłówek "${header[iDate]}" nie podaje strefy — bez niej nie wiem, `
      + 'o której naprawdę była płatność, a tego nie zgaduję')
  }

  const payments = []
  const unparsable = []
  for (let i = 0; i < data.length; i++) {
    const r = data[i]
    const at = parseExportTimestamp(r[iDate], offsetMinutes)
    const amount = toNumber(r[iAmount])
    if (at == null || amount == null) {
      unparsable.push({ line: headerRow + 2 + i, date: r[iDate] ?? '', amount: r[iAmount] ?? '' })
      continue
    }
    const statusRaw = String(r[iStatus] ?? '').trim()
    payments.push({
      line: headerRow + 2 + i,
      paidAt: at.toISOString(),
      paidAtMs: at.getTime(),
      localText: String(r[iDate] ?? '').trim(),
      amount,
      statusRaw,
      status: norm(statusRaw),
      settled: SETTLED_STATUSES.has(norm(statusRaw)),
      reversed: REVERSED_STATUSES.has(norm(statusRaw)),
      orderNumber: iNumber >= 0 ? (String(r[iNumber] ?? '').trim() || null) : null,
      operator: iOper >= 0 ? String(r[iOper] ?? '').trim() : '',
      name: iName >= 0 ? String(r[iName] ?? '').replace(/\s+/g, ' ').trim() : '',
      email: iEmail >= 0 ? String(r[iEmail] ?? '').trim() : '',
      currency: iCur >= 0 ? String(r[iCur] ?? '').trim() : '',
      orderKind: iKind >= 0 ? String(r[iKind] ?? '').trim() : '',
      refundAmount: iRefund >= 0 ? toNumber(r[iRefund]) : null,
      billingCycle: iCycle >= 0 ? String(r[iCycle] ?? '').trim() : '',
      frequency: iFreq >= 0 ? String(r[iFreq] ?? '').trim() : '',
      period: iPeriod >= 0 ? String(r[iPeriod] ?? '').trim() : '',
      subscriptionStatus: iSubSt >= 0 ? String(r[iSubSt] ?? '').trim() : '',
    })
  }

  return { header, headerRow: headerRow + 1, offsetMinutes, payments, unparsable }
}
