/**
 * Runs before every page: refuse requests whose Host is not one this app is
 * served on (see lib/hosts.ts), so a DNS-rebinding page cannot load the app
 * under its own name.
 *
 * Two kinds of request are left out of the matcher, both on purpose:
 *
 * - /api. app/api/[...path]/route.ts makes the same Host check itself, and
 *   also the Origin, size and time checks on bodies.
 * - Requests that carry a body (a content-length or transfer-encoding
 *   header). With a proxy in front, Next copies the body for it and does not
 *   answer until the whole upload has arrived, even when the proxy refuses at
 *   once, so a 2 GB chunked POST to a page would be read to the end. Without
 *   the proxy, Next answers such a write to a page with 405 straight away:
 *   this app has no Server Actions, so pages take no writes. If Server Actions
 *   are ever added, put writes back under this check.
 *
 *   That also lets a GET with a content-length header skip the Host check.
 *   Only non-browser clients can send one (fetch refuses a body on GET and
 *   sets content-length itself), and those can send any Host anyway; the
 *   allowlist exists to stop browsers.
 */
import { NextResponse, type NextRequest } from 'next/server'
import { isAllowedHost, requestHosts } from '@/lib/hosts'

const BODYLESS = new Set(['GET', 'HEAD', 'OPTIONS'])

function plain(status: number, message: string) {
  return new NextResponse(`${message}\n`, {
    status,
    headers: { 'content-type': 'text/plain', 'cache-control': 'no-store', connection: 'close' },
  })
}

export function proxy(request: NextRequest) {
  if (!requestHosts(request.headers).every(isAllowedHost)) {
    return plain(421, 'Unknown host. Add it to ALLOWED_HOSTS to open the app on this address.')
  }
  // A write that reaches here has no body headers; pages take no writes.
  if (!BODYLESS.has(request.method)) return plain(405, 'Method Not Allowed')
  return NextResponse.next()
}

export const config = {
  matcher: [
    {
      source: '/((?!api(?:/|$)).*)',
      missing: [
        { type: 'header', key: 'content-length' },
        { type: 'header', key: 'transfer-encoding' },
      ],
    },
  ],
}
