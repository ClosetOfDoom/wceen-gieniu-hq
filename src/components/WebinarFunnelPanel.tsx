// Webinars tab.
//
// The tab is about PRODUCT SALES now: JSU (549) and Językozak AI (347) counted
// from the orders table via the canonical price table. Registrations, show-up
// rates and the whole email→registration→attendance funnel are gone from the
// view — those feeds stopped, and every "not populated" / "brak danych" cell was
// a promise about data that will not arrive.
//
// The webinar history survives underneath as an explicitly frozen snapshot, so
// nobody reads last quarter's attendance as a current number.

import { useEffect, useState } from 'react'
import { normalizeProduct, type ProductTag } from '../lib/webinarProduct'
import { ProductSalesPanel } from './ProductSalesPanel'
import { WebinarHistoryTable } from './WebinarHistoryTable'
import { fetchWebinarFunnelView, type FunnelViewRow } from '../services/webinarFunnelView'
import { ATTENDANCE_CUTOFF } from '../services/productSales'
import type { JsuCommandKey } from '../brain/responses'

interface Props {
  onCommand: (key: JsuCommandKey) => void
  gieniuResponse: string
}

const COMMANDS: JsuCommandKey[] = [
  'webinar jak się uczyć',
  'czemu kurs się nie sprzedaje',
]

export function WebinarFunnelPanel({ onCommand, gieniuResponse }: Props) {
  const [productFilter, setProductFilter] = useState<ProductTag | 'ALL'>('ALL')
  const [showHistory, setShowHistory] = useState(false)

  // The historical snapshot is loaded once, on demand. It is a closed set — no
  // refresh, no polling; new sessions do not land here any more.
  const [rows, setRows] = useState<FunnelViewRow[]>([])
  const [error, setError] = useState<string | null>(null)
  const [loaded, setLoaded] = useState(false)

  useEffect(() => {
    if (!showHistory || loaded) return
    let alive = true
    fetchWebinarFunnelView().then(r => {
      if (!alive) return
      setRows(r.rows)
      setError(r.error)
      setLoaded(true)
    })
    return () => { alive = false }
  }, [showHistory, loaded])

  const filtered = rows.filter(
    r => productFilter === 'ALL' || normalizeProduct({ product_tag: r.product_tag }).canonicalTag === productFilter,
  )

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 22 }}>

      {/* ── Main view: product sales from orders ─────────────────────────── */}
      <ProductSalesPanel />

      {/* ── Stanley commands ─────────────────────────────────────────────── */}
      <div>
        <div style={{ display: 'flex', flexWrap: 'wrap', gap: 6 }}>
          {COMMANDS.map(key => (
            <button key={key} className="btn-sm" onClick={() => onCommand(key)}>{key}</button>
          ))}
        </div>
        {gieniuResponse && (
          <pre style={{
            whiteSpace: 'pre-wrap', fontFamily: 'var(--font-mono)', fontSize: '0.74rem',
            lineHeight: 1.7, color: 'var(--text2)', background: 'var(--surface)',
            border: '1px solid var(--border)', borderLeft: '3px solid var(--gold)',
            borderRadius: 4, padding: '10px 12px', margin: '10px 0 0',
          }}>
            {gieniuResponse}
          </pre>
        )}
      </div>

      {/* ── Historical snapshot ──────────────────────────────────────────── */}
      <div>
        <div style={{
          border: '1px solid var(--border)', borderLeft: '3px solid var(--muted2)',
          borderRadius: 4, background: 'var(--surface)', padding: '11px 14px',
        }}>
          <div style={{ display: 'flex', alignItems: 'baseline', justifyContent: 'space-between', flexWrap: 'wrap', gap: 8 }}>
            <div>
              <div style={{ fontFamily: 'var(--font-serif)', fontSize: '0.8rem', color: 'var(--text2)', letterSpacing: '0.1em', textTransform: 'uppercase' }}>
                Historia webinarów
              </div>
              <div style={{ fontFamily: 'var(--font-mono)', fontSize: '0.66rem', color: 'var(--amber)', marginTop: 3 }}>
                SNAPSHOT HISTORYCZNY DO {ATTENDANCE_CUTOFF} · nie odświeża się
              </div>
              <div style={{ fontFamily: 'var(--font-mono)', fontSize: '0.62rem', color: 'var(--muted2)', marginTop: 3 }}>
                Frekwencja i czas w pokoju nie są już zbierane. Te liczby zamarły na {ATTENDANCE_CUTOFF} — nie są bieżące.
              </div>
            </div>
            <button className="btn-sm" onClick={() => setShowHistory(v => !v)}>
              {showHistory ? 'Ukryj snapshot' : 'Pokaż snapshot'}
            </button>
          </div>
        </div>

        {showHistory && (
          <div style={{ marginTop: 12 }}>
            <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap', marginBottom: 10 }}>
              {(['ALL', 'JSU', 'JZK'] as const).map(t => (
                <button
                  key={t}
                  onClick={() => setProductFilter(t as ProductTag | 'ALL')}
                  style={{
                    fontFamily: 'var(--font-mono)', fontSize: '0.66rem', padding: '3px 10px', borderRadius: 3, cursor: 'pointer',
                    border: `1px solid ${productFilter === t ? 'var(--border-gold)' : 'var(--border)'}`,
                    background: productFilter === t ? 'var(--surface2)' : 'transparent',
                    color: productFilter === t ? 'var(--gold)' : 'var(--muted)',
                  }}
                >{t === 'ALL' ? 'Wszystkie' : t}</button>
              ))}
            </div>

            {!loaded ? (
              <div style={{ fontFamily: 'var(--font-mono)', fontSize: '0.72rem', color: 'var(--muted)' }}>Ładowanie snapshotu…</div>
            ) : error ? (
              <div style={{ fontFamily: 'var(--font-mono)', fontSize: '0.72rem', color: 'var(--orange)' }}>v_webinar_funnel: {error}</div>
            ) : (
              <WebinarHistoryTable rows={filtered} />
            )}
          </div>
        )}
      </div>
    </div>
  )
}
