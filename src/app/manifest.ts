import type { MetadataRoute } from "next";

/**
 * PWA manifest — makes MagicTech installable ("Add to Home Screen" /
 * "Install app") on desktop and mobile. Served at /manifest.webmanifest
 * by Next.js. Icons are padded square renders of the brand logo (see
 * public/icons) so the installed icon and the browser tab favicon both
 * show the full wordmark instead of a squashed crop.
 */
export default function manifest(): MetadataRoute.Manifest {
  return {
    name: "MagicTech — Data Analytics & Quotation Platform",
    short_name: "MagicTech",
    description:
      "Data analytics and quotation platform powered by AI.",
    id: "/",
    start_url: "/",
    scope: "/",
    display: "standalone",
    orientation: "any",
    background_color: "#F3F5FB",
    theme_color: "#E2231A",
    icons: [
      {
        src: "/icons/icon-192.png",
        sizes: "192x192",
        type: "image/png",
        purpose: "any",
      },
      {
        src: "/icons/icon-512.png",
        sizes: "512x512",
        type: "image/png",
        purpose: "any",
      },
      {
        src: "/icons/maskable-192.png",
        sizes: "192x192",
        type: "image/png",
        purpose: "maskable",
      },
      {
        src: "/icons/maskable-512.png",
        sizes: "512x512",
        type: "image/png",
        purpose: "maskable",
      },
    ],
  };
}
