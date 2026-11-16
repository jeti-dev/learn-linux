// Minimal offline support: cache same-origin GET responses as they are fetched.
// The page is served network-first so a new deployment is picked up on the next online visit;
// hashed assets are served cache-first because their names change whenever their content does.
const CACHE = 'learn-linux-v1';

self.addEventListener('install', (event) => {
  event.waitUntil(caches.open(CACHE).then((cache) => cache.addAll(['./', './icon.svg', './manifest.webmanifest'])).then(() => self.skipWaiting()));
});

self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches
      .keys()
      .then((keys) => Promise.all(keys.filter((k) => k !== CACHE).map((k) => caches.delete(k))))
      .then(() => self.clients.claim()),
  );
});

self.addEventListener('fetch', (event) => {
  const { request } = event;
  if (request.method !== 'GET' || new URL(request.url).origin !== self.location.origin) return;
  const store = (response) => {
    if (response.ok) {
      const copy = response.clone();
      caches.open(CACHE).then((cache) => cache.put(request, copy));
    }
    return response;
  };
  if (request.mode === 'navigate') {
    event.respondWith(
      fetch(request)
        .then(store)
        .catch(() => caches.match(request).then((hit) => hit || caches.match('./'))),
    );
    return;
  }
  event.respondWith(caches.match(request).then((hit) => hit || fetch(request).then(store)));
});
