/** @type {import('next').NextConfig} */
const nextConfig = {
  // /api/* is proxied to the backend by a route handler
  // (app/api/[...path]/route.ts), which reads BACKEND_URL at request time and
  // refuses cross-site writes and oversized bodies.
  // No next/image in this app; turning the optimizer off removes the
  // /_next/image endpoint, which has had several security advisories.
  images: { unoptimized: true },
  poweredByHeader: false,
  experimental: {
    // Next copies a request body for proxy.ts and keeps at most this much.
    // proxy.ts skips requests with bodies (see the note there), so this is a
    // backstop: 1 MB bounds memory if that ever changes, and is well over the
    // 64 KB cap (lib/body.ts), so a cut-off body is still seen as too large.
    proxyClientMaxBodySize: '1mb',
  },
  // next dev only answers its own host by default. To use dev mode from a
  // phone, list the hosts you open it on, e.g. ALLOWED_DEV_ORIGINS=*.ts.net,100.101.102.103
  allowedDevOrigins: (process.env.ALLOWED_DEV_ORIGINS ?? '')
    .split(',')
    .map((origin) => origin.trim())
    .filter(Boolean),
  async headers() {
    // A request with a body reaching a page is refused (405, or 404 for no
    // page), and proxy.ts does not see it (see the note there). Close the
    // connection on that answer, or Node reads and discards the rest of the
    // body to keep the socket alive: gigabytes, or minutes of a slow drip.
    const pageWithBody = (key) => ({
      source: '/((?!api(?:/|$)).*)',
      has: [{ type: 'header', key }],
      headers: [{ key: 'Connection', value: 'close' }],
    })
    return [
      pageWithBody('content-length'),
      pageWithBody('transfer-encoding'),
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
