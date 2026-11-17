self.addEventListener('push', (event) => {
  if (!event.data) return
  const { title, body, url } = event.data.json()
  event.waitUntil(self.registration.showNotification(title, { body, icon: '/icons/192', data: { url } }))
})

self.addEventListener('notificationclick', (event) => {
  event.notification.close()
  const url = event.notification.data?.url ?? '/'
  event.waitUntil((async () => {
    const all = await self.clients.matchAll({ type: 'window', includeUncontrolled: true })
    const open = all.find((c) => new URL(c.url).origin === self.location.origin)
    if (open) {
      await open.focus()
      return open.navigate(url)
    }
    return self.clients.openWindow(url)
  })())
})
