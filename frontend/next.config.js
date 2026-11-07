/** @type {import('next').NextConfig} */
const nextConfig = {
  // The /api proxy is a route handler (app/api/[...path]/route.ts) so the
  // backend URL is read at request time, not baked in at build time.
  output: 'standalone',
  // No next/image in this app; turning the optimizer off removes the
  // /_next/image endpoint, which has had several security advisories.
  images: { unoptimized: true },
  poweredByHeader: false,
  reactStrictMode: true,
}

module.exports = nextConfig
