// SAKi Talk 서비스 워커: 화면 파일을 캐시해서 두 번째부터는 바로 열리게 한다.
// 화면(html)은 먼저 서버에 물어보고(새 버전 바로 반영), 안 되면 캐시. assets/ 는 이름에 해시가 붙어 캐시 먼저.
// API(api.php)는 절대 캐시하지 않는다.
const CACHE = 'talk-v2';

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

// 새 메시지 알림 (서버가 보낸 웹 푸시). 같은 방 알림은 하나로 묶어서 바꿔 끼운다
self.addEventListener('push', (e) => {
  let d = {};
  try { d = e.data ? e.data.json() : {}; } catch { d = { body: e.data?.text() || '' }; }
  // 홈 화면 아이콘 뱃지: 서버가 넣어 준 내 안 읽은 메시지 합계 (공지·시험 알림에는 없음 → 그대로 둠)
  const badge = typeof d.badge === 'number' && 'setAppBadge' in self.navigator
    ? (d.badge > 0 ? self.navigator.setAppBadge(d.badge) : self.navigator.clearAppBadge()).catch(() => {}) : null;
  e.waitUntil(Promise.all([badge, self.registration.showNotification(d.title || 'SAKi Talk', {
    body: d.body || '새 메시지',
    tag: d.tag || 'talk',
    renotify: true,
    icon: './icon-192.png',
    data: { room: d.room || 0, notice: d.notice || 0 },
  })]));
});

// 알림을 누르면: 열린 앱이 있으면 그 방(공지면 공지사항)으로, 없으면 앱을 그렇게 연다
self.addEventListener('notificationclick', (e) => {
  e.notification.close();
  const room = e.notification.data?.room || 0;
  const notice = e.notification.data?.notice || 0;
  e.waitUntil((async () => {
    const wins = await self.clients.matchAll({ type: 'window', includeUncontrolled: true });
    for (const w of wins) {
      if (new URL(w.url).pathname.startsWith(new URL('./', self.registration.scope).pathname)) {
        await w.focus();
        if (room) w.postMessage({ type: 'open-room', room });
        else if (notice) w.postMessage({ type: 'open-notices' });
        return;
      }
    }
    await self.clients.openWindow('./' + (room ? '#room=' + room : notice ? '#notices' : ''));
  })());
});
