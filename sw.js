// VNO Era service worker — app-shell caching, offline fallback, notification clicks, push-ready.
const VERSION = 'vno-era-v1.2.0';
const SHELL = [
  './', './index.html', './styles.css', './app.js', './data.js', './map.js', './i18n.js',
  './manifest.webmanifest', './offline.html',
  './icons/favicon.svg', './icons/icon-192.png', './icons/icon-512.png', './icons/maskable-512.png',
  './icons/apple-touch-icon.png', './icons/badge-96.png',
];

self.addEventListener('install', (e) => {
  e.waitUntil(caches.open(VERSION).then((c) => c.addAll(SHELL)));
  self.skipWaiting();
});

self.addEventListener('activate', (e) => {
  e.waitUntil((async () => {
    for (const k of await caches.keys()) if (k !== VERSION) await caches.delete(k);
    await self.clients.claim();
  })());
});

self.addEventListener('message', (e) => { if (e.data?.type === 'SKIP_WAITING') self.skipWaiting(); });

self.addEventListener('fetch', (e) => {
  const req = e.request;
  if (req.method !== 'GET') return;
  const url = new URL(req.url);
  if (url.origin !== location.origin || url.pathname.includes('/data/')) return; // live data: always network

  if (req.mode === 'navigate') {
    // Network first (3 s budget), then cached shell, then offline page.
    e.respondWith((async () => {
      try {
        const res = await Promise.race([fetch(req), new Promise((_, rej) => setTimeout(() => rej(new Error('timeout')), 3000))]);
        const c = await caches.open(VERSION); c.put('./index.html', res.clone());
        return res;
      } catch {
        return (await caches.match('./index.html')) || (await caches.match('./offline.html'));
      }
    })());
    return;
  }

  // Static assets: stale-while-revalidate.
  e.respondWith((async () => {
    const cache = await caches.open(VERSION);
    const cached = await cache.match(req, { ignoreSearch: true });
    const network = fetch(req).then((res) => { if (res.ok) cache.put(req, res.clone()); return res; }).catch(() => null);
    return cached || (await network) || new Response('', { status: 504, statusText: 'Offline' });
  })());
});

// Tap on a flight alert → focus the app and open that flight.
self.addEventListener('notificationclick', (e) => {
  e.notification.close();
  const url = new URL(e.notification.data?.url || './', self.registration.scope).href;
  e.waitUntil((async () => {
    const all = await self.clients.matchAll({ type: 'window', includeUncontrolled: true });
    for (const c of all) {
      if (c.url.startsWith(self.registration.scope)) { await c.focus(); c.postMessage({ type: 'open', url }); return; }
    }
    await self.clients.openWindow(url);
  })());
});

// Ready for a Web Push server (see README). Payload: { title, body, flightId }.
self.addEventListener('push', (e) => {
  let d = {};
  try { d = e.data?.json() || {}; } catch { d = { title: 'VNO Era', body: e.data?.text() }; }
  e.waitUntil(self.registration.showNotification(d.title || 'VNO Era', {
    body: d.body || '', icon: './icons/icon-192.png', badge: './icons/badge-96.png', tag: d.tag || d.flightId,
    data: { url: d.flightId ? `./#/flight/${encodeURIComponent(d.flightId)}` : './' },
  }));
});
