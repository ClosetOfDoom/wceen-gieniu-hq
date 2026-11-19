// webinarMailWix.js — the thin Wix Email Marketing client used by the webinar mails.
//
// Endpoints (https://dev.wix.com/docs/api-reference/business-management/marketing/emails/email-marketing):
//   GET  /email-marketing/v1/account-details
//   GET  /email-marketing/v1/campaigns            (list; statuses, distributionStatus, publishingData)
//   POST /email-marketing/v1/campaigns            (create from HTML: campaignEditorType HTML)
//   POST /email-marketing/v1/campaigns/{id}/publish   (emailDistributionOptions: labelIds, sendAt ...)
//   POST /email-marketing/v1/campaigns/{id}/test      (Send Test Email)
//   POST /email-marketing/v1/campaigns/{id}/preview   (rendered HTML + subject)
//   GET  /email-marketing/v1/campaigns/statistics
//   DELETE /email-marketing/v1/campaigns/{id}
// The API key is never logged or returned; error text is scrubbed of it.

const BASE = 'https://www.wixapis.com'

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
        campaignEditorType: 'HTML',
        composer: { composerDataJson: JSON.stringify({ html }) },
        emailSubject: subject,
      }
      if (preheader) body.emailPreheader = preheader
      const j = await call('POST', '/email-marketing/v1/campaigns', body)
      const id = j.campaign?.campaignId
      if (!id) throw new Error('Wix nie zwrócił campaignId po utworzeniu kampanii')
      return id
    },

    async publishCampaign(campaignId, { subject, sendAt, audience }) {
      return call('POST', `/email-marketing/v1/campaigns/${campaignId}/publish`, {
        emailDistributionOptions: {
          emailSubject: subject,
          labelIds: [...audience.labelIds],
          activeContactsOnly: Boolean(audience.activeContactsOnly),
          sendAt,
        },
      })
    },

    async sendTest(campaignId, { to, subject }) {
      return call('POST', `/email-marketing/v1/campaigns/${campaignId}/test`, { toEmailAddress: to, emailSubject: subject })
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
