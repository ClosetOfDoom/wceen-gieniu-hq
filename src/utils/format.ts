// The number formatters the dashboard renders with.
//
// These lived as private helpers inside App.tsx. The clipboard export has to
// print the SAME strings the KPI cards print — a report whose figures differ
// from the screen is worthless to whoever is handed it — so they moved here and
// both callers use the one implementation rather than two that agree today.
//
// Locale is en-US deliberately: it is what the cards have always used, and it
// renders identically in every browser and in Node, so the exported text does
// not change shape depending on where it was generated.

export function fmtPln(n: number | null | undefined): string {
  if (n == null) return '—'
  return n.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 }) + ' PLN'
}

export function fmtNum(n: number | null | undefined): string {
  if (n == null) return '—'
  return n.toLocaleString('en-US')
}

export function fmtRoas(n: number | null | undefined): string {
  if (n == null) return '—'
  return n.toFixed(2) + 'x'
}

export function fmtPct(n: number | null | undefined, decimals = 2): string {
  if (n == null) return '—'
  return n.toFixed(decimals) + '%'
}
