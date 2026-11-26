/*
Service worker of Nôm Ink (ink/): the app works offline.
Raise CACHE when a file of PRECACHE changes (a new name = a new cache; the old ones are deleted when the new worker takes over). Keep PRECACHE equal to what
index.html loads. The fonts of cdn.qatt.org (the slices of Pen with the characters) are cached when first used and renewed in the background.
*/
const CACHE = 'nom-ink-v13';
const HERE = new URL('./', self.location).href;
const at = p => new URL(p, HERE).href;
const PRECACHE = ['./', 'css/app.css', 'js/lang.js', 'js/shape.js', 'js/db.js', 'js/app.js', 'chars.json', 'parts.json', 'manifest.webmanifest',
  'icons/icon-192.png', 'icons/icon-512.png', 'icons/maskable-512.png'].map(at).concat(['https://qatt.org/js/fonts.js']);
const FONTS = /^https:\/\/cdn\.qatt\.org\/fonts\//;

self.addEventListener('install', event => event.waitUntil((async () => {
  const cache = await caches.open(CACHE);
  await Promise.all(PRECACHE.map(async url => {
    const res = await fetch(new Request(url, { cache: 'reload' })).catch(() => null);
    if (res && res.ok) await cache.put(url, res);
  }));
  self.skipWaiting();
})()));

self.addEventListener('activate', event => event.waitUntil((async () => {
  for (const k of await caches.keys()) if (k.startsWith('nom-ink-') && k !== CACHE) await caches.delete(k);
  await self.clients.claim();
})()));

// from the cache, renewed in the background (the files of the app, fonts.js and the fonts)
self.addEventListener('fetch', event => {
  const req = event.request;
  if (req.method !== 'GET') return;
  const url = req.url.split('#')[0];
  const mine = PRECACHE.includes(url.split('?')[0]) || FONTS.test(url);
  if (!mine) return;
  event.respondWith((async () => {
    const cache = await caches.open(CACHE);
    const hit = await cache.match(url.split('?')[0] === url ? url : req, { ignoreSearch: !FONTS.test(url) });
    const fresh = fetch(req).then(res => { if (res && res.ok) cache.put(req, res.clone()); return res; }).catch(() => null);
    if (hit) { event.waitUntil(fresh); return hit; }
    return (await fresh) || new Response('', { status: 504 });
  })());
});
