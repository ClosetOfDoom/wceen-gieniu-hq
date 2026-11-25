// FinanceAnswer — the finance answer as a readable panel: a real HTML table (scrolls sideways in a narrow panel, figures
// right-aligned and never wrapped, status in colour), the notes / lists of the report, and the model's comment in sections.
//
// Safety: every string is rendered as a React text node (escaped by React). Model text goes through inlineParts() which only
// understands **bold**; there is no dangerouslySetInnerHTML anywhere, so a <script> in a comment is shown as text and never runs.
import { useState } from 'react'
import {
  blocksToText, inlineParts,
  type CommentBlock, type FinanceBlock, type ListBlock, type TableBlock, type TextBlock,
} from '../../netlify/shared/financeBlocks.js'
import { copyText } from '../utils/clipboard'

export const STATUS_COLOR: Record<string, string> = {
  OK: 'var(--green)',
  INCOMPLETE: 'var(--amber)',
  WARNING: 'var(--red)',
}

const serif = 'var(--font-serif)'
const mono = 'var(--font-mono)'

const headingStyle: React.CSSProperties = {
  fontFamily: serif, fontSize: '0.62rem', color: 'var(--gold)', letterSpacing: '0.14em', textTransform: 'uppercase', margin: '16px 0 6px',
}

/** Display only: a figure ("20 613,00 zł", "6,5%") is never broken across lines. The copied text keeps ordinary spaces. */
export const keepFigures = (t: string): string =>
  t.replace(/(\d) (?=\d{3}(?:\D|$))/g, '$1\u00a0').replace(/(\d) (zł|%|pp)/g, '$1\u00a0$2')

/** **bold** only; everything else is plain text. Never HTML. */
export function InlineText({ text }: { text: string }) {
  return (
    <>
      {inlineParts(text).map((p, i) => (p.bold ? <strong key={i} style={{ color: 'var(--text)', fontWeight: 700 }}>{keepFigures(p.text)}</strong> : <span key={i}>{keepFigures(p.text)}</span>))}
    </>
  )
}

function Table({ block }: { block: TableBlock }) {
  const hasStatus = block.rows.some((r) => r.status)
  return (
    <div style={{ marginTop: block.lead ? 14 : 0 }}>
      {block.title && <div style={headingStyle}>{block.title}</div>}
      {/* scrolls sideways inside the panel instead of wrapping figures */}
      <div data-testid="finance-table-scroll" style={{ overflowX: 'auto', WebkitOverflowScrolling: 'touch', maxWidth: '100%', border: '1px solid var(--border)', borderRadius: 4 }}>
        <table style={{ borderCollapse: 'collapse', fontFamily: mono, fontSize: '0.76rem', lineHeight: 1.5, minWidth: 'max-content', width: '100%' }}>
          <thead>
            <tr>
              {block.columns.map((c) => (
                <th key={c.key} scope="col" style={{
                  textAlign: c.align, whiteSpace: 'nowrap', padding: '6px 10px', color: 'var(--muted2)', fontWeight: 600,
                  fontSize: '0.66rem', letterSpacing: '0.06em', textTransform: 'uppercase', borderBottom: '1px solid var(--border-gold)', background: 'var(--surface)',
                }}>{c.label}</th>
              ))}
            </tr>
          </thead>
          <tbody>
            {block.rows.map((r, ri) => (
              <tr key={ri} style={{ borderBottom: ri < block.rows.length - 1 ? '1px solid var(--border)' : undefined }}>
                {r.cells.map((cell, ci) => {
                  const col = block.columns[ci]
                  const isStatus = hasStatus && col?.key === 'status'
                  return (
                    <td
                      key={ci}
                      data-col={col?.key}
                      style={{
                        textAlign: col?.align ?? 'left', whiteSpace: 'nowrap', padding: '6px 10px', fontVariantNumeric: 'tabular-nums',
                        color: isStatus ? (STATUS_COLOR[cell] ?? 'var(--text)') : 'var(--text)', fontWeight: isStatus ? 700 : 400,
                      }}
                    >{cell}</td>
                  )
                })}
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  )
}

function Lines({ block }: { block: TextBlock }) {
  const color = block.role === 'warning' ? 'var(--amber)' : block.role === 'footer' || block.role === 'note' ? 'var(--muted2)' : 'var(--text)'
  const lines = block.lines.filter((l) => l.trim() !== '')
  if (lines.length === 0) return null
  return (
    <div style={{ marginTop: 10, fontFamily: mono, fontSize: '0.76rem', lineHeight: 1.65, color, fontStyle: block.role === 'footer' ? 'italic' : undefined }}>
      {lines.map((l, i) => (
        <div key={i} style={{ paddingLeft: l.startsWith('  ') ? 14 : 0, overflowWrap: 'break-word' }}>{keepFigures(l.trim())}</div>
      ))}
    </div>
  )
}

function List({ block }: { block: ListBlock }) {
  return (
    <div>
      <div style={headingStyle}>{block.title}</div>
      <ul style={{ margin: 0, padding: 0, listStyle: 'none', fontFamily: mono, fontSize: '0.76rem', lineHeight: 1.6 }}>
        {block.items.map((it, i) => (
          <li key={i} style={{ display: 'flex', gap: 8, padding: '2px 0', color: it.kind === 'warn' ? 'var(--red)' : 'var(--text)' }}>
            <span aria-hidden style={{ flexShrink: 0, width: 10, color: it.kind === 'warn' ? 'var(--red)' : 'var(--muted2)' }}>{it.kind === 'warn' ? '!' : '•'}</span>
            <span style={{ overflowWrap: 'break-word', minWidth: 0 }}>{keepFigures(it.text)}</span>
          </li>
        ))}
      </ul>
    </div>
  )
}

function Comment({ block }: { block: CommentBlock }) {
  return (
    <div data-testid="finance-comment" style={{ marginTop: 18, borderLeft: '3px solid var(--gold)', paddingLeft: 12 }}>
      <div style={{ ...headingStyle, margin: '0 0 6px', fontSize: '0.72rem' }}>Comment</div>
      {block.sections.length === 0 && <div style={{ fontFamily: mono, fontSize: '0.8rem', color: 'var(--muted2)' }}>{block.fallback}</div>}
      {block.sections.map((s) => (
        <section key={s.id} style={{ marginTop: 10 }}>
          <h4 style={{ margin: '0 0 4px', fontFamily: serif, fontSize: '0.64rem', letterSpacing: '0.12em', color: s.id === 'WHY' || s.id === 'IDEAS' ? 'var(--teal)' : 'var(--gold)', textTransform: 'uppercase' }}>{s.title}</h4>
          <ul style={{ margin: 0, paddingLeft: 18, fontFamily: mono, fontSize: '0.86rem', lineHeight: 1.7, color: 'var(--text)' }}>
            {s.items.map((it, i) => (
              <li key={i} style={{ overflowWrap: 'break-word', marginBottom: 2 }}><InlineText text={it} /></li>
            ))}
          </ul>
        </section>
      ))}
    </div>
  )
}

export function FinanceAnswer({ blocks }: { blocks: FinanceBlock[] }) {
  const [copyState, setCopyState] = useState<'idle' | 'copied' | 'error'>('idle')
  async function handleCopy() {
    // the plain text comes from the SAME blocks as the panel — no second path that formats figures
    const res = await copyText(blocksToText(blocks))
    setCopyState(res.ok ? 'copied' : 'error')
    setTimeout(() => setCopyState('idle'), 2200)
  }
  return (
    <div data-testid="finance-answer" className="gieniu-response-text">
      {blocks.map((b, i) => {
        switch (b.type) {
          case 'table': return <Table key={i} block={b} />
          case 'text': return <Lines key={i} block={b} />
          case 'list': return <List key={i} block={b} />
          case 'comment': return <Comment key={i} block={b} />
          default: return null
        }
      })}
      <div style={{ marginTop: 14 }}>
        <button
          className="btn-sm"
          onClick={handleCopy}
          style={copyState === 'error' ? { borderColor: 'var(--orange)', color: 'var(--orange)' } : undefined}
        >
          {copyState === 'copied' ? '✓ COPIED' : copyState === 'error' ? '⚠ COPY FAILED' : '⧉ COPY ANSWER'}
        </button>
      </div>
    </div>
  )
}
