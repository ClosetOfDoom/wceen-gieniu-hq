// JSU / Językozak AI sales — the main Webinars view.
//
// One source: the orders table, classified by the canonical price table
// (549 = Kurs Jak się uczyć, 347 = Językozak AI). No registrations, no
// attendance, no funnel rates — the pipelines behind those stopped, and a
// number derived from them would promise data that no longer arrives.

import { useEffect, useState } from 'react'
import { fetchProductSales, type ProductSalesData, type SalesBucket, type ProductBucket } from '../services/productSales'

const RANGES = [7, 30, 90] as const

const fmtPln = (n: number) => Math.round(n).toLocaleString('pl-PL') + ' PLN'

const fmtDay = (iso: string) =>
  new Date(iso + 'T12:00:00Z').toLocaleDateString('pl-PL', { day: '2-digit', month: '2-digit', weekday: 'short' })

function weekLabel(mondayISO: string): string {
  const end = new Date(Date.parse(mondayISO + 'T12:00:00Z') + 6 * 86400000).toISOString().slice(0, 10)
  const f = (d: string) => new Date(d + 'T12:00:00Z').toLocaleDateString('pl-PL', { day: '2-digit', month: '2-digit' })
  return `${f(mondayISO)} – ${f(end)}`
}

const JSU = { color: 'var(--gold)', label: 'Kurs Jak się uczyć', price: 549 }
const JZK = { color: 'var(--teal)', label: 'Językozak AI', price: 347 }

export function ProductSalesPanel() {
  const [days, setDays] = useState<number>(30)
  const [data, setData] = useState<ProductSalesData | null>(null)
  const [loading, setLoading] = useState(true)
  const [mode, setMode] = useState<'day' | 'week'>('day')
  const [openKey, setOpenKey] = useState<string | null>(null)

  useEffect(() => {
    let alive = true
    setLoading(true)
    fetchProductSales(days).then(d => {
      if (!alive) return
      setData(d)
      setLoading(false)
    })
    return () => { alive = false }
  }, [days])

  const buckets: SalesBucket[] = (mode === 'day' ? data?.byDay : data?.byWeek) ?? []

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>
      <div style={{ display: 'flex', alignItems: 'baseline', justifyContent: 'space-between', flexWrap: 'wrap', gap: 10 }}>
        <div>
          <div style={{ fontFamily: 'var(--font-serif)', fontWeight: 700, fontSize: '1rem', color: 'var(--gold)', letterSpacing: '0.05em' }}>
            SPRZEDAŻ PRODUKTÓW
          </div>
          <div style={{ fontSize: '0.66rem', color: 'var(--muted)', fontFamily: 'var(--font-mono)', marginTop: 4 }}>
            Wyłącznie z tabeli orders · ceny kanoniczne: 549 = JSU · 347 = Językozak AI
          </div>
        </div>
        <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap' }}>
          {RANGES.map(r => (
            <Chip key={r} active={days === r} onClick={() => setDays(r)}>{r} dni</Chip>
          ))}
        </div>
      </div>

      {loading ? (
        <div style={{ fontFamily: 'var(--font-mono)', fontSize: '0.75rem', color: 'var(--muted)' }}>Ładowanie sprzedaży…</div>
      ) : !data?.ok ? (
        <div style={{ fontFamily: 'var(--font-mono)', fontSize: '0.75rem', color: 'var(--orange)' }}>
          Nie mogę odczytać zamówień{data?.error ? `: ${data.error}` : '.'}
        </div>
      ) : (
        <>
          {/* Totals for the chosen range */}
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(210px, 1fr))', gap: 12 }}>
            <TotalCard p={JSU} b={data.totals.jsu} days={data.days} />
            <TotalCard p={JZK} b={data.totals.jzk} days={data.days} />
          </div>

          <div style={{ display: 'flex', gap: 6 }}>
            <Chip active={mode === 'day'} onClick={() => { setMode('day'); setOpenKey(null) }}>Per dzień</Chip>
            <Chip active={mode === 'week'} onClick={() => { setMode('week'); setOpenKey(null) }}>Per tydzień</Chip>
          </div>

          {buckets.length === 0 ? (
            <div style={{ fontFamily: 'var(--font-mono)', fontSize: '0.75rem', color: 'var(--muted)' }}>
              Żadnej sprzedaży JSU ani Językozaka w tym zakresie.
            </div>
          ) : (
            <div style={{ display: 'grid', gap: 3 }}>
              {buckets.map(b => (
                <BucketRow
                  key={b.key}
                  b={b}
                  mode={mode}
                  open={openKey === b.key}
                  onToggle={() => setOpenKey(k => (k === b.key ? null : b.key))}
                />
              ))}
            </div>
          )}

          <div style={{ fontFamily: 'var(--font-mono)', fontSize: '0.62rem', color: 'var(--muted2)' }}>
            Źródło: {data.source_table} · {data.from} → {data.today_warsaw} · {data.ordersScannedInRange} zamówień w zakresie.
            Kliknij wiersz, aby zobaczyć kupujących. E-maile maskowane.
          </div>
        </>
      )}
    </div>
  )
}

function TotalCard({ p, b, days }: { p: typeof JSU; b: ProductBucket; days: number }) {
  return (
    <div style={{
      background: 'var(--surface)', border: '1px solid var(--border)',
      borderLeft: `3px solid ${p.color}`, borderRadius: 4, padding: '12px 14px',
    }}>
      <div style={{ fontFamily: 'var(--font-mono)', fontSize: '0.62rem', color: p.color, textTransform: 'uppercase', letterSpacing: '0.1em' }}>
        {p.label} · {p.price} PLN
      </div>
      <div style={{ display: 'flex', alignItems: 'baseline', gap: 10, marginTop: 6 }}>
        <span style={{ fontFamily: 'var(--font-mono)', fontSize: '1.6rem', fontWeight: 700, color: 'var(--text)', fontVariantNumeric: 'tabular-nums' }}>
          {b.count}
        </span>
        <span style={{ fontFamily: 'var(--font-mono)', fontSize: '0.85rem', color: b.revenue > 0 ? 'var(--emerald)' : 'var(--muted2)' }}>
          {fmtPln(b.revenue)}
        </span>
      </div>
      <div style={{ fontFamily: 'var(--font-mono)', fontSize: '0.62rem', color: 'var(--muted2)', marginTop: 2 }}>
        sprzedaży w {days} dniach
      </div>
    </div>
  )
}

function BucketRow({ b, mode, open, onToggle }: { b: SalesBucket; mode: 'day' | 'week'; open: boolean; onToggle: () => void }) {
  const total = b.jsu.count + b.jzk.count
  const revenue = b.jsu.revenue + b.jzk.revenue
  const buyers = [...b.jsu.buyers, ...b.jzk.buyers].sort((x, y) => (x.at < y.at ? 1 : -1))

  return (
    <div style={{ border: '1px solid var(--border)', borderRadius: 4, background: open ? 'var(--surface2)' : 'var(--surface)' }}>
      <div
        role="button"
        tabIndex={0}
        aria-expanded={open}
        onClick={onToggle}
        onKeyDown={e => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); onToggle() } }}
        style={{
          display: 'flex', alignItems: 'center', gap: 10, flexWrap: 'wrap',
          padding: '7px 12px', cursor: 'pointer', fontFamily: 'var(--font-mono)', fontSize: '0.72rem',
        }}
      >
        <span aria-hidden="true" style={{ color: 'var(--muted2)', fontSize: '0.7rem' }}>{open ? '▾' : '▸'}</span>
        <span style={{ color: 'var(--text2)', minWidth: 120 }}>
          {mode === 'day' ? fmtDay(b.key) : weekLabel(b.key)}
        </span>
        <span style={{ color: JSU.color }}>JSU {b.jsu.count}</span>
        <span style={{ color: JZK.color }}>JZK {b.jzk.count}</span>
        <span style={{ color: 'var(--muted)', marginLeft: 'auto' }}>{total} szt.</span>
        <span style={{ color: revenue > 0 ? 'var(--emerald)' : 'var(--muted2)', minWidth: 90, textAlign: 'right' }}>
          {fmtPln(revenue)}
        </span>
      </div>

      {open && (
        <div style={{ padding: '0 12px 10px 26px', borderTop: '1px solid var(--border)', paddingTop: 8, overflowX: 'auto' }}>
          <table style={{ width: '100%', borderCollapse: 'collapse', fontFamily: 'var(--font-mono)', fontSize: '0.68rem', minWidth: 420 }}>
            <thead>
              <tr style={{ color: 'var(--muted2)', textAlign: 'left' }}>
                <th style={{ padding: '3px 8px' }}>E-mail</th>
                <th style={{ padding: '3px 8px' }}>Produkt</th>
                <th style={{ padding: '3px 8px', textAlign: 'right' }}>Kwota</th>
                <th style={{ padding: '3px 8px' }}>Data</th>
              </tr>
            </thead>
            <tbody>
              {buyers.map((x, i) => (
                <tr key={i} style={{ borderTop: '1px solid var(--border)', color: 'var(--text2)' }}>
                  <td style={{ padding: '3px 8px', whiteSpace: 'nowrap' }}>{x.email}</td>
                  <td style={{ padding: '3px 8px', color: x.amount === JSU.price ? JSU.color : JZK.color, whiteSpace: 'nowrap' }}>
                    {x.amount === JSU.price ? 'JSU' : 'Językozak AI'}
                  </td>
                  <td style={{ padding: '3px 8px', textAlign: 'right', whiteSpace: 'nowrap' }}>{fmtPln(x.amount)}</td>
                  <td style={{ padding: '3px 8px', whiteSpace: 'nowrap' }}>
                    {x.at ? new Date(x.at).toLocaleString('pl-PL', { day: '2-digit', month: '2-digit', hour: '2-digit', minute: '2-digit' }) : x.date}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  )
}

function Chip({ active, onClick, children }: { active: boolean; onClick: () => void; children: React.ReactNode }) {
  return (
    <button
      onClick={onClick}
      style={{
        fontFamily: 'var(--font-mono)', fontSize: '0.66rem', padding: '3px 10px', borderRadius: 3, cursor: 'pointer',
        border: `1px solid ${active ? 'var(--border-gold)' : 'var(--border)'}`,
        background: active ? 'var(--surface2)' : 'transparent',
        color: active ? 'var(--gold)' : 'var(--muted)',
      }}
    >{children}</button>
  )
}
