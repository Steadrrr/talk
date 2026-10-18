// SAKi Talk 서비스 워커: 화면 파일을 캐시해서 두 번째부터는 바로 열리게 한다.
// 화면(html)은 먼저 서버에 물어보고(새 버전 바로 반영), 안 되면 캐시. assets/ 는 이름에 해시가 붙어 캐시 먼저.
// API(api.php)는 절대 캐시하지 않는다.
const CACHE = 'talk-v1';

self.addEventListener('install', () => self.skipWaiting());
self.addEventListener('activate', (e) => {
  e.waitUntil((async () => {
    for (const k of await caches.keys()) if (k !== CACHE) await caches.delete(k);
    await self.clients.claim();
  })());
});

self.addEventListener('fetch', (e) => {
  const req = e.request;
  const url = new URL(req.url);
  if (req.method !== 'GET' || url.origin !== location.origin || url.pathname.includes('/api.php') || url.pathname.endsWith('.php')) return;
  if (url.pathname.includes('/assets/')) {
    e.respondWith(caches.open(CACHE).then(async (c) => {
      const hit = await c.match(req);
      if (hit) return hit;
      const res = await fetch(req);
      if (res.ok) c.put(req, res.clone());
      return res;
    }));
    return;
  }
  e.respondWith(fetch(req).then((res) => {
    if (res.ok) caches.open(CACHE).then((c) => c.put(req, res.clone()));
    return res;
  }).catch(() => caches.match(req)));
});
