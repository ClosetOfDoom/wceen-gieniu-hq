import { useCallback, useEffect, useState } from 'react'
import {
  ackMailFailure, dryRunSlot, fetchWebinarMailStatus, sendTestMail, setMailState, setRegistrations,
  type MailAlert, type MailSlot, type RunRecord, type SendRow, type SlotQueue, type WebinarMailStatus,
} from '../services/webinarMail'
import { isProductionSend, isTestEntry, sendStatusView } from '../../netlify/shared/webinarMailStatus.js'

const MONO = { fontFamily: 'var(--font-mono)' } as const
const fmtWarsaw = (iso: string | null | undefined) =>
  iso ? new Date(iso).toLocaleString('pl-PL', { timeZone: 'Europe/Warsaw', weekday: 'short', day: '2-digit', month: '2-digit', hour: '2-digit', minute: '2-digit' }) : '—'
const SLOT_SHORT: Record<MailSlot, string> = { tuesday: 'wtorek', thursday: 'czwartek' }
const VARIANT_LABEL: Record<string, string> = { landing: 'landing', clickmeeting: 'ClickMeeting' }
const TONE_COLOR = { ok: 'var(--emerald)', pending: 'var(--teal, var(--emerald))', error: 'var(--red)', muted: 'var(--muted2)' } as const

/** Status cell: the ONE mapping (sendStatusView), with a TEST badge on test publishes. */
function StatusCell({ row, now }: { row: SendRow; now: Date }) {
  const v = sendStatusView(row, now)
  return (
    <td style={{ color: TONE_COLOR[v.tone] }}>
      {v.test && <span data-testid="test-badge" style={{ border: '1px solid var(--amber)', color: 'var(--amber)', borderRadius: 3, padding: '0 4px', marginRight: 6, fontSize: '0.64rem' }}>TEST</span>}
      {v.code}{v.code === 'błąd' && row.error ? `: ${row.error.slice(0, 60)}` : ''}
    </td>
  )
}

/** Polls the status so the Command Center can show the red alerts without opening the tab. */
export function useWebinarMailAlerts(): MailAlert[] {
  const [alerts, setAlerts] = useState<MailAlert[]>([])
  useEffect(() => {
    let alive = true
    const load = () => fetchWebinarMailStatus().then((s) => { if (alive) setAlerts(s.alerts) }).catch(() => { /* the tab itself shows load errors */ })
    load()
    const id = window.setInterval(load, 5 * 60 * 1000)
    return () => { alive = false; window.clearInterval(id) }
  }, [])
  return alerts
}

function AlertLine({ a }: { a: MailAlert }) {
  const red = a.severity === 'red'
  return (
    <div style={{
      ...MONO, fontSize: '0.76rem', lineHeight: 1.6, padding: '8px 12px', borderRadius: 3,
      color: red ? 'var(--red)' : 'var(--amber)',
      background: red ? 'rgba(239,68,68,0.07)' : 'rgba(251,191,36,0.07)',
      border: `1px solid ${red ? 'rgba(239,68,68,0.25)' : 'rgba(251,191,36,0.25)'}`,
    }}>
      <b>{a.rule}</b> — {a.message}
    </div>
  )
}

export function MailAlertLines({ alerts }: { alerts: MailAlert[] }) {
  if (!alerts.length) return null
  return <>{alerts.map((a, i) => <AlertLine key={`${a.rule}-${i}`} a={a} />)}</>
}

function RunSummary({ run, title }: { run: RunRecord; title: string }) {
  const color = run.status === 'failed' ? 'var(--red)' : run.status === 'skipped' ? 'var(--muted2)' : 'var(--emerald)'
  return (
    <div style={{ ...MONO, fontSize: '0.72rem', lineHeight: 1.7, marginTop: 8 }}>
      <div><b>{title}</b> · {run.key} · <span style={{ color }}>{run.status} / {run.reason}</span></div>
      {run.detail && <div style={{ color: 'var(--muted2)' }}>{run.detail}</div>}
      {run.plan && (
        <div style={{ color: 'var(--muted2)' }}>
          szablon {run.plan.template} · wariant {VARIANT_LABEL[run.plan.variant] ?? run.plan.variant} · wysyłka {fmtWarsaw(run.plan.sendAt)} · temat „{run.plan.subject}”
        </div>
      )}
      {run.gates && run.gates.length > 0 && (
        <div style={{ color: 'var(--amber)' }}>bramki zamknięte (przy prawdziwym biegu nic by nie wyszło): {run.gates.map((g) => g.id).join(', ')}</div>
      )}
      {run.checks && (
        <div>{run.checks.map((c) => <div key={c.id} style={{ color: c.ok ? 'var(--emerald)' : 'var(--red)' }}>{c.ok ? '✔' : '✘'} {c.id} — {c.detail}</div>)}</div>
      )}
    </div>
  )
}

function QueueCard({ q, status, busy, onDryRun, onTest }: {
  q: SlotQueue; status: WebinarMailStatus; busy: boolean; onDryRun: () => void; onTest: () => void
}) {
  const variants = status.config.slots[q.slot].variants
  const tone = q.empty ? 'var(--red)' : q.low ? 'var(--amber)' : 'var(--emerald)'
  return (
    <div className="card" style={{ padding: 14, flex: '1 1 340px' }}>
      <div className="section-title section-title-gold" style={{ marginBottom: 8 }}>{q.label} · {status.config.slots[q.slot].webinarTime}</div>
      <div style={{ ...MONO, fontSize: '0.76rem', lineHeight: 1.7 }}>
        <div style={{ color: tone }}>
          w kolejce: <b>{q.readyCount}</b> gotowych · {q.blockedCount} zablokowanych · {q.usedCount} wykorzystanych
          {q.empty ? ' — KOLEJKA PUSTA' : q.low ? ` — mało (ostrzeżenie przy ≤ ${status.config.lowQueueThreshold})` : ''}
        </div>
        {q.loadError && <div style={{ color: 'var(--red)' }}>szablony: {q.loadError}</div>}
        <div style={{ color: 'var(--muted2)' }}>
          następny wariant linku: <b>{VARIANT_LABEL[q.nextVariant] ?? q.nextVariant}</b> ({variants[q.nextVariant]})
        </div>
        <div style={{ color: 'var(--muted2)' }}>
          następny szablon: {q.next ? <>„{q.next.subject}”{q.next.warnings.length ? ` (${q.next.warnings.join(', ')})` : ''}</> : '—'}
        </div>
      </div>
      <div style={{ display: 'flex', gap: 8, margin: '10px 0' }}>
        <button className="btn-sm" disabled={busy} onClick={onDryRun}>Próba (DRY RUN)</button>
        <button className="btn-sm" disabled={busy || !q.next} onClick={onTest}>Wyślij test na {status.config.testRecipient}</button>
      </div>
      <div style={{ ...MONO, fontSize: '0.7rem', lineHeight: 1.6, maxHeight: 180, overflowY: 'auto' }}>
        {q.entries.map((e) => (
          <div key={e.file} style={{ color: e.used ? 'var(--muted)' : e.blocked.length ? 'var(--red)' : 'var(--text, inherit)' }}>
            {e.used ? '✔ wysłany' : e.blocked.length ? '✘ zablokowany' : '· czeka'} · {e.file}
            {e.blocked.length > 0 && <div style={{ paddingLeft: 14 }}>powód: {e.blocked.join('; ')}</div>}
            {!e.blocked.length && e.warnings.length > 0 && <div style={{ paddingLeft: 14, color: 'var(--amber)' }}>{e.warnings.join('; ')}</div>}
          </div>
        ))}
      </div>
    </div>
  )
}

function RegistrationsCell({ row, onSaved }: { row: SendRow; onSaved: () => void }) {
  const [value, setValue] = useState(row.registrations == null ? '' : String(row.registrations))
  const [err, setErr] = useState<string | null>(null)
  const save = async () => {
    const trimmed = value.trim()
    const n = trimmed === '' ? null : Number(trimmed)
    if (n !== null && !(Number.isInteger(n) && n >= 0)) { setErr('liczba ≥ 0'); return }
    if (n === row.registrations) return
    try { await setRegistrations(row.key, n); setErr(null); onSaved() } catch (e) { setErr(e instanceof Error ? e.message : 'błąd') }
  }
  return (
    <span>
      <input
        value={value} inputMode="numeric" aria-label={`Rejestracje ClickMeeting ${row.date}`}
        onChange={(e) => setValue(e.target.value)} onBlur={save}
        style={{ ...MONO, width: 64, fontSize: '0.74rem', background: 'transparent', color: 'inherit', border: '1px solid var(--border)', borderRadius: 3, padding: '2px 6px' }}
      />
      {err && <span style={{ color: 'var(--red)', marginLeft: 6 }}>{err}</span>}
    </span>
  )
}

export function WebinarMailPanel() {
  const [status, setStatus] = useState<WebinarMailStatus | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)
  const [message, setMessage] = useState<string | null>(null)
  const [dry, setDry] = useState<RunRecord | null>(null)

  const load = useCallback(async () => {
    try { setStatus(await fetchWebinarMailStatus()); setError(null) } catch (e) { setError(e instanceof Error ? e.message : String(e)) }
  }, [])
  useEffect(() => { load() }, [load])

  const act = async (fn: () => Promise<void>) => {
    setBusy(true); setMessage(null)
    try { await fn() } catch (e) { setMessage(`Błąd: ${e instanceof Error ? e.message : String(e)}`) } finally { setBusy(false) }
  }

  if (error && !status) return <div style={{ ...MONO, color: 'var(--red)', fontSize: '0.8rem' }}>Maile webinarowe: nie udało się wczytać stanu ({error}).</div>
  if (!status) return <div style={{ ...MONO, color: 'var(--muted2)', fontSize: '0.8rem' }}>Wczytuję maile webinarowe…</div>

  const { state } = status
  const now = new Date(status.now)
  // Older backends (before T1) still sent tests inside `log`: split them here with the same shared rule.
  const production = status.log.filter((r) => !isTestEntry(r))
  const tests = [...(status.tests ?? []), ...status.log.filter((r) => isTestEntry(r))]
  const toggleAuto = () => act(async () => {
    if (!state.auto && !window.confirm('Włączyć AUTO? Od następnego wtorku/czwartku o 6:00 funkcja sama zaplanuje kampanię na 7:00 do WSZYSTKICH kontaktów Wix.')) return
    await setMailState({ auto: !state.auto }); await load()
  })
  const togglePause = () => act(async () => { await setMailState({ pause: !state.pause }); await load() })

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 14 }}>
      <div className="section-title section-title-gold">MAILE WEBINAROWE</div>

      <div style={{ ...MONO, fontSize: '0.76rem', lineHeight: 1.7, color: 'var(--muted2)' }}>
        Wtorek: webinar językowy · czwartek: webinar pamięciowy · oba 18:00. Funkcja budzi się o {String(status.config.wakeHour).padStart(2, '0')}:00 (czas warszawski),
        planuje wysyłkę na {status.config.sendAtLocal} do wszystkich kontaktów Wix. Pomija: {status.config.skipDates.join(', ')}.
        {status.nextWakeUp && <> Najbliższe wybudzenie: <b>{SLOT_SHORT[status.nextWakeUp.slot]} {fmtWarsaw(status.nextWakeUp.at)}</b>.</>}
      </div>

      <div style={{ display: 'flex', gap: 10, alignItems: 'center', flexWrap: 'wrap' }}>
        <button className="btn-sm" disabled={busy} onClick={toggleAuto}
          style={{ color: state.auto ? 'var(--emerald)' : 'var(--muted2)', borderColor: state.auto ? 'var(--emerald)' : undefined }}>
          AUTO: {state.auto ? 'ON' : 'OFF'}
        </button>
        <button className="btn-sm" disabled={busy} onClick={togglePause}
          style={{ color: state.pause ? 'var(--amber)' : 'var(--muted2)', borderColor: state.pause ? 'var(--amber)' : undefined }}>
          PAUZA: {state.pause ? 'ON (nic nie wyjdzie)' : 'OFF'}
        </button>
        <span style={{ ...MONO, fontSize: '0.7rem', color: 'var(--muted2)' }}>
          {state.auto && !state.pause ? 'maile wyjdą automatycznie' : 'maile NIE wyjdą (AUTO wyłączone albo PAUZA)'}
          {state.autoChangedAt ? ` · AUTO zmienione ${fmtWarsaw(state.autoChangedAt)}` : ''}
        </span>
      </div>

      {message && <div style={{ ...MONO, fontSize: '0.74rem', color: message.startsWith('Błąd') ? 'var(--red)' : 'var(--emerald)' }}>{message}</div>}

      <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
        {status.alerts.length === 0
          ? <div style={{ ...MONO, fontSize: '0.76rem', color: 'var(--emerald)' }}>Brak alarmów maili webinarowych.</div>
          : <MailAlertLines alerts={status.alerts} />}
        {status.alerts.some((a) => a.rule === 'MAILE_AWARIA') && (
          <div><button className="btn-sm" disabled={busy} onClick={() => act(async () => { await ackMailFailure(); await load() })}>Przyjąłem do wiadomości</button></div>
        )}
      </div>

      <div style={{ display: 'flex', gap: 14, flexWrap: 'wrap' }}>
        {status.queues.map((q) => (
          <QueueCard
            key={q.slot} q={q} status={status} busy={busy}
            onDryRun={() => act(async () => { const r = await dryRunSlot(q.slot); setDry(r.outcome); await load() })}
            onTest={() => act(async () => {
              if (!window.confirm(`Wysłać test „${q.next?.subject}” tylko do ${status.config.testRecipient}?

Ta sama ścieżka co produkcja (kampania w Wix), ale do jednego kontaktu. Mail wyjdzie za ok. ${status.config.testLeadMinutes} min: Wix nie przyjmuje wysyłki natychmiastowej. Do bazy kontaktów nic nie idzie, szablon nie jest zużywany.`)) return
              const r = await sendTestMail(q.slot)
              setMessage(`TEST zaplanowany na ${new Date(r.sendAt).toLocaleTimeString('pl-PL', { timeZone: 'Europe/Warsaw', hour: '2-digit', minute: '2-digit' })} do ${r.to}: „${r.subject}” (${VARIANT_LABEL[r.variant] ?? r.variant}), kampania ${r.campaignId.slice(0, 8)}. W sekcji Testy: „zaplanowany”, po tej godzinie „wysłany”.`)
              await load()
            })}
          />
        ))}
      </div>

      {dry && <div className="card" style={{ padding: 12 }}><RunSummary run={dry} title="Wynik próby (DRY RUN, nic nie opublikowano)" /></div>}
      {status.lastRun && <RunSummary run={status.lastRun} title="Ostatnie uruchomienie" />}

      <div>
        <div className="section-title" style={{ marginBottom: 8 }}>Wysyłki</div>
        {status.statsError && <div style={{ ...MONO, fontSize: '0.7rem', color: 'var(--amber)' }}>CTR z Wix niedostępny: {status.statsError}</div>}
        {production.length === 0 ? (
          <div style={{ ...MONO, fontSize: '0.76rem', color: 'var(--muted2)' }}>Żadna kampania nie poszła jeszcze przez Stanleya.</div>
        ) : (
          <div style={{ overflowX: 'auto' }}>
            <table style={{ ...MONO, fontSize: '0.72rem', borderCollapse: 'collapse', width: '100%' }}>
              <thead><tr style={{ color: 'var(--muted2)', textAlign: 'left' }}>
                <th style={{ padding: '4px 8px' }}>Data</th><th>Slot</th><th>Wariant</th><th>Status</th><th>Temat</th><th>CTR (Wix)</th><th>Rejestracje CM</th>
              </tr></thead>
              <tbody>
                {production.map((r) => (
                  <tr key={`${r.key}-${r.status}-${r.campaignId}`} style={{ borderTop: '1px solid var(--border)' }}>
                    <td style={{ padding: '4px 8px' }}>{r.date}</td>
                    <td>{SLOT_SHORT[r.slot]}</td>
                    <td>{r.variant ? (VARIANT_LABEL[r.variant] ?? r.variant) : '—'}</td>
                    <StatusCell row={r} now={now} />
                    <td>{r.subject}</td>
                    <td>{r.ctr == null ? '—' : `${r.ctr.toFixed(2)}% (${r.clicked}/${r.delivered})`}</td>
                    <td>{isProductionSend(r) ? <RegistrationsCell row={r} onSaved={load} /> : '—'}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>

      {tests.length > 0 && (
        <div data-testid="mail-tests">
          <div className="section-title" style={{ marginBottom: 8 }}>Testy</div>
          <div style={{ ...MONO, fontSize: '0.7rem', color: 'var(--muted2)', marginBottom: 6 }}>
            Publikacje „Wyślij test” tylko do {status.config.testRecipient}. Nie zużywają szablonu, nie liczą się do wariantów A/B ani CTR.
          </div>
          <div style={{ overflowX: 'auto' }}>
            <table style={{ ...MONO, fontSize: '0.72rem', borderCollapse: 'collapse', width: '100%' }}>
              <thead><tr style={{ color: 'var(--muted2)', textAlign: 'left' }}>
                <th style={{ padding: '4px 8px' }}>Data</th><th>Slot</th><th>Wariant</th><th>Status</th><th>Temat</th><th>Opublikowano</th>
              </tr></thead>
              <tbody>
                {tests.map((r) => (
                  <tr key={`${r.key}-${r.status}-${r.campaignId}-${r.createdAt}`} style={{ borderTop: '1px solid var(--border)' }}>
                    <td style={{ padding: '4px 8px' }}>{r.date}</td>
                    <td>{SLOT_SHORT[r.slot]}</td>
                    <td>{r.variant ? (VARIANT_LABEL[r.variant] ?? r.variant) : '—'}</td>
                    <StatusCell row={r} now={now} />
                    <td>{r.subject}</td>
                    <td>{fmtWarsaw(r.createdAt)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      )}
    </div>
  )
}
