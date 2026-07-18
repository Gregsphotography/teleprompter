const CACHE_NAME = 'aeroprompter-v5';

// Core app shell — refreshed in the background on every visit so deploys
// reach returning users without a cache-name bump.
const SHELL_PATHS = new Set([
  '/',
  '/index.html',
  '/styles.css',
  '/app.js',
  '/js/core.js',
  '/js/storage.js',
  '/js/editor.js',
  '/js/prompter.js',
  '/js/voice.js'
]);

const PRECACHE = [
  '/',
  '/index.html',
  '/styles.css',
  '/app.js',
  '/js/core.js',
  '/js/storage.js',
  '/js/editor.js',
  '/js/prompter.js',
  '/js/voice.js',
  '/imprint.html',
  '/privacy.html',
  '/cookie-policy.html',
  '/site.webmanifest',
  '/favicon.svg',
  '/icon-192.png',
  '/icon-512.png',
  '/apple-touch-icon.png',
  '/fonts/inter-latin-300-normal.woff2',
  '/fonts/inter-latin-400-normal.woff2',
  '/fonts/inter-latin-500-normal.woff2',
  '/fonts/inter-latin-600-normal.woff2',
  '/fonts/inter-latin-700-normal.woff2',
  '/fonts/playfair-display-latin-400-normal.woff2',
  '/fonts/playfair-display-latin-400-italic.woff2',
  '/fonts/playfair-display-latin-600-normal.woff2',
  '/fonts/playfair-display-latin-700-normal.woff2',
  '/fonts/fira-code-latin-400-normal.woff2',
  '/fonts/fira-code-latin-500-normal.woff2'
];

self.addEventListener('install', event => {
  event.waitUntil(
    caches.open(CACHE_NAME)
      .then(cache => cache.addAll(PRECACHE))
      .then(() => self.skipWaiting())
  );
});

self.addEventListener('activate', event => {
  event.waitUntil(
    caches.keys()
      .then(keys => Promise.all(keys
        .filter(key => key !== CACHE_NAME)
        .map(key => caches.delete(key))
      ))
      .then(() => self.clients.claim())
  );
});

function fetchAndCache(request) {
  return fetch(request).then(response => {
    if (response.ok) {
      const copy = response.clone();
      caches.open(CACHE_NAME).then(cache => cache.put(request, copy));
    }
    return response;
  });
}

self.addEventListener('fetch', event => {
  const { request } = event;
  if (request.method !== 'GET') return;

  const url = new URL(request.url);
  if (url.origin !== self.location.origin) return;

  // Stale-while-revalidate for the app shell: serve the cached copy
  // immediately, refresh it from the network in the background.
  if (SHELL_PATHS.has(url.pathname)) {
    event.respondWith(
      caches.match(request).then(cached => {
        const refresh = fetchAndCache(request).catch(() => cached);
        return cached || refresh;
      })
    );
    return;
  }

  // Cache-first for everything else (fonts, icons, legal pages).
  event.respondWith(
    caches.match(request).then(cached => {
      if (cached) return cached;

      return fetchAndCache(request).catch(() => {
        if (request.mode === 'navigate') {
          return caches.match('/index.html');
        }
        return Response.error();
      });
    })
  );
});
