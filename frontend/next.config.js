/** @type {import('next').NextConfig} */
const nextConfig = {
  // /api/* is proxied to the backend by a route handler
  // (app/api/[...path]/route.ts), which reads BACKEND_URL at request time and
  // refuses cross-site writes and oversized bodies.
  // No next/image in this app; turning the optimizer off removes the
  // /_next/image endpoint, which has had several security advisories.
  images: { unoptimized: true },
  poweredByHeader: false,
  // next dev only answers its own host by default. To use dev mode from a
  // phone, list the hosts you open it on, e.g. ALLOWED_DEV_ORIGINS=*.ts.net,100.101.102.103
  allowedDevOrigins: (process.env.ALLOWED_DEV_ORIGINS ?? '')
    .split(',')
    .map((origin) => origin.trim())
    .filter(Boolean),
  async headers() {
    return [
      {
        source: '/:path*',
        headers: [
          // Nobody should be able to frame the Rate page and trick a click.
          { key: 'X-Frame-Options', value: 'DENY' },
          { key: 'Content-Security-Policy', value: "frame-ancestors 'none'" },
          { key: 'X-Content-Type-Options', value: 'nosniff' },
          { key: 'Referrer-Policy', value: 'same-origin' },
        ],
      },
    ]
  },
}

module.exports = nextConfig
