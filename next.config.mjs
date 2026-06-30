/** @type {import('next').NextConfig} */
const nextConfig = {
  reactStrictMode: true,
  // IMAP/SMTP libs use Node built-ins + raw sockets — keep them external so
  // Next doesn't try to bundle them into the serverless function.
  serverExternalPackages: ["imapflow", "nodemailer", "mailparser"],
  experimental: {
    serverActions: { bodySizeLimit: "10mb" },
  },
  images: {
    remotePatterns: [
      { protocol: "https", hostname: "raw.githubusercontent.com" },
      { protocol: "https", hostname: "github.com" },
    ],
  },
  // ensureSchema() applies d1/schema.sql on first D1 use from any route or
  // page (self-healing schema), so bundle it into every serverless function —
  // not just /api/admin/d1-apply-schema — so fs.readFile can find it at runtime.
  outputFileTracingIncludes: {
    "/**": ["./d1/schema.sql"],
  },
};

export default nextConfig;
