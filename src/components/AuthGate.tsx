import { useEffect, useState, type FormEvent, type ReactNode } from 'react'
import { checkPassword, getToken, onAuthLost, setToken, type PasswordCheck } from '../lib/stanleyAuth'

// Password screen in front of the whole app: nothing of the app (so no function call) starts
// until the password has been accepted. Logging out, or a 401 from any function, brings it back.

const MESSAGES: Record<Exclude<PasswordCheck, 'ok'>, string> = {
  wrong: 'Nieprawidłowe hasło.',
  unconfigured: 'Serwer nie ma ustawionego hasła (zmienna STANLEY_ACCESS_TOKEN w Netlify).',
  unreachable: 'Nie udało się połączyć z serwerem. Spróbuj ponownie.',
}

export function AuthGate({ children }: { children: ReactNode }) {
  const [authed, setAuthed] = useState<boolean>(() => !!getToken())
  const [password, setPassword] = useState('')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => onAuthLost(() => {
    setAuthed(false)
    setPassword('')
  }), [])

  if (authed) return <>{children}</>

  async function submit(e: FormEvent) {
    e.preventDefault()
    if (!password || busy) return
    setBusy(true)
    setError(null)
    const result = await checkPassword(password)
    setBusy(false)
    if (result === 'ok') {
      setToken(password)
      setPassword('')
      setAuthed(true)
    } else {
      setError(MESSAGES[result])
    }
  }

  return (
    <div
      data-testid="password-screen"
      style={{ minHeight: '100vh', display: 'flex', alignItems: 'center', justifyContent: 'center', padding: '24px', background: 'var(--bg)' }}
    >
      <form
        onSubmit={submit}
        style={{
          width: '100%', maxWidth: '340px', padding: '28px 24px', borderRadius: '12px',
          background: 'var(--surface)', border: '1px solid var(--border)', display: 'flex', flexDirection: 'column', gap: '14px',
        }}
      >
        <h1 style={{ fontFamily: 'var(--font-display)', fontSize: '1.2rem', fontWeight: 700, color: 'var(--gold)', letterSpacing: '0.14em', textAlign: 'center' }}>
          STANLEY HQ
        </h1>
        <label htmlFor="stanley-password" style={{ fontFamily: 'var(--font-sans)', fontSize: '0.8rem', color: 'var(--muted)' }}>
          Hasło
        </label>
        <input
          id="stanley-password"
          name="password"
          type="password"
          autoComplete="current-password"
          autoFocus
          value={password}
          onChange={(e) => setPassword(e.target.value)}
          style={{
            padding: '10px 12px', borderRadius: '8px', border: '1px solid var(--border)',
            background: 'var(--surface2)', color: 'var(--text)', fontFamily: 'var(--font-sans)', fontSize: '1rem',
          }}
        />
        {error && (
          <div role="alert" style={{ fontFamily: 'var(--font-sans)', fontSize: '0.8rem', color: 'var(--red)' }}>
            {error}
          </div>
        )}
        <button type="submit" className="btn-sm" disabled={busy || !password} style={{ padding: '10px 12px' }}>
          {busy ? '…' : 'Wejdź'}
        </button>
      </form>
    </div>
  )
}
