// Netlify Function: eleven-tts
// Proxies TTS requests to ElevenLabs keeping the API key server-side.

export const handler = async (event) => {
  const headers = {
    'Access-Control-Allow-Origin': '*',
    'Access-Control-Allow-Headers': 'Content-Type',
    'Access-Control-Allow-Methods': 'POST, OPTIONS',
  }

  if (event.httpMethod === 'OPTIONS') {
    return { statusCode: 204, headers, body: '' }
  }

  if (event.httpMethod === 'GET') {
    const apiKey = process.env.ELEVENLABS_API_KEY
    const action = event.queryStringParameters?.action

    if (action === 'voices') {
      if (!apiKey) return { statusCode: 500, headers: { ...headers, 'Content-Type': 'application/json' }, body: JSON.stringify({ error: 'no key' }) }
      const r = await fetch('https://api.elevenlabs.io/v1/voices', { headers: { 'xi-api-key': apiKey } })
      const data = await r.json()
      return { statusCode: 200, headers: { ...headers, 'Content-Type': 'application/json' }, body: JSON.stringify(data) }
    }

    if (action === 'sample') {
      const vid = event.queryStringParameters?.voice_id
      if (!apiKey || !vid) return { statusCode: 400, headers: { ...headers, 'Content-Type': 'application/json' }, body: JSON.stringify({ error: 'missing params' }) }
      const sampleText = 'Operational snapshot. Today: fifteen orders, one thousand seven hundred eighty PLN revenue, five hundred eighty seven PLN ad spend. Real C P A: thirty nine point seventeen PLN. R O A S: three point zero three times. Acceptable, but not heroic.'
      const r = await fetch(`https://api.elevenlabs.io/v1/text-to-speech/${vid}?output_format=mp3_44100_128`, {
        method: 'POST',
        headers: { 'xi-api-key': apiKey, 'Content-Type': 'application/json', Accept: 'audio/mpeg' },
        body: JSON.stringify({ text: sampleText, model_id: 'eleven_multilingual_v2', voice_settings: { stability: 0.5, similarity_boost: 0.75 } }),
      })
      if (!r.ok) { const e = await r.text(); return { statusCode: r.status, headers: { ...headers, 'Content-Type': 'application/json' }, body: JSON.stringify({ error: e }) } }
      const buf = await r.arrayBuffer()
      return { statusCode: 200, headers: { ...headers, 'Content-Type': 'audio/mpeg', 'Content-Transfer-Encoding': 'base64' }, body: Buffer.from(buf).toString('base64'), isBase64Encoded: true }
    }

    const voiceId = process.env.ELEVENLABS_VOICE_ID || 'CwhRBWXzGAHq8TQ4Fs17'
    const modelId = process.env.ELEVENLABS_MODEL_ID || 'eleven_multilingual_v2'
    return {
      statusCode: 200,
      headers: { ...headers, 'Content-Type': 'application/json' },
      body: JSON.stringify({
        hasApiKey: !!apiKey,
        hasVoiceId: !!voiceId,
        voiceId,
        modelId,
      }),
    }
  }

  if (event.httpMethod !== 'POST') {
    return { statusCode: 405, headers: { ...headers, 'Content-Type': 'application/json' }, body: JSON.stringify({ error: 'Method not allowed' }) }
  }

  const apiKey = process.env.ELEVENLABS_API_KEY
  if (!apiKey) {
    return {
      statusCode: 500,
      headers: { ...headers, 'Content-Type': 'application/json' },
      body: JSON.stringify({ error: 'ELEVENLABS_API_KEY not set' }),
    }
  }

  let body
  try {
    body = JSON.parse(event.body ?? '{}')
  } catch {
    return { statusCode: 400, headers: { ...headers, 'Content-Type': 'application/json' }, body: JSON.stringify({ error: 'Invalid JSON' }) }
  }

  const voiceId = body.voiceId || process.env.ELEVENLABS_VOICE_ID || 'CwhRBWXzGAHq8TQ4Fs17'
  const modelId = process.env.ELEVENLABS_MODEL_ID || 'eleven_multilingual_v2'
  const outputFormat = process.env.ELEVENLABS_OUTPUT_FORMAT || 'mp3_44100_128'
  const text = (body.text || '').slice(0, 2500)

  if (!text) {
    return { statusCode: 400, headers: { ...headers, 'Content-Type': 'application/json' }, body: JSON.stringify({ error: 'text required' }) }
  }

  try {
    const res = await fetch(
      `https://api.elevenlabs.io/v1/text-to-speech/${voiceId}?output_format=${outputFormat}`,
      {
        method: 'POST',
        headers: {
          'xi-api-key': apiKey,
          'Content-Type': 'application/json',
          'Accept': 'audio/mpeg',
        },
        body: JSON.stringify({
          text,
          model_id: modelId,
          voice_settings: { stability: 0.5, similarity_boost: 0.75 },
        }),
      }
    )

    if (!res.ok) {
      const errText = await res.text()
      return {
        statusCode: res.status,
        headers: { ...headers, 'Content-Type': 'application/json' },
        body: JSON.stringify({ error: `ElevenLabs error ${res.status}`, detail: errText }),
      }
    }

    const audioBuffer = await res.arrayBuffer()
    const audioBase64 = Buffer.from(audioBuffer).toString('base64')

    return {
      statusCode: 200,
      headers: { ...headers, 'Content-Type': 'audio/mpeg', 'Content-Transfer-Encoding': 'base64' },
      body: audioBase64,
      isBase64Encoded: true,
    }
  } catch (e) {
    return {
      statusCode: 500,
      headers: { ...headers, 'Content-Type': 'application/json' },
      body: JSON.stringify({ error: 'Internal error', detail: String(e) }),
    }
  }
}
