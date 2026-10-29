const APP_CACHE = "carmori-app-v1";

self.addEventListener("install", (event) => {
  event.waitUntil((async () => {
    const cache = await caches.open(APP_CACHE);
    const page = await fetch("/", { cache: "reload" });
    if (!page.ok) throw new Error("App shell unavailable");
    await cache.put("/", page.clone());
    const html = await page.text();
    const assets = [...html.matchAll(/(?:src|href)="(\/assets\/[^\"]+)"/g)].map((match) => match[1]);
    await cache.addAll([...new Set(assets)]);
    await self.skipWaiting();
  })());
});

self.addEventListener("activate", (event) => {
  event.waitUntil((async () => {
    const names = await caches.keys();
    await Promise.all(names.filter((name) => name.startsWith("carmori-app-") && name !== APP_CACHE).map((name) => caches.delete(name)));
    await self.clients.claim();
  })());
});

self.addEventListener("fetch", (event) => {
  const request = event.request;
  if (request.method !== "GET") return;
  const url = new URL(request.url);
  if (url.origin !== self.location.origin || url.pathname.startsWith("/api/") || url.pathname.startsWith("/pipecat/")) return;
  event.respondWith((async () => {
    const cache = await caches.open(APP_CACHE);
    try {
      const response = await fetch(request);
      if (response.ok && response.status === 200) {
        try { await cache.put(request, response.clone()); } catch { /* Storage may be full. */ }
      }
      return response;
    } catch {
      const saved = await cache.match(request);
      if (saved) return saved;
      if (request.mode === "navigate") {
        const shell = await cache.match("/");
        if (shell) return shell;
      }
      return Response.error();
    }
  })());
});
