// Offline copy of the web app, so the installed app (PWA) starts without a connection.
// The page itself is fetched fresh whenever there's a network, so a new release shows up on the
// next start; everything else (built assets with hashed names, the SoundFont, the sample song)
// comes from the cache first and is stored the first time it's fetched.
const CACHE = 'accordion-trainer-v2';

self.addEventListener('install', () => self.skipWaiting());

self.addEventListener('activate', event => {
  // Old caches from an earlier CACHE name go; then this worker takes over open pages.
  event.waitUntil((async () => {
    for (const key of await caches.keys()) if (key !== CACHE) await caches.delete(key);
    await self.clients.claim();
  })());
});

self.addEventListener('fetch', event => {
  const req = event.request;
  if (req.method !== 'GET' || new URL(req.url).origin !== self.location.origin) return;
  event.respondWith(req.mode === 'navigate' ? networkFirst(req) : cacheFirst(req));
});

async function networkFirst(req) {
  const cache = await caches.open(CACHE);
  try {
    const res = await fetch(req);
    if (res.ok) await cache.put(req, res.clone());
    return res;
  } catch (err) {
    const hit = await cache.match(req);
    if (hit) return hit;
    throw err;
  }
}

async function cacheFirst(req) {
  const cache = await caches.open(CACHE);
  const hit = await cache.match(req);
  if (hit) return hit;
  const res = await fetch(req);
  if (res.ok) await cache.put(req, res.clone());
  return res;
}
