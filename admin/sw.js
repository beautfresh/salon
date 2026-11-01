/* Service worker: receives push notifications and opens the right page when tapped. */
const CACHE = 'bf-static-v1';
self.addEventListener('install', () => self.skipWaiting());
self.addEventListener('activate', (event) => event.waitUntil((async () => {
  const keys = await caches.keys();
  await Promise.all(keys.filter((k) => k.startsWith('bf-') && k !== CACHE).map((k) => caches.delete(k)));
  await self.clients.claim();
})()));

/* Speed: versioned files and fonts come from cache; pages try the network first. Data (Supabase) is never cached. */
self.addEventListener('fetch', (event) => {
  const req = event.request;
  if (req.method !== 'GET') return;
  const url = new URL(req.url);
  const sameOrigin = url.origin === self.location.origin;
  const isFont = /fonts\.(gstatic|googleapis)\.com$/.test(url.hostname);
  if (!sameOrigin && !isFont) return;
  const staticAsset = isFont || url.searchParams.has('v') || /\/vendor\//.test(url.pathname) || /\.(svg|png|jpg|webp|woff2?|ttf)$/.test(url.pathname);
  if (staticAsset) {
    event.respondWith((async () => {
      const cache = await caches.open(CACHE);
      const hit = await cache.match(req);
      if (hit) return hit;
      const res = await fetch(req);
      if (res.ok || res.type === 'opaque') cache.put(req, res.clone());
      return res;
    })());
  } else if (req.mode === 'navigate') {
    event.respondWith((async () => {
      const cache = await caches.open(CACHE);
      try { const res = await fetch(req); cache.put(req, res.clone()); return res; }
      catch (e) { return (await cache.match(req)) || Response.error(); }
    })());
  }
});

self.addEventListener('push', (event) => {
  let data = {};
  try { data = event.data ? event.data.json() : {}; } catch (_) { data = { body: event.data && event.data.text() }; }
  const title = data.title || 'بيوتفريش';
  event.waitUntil(self.registration.showNotification(title, {
    body: data.body || '',
    tag: data.tag || undefined,
    renotify: !!data.tag,
    dir: 'rtl',
    lang: 'ar',
    icon: 'assets/icon-192.png',
    badge: 'assets/badge-72.png',
    data: { url: data.url || '#/home' },
  }));
});

self.addEventListener('notificationclick', (event) => {
  event.notification.close();
  const target = new URL(event.notification.data?.url || '#/home', self.registration.scope).href;
  event.waitUntil((async () => {
    const all = await self.clients.matchAll({ type: 'window', includeUncontrolled: true });
    for (const c of all) {
      if (c.url.startsWith(self.registration.scope)) {
        await c.focus();
        if ('navigate' in c) return c.navigate(target);
        return undefined;
      }
    }
    return self.clients.openWindow(target);
  })());
});
