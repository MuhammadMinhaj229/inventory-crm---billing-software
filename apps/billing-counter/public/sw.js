// Lightweight Service Worker enabling 1-click Desktop & Taskbar App installation (PWA)
self.addEventListener("install", () => {
    self.skipWaiting();
});

self.addEventListener("activate", (event) => {
    event.waitUntil(self.clients.claim());
});

self.addEventListener("fetch", (event) => {
    // Pass all API and dynamic requests straight to network for live Dual-DB consistency
    if (event.request.url.includes("/api/")) return;
    event.respondWith(fetch(event.request));
});
