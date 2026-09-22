// Copying text to the clipboard, with the fallback the modern API needs.
//
// navigator.clipboard.writeText refuses in more situations than it advertises:
// a non-secure origin, a document that is not focused, a permission the browser
// declines, or an iOS webview that never implemented it. Every one of those
// rejects rather than throwing at call time, so the caller finds out only if it
// awaits. The legacy execCommand path still works in all of them.
//
// The result is RETURNED, never swallowed: a COPY button that silently does
// nothing is worse than one that says it failed.

export interface CopyResult {
  ok: boolean
  /** Which path succeeded, for a caller that wants to say how. */
  method: 'clipboard-api' | 'exec-command' | null
  error: string | null
}

/** Hidden textarea + document.execCommand('copy') — the pre-Clipboard-API path. */
function copyViaExecCommand(text: string): CopyResult {
  if (typeof document === 'undefined') {
    return { ok: false, method: null, error: 'brak document — kopiowanie niedostępne poza przeglądarką' }
  }
  const ta = document.createElement('textarea')
  ta.value = text
  // Off-screen rather than display:none — a hidden element cannot be selected.
  ta.setAttribute('readonly', '')
  ta.style.position = 'fixed'
  ta.style.top = '-9999px'
  ta.style.left = '-9999px'
  ta.style.opacity = '0'
  document.body.appendChild(ta)

  const selection = document.getSelection()
  const previous = selection && selection.rangeCount > 0 ? selection.getRangeAt(0) : null

  try {
    ta.select()
    ta.setSelectionRange(0, text.length)
    const ok = document.execCommand('copy')
    return ok
      ? { ok: true, method: 'exec-command', error: null }
      : { ok: false, method: null, error: 'document.execCommand("copy") zwrócił false' }
  } catch (e) {
    return { ok: false, method: null, error: String((e as Error)?.message ?? e) }
  } finally {
    document.body.removeChild(ta)
    // Put the user's own selection back — copying should not steal it.
    if (previous && selection) {
      selection.removeAllRanges()
      selection.addRange(previous)
    }
  }
}

export async function copyText(text: string): Promise<CopyResult> {
  if (!text) return { ok: false, method: null, error: 'pusty tekst — nie ma czego kopiować' }

  if (typeof navigator !== 'undefined' && navigator.clipboard?.writeText) {
    try {
      await navigator.clipboard.writeText(text)
      return { ok: true, method: 'clipboard-api', error: null }
    } catch (e) {
      // Fall through — this is the expected path on a non-secure origin or an
      // unfocused document, not an exceptional one.
      const apiError = String((e as Error)?.message ?? e)
      const fallback = copyViaExecCommand(text)
      return fallback.ok
        ? fallback
        : { ok: false, method: null, error: `clipboard API: ${apiError}; fallback: ${fallback.error}` }
    }
  }

  return copyViaExecCommand(text)
}
