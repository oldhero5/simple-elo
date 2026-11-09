/**
 * Same-origin proxy from /api/* to the backend.
 *
 * The browser only ever talks to the frontend's origin, so the app works from
 * any device that can open it (a phone on the tailnet, https via tailscale
 * serve) without CORS or mixed content. The backend address comes from
 * BACKEND_URL at request time, so one built image works in any environment.
 */
import { type NextRequest } from 'next/server'
import { MAX_BODY_BYTES, readCapped } from '@/lib/body'
import { isAllowedHost, isAllowedOrigin, requestHosts } from '@/lib/hosts'

export const dynamic = 'force-dynamic'
export const runtime = 'nodejs'

const DEFAULT_BACKEND_URL = 'http://127.0.0.1:8000'
const TIMEOUT_MS = 30_000

// Hop-by-hop headers (RFC 9110 section 7.6.1) apply to a single connection and
// must not be forwarded. host and content-length are recomputed by fetch.
// accept-encoding is dropped because fetch negotiates and decodes compression
// itself; forwarding the browser's value would hand back bodies it already
// decoded under a stale content-encoding header.
const REQUEST_HEADERS_TO_DROP = new Set([
  'connection',
  'keep-alive',
  'proxy-authenticate',
  'proxy-authorization',
  'proxy-connection',
  'te',
  'trailer',
  'transfer-encoding',
  'upgrade',
  'host',
  'content-length',
  'accept-encoding',
  'expect',
])

const RESPONSE_HEADERS_TO_DROP = new Set([
  'connection',
  'keep-alive',
  'proxy-authenticate',
  'proxy-authorization',
  'proxy-connection',
  'te',
  'trailer',
  'transfer-encoding',
  'upgrade',
  'content-length',
  'content-encoding',
])

const NULL_BODY_STATUSES = new Set([101, 204, 205, 304])

/**
 * True when a browser sent a state-changing request from another site, for
 * example a page on the internet that posts to this app while someone on the
 * tailnet has it open. There is no login, so this is the only thing stopping
 * such a page from ending a round or editing the roster.
 */
function isCrossSite(request: NextRequest): boolean {
  // Sent by current browsers, but only over HTTPS or to localhost.
  const site = request.headers.get('sec-fetch-site')
  if (site && site !== 'same-origin' && site !== 'none') return true
  // Plain http on a tailnet IP: browsers still send Origin on POST, PATCH and
  // DELETE. It must name a host on the allowlist, not merely match Host: a
  // DNS-rebinding page sends matching Origin and Host under its own name.
  const origin = request.headers.get('origin')
  if (origin === null) return false // not a browser (curl, scripts)
  return !isAllowedOrigin(origin)
}

type RouteContext = { params: Promise<{ path?: string[] }> }

function backendBase(): string {
  return (process.env.BACKEND_URL || DEFAULT_BACKEND_URL).replace(/\/+$/, '')
}

// Refusals close the connection. A refused request may still be sending its
// body (too large, too slow, or never coming), and on a kept-alive socket Node
// would go on reading it, for minutes if the client drips, before the socket
// could be reused.
function json(status: number, detail: string): Response {
  return Response.json(
    { detail },
    { status, headers: { 'cache-control': 'no-store', connection: 'close' } },
  )
}

function filterHeaders(source: Headers, drop: Set<string>): Headers {
  // Headers named in Connection are hop-by-hop too.
  const listed = (source.get('connection') ?? '')
    .split(',')
    .map((name) => name.trim().toLowerCase())
    .filter(Boolean)
  const result = new Headers()
  source.forEach((value, name) => {
    if (!drop.has(name) && !listed.includes(name)) result.append(name, value)
  })
  return result
}

// fetch reports connection problems as "TypeError: fetch failed" with the
// useful part (ECONNREFUSED, ENOTFOUND) in `cause`.
function describe(error: unknown): string {
  if (!(error instanceof Error)) return String(error)
  const cause = error.cause
  const detail =
    cause instanceof Error ? ` (${'code' in cause ? String(cause.code) : cause.message})` : ''
  return `${error.name}: ${error.message}${detail}`
}

async function proxy(request: NextRequest, { params }: RouteContext): Promise<Response> {
  const segments = (await params).path ?? []
  // Next has already decoded each segment; reject dot segments so a path like
  // /api/%2e%2e/x cannot resolve outside the backend's /api prefix.
  if (segments.some((segment) => segment === '.' || segment === '..')) {
    return json(404, 'Not found')
  }
  const path = segments.map(encodeURIComponent).join('/')
  const target = `${backendBase()}/api/${path}${request.nextUrl.search}`

  // proxy.ts makes this check for pages but skips /api (see the note there),
  // so the API's own check is the one that counts.
  if (!requestHosts(request.headers).every(isAllowedHost)) {
    return json(421, 'Unknown host')
  }

  const method = request.method
  const hasBody = method !== 'GET' && method !== 'HEAD'
  if (hasBody && isCrossSite(request)) {
    return json(403, 'Cross-site request blocked')
  }
  if (Number(request.headers.get('content-length') ?? 0) > MAX_BODY_BYTES) {
    return json(413, 'Request body too large')
  }
  let body: Uint8Array<ArrayBuffer> | undefined
  if (hasBody) {
    const read = await readCapped(request, MAX_BODY_BYTES)
    if (!read.ok) {
      return read.reason === 'timeout'
        ? json(408, 'Request body not received in time')
        : json(413, 'Request body too large')
    }
    body = read.body
  }

  let upstream: Response
  try {
    upstream = await fetch(target, {
      method,
      headers: filterHeaders(request.headers, REQUEST_HEADERS_TO_DROP),
      body: body && body.byteLength > 0 ? body : undefined,
      redirect: 'manual',
      cache: 'no-store',
      signal: AbortSignal.timeout(TIMEOUT_MS),
    })
  } catch (error) {
    console.error(`Proxy ${method} /api/${path} to ${backendBase()} failed: ${describe(error)}`)
    if (error instanceof Error && error.name === 'TimeoutError') {
      return json(504, 'Backend did not respond in time')
    }
    return json(502, 'Backend unavailable')
  }

  const headers = filterHeaders(upstream.headers, RESPONSE_HEADERS_TO_DROP)
  // FastAPI redirects (for example a trailing slash) point at the backend's own
  // address, which the browser cannot reach; make them relative to this origin.
  const location = headers.get('location')
  if (location?.startsWith(`${backendBase()}/`)) {
    headers.set('location', location.slice(backendBase().length))
  }
  const noBody = method === 'HEAD' || NULL_BODY_STATUSES.has(upstream.status)
  if (noBody) await upstream.body?.cancel()
  return new Response(noBody ? null : upstream.body, {
    status: upstream.status,
    statusText: upstream.statusText,
    headers,
  })
}

export const GET = proxy
export const HEAD = proxy
export const POST = proxy
export const PUT = proxy
export const PATCH = proxy
export const DELETE = proxy
