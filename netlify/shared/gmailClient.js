// gmailClient.js — the narrow slice of the Gmail REST API that Stanley uses. Plain fetch (injectable); no googleapis package.
//
// What it can do:   read headers + snippet (format=metadata), add / remove Stanley's labels, send an approved reply.
// What it cannot:   delete or trash anything (no such call exists here, and the scopes do not allow permanent deletion).
// Stanley reads headers and the snippet only, never the full body. Nothing here logs an address or a subject.

const API = 'https://gmail.googleapis.com/gmail/v1/users/me'
const META_HEADERS = ['From', 'Reply-To', 'Subject', 'Date', 'Message-ID', 'References', 'List-Unsubscribe', 'Precedence', 'Auto-Submitted']

export class GmailError extends Error {
  constructor(message, { status = null, code = 'gmail_error' } = {}) {
    super(message)
    this.name = 'GmailError'
    this.status = status
    this.code = code
  }
}

const oneLine = (v) => String(v ?? '').replace(/[\r\n]+/g, ' ').trim()

/** "Name <a@b.c>" | "a@b.c" → { name, address } (address lower-cased); address '' when none is found. */
export function parseAddress(raw) {
  const s = oneLine(raw)
  const m = /<([^<>\s]+@[^<>\s]+)>/.exec(s) ?? /([^\s<>",;]+@[^\s<>",;]+)/.exec(s)
  const address = m ? m[1].toLowerCase() : ''
  const name = s.replace(/<[^>]*>/, '').replace(/^["'\s]+|["'\s]+$/g, '')
  return { name: name && name.toLowerCase() !== address ? name : '', address }
}

export const isPlainAddress = (a) => /^[^\s@<>",;]+@[^\s@<>",;]+\.[^\s@<>",;]+$/.test(String(a ?? ''))

const headerMap = (payload) => {
  const out = {}
  for (const h of payload?.headers ?? []) out[String(h.name).toLowerCase()] = String(h.value ?? '')
  return out
}

/** A Gmail message resource (format=metadata) → the small shape the triage works on. */
export function normalizeMessage(m) {
  const h = headerMap(m.payload)
  const from = parseAddress(h.from)
  const replyTo = parseAddress(h['reply-to'])
  return {
    id: m.id,
    threadId: m.threadId,
    labelIds: m.labelIds ?? [],
    snippet: oneLine(m.snippet).slice(0, 400),
    internalDate: m.internalDate ? new Date(Number(m.internalDate)).toISOString() : null,
    from: from.address,
    fromName: from.name,
    replyTo: replyTo.address,
    subject: oneLine(h.subject).slice(0, 300),
    messageId: oneLine(h['message-id']),
    references: oneLine(h.references),
    bulk: Boolean(h['list-unsubscribe']) || /bulk|list|junk/i.test(h.precedence ?? '') || (h['auto-submitted'] ? !/^no$/i.test(h['auto-submitted'].trim()) : false),
  }
}

const b64url = (buf) => Buffer.from(buf).toString('base64url')
const wrap76 = (s) => s.replace(/(.{76})/g, '$1\r\n')
const mimeWord = (s) => (/^[\x20-\x7e]*$/.test(s) ? s : `=?UTF-8?B?${Buffer.from(s, 'utf8').toString('base64')}?=`)

/** An RFC 5322 multipart/alternative message (plain + html), headers sanitised against injection. */
export function buildMime({ to, subject, plain, html, inReplyTo, references }) {
  if (!isPlainAddress(to)) throw new GmailError('the recipient is not a single plain address', { code: 'bad_recipient' })
  const boundary = `stanley_${Date.now().toString(36)}${Math.random().toString(36).slice(2, 8)}`
  const head = [
    `To: ${to}`,
    `Subject: ${mimeWord(oneLine(subject))}`,
    'MIME-Version: 1.0',
    ...(inReplyTo ? [`In-Reply-To: ${oneLine(inReplyTo)}`] : []),
    ...(references || inReplyTo ? [`References: ${oneLine([references, inReplyTo].filter(Boolean).join(' '))}`] : []),
    `Content-Type: multipart/alternative; boundary="${boundary}"`,
  ]
  const part = (type, text) => [`--${boundary}`, `Content-Type: ${type}; charset=UTF-8`, 'Content-Transfer-Encoding: base64', '', wrap76(Buffer.from(text, 'utf8').toString('base64'))].join('\r\n')
  return `${head.join('\r\n')}\r\n\r\n${part('text/plain', plain)}\r\n${part('text/html', html)}\r\n--${boundary}--`
}

export function createGmailClient({ getToken, fetchImpl = fetch }) {
  const labelCache = new Map()

  async function call(path, { method = 'GET', body } = {}) {
    const token = await getToken()
    let res
    try {
      res = await fetchImpl(`${API}${path}`, {
        method,
        headers: { Authorization: `Bearer ${token}`, ...(body ? { 'Content-Type': 'application/json' } : {}) },
        ...(body ? { body: JSON.stringify(body) } : {}),
      })
    } catch (e) {
      throw new GmailError(`Gmail unreachable: ${e.message}`, { code: 'network' })
    }
    if (res.status === 204) return null
    let data = null
    try { data = await res.json() } catch { /* empty */ }
    if (!res.ok) {
      const code = res.status === 401 ? 'unauthorized' : res.status === 403 ? 'forbidden' : res.status === 429 ? 'rate_limited' : 'gmail_error'
      throw new GmailError(`Gmail API HTTP ${res.status}${data?.error?.status ? ` ${data.error.status}` : ''}`, { status: res.status, code })
    }
    return data
  }

  return {
    async profile() {
      const p = await call('/profile')
      return { email: p.emailAddress ?? null, total: p.messagesTotal ?? null }
    },
    /** Ids of the newest messages that match a Gmail search query. */
    async listIds(q, max = 25) {
      const p = await call(`/messages?${new URLSearchParams({ q, maxResults: String(max) })}`)
      return (p?.messages ?? []).map((m) => m.id)
    },
    async getMeta(id) {
      const qs = new URLSearchParams({ format: 'metadata' })
      for (const h of META_HEADERS) qs.append('metadataHeaders', h)
      return normalizeMessage(await call(`/messages/${encodeURIComponent(id)}?${qs}`))
    },
    async labelId(name, { create = true } = {}) {
      if (labelCache.has(name)) return labelCache.get(name)
      const all = (await call('/labels'))?.labels ?? []
      let hit = all.find((l) => l.name === name)
      if (!hit && create) hit = await call('/labels', { method: 'POST', body: { name, labelListVisibility: 'labelShow', messageListVisibility: 'show' } })
      if (hit) labelCache.set(name, hit.id)
      return hit?.id ?? null
    },
    async modifyLabels(id, { add = [], remove = [] }) {
      const addLabelIds = (await Promise.all(add.map((n) => this.labelId(n)))).filter(Boolean)
      const removeLabelIds = (await Promise.all(remove.map((n) => this.labelId(n, { create: false })))).filter(Boolean)
      await call(`/messages/${encodeURIComponent(id)}/modify`, { method: 'POST', body: { addLabelIds, removeLabelIds } })
    },
    /** Sends a reply inside the thread; returns the new message id. */
    async send({ to, subject, plain, html, threadId, inReplyTo, references }) {
      const raw = b64url(buildMime({ to, subject, plain, html, inReplyTo, references }))
      const r = await call('/messages/send', { method: 'POST', body: { raw, ...(threadId ? { threadId } : {}) } })
      return { id: r?.id ?? null, threadId: r?.threadId ?? threadId ?? null }
    },
  }
}
