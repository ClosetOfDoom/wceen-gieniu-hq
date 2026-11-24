// webinarMailWix.js — the thin Wix Email Marketing client used by the webinar mails.
//
// Endpoints (https://dev.wix.com/docs/api-reference/business-management/marketing/emails/email-marketing):
//   GET  /email-marketing/v1/account-details
//   GET  /email-marketing/v1/campaigns            (list; statuses, distributionStatus, publishingData)
//   POST /email-marketing/v1/campaigns            (create from HTML: campaignEditorType HTML)
//   POST /email-marketing/v1/campaigns/{id}/publish   (emailDistributionOptions: contactIds ONLY, sendAt, emailSubject)
//   POST /contacts/v4/contacts/query                  (filter primaryEmail.subscriptionStatus = SUBSCRIBED → the recipients)
//   GET  /email-marketing/v1/campaigns/{id}           (status of one campaign)
//   POST /email-marketing/v1/campaigns/{id}/preview   (rendered HTML + subject)
//   GET  /email-marketing/v1/campaigns/statistics
//   DELETE /email-marketing/v1/campaigns/{id}
//   GET   /email-marketing/v1/sender-details      (fromName, fromEmail, dateVerified)
//   PATCH /email-marketing/v1/sender-details      ({ senderDetails: { fromName, fromEmail } } → { verificationNeeded })
//     Only the NAME is ever changed. Wix rejects a PATCH without fromEmail (HTTP 400 "fromEmail is not a valid email
//     address", checked 2026-11-20), so the address is re-sent exactly as the GET just returned it; with the same address
//     Wix answers 200, verificationNeeded false, and dateVerified stays. The new Sender Details API
//     (/sender-details/v1) gives this key HTTP 403, so it is not used. The address never leaves this module.
// Wix "Send Test Email" is deliberately NOT used: a test is a real publish to one contact (see createAndPublish).
// The API key is never logged or returned; error text is scrubbed of it.

const BASE = 'https://www.wixapis.com'
/** The e-mail subscribers (WEBINAR_MAIL_CONFIG.audience.contactsFilter; a test asserts both are the same). */
const SUBSCRIBED_FILTER = Object.freeze({ 'primaryEmail.subscriptionStatus': 'SUBSCRIBED' })
export { SUBSCRIBED_FILTER }

export function createWixClient({ apiKey, siteId, fetchImpl = fetch } = {}) {
  if (!apiKey || !siteId) throw new Error('Brak WIX_API_KEY lub WIX_SITE_ID')

  async function call(method, path, body) {
    const res = await fetchImpl(BASE + path, {
      method,
      headers: { Authorization: apiKey, 'wix-site-id': siteId, 'Content-Type': 'application/json' },
      body: body === undefined ? undefined : JSON.stringify(body),
      signal: AbortSignal.timeout(25000),
    })
    const text = await res.text()
    let json = null
    try { json = JSON.parse(text) } catch { /* not JSON */ }
    if (!res.ok) {
      const detail = String(json?.message ?? text).split(apiKey).join('[klucz]').slice(0, 300)
      throw new Error(`Wix ${method} ${path.split('?')[0].replace(/[0-9a-f-]{36}/g, '{id}')} → HTTP ${res.status} ${detail}`)
    }
    return json ?? {}
  }

  return {
    async accountDetails() {
      const j = await call('GET', '/email-marketing/v1/account-details')
      const a = j.accountDetails ?? {}
      return { status: a.status, plan: a.package?.id, quota: a.package?.monthlyQuotaAllocation, usage: a.quotaPeriod?.quotaUsage }
    },

    async listRecentCampaigns({ limit = 40 } = {}) {
      const j = await call('GET', `/email-marketing/v1/campaigns?paging.limit=${limit}&visibilityStatuses=PUBLISHED`)
      return (j.campaigns ?? []).map((c) => ({
        campaignId: c.campaignId,
        emailSubject: c.emailSubject ?? c.title ?? '',
        editorType: c.editorType,
        distributionStatus: c.distributionStatus,
        datePublished: c.publishingData?.datePublished ?? null,
      }))
    },

    async previewCampaign(campaignId) {
      const j = await call('POST', `/email-marketing/v1/campaigns/${campaignId}/preview`, { removeMissingPlaceholders: false })
      return { html: j.html ?? '', emailSubject: j.emailSubject ?? '' }
    },

    async createCampaign({ subject, preheader, html }) {
      const body = {
        // Wix wants an object here ({ value: 'HTML' }), not a bare string: a string gives HTTP 400 "Expected an object".
        campaignEditorType: { value: 'HTML' },
        composer: { composerDataJson: JSON.stringify({ html }) },
        emailSubject: subject,
      }
      if (preheader) body.emailPreheader = preheader
      const j = await call('POST', '/email-marketing/v1/campaigns', body)
      const id = j.campaign?.campaignId
      if (!id) throw new Error('Wix nie zwrócił campaignId po utworzeniu kampanii')
      return id
    },

    /**
     * audience: { contactIds } only — production (the e-mail subscribers resolved by listEmailSubscriberIds) and the test
     * (the one test contact). A label (contacts-all included), a segment, activeContactsOnly or any other field is refused
     * here as well, before anything reaches Wix (the core guards in webinarMail.js run first).
     */
    async publishCampaign(campaignId, { subject, sendAt, audience }) {
      const keys = Object.keys(audience ?? {})
      if (keys.some((k) => k !== 'contactIds') || !Array.isArray(audience?.contactIds) || audience.contactIds.length === 0) {
        throw new Error(`BEZPIECZNIK ODBIORCÓW: publikacja tylko z contactIds (odrzucono: ${keys.join(', ') || 'brak odbiorców'})`)
      }
      const options = { emailSubject: subject, sendAt, contactIds: [...audience.contactIds] }
      return call('POST', `/email-marketing/v1/campaigns/${campaignId}/publish`, { emailDistributionOptions: options })
    },

    /** How many contacts have a PRIMARY e-mail with subscriptionStatus SUBSCRIBED (Wix Contacts total). */
    async countEmailSubscribers() {
      const j = await call('POST', '/contacts/v4/contacts/query', { query: { filter: SUBSCRIBED_FILTER, paging: { limit: 1 }, fieldsets: ['BASIC'] } })
      const total = j.pagingMetadata?.total
      if (!Number.isInteger(total) || j.pagingMetadata?.tooManyToCount) throw new Error('Wix nie podał liczby subskrybentów')
      return total
    },

    /**
     * IDs of every contact whose PRIMARY e-mail is SUBSCRIBED: { ids, total } (total = what Wix reports for the filter).
     * Every returned contact is checked again (primaryEmail.subscriptionStatus === 'SUBSCRIBED'); one that is not, a
     * duplicate, or a count that differs from total throws, so the run fails closed. No e-mail address leaves this function.
     */
    async listEmailSubscriberIds() {
      const ids = new Set()
      let total = null
      for (let offset = 0, page = 0; page < 50; page++) {
        const j = await call('POST', '/contacts/v4/contacts/query', { query: { filter: SUBSCRIBED_FILTER, sort: [{ fieldName: 'createdDate', order: 'ASC' }], paging: { limit: 1000, offset }, fieldsets: ['BASIC'] } })
        const meta = j.pagingMetadata ?? {}
        if (total === null) total = meta.total
        const contacts = j.contacts ?? []
        for (const c of contacts) {
          if (c.primaryEmail?.subscriptionStatus !== 'SUBSCRIBED') throw new Error('Wix zwrócił kontakt bez subskrypcji w zapytaniu o subskrybentów')
          if (ids.has(c.id)) throw new Error('Wix zwrócił ten sam kontakt dwa razy w zapytaniu o subskrybentów')
          ids.add(c.id)
        }
        offset += contacts.length
        if (!meta.hasNext || contacts.length === 0) break
      }
      if (!Number.isInteger(total)) throw new Error('Wix nie podał liczby subskrybentów')
      if (ids.size !== total) throw new Error(`lista subskrybentów niepełna: ${ids.size} ID, Wix podaje ${total}`)
      return { ids: [...ids], total }
    },

    async getCampaign(campaignId) {
      const j = await call('GET', `/email-marketing/v1/campaigns/${campaignId}`)
      const c = j.campaign ?? {}
      return {
        campaignId: c.campaignId ?? campaignId,
        distributionStatus: c.distributionStatus ?? null,
        visibilityStatus: c.visibilityStatus ?? null,
        datePublished: c.publishingData?.datePublished ?? null,
        mailsSent: c.publishingData?.statistics?.total?.mailsSent ?? null,
        delivered: c.publishingData?.statistics?.emailCampaign?.delivered ?? null,
      }
    },

    /** The current sender NAME (the address is deliberately not returned). */
    async getSenderName() {
      const j = await call('GET', '/email-marketing/v1/sender-details')
      return j.senderDetails?.fromName ?? null
    },

    /** Set the sender NAME; the address is re-sent unchanged (see the header). No PATCH when the name is already right. */
    async setSenderName(fromName) {
      const name = String(fromName ?? '').trim()
      if (!name || name.length > 100) throw new Error('niepoprawna nazwa nadawcy')
      const current = (await call('GET', '/email-marketing/v1/sender-details')).senderDetails ?? {}
      const fromEmail = current.fromEmail
      if (typeof fromEmail !== 'string' || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(fromEmail)) {
        throw new Error('Wix nie podał obecnego adresu nadawcy, nazwy nie zmieniono')
      }
      if (current.fromName === name) return { fromName: name, changed: false }
      const j = await call('PATCH', '/email-marketing/v1/sender-details', { senderDetails: { fromName: name, fromEmail } })
      if (j.verificationNeeded) throw new Error('Wix żąda weryfikacji adresu nadawcy po zmianie nazwy (adresu nie zmieniano), sprawdź panel Wix')
      return { fromName: name, changed: true }
    },

    async deleteCampaign(campaignId) {
      return call('DELETE', `/email-marketing/v1/campaigns/${campaignId}`)
    },

    /** { [campaignId]: { delivered, opened, clicked } } for up to 100 campaigns. */
    async campaignStats(ids) {
      if (!ids.length) return {}
      const q = ids.slice(0, 100).map((id) => `campaignIds=${encodeURIComponent(id)}`).join('&')
      const j = await call('GET', `/email-marketing/v1/campaigns/statistics?${q}`)
      return Object.fromEntries((j.statistics ?? []).map((s) => [s.campaignId, { delivered: s.email?.delivered ?? 0, opened: s.email?.opened ?? 0, clicked: s.email?.clicked ?? 0 }]))
    },
  }
}

/** Does the registration link answer HTTP 200 (after redirects)? */
export async function checkUrl(url, fetchImpl = fetch) {
  const res = await fetchImpl(url, {
    method: 'GET',
    redirect: 'follow',
    headers: { 'User-Agent': 'Mozilla/5.0 (compatible; StanleyLinkCheck/1.0)' },
    signal: AbortSignal.timeout(12000),
  })
  return { status: res.status, finalUrl: res.url }
}
