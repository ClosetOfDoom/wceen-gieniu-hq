// push-sw.js — imported into the Workbox service worker (vite.config.ts → workbox.importScripts).
// The 09:00 push carries no payload: the text is fixed here. A click opens (or focuses) HOME.
self.addEventListener('push', (event) => {
  event.waitUntil(self.registration.showNotification('Brief gotowy', {
    body: 'Stanley przygotował brief dnia. Otwórz HOME.',
    icon: '/icons/icon-192.png?v=4',
    badge: '/icons/icon-192.png?v=4',
    tag: 'stanley-brief',
    renotify: true,
    data: { url: '/' },
  }))
})

self.addEventListener('notificationclick', (event) => {
  event.notification.close()
  const url = (event.notification.data && event.notification.data.url) || '/'
  event.waitUntil((async () => {
    const all = await self.clients.matchAll({ type: 'window', includeUncontrolled: true })
    for (const c of all) {
      if ('focus' in c) {
        await c.focus()
        if ('navigate' in c) await c.navigate(url).catch(() => {})
        return
      }
    }
    await self.clients.openWindow(url)
  })())
})
