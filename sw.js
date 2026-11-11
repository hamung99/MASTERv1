/* Service Worker - Laporan Penjualan (online + offline)
   Naikkan angka VER setiap kali upload versi baru agar perangkat lain yang sedang terbuka tahu ada update. */
const VER = 'pj-v2';
const SHELL = ['./', 'index.html', 'theme.js', 'backup.js', 'manifest.webmanifest', 'icon-192.png', 'icon-512.png'];
const CDN = [
  'https://cdnjs.cloudflare.com/ajax/libs/xlsx/0.18.5/xlsx.full.min.js',
  'https://cdn.jsdelivr.net/npm/exceljs@4.4.0/dist/exceljs.min.js'
];

self.addEventListener('install', e => {
  e.waitUntil((async () => {
    const c = await caches.open(VER);
    await Promise.all(SHELL.map(u => fetch(new Request(u, { cache: 'reload' })).then(r => { if (r.ok) return c.put(u, r); }).catch(() => {})));
    await Promise.all(CDN.map(u => fetch(u, { mode: 'no-cors' }).then(r => c.put(u, r)).catch(() => {})));
    self.skipWaiting();
  })());
});

self.addEventListener('activate', e => {
  e.waitUntil((async () => {
    for (const k of await caches.keys()) if (k !== VER) await caches.delete(k);
    await self.clients.claim();
  })());
});

self.addEventListener('fetch', e => {
  const req = e.request;
  if (req.method !== 'GET') return;
  const url = new URL(req.url);
  if (url.hostname.endsWith('supabase.co') || url.hostname.endsWith('supabase.in')) return;   // sinkron data selalu langsung ke server

  // Library CDN (xlsx, exceljs): cache dulu, supaya Excel tetap jalan offline
  if (url.hostname === 'cdnjs.cloudflare.com' || url.hostname === 'cdn.jsdelivr.net') {
    e.respondWith(caches.match(req).then(hit => hit || fetch(req).then(res => {
      const copy = res.clone(); caches.open(VER).then(c => c.put(req, copy)); return res;
    })));
    return;
  }

  // File aplikasi: ambil versi terbaru dari server; bila offline / koneksi lambat pakai salinan tersimpan
  if (url.origin === location.origin) {
    e.respondWith((async () => {
      const cache = await caches.open(VER);
      const cached = await cache.match(req, { ignoreSearch: true });
      const net = fetch(req).then(res => { if (res && res.ok) cache.put(req, res.clone()); return res; });
      try {
        if (!cached) return await net;
        return await Promise.race([net, new Promise((_, no) => setTimeout(no, 4000))]);
      } catch (err) {
        if (cached) return cached;
        if (req.mode === 'navigate') return (await cache.match('index.html')) || (await cache.match('./'));
        throw err;
      }
    })());
  }
});
