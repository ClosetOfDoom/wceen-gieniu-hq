// webinarMailImport.js — turns the PREVIEW of a sent Wix campaign into a clean, reusable template.
//
// Wix Preview returns the mail the way it is sent, which is not what we want to store:
//   · every link is wrapped in a tracking redirect of THAT campaign (…/so/<id>/c?w=<sig>.<base64url {"u": url}>)
//   · Wix injects its own footer ("Ta wiadomość e-mail została wysłana z tej strony") and a tracking pixel
//   · the registration link is a concrete address, not the {{WEBINAR_URL}} placeholder
// importTemplate() undoes all three. Pure, tested in src/lib/__tests__/webinarMail.test.ts.

import { escapeHtml } from './webinarMail.js'
import { WEBINAR_MAIL_CONFIG } from './webinarMailConfig.js'

const TRACK = /https?:\/\/[^"'\s]*\/so\/[A-Za-z0-9_-]+\/c\?w=[A-Za-z0-9_-]+\.([A-Za-z0-9_-]+)/

/** The original destination hidden in a Wix tracking link, or the link itself when it is not one. */
export function unwrapTrackingLink(href) {
  const m = TRACK.exec(href.replace(/&amp;/g, '&'))
  if (!m) return href
  try {
    const u = JSON.parse(Buffer.from(m[1], 'base64url').toString('utf8')).u
    return typeof u === 'string' && u ? u : href
  } catch {
    return href
  }
}

export function unwrapAllLinks(html) {
  return html.replace(/href=(["'])([^"']*)\1/gi, (_, q, href) => `href=${q}${unwrapTrackingLink(href)}${q}`)
}

/**
 * The template's OWN unsubscribe link (href "{{unsubscribe}}" or the dashboard's "[LINK WYPISANIA Z WIX]") is removed,
 * together with a <br> right before it. Wix does not replace these in an HTML campaign (the link arrives dead) and adds
 * its own footer with a working unsubscribe link, so the own link is redundant. The sentence before it stays.
 */
const OWN_UNSUBSCRIBE = /(?:<br\s*\/?>)?\s*<a\b[^>]*\bhref=(["'])(?:\{\{unsubscribe\}\}|\[LINK(?:%20| )WYPISANIA(?:%20| )Z(?:%20| )WIX\])\1[^>]*>[\s\S]*?<\/a>/gi

export function removeOwnUnsubscribeLinks(html) {
  let count = 0
  const out = html.replace(OWN_UNSUBSCRIBE, () => { count++; return '' })
  return { html: out, removed: count }
}

/** Removes the footer table Wix appends and the tracking pixel after it. */
export function stripWixInjection(html) {
  const footer = /<table role="presentation" border="0" cellpadding="0" cellspacing="0" width="100%" dir="ltr" style="width:100%!important[\s\S]*?<\/table>\s*<div style="display:none!important[^>]*><!--TRACKING_PIXEL--><\/div>/
  return html.replace(footer, '').replace(/<div[^>]*>\s*<!--TRACKING_PIXEL-->\s*<\/div>/g, '')
}

// Every address that stands for "register for the webinar", in any variant the mails used so far.
const WEBINAR_URL = /https?:\/\/(?:www\.)?(?:wceen\.com\/(?:webinar-jezyk-w-17h|darmowy-webinar)|eccehomo21\.com\/darmowy-webinar|[a-z0-9-]+\.clickmeeting\.com\/[a-z0-9-]+\/register)[^"'\s<)]*/gi

export function replaceWebinarLinks(html, placeholder = WEBINAR_MAIL_CONFIG.placeholder) {
  return html.replace(WEBINAR_URL, placeholder)
}

/** 'tuesday' | 'thursday' | null (neither or both markers present) from the unwrapped mail. */
export function classifySlot(html, config = WEBINAR_MAIL_CONFIG) {
  const hits = Object.entries(config.slots).filter(([, s]) => s.markers.some((m) => html.includes(m))).map(([name]) => name)
  return hits.length === 1 ? hits[0] : null
}

const FOLD = { ą: 'a', ć: 'c', ę: 'e', ł: 'l', ń: 'n', ó: 'o', ś: 's', ź: 'z', ż: 'z' }
export function slugify(text, max = 40) {
  const s = String(text).toLowerCase().replace(/[ąćęłńóśźż]/g, (c) => FOLD[c]).replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '')
  return (s.slice(0, max).replace(/-+$/, '')) || 'szablon'
}

/** Sets <title> to the subject and <meta name="preheader"> to the preheader (adds them when missing). */
export function setHeadFields(html, subject, preheader = '') {
  let out = html
  const title = `<title>${escapeHtml(subject)}</title>`
  out = /<title[^>]*>[\s\S]*?<\/title>/i.test(out) ? out.replace(/<title[^>]*>[\s\S]*?<\/title>/i, title) : out.replace(/<head[^>]*>/i, (m) => `${m}\n  ${title}`)
  const meta = `<meta name="preheader" content="${escapeHtml(preheader)}">`
  out = /<meta\b[^>]*\bname=["']preheader["'][^>]*>/i.test(out) ? out.replace(/<meta\b[^>]*\bname=["']preheader["'][^>]*>/i, meta) : out.replace(/<title[^>]*>[\s\S]*?<\/title>/i, (m) => `${m}\n  ${meta}`)
  return out
}

/** One sent campaign (preview html + subject) → { slot, html } or { slot: null } when it is not a webinar mail. */
export function importTemplate({ html, subject, preheader = '' }, config = WEBINAR_MAIL_CONFIG) {
  const unwrapped = removeOwnUnsubscribeLinks(stripWixInjection(unwrapAllLinks(html))).html
  const slot = classifySlot(unwrapped, config)
  if (!slot) return { slot: null, html: null }
  return { slot, html: setHeadFields(replaceWebinarLinks(unwrapped, config.placeholder), subject, preheader) }
}
