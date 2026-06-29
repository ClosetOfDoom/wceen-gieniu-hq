# GIENIU Local TTS Server

Free, unlimited, self-hosted TTS for the GIENIU HQ voice feature.

## Why this exists

ElevenLabs has a character quota. When it runs out, voice becomes unavailable.  
This server provides a free/unlimited fallback — you host it on your own machine or VPS,
and the Netlify function routes to it instead of ElevenLabs.

**Frontend still calls only `/.netlify/functions/gieniu-tts` — provider is 100% backend config.**

## Quick start

```bash
cd tools/local-tts-server
pip install -r requirements.txt
python server.py
# Server running at http://localhost:7501
```

## HTTP contract

```
POST /tts
Content-Type: application/json
{ "text": "Hello world" }

→ 200 audio/wav   (or audio/mpeg depending on engine)
→ 4xx/5xx application/json { "error": "..." }
```

## Activating for GIENIU production

Set these in Netlify environment variables (scope: **All**):

```
GIENIU_TTS_PROVIDER=local
GIENIU_LOCAL_TTS_URL=https://your-server.example.com/tts
```

If `GIENIU_TTS_PROVIDER` is `local` and `GIENIU_LOCAL_TTS_URL` is set,
the Netlify function routes ALL TTS requests to your server instead of ElevenLabs.

## Swapping the TTS engine

Edit `synthesize()` in `server.py`. Current default: `pyttsx3` (offline, limited quality).

Better options:
- **Kokoro** (English, high quality): `pip install kokoro soundfile`
- **Piper** (multi-language, high quality): see [piper-tts](https://github.com/rhasspy/piper)
- Any engine that returns WAV/MP3 bytes works — just replace the function body.

## Docker

```bash
docker build -t gieniu-tts .
docker run -p 7501:7501 gieniu-tts
```

## Provider fallback chain

```
GIENIU_TTS_PROVIDER=local + GIENIU_LOCAL_TTS_URL set
  → call local server

GIENIU_TTS_PROVIDER not set (default)
  → ElevenLabs Stanley (9Ft9sm9dzvprPILZmLJl) — requires ELEVENLABS_API_KEY

ElevenLabs quota exhausted or key missing
  → voice_unavailable JSON — text/chat still works
```

Voice is always server-decided. No provider labels in the UI.
