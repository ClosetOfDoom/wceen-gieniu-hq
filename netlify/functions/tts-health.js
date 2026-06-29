// Netlify Function: tts-health
// Safe diagnostic endpoint. By default returns key diagnostics WITHOUT calling ElevenLabs.
// Add ?live=1 to make an actual ElevenLabs TTS request (burns quota).
// GET /.netlify/functions/tts-health
// GET /.netlify/functions/tts-health?live=1

const STANLEY_VOICE_ID   = '9Ft9sm9dzvprPILZmLJl'
const STANLEY_VOICE_NAME = 'Stanley'

const CORS = {
  'Access-Control-Allow-Origin':  '*',
  'Access-Control-Allow-Headers': 'Content-Type',
  'Access-Control-Allow-Methods': 'GET, OPTIONS',
}

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

  const normalized = rawKey
    .trim()
    .replace(/^Bearer\s+/i, '')
    .replace(/^"+|"+$/g, '')
    .trim()

  return {
    apiKey:             normalized,
    apiKeySource:       source,
    hasApiKey:          normalized.length > 0,
    keyLength:          normalized.length,
    keyLooksQuoted:     rawKey.trim().startsWith('"') || rawKey.trim().endsWith('"'),
    keyHasBearerPrefix: /^Bearer\s+/i.test(rawKey.trim()),
    keyHasWhitespace:   rawKey !== rawKey.trim(),
  }
}

export const handler = async (event) => {
  if (event.httpMethod === 'OPTIONS') {
    return { statusCode: 204, headers: CORS, body: '' }
  }

  if (event.httpMethod !== 'GET') {
    return { statusCode: 405, headers: CORS, body: 'Method not allowed' }
  }

  const { apiKey, ...keyDiagnostics } = resolveApiKey()
  const modelId   = process.env.ELEVENLABS_MODEL_ID     || 'eleven_multilingual_v2'
  const outFormat = process.env.ELEVENLABS_OUTPUT_FORMAT || 'mp3_44100_128'
  const liveMode  = event.queryStringParameters?.live === '1'

  const base = {
    voiceId:   STANLEY_VOICE_ID,
    voiceName: STANLEY_VOICE_NAME,
    modelId,
    outFormat,
    liveMode,
    ...keyDiagnostics,
  }

  // Static diagnostics only (no ElevenLabs call, no quota burn)
  if (!liveMode) {
    return {
      statusCode: 200,
      headers: { ...CORS, 'Content-Type': 'application/json' },
      body: JSON.stringify({
        ...base,
        ok:               null,         // unknown without live test
        stage:            'static_check',
        message:          apiKey ? 'Key present. Add ?live=1 to test against ElevenLabs (burns quota).' : 'No API key found.',
        elevenStatus:     null,
        elevenContentType: null,
        byteLength:       null,
      }),
    }
  }

  // Live test — calls ElevenLabs (burns quota)
  if (!apiKey) {
    return {
      statusCode: 200,
      headers: { ...CORS, 'Content-Type': 'application/json' },
      body: JSON.stringify({
        ...base,
        ok:               false,
        stage:            'missing_api_key',
        message:          'No ElevenLabs API key found. Check Netlify env vars (ELEVENLABS_API_KEY).',
        elevenStatus:     null,
        elevenContentType: null,
        byteLength:       null,
      }),
    }
  }

  try {
    const res = await fetch(
      `https://api.elevenlabs.io/v1/text-to-speech/${STANLEY_VOICE_ID}?output_format=${outFormat}`,
      {
        method:  'POST',
        headers: { 'xi-api-key': apiKey, 'Content-Type': 'application/json', 'Accept': 'audio/mpeg' },
        body:    JSON.stringify({
          text:           'Stanley.',
          model_id:       modelId,
          voice_settings: { stability: 0.45, similarity_boost: 0.75 },
        }),
      }
    )

    const elevenContentType = res.headers.get('content-type') ?? null
    const buf               = await res.arrayBuffer()
    const bodyText          = elevenContentType?.includes('application/json')
      ? Buffer.from(buf).toString('utf8').slice(0, 200)
      : null

    const isQuota = bodyText?.includes('quota_exceeded') ?? false
    const ok      = res.ok && buf.byteLength > 0

    let stage   = ok ? 'ok' : (isQuota ? 'quota_exceeded' : 'elevenlabs_http_error')
    let message = ok
      ? 'Stanley is ready.'
      : isQuota
        ? 'ElevenLabs quota exhausted. Upgrade plan or wait for monthly reset.'
        : `ElevenLabs returned HTTP ${res.status}. ${bodyText ?? ''}`

    console.log(`GIENIU tts-health live: ok=${ok} status=${res.status} stage=${stage} keySource=${keyDiagnostics.apiKeySource}`)

    return {
      statusCode: 200,
      headers: { ...CORS, 'Content-Type': 'application/json' },
      body: JSON.stringify({
        ...base,
        ok,
        stage,
        message,
        elevenStatus:      res.status,
        elevenBodySnippet: bodyText,
        elevenContentType,
        byteLength:        buf.byteLength,
      }),
    }
  } catch (e) {
    return {
      statusCode: 200,
      headers: { ...CORS, 'Content-Type': 'application/json' },
      body: JSON.stringify({
        ...base,
        ok:      false,
        stage:   'unknown',
        message: `Unexpected error: ${String(e)}`,
        elevenStatus:      null,
        elevenContentType: null,
        byteLength:        null,
      }),
    }
  }
}
