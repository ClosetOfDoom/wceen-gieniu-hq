import { useState, useEffect, useRef } from 'react'

export type Theme = 'dark' | 'light'

// "Sunny Pond" follows the local clock:
//   06:00–17:59 → light ("pond in sun") · 18:00–05:59 → dark ("pond at dusk").
export function autoThemeForNow(): Theme {
  const h = new Date().getHours()
  return h >= 6 && h < 18 ? 'light' : 'dark'
}

// Auto is the default startup state and keeps tracking the clock. A manual toggle
// is a SECONDARY option: once the user clicks it, their choice wins for the rest of
// the session and auto stops overriding it. The override lives in React state only
// (session memory) — nothing is persisted to localStorage.
export function useTheme(): { theme: Theme; toggleTheme: () => void } {
  const [theme, setTheme] = useState<Theme>(() => autoThemeForNow())
  const overriddenRef = useRef(false)

  useEffect(() => {
    document.documentElement.setAttribute('data-theme', theme)
  }, [theme])

  // Keep following the clock (e.g. across the 18:00 boundary) until — and only
  // until — the user manually overrides this session.
  useEffect(() => {
    const id = setInterval(() => {
      if (!overriddenRef.current) setTheme(autoThemeForNow())
    }, 60 * 1000)
    return () => clearInterval(id)
  }, [])

  function toggleTheme() {
    overriddenRef.current = true   // manual choice wins for the rest of the session
    setTheme(prev => (prev === 'dark' ? 'light' : 'dark'))
  }

  return { theme, toggleTheme }
}
