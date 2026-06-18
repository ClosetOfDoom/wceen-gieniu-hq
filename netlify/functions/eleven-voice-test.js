// Netlify Function: eleven-voice-test
// Voice preview — always uses George (JBFqnCBsd6RMkjVDRZzb).

const GEORGE_VOICE_ID = 'JBFqnCBsd6RMkjVDRZzb'

export const handler = async (event) => {
  const headers = {
    'Access-Control-Allow-Origin': '*',
    'Access-Control-Allow-Headers': 'Content-Type',
    'Access-Control-Allow-Methods': 'POST, OPTIONS',
  }

  if (event.httpMethod === 'OPTIONS') {
    return { statusCode: 204, headers, body: '' }
  }
  if (event.httpMethod !== 'POST') {
    return { statusCode: 405, headers: { ...headers, 'Content-Type': 'application/json' }, body: JSON.stringify({ error: 'Method not allowed' }) }
  }

  const apiKey = process.env.ELEVENLABS_API_KEY
  if (!apiKey) {
    return { statusCode: 500, headers: { ...headers, 'Content-Type': 'application/json' }, body: JSON.stringify({ error: 'ELEVENLABS_API_KEY not set' }) }
  }

  let body
  try { body = JSON.parse(event.body ?? '{}') } catch { return { statusCode: 400, headers: { ...headers, 'Content-Type': 'application/json' }, body: JSON.stringify({ error: 'Invalid JSON' }) } }

  // Always George — never override
  const voiceId      = GEORGE_VOICE_ID
  const text         = (body.text || 'Operational snapshot. George voice check.').slice(0, 500)
  const outputFormat = process.env.ELEVENLABS_OUTPUT_FORMAT || 'mp3_44100_128'
  const modelId      = process.env.ELEVENLABS_MODEL_ID || 'eleven_multilingual_v2'

  console.log(`GIENIU TTS voice used: George ${GEORGE_VOICE_ID}`)

  try {
    const res = await fetch(
      `https://api.elevenlabs.io/v1/text-to-speech/${voiceId}?output_format=${outputFormat}`,
      {
        method: 'POST',
        headers: { 'xi-api-key': apiKey, 'Content-Type': 'application/json', 'Accept': 'audio/mpeg' },
        body: JSON.stringify({ text, model_id: modelId, voice_settings: { stability: 0.5, similarity_boost: 0.75 } }),
      }
    )

    if (!res.ok) {
      const errText = await res.text()
      return { statusCode: res.status, headers: { ...headers, 'Content-Type': 'application/json' }, body: JSON.stringify({ error: `ElevenLabs ${res.status}`, detail: errText }) }
    }

    const buf = await res.arrayBuffer()
    return {
      statusCode: 200,
      headers: { ...headers, 'Content-Type': 'audio/mpeg', 'Content-Transfer-Encoding': 'base64' },
      body: Buffer.from(buf).toString('base64'),
      isBase64Encoded: true,
    }
  } catch (e) {
    return { statusCode: 500, headers: { ...headers, 'Content-Type': 'application/json' }, body: JSON.stringify({ error: String(e) }) }
  }
}
