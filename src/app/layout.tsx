import type { Metadata, Viewport } from "next";
import "./globals.css";
import ServiceWorkerRegister from "@/components/ServiceWorkerRegister";

export const metadata: Metadata = {
  title: "MagicTech — Data Analytics & Quotation Platform",
  description: "Data analytics and quotation platform powered by AI.",
  applicationName: "MagicTech",
  manifest: "/manifest.webmanifest",
  appleWebApp: {
    capable: true,
    statusBarStyle: "default",
    title: "MagicTech",
  },
};

export const viewport: Viewport = {
  themeColor: "#E2231A",
  width: "device-width",
  initialScale: 1,
};

export default function RootLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <html lang="en">
      <body className="min-h-screen text-magic-ink antialiased selection:bg-magic-red/20 selection:text-magic-ink">
        <ServiceWorkerRegister />
        {children}
      </body>
    </html>
  );
}
