// Appends a timestamp query param to a URL to defeat CDN / service-worker caches.
// Only for /.netlify/functions/* endpoints — static assets should NOT use this.
export function bustUrl(url: string): string {
  const sep = url.includes('?') ? '&' : '?'
  return `${url}${sep}_t=${Date.now()}`
}
