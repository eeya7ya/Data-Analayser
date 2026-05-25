"use client";

import { useEffect } from "react";

/**
 * Registers the PWA service worker (/sw.js) once on first mount. Kept as a
 * tiny standalone client component so it can sit in the root layout
 * without turning the layout itself into a client component. Failures are
 * swallowed — an unsupported browser simply runs the app without offline
 * support or push.
 */
export default function ServiceWorkerRegister() {
  useEffect(() => {
    if (typeof navigator === "undefined" || !("serviceWorker" in navigator)) {
      return;
    }
    const register = () => {
      navigator.serviceWorker.register("/sw.js").catch(() => {
        /* registration failed — app still works, just no PWA features */
      });
    };
    if (document.readyState === "complete") register();
    else window.addEventListener("load", register, { once: true });
  }, []);

  return null;
}
