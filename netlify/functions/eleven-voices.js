// Netlify Function: eleven-voices
// Returns list of available ElevenLabs voices.

import { withStanleyAuth } from '../shared/auth.js'

const handlerImpl = async (event) => {
  const headers = {
    'Content-Type': 'application/json',
  }

  if (event.httpMethod === 'OPTIONS') {
    return { statusCode: 204, headers, body: '' }
  }

  const apiKey = process.env.ELEVENLABS_API_KEY
  if (!apiKey) {
    return {
      statusCode: 500,
      headers,
      body: JSON.stringify({ error: 'ELEVENLABS_API_KEY not set' }),
    }
  }

  try {
    const res = await fetch('https://api.elevenlabs.io/v1/voices', {
      headers: { 'xi-api-key': apiKey },
    })

    if (!res.ok) {
      return {
        statusCode: res.status,
        headers,
        body: JSON.stringify({ error: `ElevenLabs voices error ${res.status}` }),
      }
    }

    const json = await res.json()
    const voices = (json.voices ?? []).map((v) => ({
      voice_id: v.voice_id,
      name: v.name,
    }))

    return { statusCode: 200, headers, body: JSON.stringify({ voices }) }
  } catch (e) {
    return {
      statusCode: 500,
      headers,
      body: JSON.stringify({ error: String(e) }),
    }
  }
}

// Every function of this site sits behind the shared password (netlify/shared/auth.js).
export const handler = withStanleyAuth(handlerImpl)
