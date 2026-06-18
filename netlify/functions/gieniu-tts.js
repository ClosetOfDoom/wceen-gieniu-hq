// Netlify Function: gieniu-tts
// Frontend-facing voice endpoint. Backend decides provider — no UI exposure.
//
// Provider routing order:
//   1. GIENIU_TTS_PROVIDER=local + GIENIU_LOCAL_TTS_URL  → local/self-hosted TTS server
//   2. ElevenLabs (George JBFqnCBsd6RMkjVDRZzb) if API key is set
//   3. voice_unavailable JSON (text/chat still works)
//
// No browser speechSynthesis fallback — voice is always server-provided.

import { handler as elevenTtsHandler } from './eleven-tts.js'

const CORS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'Content-Type',
  'Access-Control-Allow-Methods': 'GET, POST, OPTIONS',
}

export async function handler(event, context) {
  if (event.httpMethod === 'OPTIONS') {
    return { statusCode: 204, headers: CORS, body: '' }
  }

  const provider    = (process.env.GIENIU_TTS_PROVIDER ?? '').trim().toLowerCase()
  const localTtsUrl = (process.env.GIENIU_LOCAL_TTS_URL ?? '').trim()

  // ── Route 1: local/self-hosted TTS server ────────────────────────────────
  if (provider === 'local' && localTtsUrl) {
    try {
      let text = ''
      try { text = JSON.parse(event.body ?? '{}').text ?? '' } catch { /* ignore */ }
      if (!text.trim()) {
        return { statusCode: 400, headers: { ...CORS, 'Content-Type': 'application/json' },
          body: JSON.stringify({ ok: false, stage: 'bad_request', message: 'Empty text field.' }) }
      }

      const res = await fetch(localTtsUrl, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ text }),
        signal: AbortSignal.timeout(15000),
      })

      if (!res.ok) {
        const snippet = (await res.text().catch(() => '')).slice(0, 120)
        return { statusCode: 502, headers: { ...CORS, 'Content-Type': 'application/json' },
          body: JSON.stringify({ ok: false, stage: 'local_tts_error', message: `Local TTS returned HTTP ${res.status}: ${snippet}` }) }
      }

      const audioBuffer = Buffer.from(await res.arrayBuffer())
      const contentType = res.headers.get('content-type') ?? 'audio/mpeg'
      return {
        statusCode: 200,
        headers: { ...CORS, 'Content-Type': contentType },
        body: audioBuffer.toString('base64'),
        isBase64Encoded: true,
      }
    } catch (err) {
      console.error('GIENIU local TTS error:', err)
      return { statusCode: 502, headers: { ...CORS, 'Content-Type': 'application/json' },
        body: JSON.stringify({ ok: false, stage: 'local_tts_network_error', message: String(err) }) }
    }
  }

  // ── Route 2: ElevenLabs George ───────────────────────────────────────────
  return elevenTtsHandler(event, context)
}
