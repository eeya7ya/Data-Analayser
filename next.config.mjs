/** @type {import('next').NextConfig} */
const nextConfig = {
  reactStrictMode: true,
  experimental: {
    serverActions: { bodySizeLimit: "8mb" },
  },
  // xlsx ships dynamic requires for node-only modules (fs, crypto). Without
  // this the App Router build fails with "Can't resolve 'fs'" when the upload
  // / template routes import it.
  serverExternalPackages: ["xlsx"],
  images: {
    remotePatterns: [
      { protocol: "https", hostname: "raw.githubusercontent.com" },
      { protocol: "https", hostname: "github.com" },
    ],
  },
};

export default nextConfig;
