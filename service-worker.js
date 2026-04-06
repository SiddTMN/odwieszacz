const CACHE_NAME = 'odwieszacz-cache-v2';
const APP_SHELL = [
  './',
  './index.html',
  './styles.css',
  './app.js',
  './manifest.json',
  './icon.svg'
];

self.addEventListener('install', (event) => {
  event.waitUntil(
    caches.open(CACHE_NAME).then((cache) => cache.addAll(APP_SHELL))
  );
  self.skipWaiting();
});

self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches.keys().then((keys) => Promise.all(
      keys
        .filter((key) => key !== CACHE_NAME)
        .map((key) => caches.delete(key))
    ))
  );
  self.clients.claim();
});

self.addEventListener('fetch', (event) => {
  if (event.request.method !== 'GET') {
    return;
  }

  event.respondWith(
    caches.match(event.request).then((cachedResponse) => {
      if (cachedResponse) {
        return cachedResponse;
      }

      return fetch(event.request).then((networkResponse) => {
        const responseClone = networkResponse.clone();
        caches.open(CACHE_NAME).then((cache) => cache.put(event.request, responseClone));
        return networkResponse;
      }).catch(() => caches.match('./index.html'));
    })
  );
});


self.addEventListener('notificationclick', (event) => {
  event.notification.close();

  const action = event.action || 'open';
  const reminderId = event.notification.data && event.notification.data.reminderId
    ? event.notification.data.reminderId
    : '';

  event.waitUntil((async () => {
    const allClients = await clients.matchAll({ type: 'window', includeUncontrolled: true });

    for (const client of allClients) {
      if ('focus' in client) {
        await client.focus();
      }

      client.postMessage({
        type: 'notification-action',
        action,
        reminderId
      });
      return;
    }

    if (clients.openWindow) {
      const query = new URLSearchParams({
        notificationAction: action,
        reminderId
      });
      await clients.openWindow(`./?${query.toString()}`);
    }
  })());
});
