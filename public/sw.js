// Service worker: lets the shop install as an app, opens fast on a slow connection, and shows
// push notifications (order updates, promotions, new-order alerts for staff).
const CACHE = 'afm-v3';
const SHELL = ['/', '/index.html', '/styles.css', '/shop.js', '/addr.js', '/app.js', '/logo.png', '/icons/icon-192.png', '/order.html', '/account.html', '/account.js'];

self.addEventListener('install', (e) => {
  e.waitUntil(caches.open(CACHE).then((c) => c.addAll(SHELL)).catch(() => {}).then(() => self.skipWaiting()));
});
self.addEventListener('activate', (e) => {
  e.waitUntil(caches.keys().then((keys) => Promise.all(keys.filter((k) => k !== CACHE).map((k) => caches.delete(k)))).then(() => self.clients.claim()));
});

// Pages and scripts: network first (always fresh prices), cached copy when offline. API calls are never cached.
self.addEventListener('fetch', (e) => {
  const u = new URL(e.request.url);
  if (e.request.method !== 'GET' || u.origin !== location.origin || u.pathname.startsWith('/api/') || u.pathname.startsWith('/s/') || u.pathname.startsWith('/S/')) return;
  e.respondWith(
    fetch(e.request).then((res) => {
      if (res.ok && (SHELL.includes(u.pathname) || u.pathname.startsWith('/icons/'))) { const copy = res.clone(); caches.open(CACHE).then((c) => c.put(e.request, copy)); }
      return res;
    }).catch(() => caches.match(e.request, { ignoreSearch: true }).then((r) => r || caches.match('/')))
  );
});

self.addEventListener('push', (e) => {
  let d = {};
  try { d = e.data ? e.data.json() : {}; } catch { d = { title: "Ali's Fresh Meats", body: e.data && e.data.text() }; }
  const staff = String(d.tag || '').startsWith('staff');
  e.waitUntil(self.registration.showNotification(d.title || "Ali's Fresh Meats", {
    body: d.body || '', tag: d.tag || undefined, renotify: !!d.tag,
    icon: staff ? '/icons/staff-192.png' : '/icons/icon-192.png', badge: '/icons/icon-192.png',
    data: { url: d.url || '/' }, requireInteraction: staff, vibrate: staff ? [300, 100, 300, 100, 300] : [100],
  }));
});

self.addEventListener('notificationclick', (e) => {
  e.notification.close();
  const url = new URL(e.notification.data?.url || '/', location.origin).href;
  e.waitUntil(self.clients.matchAll({ type: 'window', includeUncontrolled: true }).then((list) => {
    for (const c of list) if (c.url.split('#')[0] === url.split('#')[0] && 'focus' in c) { c.navigate(url).catch(() => {}); return c.focus(); }
    return self.clients.openWindow(url);
  }));
});
