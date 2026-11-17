// Setaside service worker (item 23, spec 11): keeps the app's files so the app opens with no connection.
// Served as /sw.js by the plugin in vite.config.ts, which fills in VERSION and FILES (the built files and
// public/; none in development, where files are kept as they are fetched). /api/* is never touched: the
// money data lives in the app's own saved copy (src/client/offline-copy.ts), not in this cache.

const VERSION = "__VERSION__";
const FILES = "__FILES__";
const CACHE = `setaside-${VERSION}`;
/** Every screen is the one page; it is kept under this name. */
const PAGE = "/";
/** Wait this long for the network before opening the kept page instead (a very slow connection). */
const PAGE_WAIT_MS = 3000;
const kept = new Set(FILES);

self.addEventListener("install", (event) => {
  event.waitUntil(
    (async () => {
      const cache = await caches.open(CACHE);
      await cache.addAll([PAGE, ...FILES]);
      await self.skipWaiting();
    })(),
  );
});

self.addEventListener("activate", (event) => {
  event.waitUntil(
    (async () => {
      for (const key of await caches.keys()) {
        if (key.startsWith("setaside-") && key !== CACHE) await caches.delete(key);
      }
      await self.clients.claim();
    })(),
  );
});

self.addEventListener("fetch", (event) => {
  const request = event.request;
  if (request.method !== "GET") return;
  const url = new URL(request.url);
  if (url.origin !== self.location.origin || url.pathname.startsWith("/api/")) return;
  event.respondWith(request.mode === "navigate" ? page(request) : file(request, url));
});

/** The page: the network first (so a new release shows at once), the kept page when there is none. */
async function page(request) {
  const cache = await caches.open(CACHE);
  const fresh = fetch(request).then(async (res) => {
    if (res.ok && (res.headers.get("content-type") ?? "").includes("text/html")) {
      await cache.put(PAGE, res.clone());
    }
    return res;
  });
  const keptPage = await cache.match(PAGE, { ignoreVary: true });
  if (!keptPage) return fresh;
  const slow = new Promise((resolve) => setTimeout(() => resolve(keptPage), PAGE_WAIT_MS));
  return Promise.race([fresh.catch(() => keptPage), slow]);
}

/** Built files never change under one name: kept copy first. Anything else: network first, kept as a fallback. */
async function file(request, url) {
  const cache = await caches.open(CACHE);
  // ignoreVary: module scripts send Origin and some servers answer "Vary: Origin"; the file is the same.
  const hit = await cache.match(request, { ignoreVary: true });
  if (hit && kept.has(url.pathname)) return hit;
  try {
    const res = await fetch(request);
    if (res.ok) await cache.put(request, res.clone());
    return res;
  } catch (error) {
    if (hit) return hit;
    throw error;
  }
}

// Phone notifications (item 26, spec 12): the cron's push is always shown as a visible notification
// (Safari stops pushes to a page that shows none). Tapping it opens Today, or brings the open app forward.
self.addEventListener("push", (event) => {
  let message = { title: "Setaside", body: "", url: "/" };
  try {
    message = { ...message, ...event.data?.json() };
  } catch {
    message.body = event.data?.text() ?? "";
  }
  event.waitUntil(
    self.registration.showNotification(message.title, {
      body: message.body,
      icon: "/icon-192.png",
      badge: "/icon-192.png",
      tag: "setaside-reminders",
      data: { url: message.url },
    }),
  );
});

self.addEventListener("notificationclick", (event) => {
  event.notification.close();
  const url = new URL(event.notification.data?.url ?? "/", self.location.origin).href;
  event.waitUntil(
    (async () => {
      const open = await self.clients.matchAll({ type: "window", includeUncontrolled: true });
      const app = open.find((c) => new URL(c.url).origin === self.location.origin);
      if (app) {
        await app.focus();
        if ("navigate" in app) await app.navigate(url).catch(() => null);
        return;
      }
      await self.clients.openWindow(url);
    })(),
  );
});
