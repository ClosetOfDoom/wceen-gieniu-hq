// Netlify Function: gieniu-tts
// Frontend-facing voice endpoint — provider details are internal.
// Delegates to eleven-tts which handles key resolution, normalization, and diagnostics.
// Voice is ALWAYS George (JBFqnCBsd6RMkjVDRZzb) — hardcoded in eleven-tts.

export { handler } from './eleven-tts.js'
