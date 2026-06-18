// Netlify Function: eleven-tts
// Proxies TTS requests to ElevenLabs keeping the API key server-side.
// Voice is ALWAYS George (JBFqnCBsd6RMkjVDRZzb) — env ELEVENLABS_VOICE_ID is intentionally ignored.

const GEORGE_VOICE_ID   = 'JBFqnCBsd6RMkjVDRZzb'
const GEORGE_VOICE_NAME = 'George'

const CORS = {
  'Access-Control-Allow-Origin':  '*',
  'Access-Control-Allow-Headers': 'Content-Type',
  'Access-Control-Allow-Methods': 'GET, POST, OPTIONS',
}

// ── Safe key normalization ────────────────────────────────────────────────────
// Tries multiple env var names, strips common formatting mistakes
// (quoted key, Bearer prefix, leading/trailing whitespace).
function resolveApiKey() {
  const rawKey =
    process.env.ELEVENLABS_API_KEY ||
    process.env.ELEVEN_API_KEY     ||
    process.env.ELEVENLABS_KEY     ||
    ''

  const source =
    process.env.ELEVENLABS_API_KEY ? 'ELEVENLABS_API_KEY' :
    process.env.ELEVEN_API_KEY     ? 'ELEVEN_API_KEY'     :
    process.env.ELEVENLABS_KEY     ? 'ELEVENLABS_KEY'     :
    'missing'

  // Normalize: strip whitespace, Bearer prefix, surrounding quotes
  const normalized = rawKey
    .trim()
    .replace(/^Bearer\s+/i, '')
    .replace(/^"+|"+$/g, '')
    .trim()

  const diagnostics = {
    apiKeySource:       source,
    hasApiKey:          normalized.length > 0,
    keyLength:          normalized.length,
    keyLooksQuoted:     rawKey.trim().startsWith('"') || rawKey.trim().endsWith('"'),
    keyHasBearerPrefix: /^Bearer\s+/i.test(rawKey.trim()),
    keyHasWhitespace:   rawKey !== rawKey.trim(),
  }

  return { apiKey: normalized, diagnostics }
}

function stageMessage(stage, extra = {}) {
  switch (stage) {
    case 'missing_api_key':
      return 'ELEVENLABS_API_KEY (or ELEVEN_API_KEY / ELEVENLABS_KEY) is not set in Netlify environment variables.'
    case 'bad_request':
      return 'Empty or missing text field in POST body.'
    case 'quota_exceeded':
      return 'ElevenLabs character quota exhausted. Upgrade the ElevenLabs plan or wait for the monthly quota to reset.'
    case 'elevenlabs_http_error':
      return `ElevenLabs returned HTTP ${extra.elevenStatus ?? '?'}. ${(extra.elevenBodySnippet ?? '').slice(0, 120)}`
    case 'audio_decode_error':
      return 'ElevenLabs returned 200 but audio buffer was empty.'
    case 'unknown':
      return `Unexpected error: ${extra.detail ?? 'unknown'}`
    default:
      return stage
  }
}

function errorBody(stage, diagnostics, extra = {}) {
  const obj = {
    ok: false,
    stage,
    voiceId:          GEORGE_VOICE_ID,
    voiceName:        GEORGE_VOICE_NAME,
    ...diagnostics,
    elevenStatus:      extra.elevenStatus ?? null,
    elevenBodySnippet: extra.elevenBodySnippet ?? null,
    message:           stageMessage(stage, extra),
  }
  console.error('GIENIU TTS failure', obj)
  return obj
}

export const handler = async (event) => {
  // ── CORS preflight ─────────────────────────────────────────────────────────
  if (event.httpMethod === 'OPTIONS') {
    return { statusCode: 204, headers: CORS, body: '' }
  }

  const { apiKey, diagnostics } = resolveApiKey()
  const modelId   = process.env.ELEVENLABS_MODEL_ID     || 'eleven_multilingual_v2'
  const outFormat = process.env.ELEVENLABS_OUTPUT_FORMAT || 'mp3_44100_128'

  // ── GET — diagnostic / health ───────────────────────────────────────────────
  if (event.httpMethod === 'GET') {
    const debugMode = event.queryStringParameters?.debug === '1'
    const info = {
      voiceId:   GEORGE_VOICE_ID,
      voiceName: GEORGE_VOICE_NAME,
      ...diagnostics,
      modelId,
      outFormat,
      endpoint:  `https://api.elevenlabs.io/v1/text-to-speech/${GEORGE_VOICE_ID}?output_format=${outFormat}`,
    }

    // debug=1 without live=1: return static key diagnostics (no ElevenLabs call, no quota burn)
    // debug=1&live=1: make actual ElevenLabs call
    const liveMode = event.queryStringParameters?.live === '1'
    if (!debugMode || !liveMode) {
      return {
        statusCode: 200,
        headers: { ...CORS, 'Content-Type': 'application/json' },
        body: JSON.stringify({
          ...info,
          ok:      null,
          stage:   'static_check',
          message: apiKey ? 'Key present. Add &live=1 to test against ElevenLabs (burns quota).' : 'No API key found.',
        }),
      }
    }

    // live ping — burns quota, use sparingly
    if (!apiKey) {
      return {
        statusCode: 500,
        headers: { ...CORS, 'Content-Type': 'application/json' },
        body: JSON.stringify({ ...info, ok: false, stage: 'missing_api_key', elevenStatus: null, elevenContentType: null, byteLength: null }),
      }
    }

    try {
      const pingRes = await fetch(
        `https://api.elevenlabs.io/v1/text-to-speech/${GEORGE_VOICE_ID}?output_format=${outFormat}`,
        {
          method:  'POST',
          headers: { 'xi-api-key': apiKey, 'Content-Type': 'application/json', 'Accept': 'audio/mpeg' },
          body:    JSON.stringify({ text: 'George.', model_id: modelId, voice_settings: { stability: 0.45, similarity_boost: 0.75 } }),
        }
      )
      const elevenContentType = pingRes.headers.get('content-type') ?? null
      const buf = await pingRes.arrayBuffer()
      return {
        statusCode: 200,
        headers: { ...CORS, 'Content-Type': 'application/json' },
        body: JSON.stringify({
          ...info,
          ok:               pingRes.ok,
          elevenStatus:     pingRes.status,
          elevenContentType,
          byteLength:       buf.byteLength,
        }),
      }
    } catch (e) {
      return {
        statusCode: 200,
        headers: { ...CORS, 'Content-Type': 'application/json' },
        body: JSON.stringify({ ...info, ok: false, stage: 'unknown', detail: String(e) }),
      }
    }
  }

  // ── Only POST beyond this point ─────────────────────────────────────────────
  if (event.httpMethod !== 'POST') {
    return {
      statusCode: 405,
      headers: { ...CORS, 'Content-Type': 'application/json' },
      body: JSON.stringify({ error: 'Method not allowed' }),
    }
  }

  // ── API key check ───────────────────────────────────────────────────────────
  if (!apiKey) {
    return {
      statusCode: 500,
      headers: { ...CORS, 'Content-Type': 'application/json' },
      body: JSON.stringify(errorBody('missing_api_key', diagnostics)),
    }
  }

  // ── Parse body ──────────────────────────────────────────────────────────────
  let body
  try {
    body = JSON.parse(event.body ?? '{}')
  } catch {
    return {
      statusCode: 400,
      headers: { ...CORS, 'Content-Type': 'application/json' },
      body: JSON.stringify(errorBody('bad_request', diagnostics, { detail: 'Invalid JSON in request body' })),
    }
  }

  // Use debug text if ?debug=1 so callers can test without providing text
  const isDebug = event.queryStringParameters?.debug === '1'
  const text    = isDebug ? 'George voice check.' : (body.text || '').slice(0, 2500)

  if (!text) {
    return {
      statusCode: 400,
      headers: { ...CORS, 'Content-Type': 'application/json' },
      body: JSON.stringify(errorBody('bad_request', diagnostics)),
    }
  }

  console.log(`GIENIU TTS voice used: George ${GEORGE_VOICE_ID} | keySource: ${diagnostics.apiKeySource} | keyLen: ${diagnostics.keyLength}`)

  // ── ElevenLabs request ──────────────────────────────────────────────────────
  try {
    const elevenRes = await fetch(
      `https://api.elevenlabs.io/v1/text-to-speech/${GEORGE_VOICE_ID}?output_format=${outFormat}`,
      {
        method:  'POST',
        headers: {
          'xi-api-key':   apiKey,
          'Content-Type': 'application/json',
          'Accept':       'audio/mpeg',
        },
        body: JSON.stringify({
          text,
          model_id: modelId,
          voice_settings: { stability: 0.45, similarity_boost: 0.75 },
        }),
      }
    )

    if (!elevenRes.ok) {
      const snippet = (await elevenRes.text().catch(() => '')).slice(0, 300)
      // ElevenLabs returns 401 for quota exhaustion (not 429) — detect it by body
      const stage = snippet.includes('quota_exceeded') ? 'quota_exceeded' : 'elevenlabs_http_error'
      return {
        statusCode: elevenRes.status,
        headers: { ...CORS, 'Content-Type': 'application/json' },
        body: JSON.stringify(errorBody(stage, diagnostics, {
          elevenStatus:      elevenRes.status,
          elevenBodySnippet: snippet,
        })),
      }
    }

    const audioBuffer = await elevenRes.arrayBuffer()
    if (audioBuffer.byteLength === 0) {
      return {
        statusCode: 500,
        headers: { ...CORS, 'Content-Type': 'application/json' },
        body: JSON.stringify(errorBody('audio_decode_error', diagnostics)),
      }
    }

    const audioBase64 = Buffer.from(audioBuffer).toString('base64')
    return {
      statusCode: 200,
      headers: { ...CORS, 'Content-Type': 'audio/mpeg', 'Content-Transfer-Encoding': 'base64' },
      body: audioBase64,
      isBase64Encoded: true,
    }
  } catch (e) {
    return {
      statusCode: 500,
      headers: { ...CORS, 'Content-Type': 'application/json' },
      body: JSON.stringify(errorBody('unknown', diagnostics, { detail: String(e) })),
    }
  }
}
