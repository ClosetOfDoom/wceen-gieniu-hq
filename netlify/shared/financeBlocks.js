// financeBlocks.js — the finance answer as STRUCTURED BLOCKS plus the ONE function that turns blocks into text.
//
// The server builds blocks once (financeStore.buildReportBlocks for the report, financeStanley for the comment).
// The panel renders the blocks (table, text, lists, comment sections); the plain-text answer (fallback for old clients,
// speech guards, the COPY button) is generated from the SAME blocks here — there is no second path that computes or
// formats a figure. Imported by the server and by the client (like financeIntent).
//
// Block types
//   { type: 'table',   title, lead?, columns: [{ key, label, align: 'left' | 'right' }], rows: [{ cells: string[], status?: string }] }
//   { type: 'text',    lines: string[], role?: 'notes' | 'meta' | 'warning' | 'footer' | 'note' }   ('' = blank separator line)
//   { type: 'list',    title, items: [{ text, kind?: 'warn' }] }                                   (blank line before the title)
//   { type: 'comment', sections: [{ id, title, items: string[] }], fallback?: string }              (items may hold **bold**)

const pad = (s, n) => String(s).padEnd(n)

/** **bold** markers are formatting, not text: copied / spoken text never has them. */
export const stripMarkup = (s) => String(s ?? '').replace(/\*\*/g, '')

function tableLines(block) {
  const head = block.columns.map((c) => c.label)
  const body = block.rows.map((r) => r.cells)
  const widths = head.map((h, i) => Math.max(h.length, ...body.map((r) => String(r[i]).length)))
  const line = (r) => r.map((c, i) => pad(c, widths[i])).join('  ').trimEnd()
  return [
    ...(block.lead ? [''] : []),
    ...(block.title ? [block.title] : []),
    line(head),
    widths.map((w) => '-'.repeat(w)).join('  '),
    ...body.map(line),
  ]
}

/** Lines of one block, exactly as the text answer shows them. */
export function blockLines(block) {
  switch (block.type) {
    case 'table':
      return tableLines(block)
    case 'text':
      return block.lines.map(stripMarkup)
    case 'list':
      return ['', block.title, ...block.items.map((i) => `${i.kind === 'warn' ? '  ! ' : '  '}${stripMarkup(i.text)}`)]
    case 'comment': {
      const lines = ['', 'KOMENTARZ']
      if (block.sections.length === 0) {
        lines.push(stripMarkup(block.fallback ?? ''))
        return lines
      }
      block.sections.forEach((s, i) => {
        if (i > 0) lines.push('')
        lines.push(s.title, ...s.items.map((t) => `- ${stripMarkup(t)}`))
      })
      return lines
    }
    default:
      return []
  }
}

export function blocksToText(blocks) {
  return (blocks ?? []).flatMap(blockLines).join('\n')
}

/** Splits **bold** into parts — the renderer builds React text nodes from these; no HTML is ever produced from model text. */
export function inlineParts(text) {
  const parts = []
  const re = /\*\*([^*]+?)\*\*/g
  const s = String(text ?? '')
  let last = 0
  for (const m of s.matchAll(re)) {
    if (m.index > last) parts.push({ text: s.slice(last, m.index), bold: false })
    parts.push({ text: m[1], bold: true })
    last = m.index + m[0].length
  }
  if (last < s.length) parts.push({ text: s.slice(last), bold: false })
  return parts.map((p) => ({ ...p, text: p.text.replace(/\*+/g, '') })).filter((p) => p.text !== '')
}
