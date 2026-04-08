import type { Metadata } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: "MagicTech — AI Quotation Designer",
  description:
    "AI-driven quotation designer powered by Groq, serverless Postgres, and live GitHub product databases.",
};

export default function RootLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <html lang="en">
      <body className="min-h-screen bg-white text-magic-ink antialiased">
        {children}
      </body>
    </html>
  );
}
