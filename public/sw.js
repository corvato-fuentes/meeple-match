// Service worker: only job is showing push notifications and opening the app when one is tapped.
// It has no fetch handler on purpose: it never sits between the page and the network, and it is only
// registered once a player turns notifications on.

self.addEventListener('install', () => self.skipWaiting());
self.addEventListener('activate', (event) => event.waitUntil(self.clients.claim()));

self.addEventListener('push', (event) => {
  let data = {};
  try {
    data = event.data ? event.data.json() : {};
  } catch {
    data = { body: event.data ? event.data.text() : '' };
  }
  // Browsers (iOS especially) require every push to show a notification.
  event.waitUntil(
    self.registration.showNotification(data.title || 'Meeple Loop', {
      body: data.body || '',
      icon: '/icon-192.png',
      badge: '/icon-192.png',
      // Same tag = the newer one replaces the older instead of stacking up
      tag: data.tag || undefined,
      renotify: !!data.tag,
      data: { url: data.url || '/' },
    })
  );
});

self.addEventListener('notificationclick', (event) => {
  event.notification.close();
  const target = new URL((event.notification.data && event.notification.data.url) || '/', self.location.origin).href;
  event.waitUntil(
    (async () => {
      const windows = await self.clients.matchAll({ type: 'window', includeUncontrolled: true });
      // Reuse an already-open tab / the installed app instead of opening a second one
      for (const w of windows) {
        if (new URL(w.url).origin !== self.location.origin) continue;
        await w.focus();
        try { await w.navigate(target); } catch { /* navigate() isn't available everywhere */ }
        return;
      }
      await self.clients.openWindow(target);
    })()
  );
});
