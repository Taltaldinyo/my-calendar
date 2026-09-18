// Shows reminders sent by the server, and opens the right day when one is tapped.
// No caching here on purpose: the app always loads fresh from the site.

self.addEventListener('push', (event) => {
  const data = event.data ? event.data.json() : {};
  event.waitUntil(self.registration.showNotification(data.title || 'לוח השנה שלי', {
    body: data.body || '',
    icon: 'icon.png',
    badge: 'icon.png',
    tag: data.tag,
    lang: 'he',
    dir: 'rtl',
    silent: true, // a quiet note, like a message preview; the phone may still follow its own sound setting
    data: { url: data.url || './' },
  }));
});

self.addEventListener('notificationclick', (event) => {
  event.notification.close();
  const url = new URL(event.notification.data?.url || './', self.registration.scope).href;
  event.waitUntil((async () => {
    const windows = await self.clients.matchAll({ type: 'window', includeUncontrolled: true });
    for (const client of windows) {
      if ('focus' in client) {
        await client.navigate?.(url).catch(() => {});
        return client.focus();
      }
    }
    return self.clients.openWindow(url);
  })());
});
