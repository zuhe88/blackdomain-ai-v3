const CACHE_VERSION = "blackdomain-pwa-20260826.05";
const APP_SHELL = [
  "/portal/",
  "/portal/index.html",
  "/portal/styles.css?v=20260826.05",
  "/portal/admin.css?v=20260826.05",
  "/portal/app.js?v=20260826.05",
  "/portal/manifest.webmanifest",
  "/portal/icons/icon-192.png",
  "/portal/icons/icon-512.png",
  "/portal/icons/icon-maskable-512.png",
  "/portal/icons/apple-touch-icon.png",
  "/brand/blackdomain-ai-logo.png"
];

self.addEventListener("install", (event) => {
  event.waitUntil(caches.open(CACHE_VERSION).then((cache) => cache.addAll(APP_SHELL)));
  self.skipWaiting();
});

self.addEventListener("activate", (event) => {
  event.waitUntil(Promise.all([
    caches.keys().then((keys) => Promise.all(
      keys.filter((key) => key.startsWith("blackdomain-pwa-") && key !== CACHE_VERSION)
        .map((key) => caches.delete(key)),
    )),
    self.clients.claim(),
  ]));
});

async function networkFirst(request, fallbackUrl = "") {
  const cache = await caches.open(CACHE_VERSION);
  try {
    const response = await fetch(request);
    if (response.ok) await cache.put(request, response.clone());
    return response;
  } catch (error) {
    const cached = await cache.match(request, { ignoreSearch: true });
    if (cached) return cached;
    if (fallbackUrl) {
      const fallback = await cache.match(fallbackUrl, { ignoreSearch: true });
      if (fallback) return fallback;
    }
    throw error;
  }
}

self.addEventListener("fetch", (event) => {
  const { request } = event;
  if (request.method !== "GET") return;
  const url = new URL(request.url);
  if (url.origin !== self.location.origin) return;
  if (url.pathname.startsWith("/api/") || url.pathname.startsWith("/portal/login")) return;
  if (request.mode === "navigate" && url.pathname.startsWith("/portal/")) {
    event.respondWith(networkFirst(request, "/portal/index.html"));
    return;
  }
  if (
    url.pathname.startsWith("/portal/")
    || url.pathname.startsWith("/brand/")
    || url.pathname.startsWith("/images/")
  ) {
    event.respondWith(networkFirst(request));
  }
});
