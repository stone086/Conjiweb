/// <reference lib="webworker" />
/* eslint-disable no-restricted-globals */

import { precacheAndRoute, cleanupOutdatedCaches } from "workbox-precaching";
import { registerRoute, NavigationRoute } from "workbox-routing";
import { NetworkFirst, NetworkOnly, StaleWhileRevalidate, CacheFirst } from "workbox-strategies";
import { ExpirationPlugin } from "workbox-expiration";

declare const self: ServiceWorkerGlobalScope;

// Pre-cache build manifest
precacheAndRoute(self.__WB_MANIFEST);
cleanupOutdatedCaches();

// =====================================================
// Runtime caching strategies
// =====================================================
registerRoute(
  new NavigationRoute(
    new NetworkFirst({
      cacheName: "pages-cache",
      networkTimeoutSeconds: 3,
      plugins: [new ExpirationPlugin({ maxEntries: 20, maxAgeSeconds: 24 * 60 * 60 })],
    })
  )
);

registerRoute(
  ({ url }) => url.pathname.startsWith("/api/"),
  new NetworkOnly()
);

registerRoute(
  ({ request }) =>
    request.destination === "style" ||
    request.destination === "script" ||
    request.destination === "worker",
  new StaleWhileRevalidate({
    cacheName: "assets-runtime",
    plugins: [new ExpirationPlugin({ maxEntries: 100, maxAgeSeconds: 7 * 24 * 60 * 60 })],
  })
);

registerRoute(
  ({ request }) => request.destination === "image",
  new CacheFirst({
    cacheName: "images-runtime",
    plugins: [new ExpirationPlugin({ maxEntries: 200, maxAgeSeconds: 30 * 24 * 60 * 60 })],
  })
);

// =====================================================
// Web Push handlers
// =====================================================
self.addEventListener("push", (event: PushEvent) => {
  if (!event.data) return;
  let data: { title?: string; body?: string; tag?: string; conversationId?: string };
  try {
    data = event.data.json();
  } catch {
    data = { title: "New message", body: event.data.text() };
  }

  const title = (data.title || "Conjiweb").slice(0, 100);
  const options: NotificationOptions = {
    body: (data.body || "").slice(0, 500),
    icon: "/icon-192.png",
    badge: "/icon-192.png",
    tag: data.tag || "conjiweb-msg",
    data: {
      conversationId: data.conversationId,
      url: data.conversationId ? `/chat/${encodeURIComponent(data.conversationId)}` : "/",
    },
  };

  event.waitUntil(self.registration.showNotification(title, options));
});

self.addEventListener("notificationclick", (event: NotificationEvent) => {
  event.notification.close();
  const rawUrl = (event.notification.data as { url?: string })?.url || "/";
  // Only allow same-origin paths (not absolute external URLs)
  const url = rawUrl.startsWith("/") && !rawUrl.startsWith("//") ? rawUrl : "/";
  event.waitUntil(
    self.clients.matchAll({ type: "window", includeUncontrolled: true }).then((clients) => {
      // If a window is already open, focus it and navigate
      for (const client of clients) {
        if ("focus" in client && "navigate" in client) {
          (client as WindowClient).focus();
          (client as WindowClient).navigate(url);
          return;
        }
      }
      // Otherwise open a new window
      return self.clients.openWindow(url);
    })
  );
});

// Skip waiting on update — only accept messages from same-origin clients
self.addEventListener("message", (event) => {
  // Validate the source is one of our own clients (same origin)
  if (event.source && "url" in event.source) {
    const sourceUrl = (event.source as Client).url;
    try {
      const sourceOrigin = new URL(sourceUrl).origin;
      if (sourceOrigin !== self.location.origin) {
        return;
      }
    } catch {
      return;
    }
  }
  if (event.data && event.data.type === "SKIP_WAITING") {
    self.skipWaiting();
  }
});
