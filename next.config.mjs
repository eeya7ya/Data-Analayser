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
  // Bundle d1/schema.sql into the Vercel serverless function so
  // /api/admin/d1-apply-schema can read it with fs.readFile at runtime.
  outputFileTracingIncludes: {
    "/api/admin/d1-apply-schema": ["./d1/schema.sql"],
  },
};

export default nextConfig;
