const CACHE_NAME = "sfsy-static-v20260818-japan-travel";
const STATIC_ASSETS = [
  "/",
  "/travel/",
  "/manifest.webmanifest",
  "/contact.vcf",
  "/cities/japan-2026.html",
  "/assets/css/styles.css?v=20260818-japan-travel",
  "/assets/js/app.js?v=20260818-japan-travel",
  "/assets/js/data.js",
  "/assets/images/avatar.webp",
  "/assets/images/generated/home-hero-ink-960.webp",
  "/assets/images/og-card.webp",
  "/assets/images/generated/japan-2026/01-arrival-480.webp",
];

self.addEventListener("install", (event) => {
  event.waitUntil(caches.open(CACHE_NAME).then((cache) => cache.addAll(STATIC_ASSETS)).catch(() => undefined));
  self.skipWaiting();
});

self.addEventListener("activate", (event) => {
  event.waitUntil(
    caches.keys().then((keys) => Promise.all(keys.filter((key) => key !== CACHE_NAME).map((key) => caches.delete(key))))
  );
  self.clients.claim();
});

self.addEventListener("fetch", (event) => {
  const request = event.request;
  const url = new URL(request.url);
  if (request.method !== "GET" || url.pathname.startsWith("/api/") || url.pathname.startsWith("/admin")) return;

  if (request.mode === "navigate") {
    event.respondWith(networkFirstPage(request));
    return;
  }

  event.respondWith(staleWhileRevalidate(request, event));
});

async function networkFirstPage(request) {
  try {
    const response = await fetch(request);
    if (response.ok) {
      const cache = await caches.open(CACHE_NAME);
      await cache.put(request, response.clone());
    }
    return response;
  } catch {
    return (await caches.match(request)) || (await caches.match("/")) || new Response("当前处于离线状态，请联网后重试。", {
      status: 503,
      headers: { "content-type": "text/plain; charset=utf-8" },
    });
  }
}

async function staleWhileRevalidate(request, event) {
  const cached = await caches.match(request);
  const network = fetch(request)
    .then(async (response) => {
      if (response.ok) {
        const cache = await caches.open(CACHE_NAME);
        await cache.put(request, response.clone());
      }
      return response;
    })
    .catch(() => null);

  if (cached) {
    event.waitUntil(network);
    return cached;
  }

  return (await network) || new Response("资源暂时不可用。", {
    status: 503,
    headers: { "content-type": "text/plain; charset=utf-8" },
  });
}
