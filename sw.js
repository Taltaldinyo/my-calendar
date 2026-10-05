// Two jobs: (1) keep the app's own files on the phone so it opens without waiting for the network,
// and (2) show reminders sent by the server and open the right day when one is tapped.
//
// HOW UPDATES REACH THE PHONE
// Every release raises VERSION below, together with the ?v= numbers in index.html/app.js/data.js.
// sw.js then differs by a byte, so the browser installs the new worker in the background: it downloads
// the whole new set of files into a cache of its own, and only when all of them arrived does it take over
// (skipWaiting + clients.claim) and delete the old cache. The next time the app opens it shows the new
// version; the version that is already open is never touched mid-session. If the download fails halfway,
// the old worker and old cache stay in charge and the install retries on the next open.
// Forgot to raise VERSION? Still safe: index.html is refreshed on every open, and any file it asks for
// that isn't in the cache is fetched from the network - it just skips the tidy-up.
//
// WHAT IS CAUGHT: only GET requests to this site, inside this folder. Supabase, and anything else on
// another address, never goes through here. sw.js itself is always fetched by the browser directly.

const VERSION = 29;
const CACHE = `my-calendar-v${VERSION}`;
const SCOPE = self.registration.scope; // https://.../my-calendar/ - also what "./" (index.html) is
const PRECACHE = [
  SCOPE,
  `style.css?v=${VERSION}`,
  `data.js?v=${VERSION}`,
  `config.js?v=${VERSION}`,
  `holidays.js?v=${VERSION}`,
  `app.js?v=${VERSION}`,
  `vendor/supabase.js?v=${VERSION}`,
  'fonts/frank-ruhl-libre-hebrew.woff2',
  'fonts/frank-ruhl-libre-latin.woff2',
  'fonts/ibm-plex-sans-hebrew-400-hebrew.woff2',
  'fonts/ibm-plex-sans-hebrew-400-latin.woff2',
  'fonts/ibm-plex-sans-hebrew-500-hebrew.woff2',
  'fonts/ibm-plex-sans-hebrew-500-latin.woff2',
  'fonts/ibm-plex-sans-hebrew-600-hebrew.woff2',
  'fonts/ibm-plex-sans-hebrew-600-latin.woff2',
].map((path) => new URL(path, SCOPE).href);
// (manifest and icons are not listed: they are kept the first time the page asks for them)

self.addEventListener('install', (event) => {
  event.waitUntil((async () => {
    const cache = await caches.open(CACHE);
    // cache: 'reload' skips the browser's own 10-minute memory, so a new version never stores an old file
    await cache.addAll(PRECACHE.map((url) => new Request(url, { cache: 'reload' })));
    await self.skipWaiting();
  })());
});

self.addEventListener('activate', (event) => {
  event.waitUntil((async () => {
    for (const name of await caches.keys()) {
      if (name.startsWith('my-calendar-') && name !== CACHE) await caches.delete(name);
    }
    await self.clients.claim();
  })());
});

self.addEventListener('fetch', (event) => {
  const request = event.request;
  if (request.method !== 'GET' || request.headers.has('range')) return;
  const url = new URL(request.url);
  if (!url.href.startsWith(SCOPE)) return; // another address, or outside this folder
  if (url.pathname.endsWith('/sw.js')) return;
  event.respondWith(request.mode === 'navigate' ? openPage(event) : fileFromCache(event));
});

// The page itself: show what is on the phone at once, and quietly check the site for a newer copy.
// Every address of the page (?demo, ?v=2, #/2026-09...) is the same index.html.
async function openPage(event) {
  const cache = await caches.open(CACHE);
  const saved = await cache.match(SCOPE, { ignoreVary: true });
  const fresh = fetch(SCOPE, { cache: 'no-cache' }).then(async (response) => {
    // (not if a newer worker already took over and removed this cache while we were waiting)
    if (response.ok && !response.redirected && await caches.has(CACHE)) await cache.put(SCOPE, response.clone());
    return response;
  });
  if (!saved) return fresh; // nothing stored (first visit, or the phone cleared it): as if there was no worker
  event.waitUntil(fresh.catch(() => {}));
  return saved;
}

// Everything else: whatever is stored (the ?v= number is part of the name, so a new version is a new
// name and never matches an old file), otherwise the network - and keep the answer for next time.
async function fileFromCache(event) {
  const cache = await caches.open(CACHE);
  const saved = await cache.match(event.request, { ignoreVary: true });
  if (saved) return saved;
  const response = await fetch(event.request);
  if (response.ok && response.type === 'basic') {
    const copy = response.clone();
    event.waitUntil((async () => { if (await caches.has(CACHE)) await cache.put(event.request, copy); })());
  }
  return response;
}

self.addEventListener('push', (event) => {
  const data = event.data ? event.data.json() : {};
  event.waitUntil(self.registration.showNotification(data.title || 'לוח השנה שלי', {
    body: data.body || '',
    icon: 'icon.png',
    badge: 'icon.png',
    tag: data.tag,
    lang: 'he',
    dir: 'rtl',
    silent: true, // a quiet note, like a message preview; the phone may still follow its own sound setting
    data: { url: data.url || './' },
  }));
});

self.addEventListener('notificationclick', (event) => {
  event.notification.close();
  const url = new URL(event.notification.data?.url || './', self.registration.scope).href;
  event.waitUntil((async () => {
    const windows = await self.clients.matchAll({ type: 'window', includeUncontrolled: true });
    for (const client of windows) {
      if ('focus' in client) {
        await client.navigate?.(url).catch(() => {});
        return client.focus();
      }
    }
    return self.clients.openWindow(url);
  })());
});
