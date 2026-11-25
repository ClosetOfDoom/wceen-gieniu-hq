import { useCallback, useEffect, useState } from 'react'
import {
  connectGoogleUrl, disconnectGoogle, fetchMailStatus, previewReply, sendReply, skipMail, triageInbox,
  type BuyerStatus, type InboxItem, type MailStatus, type Preview, type TemplateInfo, type Triage,
} from '../services/mail'

const MONO = { fontFamily: 'var(--font-mono)' } as const
const fmt = (iso: string | null | undefined) =>
  iso ? new Date(iso).toLocaleString('en-GB', { timeZone: 'Europe/Warsaw', day: '2-digit', month: 'short', hour: '2-digit', minute: '2-digit' }) : '—'

const BUYER: Record<BuyerStatus, { color: string; text: (i: InboxItem) => string }> = {
  verified: { color: 'var(--emerald)', text: (i) => `✔ paid order found: ${i.buyer.orders[0]?.product ?? 'order'}${i.buyer.orders[0]?.date ? ` (${i.buyer.orders[0].date})` : ''}` },
  unverified: { color: 'var(--red)', text: () => '⚠ no matching paid order for this address: check before sending' },
  unknown: { color: 'var(--amber)', text: () => '? the order check could not run: check before sending' },
  'n/a': { color: 'var(--muted2)', text: () => '' },
}

function ItemCard({ item, templates, onDone }: { item: InboxItem; templates: TemplateInfo[]; onDone: (id: string, outcome: 'replied' | 'skipped') => void }) {
  const [templateId, setTemplateId] = useState(item.template ?? '')
  const [code, setCode] = useState('')
  const [preview, setPreview] = useState<Preview | null>(null)
  const [force, setForce] = useState(false)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const tpl = templates.find((t) => t.id === templateId)
  const needsForce = item.buyer.status !== 'verified'
  const ready = Boolean(tpl) && (!tpl!.needsCode || code.trim().length >= 6) && (!needsForce || force)

  const run = async (fn: () => Promise<void>) => {
    setBusy(true); setError(null)
    try { await fn() } catch (e) { setError(e instanceof Error ? e.message : String(e)) } finally { setBusy(false) }
  }

  const doPreview = () => run(async () => setPreview(await previewReply(templateId, code)))
  const doSend = () => run(async () => {
    const label = tpl?.label ?? templateId
    if (!window.confirm(`Send the template “${label}” to ${item.to}?\n\nIt goes out from the foundation’s mailbox, in this thread.`)) return
    await sendReply({ messageId: item.id, templateId, code: code.trim() || undefined, confirmUnverified: needsForce ? true : undefined })
    onDone(item.id, 'replied')
  })
  const doSkip = () => run(async () => { await skipMail(item.id); onDone(item.id, 'skipped') })

  const badge = item.kind === 'access-request' ? { t: 'ACCESS REQUEST', c: 'var(--gold, #fbbf24)' } : item.kind === 'sensitive' ? { t: 'FOR YOU ONLY', c: 'var(--red)' } : { t: 'PERSON', c: 'var(--muted2)' }

  return (
    <div className="card" style={{ padding: 14, marginBottom: 10 }} data-testid="mail-item">
      <div style={{ ...MONO, fontSize: '0.74rem', lineHeight: 1.6 }}>
        <span style={{ border: `1px solid ${badge.c}`, color: badge.c, borderRadius: 3, padding: '0 5px', fontSize: '0.64rem', marginRight: 8 }}>{badge.t}</span>
        <b>{item.fromName || item.from}</b> <span style={{ color: 'var(--muted2)' }}>&lt;{item.to}&gt; · {fmt(item.date)}</span>
        <div style={{ fontWeight: 700 }}>{item.subject || '(no subject)'}</div>
        <div style={{ color: 'var(--muted2)' }}>{item.snippet}</div>
        {item.kind === 'access-request' && <div style={{ color: BUYER[item.buyer.status].color }}>{BUYER[item.buyer.status].text(item)}</div>}
        {item.kind !== 'access-request' && <div style={{ color: 'var(--muted2)' }}>{item.reason}</div>}
      </div>

      {item.canReply && (
        <div style={{ marginTop: 10, display: 'flex', flexWrap: 'wrap', gap: 8, alignItems: 'center' }}>
          <select value={templateId} onChange={(e) => { setTemplateId(e.target.value); setPreview(null) }} aria-label="Reply template" style={{ ...MONO, fontSize: '0.74rem', maxWidth: '100%' }}>
            <option value="">— choose a template —</option>
            {templates.map((t) => <option key={t.id} value={t.id}>{t.label}</option>)}
          </select>
          {item.confidence === 'low' && <span style={{ ...MONO, fontSize: '0.68rem', color: 'var(--amber)' }}>several products mentioned: choose</span>}
          {tpl?.needsCode && (
            <input value={code} onChange={(e) => { setCode(e.target.value); setPreview(null) }} placeholder="customer’s activation code" aria-label="Activation code" style={{ ...MONO, fontSize: '0.74rem', minWidth: 190 }} />
          )}
          <button className="btn-sm" disabled={busy || !templateId} onClick={doPreview}>Preview</button>
          <button className="btn-sm" disabled={busy} onClick={doSkip}>Skip</button>
        </div>
      )}
      {!item.canReply && <div style={{ marginTop: 8 }}><button className="btn-sm" disabled={busy} onClick={doSkip}>Hide (label only)</button></div>}

      {preview && (
        <div style={{ ...MONO, fontSize: '0.72rem', marginTop: 10, border: '1px solid var(--border, #333)', borderRadius: 4, padding: 10, maxHeight: 260, overflowY: 'auto', whiteSpace: 'pre-wrap' }}>
          <b>Subject: {preview.subject}</b>{'\n\n'}{preview.plain}
        </div>
      )}
      {preview && (
        <div style={{ marginTop: 10, display: 'flex', flexWrap: 'wrap', gap: 10, alignItems: 'center' }}>
          {needsForce && (
            <label style={{ ...MONO, fontSize: '0.72rem', color: 'var(--red)' }}>
              <input type="checkbox" checked={force} onChange={(e) => setForce(e.target.checked)} /> send anyway: I have checked that this person paid
            </label>
          )}
          <button className="btn-sm" disabled={busy || !ready} onClick={doSend} style={{ borderColor: 'var(--emerald)', color: 'var(--emerald)' }}>
            {busy ? 'Sending…' : 'Approve and send'}
          </button>
          {tpl?.needsCode && code.trim().length < 6 && <span style={{ ...MONO, fontSize: '0.68rem', color: 'var(--amber)' }}>type the activation code first</span>}
        </div>
      )}
      {error && <div style={{ ...MONO, fontSize: '0.72rem', color: 'var(--red)', marginTop: 8 }}>{error}</div>}
    </div>
  )
}

function Setup({ configured }: { configured: boolean }) {
  return (
    <div className="card" style={{ padding: 14 }}>
      <div className="section-title section-title-gold" style={{ marginBottom: 8 }}>One-time Google setup</div>
      <ol style={{ ...MONO, fontSize: '0.74rem', lineHeight: 1.8, paddingLeft: 18, margin: 0 }}>
        <li>console.cloud.google.com: create a project under the foundation’s Google Workspace organisation, enable the <b>Gmail API</b>.</li>
        <li>OAuth consent screen: user type <b>Internal</b> (no Google verification, and the token does not expire after 7 days). Scopes: <b>gmail.modify</b> and <b>gmail.send</b>.</li>
        <li>Credentials → OAuth client ID → <b>Web application</b>. Authorised redirect URI: <b>{window.location.origin}/.netlify/functions/mail-oauth-callback</b></li>
        <li>Netlify → Environment variables: <b>GOOGLE_CLIENT_ID</b> and <b>GOOGLE_CLIENT_SECRET</b>, then redeploy.</li>
        <li>Come back here and press “Connect Google”.</li>
      </ol>
      {!configured && <div style={{ ...MONO, fontSize: '0.72rem', color: 'var(--amber)', marginTop: 8 }}>The two variables are not set yet.</div>}
    </div>
  )
}

export function MailPanel() {
  const [status, setStatus] = useState<MailStatus | null>(null)
  const [triage, setTriage] = useState<Triage | null>(null)
  const [done, setDone] = useState<Record<string, 'replied' | 'skipped'>>({})
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const loadInbox = useCallback(async () => {
    setBusy(true); setError(null)
    try { setTriage(await triageInbox()); setDone({}) } catch (e) { setError(e instanceof Error ? e.message : String(e)) } finally { setBusy(false) }
  }, [])

  const loadStatus = useCallback(async () => {
    try {
      const s = await fetchMailStatus()
      setStatus(s)
      if (s.connected && !s.invalid) void loadInbox()
    } catch (e) { setError(e instanceof Error ? e.message : String(e)) }
  }, [loadInbox])

  useEffect(() => { void loadStatus() }, [loadStatus])

  const connect = async () => {
    setError(null)
    try { window.open((await connectGoogleUrl()).url, '_blank', 'noopener') } catch (e) { setError(e instanceof Error ? e.message : String(e)) }
  }
  const disconnect = async () => {
    if (!window.confirm('Disconnect Google? Stanley will stop reading the inbox.')) return
    try { await disconnectGoogle(); setTriage(null); await loadStatus() } catch (e) { setError(e instanceof Error ? e.message : String(e)) }
  }

  const connected = Boolean(status?.connected && !status.invalid)
  const items = (triage?.items ?? []).filter((i) => !done[i.id])
  const c = triage?.counts

  return (
    <div style={{ display: 'grid', gap: 12 }}>
      <div className="section-title section-title-gold">Mail · access requests and replies</div>
      <div style={{ ...MONO, fontSize: '0.74rem', lineHeight: 1.7, color: 'var(--muted2)' }}>
        Stanley reads headers and the first lines only, never deletes anything, and answers a customer only after you press “Approve and send”.
        Invoices, refunds, complaints, banks, authorities and system mail are never answered. The replies are the Polish templates from PAKIETY.
      </div>

      {error && <div style={{ ...MONO, fontSize: '0.74rem', color: 'var(--red)' }}>{error}</div>}

      {status && !connected && (
        <>
          {status.invalid && <div style={{ ...MONO, fontSize: '0.74rem', color: 'var(--amber)' }}>Google access was revoked or expired: connect again.</div>}
          <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
            <button className="btn-sm" disabled={!status.configured} onClick={connect}>Connect Google</button>
            <button className="btn-sm" onClick={() => void loadStatus()}>I connected it: refresh</button>
          </div>
          <Setup configured={status.configured} />
        </>
      )}

      {connected && (
        <>
          <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap', alignItems: 'center', ...MONO, fontSize: '0.74rem' }}>
            <span style={{ color: 'var(--emerald)' }}>● connected{status?.email ? ` as ${status.email}` : ''}</span>
            <button className="btn-sm" disabled={busy} onClick={() => void loadInbox()}>{busy ? 'Reading…' : 'Check inbox'}</button>
            <button className="btn-sm" onClick={disconnect}>Disconnect</button>
          </div>
          {c && (
            <div style={{ ...MONO, fontSize: '0.74rem', color: 'var(--muted2)' }} data-testid="mail-counts">
              {c.scanned} messages checked · {c.access} access request{c.access === 1 ? '' : 's'} · {c.human + c.sensitive} from people · ignored: {c.automated} automated, {c.protected} system/bank/authority
            </div>
          )}
          {triage && items.length === 0 && !busy && <div style={{ ...MONO, fontSize: '0.78rem', color: 'var(--emerald)' }}>Nothing is waiting for you in the inbox, sir.</div>}
          {triage && items.map((i) => (
            <ItemCard key={i.id} item={i} templates={triage.templates} onDone={(id, outcome) => setDone((d) => ({ ...d, [id]: outcome }))} />
          ))}
          {Object.keys(done).length > 0 && (
            <div style={{ ...MONO, fontSize: '0.72rem', color: 'var(--emerald)' }}>
              {Object.values(done).filter((v) => v === 'replied').length} replied · {Object.values(done).filter((v) => v === 'skipped').length} skipped in this session
            </div>
          )}
        </>
      )}
    </div>
  )
}
