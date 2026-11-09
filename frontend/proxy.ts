/**
 * Runs before every page: refuse requests whose Host is not one this app is
 * served on (see lib/hosts.ts), so a DNS-rebinding page cannot load the app
 * under its own name.
 *
 * /api is left out of the matcher on purpose. With a proxy in front, Next
 * copies each request body for it and does not answer until the whole upload
 * has arrived, so a 300 MB chunked POST would be read to the end before being
 * refused. app/api/[...path]/route.ts makes the same Host check itself and
 * streams the body, so it can refuse an oversized one after 64 KB.
 *
 * Writes to pages are still capped here (the app has none; Next keeps at most
 * proxyClientMaxBodySize of the copy, see next.config.js).
 */
import { NextResponse, type NextRequest } from 'next/server'
import { MAX_BODY_BYTES, readCapped } from '@/lib/body'
import { isAllowedHost, requestHosts } from '@/lib/hosts'

const BODYLESS = new Set(['GET', 'HEAD', 'OPTIONS'])

function plain(status: number, message: string) {
  return new NextResponse(`${message}\n`, {
    status,
    headers: { 'content-type': 'text/plain', 'cache-control': 'no-store', connection: 'close' },
  })
}

export async function proxy(request: NextRequest) {
  if (!requestHosts(request.headers).every(isAllowedHost)) {
    return plain(421, 'Unknown host. Add it to ALLOWED_HOSTS to open the app on this address.')
  }
  if (!BODYLESS.has(request.method)) {
    if (Number(request.headers.get('content-length') ?? 0) > MAX_BODY_BYTES) {
      return plain(413, 'Request body too large')
    }
    // Reads Next's copy of the body; the handler still gets its own.
    if ((await readCapped(request, MAX_BODY_BYTES)) === null) {
      return plain(413, 'Request body too large')
    }
  }
  return NextResponse.next()
}

export const config = { matcher: '/((?!api(?:/|$)).*)' }
