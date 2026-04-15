import type { Metadata } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: "MagicTech — Data Analytics & Quotation Platform",
  description:
    "Data analytics and quotation platform powered by AI.",
};

export default function RootLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <html lang="en">
      <body className="min-h-screen text-magic-ink antialiased selection:bg-magic-red/20 selection:text-magic-ink">
        {children}
      </body>
    </html>
  );
}
