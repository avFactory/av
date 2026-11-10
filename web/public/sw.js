// عامل الخدمة للتطبيق: تثبيت النظام كتطبيق، وتسريع ملفات الواجهة، وصفحة "لا يوجد اتصال".
// لا يُخزَّن أي شيء من /api (البيانات دائماً من الخادم مباشرة).
const VERSION = 'av-v1';
const OFFLINE = '/offline.html';

self.addEventListener('install', (e) => {
  e.waitUntil(caches.open(VERSION).then((c) => c.addAll([OFFLINE, '/icon-192.png', '/logo-gold.png'])).then(() => self.skipWaiting()));
});

self.addEventListener('activate', (e) => {
  e.waitUntil(caches.keys().then((keys) => Promise.all(keys.filter((k) => k !== VERSION).map((k) => caches.delete(k)))).then(() => self.clients.claim()));
});

self.addEventListener('fetch', (e) => {
  const req = e.request;
  if (req.method !== 'GET') return;
  const url = new URL(req.url);
  if (url.origin !== location.origin || url.pathname.startsWith('/api/')) return;
  // ملفات الواجهة المبنية (أسماؤها تتغير مع كل تحديث): من الذاكرة أولاً
  if (url.pathname.startsWith('/assets/')) {
    e.respondWith(caches.open(VERSION).then(async (c) => {
      const hit = await c.match(req);
      if (hit) return hit;
      const res = await fetch(req);
      if (res.ok) c.put(req, res.clone());
      return res;
    }));
    return;
  }
  // الصفحات: من الخادم دائماً (أحدث نسخة)، وعند انقطاع الاتصال صفحة "لا يوجد اتصال"
  if (req.mode === 'navigate') {
    e.respondWith(fetch(req).catch(() => caches.match(OFFLINE)));
  }
});
