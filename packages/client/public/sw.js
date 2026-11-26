const CACHE = 'uno-pro-v2';
const ASSETS = ['/', '/index.html', '/icon.svg', '/manifest.webmanifest'];

self.addEventListener('install', (e) => {
  e.waitUntil(caches.open(CACHE).then(c => c.addAll(ASSETS)));
  self.skipWaiting();
});

self.addEventListener('activate', (e) => {
  e.waitUntil(caches.keys().then(keys => Promise.all(keys.filter(k => k !== CACHE).map(k => caches.delete(k)))));
  self.clients.claim();
});

self.addEventListener('fetch', (e) => {
  const url = new URL(e.request.url);
  if (url.pathname.startsWith('/socket.io') || url.pathname.startsWith('/api')) return;
  // 导航请求走 network-first：发版后 index.html 引用的 hash 资源已换，
  // 若命中旧缓存会整页 404。离线时才回退缓存。
  if (e.request.mode === 'navigate') {
    e.respondWith(
      fetch(e.request).then((res) => {
        if (res.ok) { const clone = res.clone(); caches.open(CACHE).then((c) => c.put('/index.html', clone)); }
        return res;
      }).catch(() => caches.match('/index.html').then((r) => r ?? Response.error())),
    );
    return;
  }
  e.respondWith(
    caches.match(e.request).then(cached => cached ?? fetch(e.request).then(res => {
      if (res.ok && e.request.method === 'GET') {
        const clone = res.clone();
        caches.open(CACHE).then(c => c.put(e.request, clone));
      }
      return res;
    }).catch(() => caches.match('/index.html'))),
  );
});
