/* MagicTech PWA service worker.
 *
 * Responsibilities:
 *   1. Make the app installable (a registered SW with a fetch handler is
 *      part of Chromium's install criteria).
 *   2. Receive Web Push messages and surface them as OS notifications on
 *      whatever device the app is installed on — desktop or phone.
 *   3. Focus / open the right page when a notification is clicked.
 *
 * It intentionally does NOT cache app responses: this app is auth-gated
 * and data-heavy, and a stale cache would show wrong CRM data. The fetch
 * handler only provides a tiny offline fallback for navigations.
 */

const OFFLINE_HTML =
  '<!doctype html><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">' +
  "<title>Offline</title>" +
  '<body style="font-family:system-ui,sans-serif;display:grid;place-items:center;min-height:100vh;margin:0;background:#F3F5FB;color:#111827">' +
  '<div style="text-align:center;padding:2rem"><h1 style="color:#E2231A;margin:0 0 .5rem">You’re offline</h1>' +
  "<p>MagicTech needs a connection to load this page. Reconnect and try again.</p></div></body>";

self.addEventListener("install", (event) => {
  // Activate the new SW immediately rather than waiting for old tabs.
  event.waitUntil(self.skipWaiting());
});

self.addEventListener("activate", (event) => {
  event.waitUntil(self.clients.claim());
});

self.addEventListener("fetch", (event) => {
  const req = event.request;
  // Only intervene for top-level navigations; let everything else hit the
  // network untouched so no API/data response is ever served from cache.
  if (req.mode !== "navigate") return;
  event.respondWith(
    fetch(req).catch(
      () =>
        new Response(OFFLINE_HTML, {
          headers: { "content-type": "text/html; charset=utf-8" },
        }),
    ),
  );
});

self.addEventListener("push", (event) => {
  let data = {};
  try {
    data = event.data ? event.data.json() : {};
  } catch {
    data = { title: "MagicTech", body: event.data ? event.data.text() : "" };
  }
  const title = data.title || "MagicTech";
  const options = {
    body: data.body || "",
    icon: "/icons/icon-192.png",
    badge: "/icons/maskable-192.png",
    tag: data.tag || undefined,
    data: { url: data.url || "/" },
  };
  event.waitUntil(self.registration.showNotification(title, options));
});

self.addEventListener("notificationclick", (event) => {
  event.notification.close();
  const target = (event.notification.data && event.notification.data.url) || "/";
  event.waitUntil(
    self.clients
      .matchAll({ type: "window", includeUncontrolled: true })
      .then((clients) => {
        for (const client of clients) {
          // Focus an existing tab and route it to the target if possible.
          if ("focus" in client) {
            client.focus();
            if ("navigate" in client && target) {
              try {
                client.navigate(target);
              } catch {
                /* cross-origin or detached — ignore */
              }
            }
            return;
          }
        }
        if (self.clients.openWindow) return self.clients.openWindow(target);
      }),
  );
});
