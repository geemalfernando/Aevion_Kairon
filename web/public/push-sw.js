/* Loaded by the generated Workbox worker; app-shell/offline caching stays in Workbox. */
self.addEventListener('push', (event) => {
  let tag = 'kairon-update'
  try { tag = String(event.data.json().tag ?? tag).slice(0, 200) } catch { /* Generic text only. */ }
  event.waitUntil(self.registration.showNotification('Kairon', {
    body: 'You have a delivery update. Open Kairon to view it.',
    icon: '/pwa-192.png', badge: '/pwa-192.png', tag, data: { url: '/login' },
  }))
})
self.addEventListener('notificationclick', (event) => {
  event.notification.close()
  event.waitUntil((async () => {
    const target = new URL('/login', self.location.origin).href
    const windows = await self.clients.matchAll({ type: 'window', includeUncontrolled: true })
    const existing = windows.find((client) => new URL(client.url).origin === self.location.origin)
    if (existing) { await existing.navigate(target); await existing.focus() }
    else await self.clients.openWindow(target)
  })())
})
