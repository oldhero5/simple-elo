/**
 * The hosts this app may be opened on.
 *
 * Without a list, any DNS name pointed at this machine reaches the app, so a
 * page on the internet could rebind its own name to 127.0.0.1 or a tailnet IP
 * and then call /api as a "same-origin" page. Every request's Host, and the
 * Origin of every write, must be on this list.
 *
 * Loopback is always allowed. Add the addresses you open the app on, comma
 * separated, in ALLOWED_HOSTS, for example
 *   ALLOWED_HOSTS=100.113.71.18,eigens-mac-studio.tail3355e0.ts.net
 * An entry without a port allows any port; "name:3000" allows only that port.
 *
 * What this does not see: a request with two Host headers. Node keeps the
 * first and drops the rest before Next sees them, and Next does not expose
 * the raw headers, so "Host: localhost" then "Host: evil.example" is checked
 * as localhost. Only a non-browser client can send that, and such a client
 * can send any single Host it likes anyway: the allowlist is a defence
 * against browsers (DNS rebinding), which always send exactly one Host.
 */

const DEFAULT_HOSTS = ['localhost', '127.0.0.1', '[::1]']

type Entry = { hostname: string; port: string | null }

// Letters, digits, dots, hyphens, colons and IPv6 brackets: nothing else
// belongs in a Host header, and refusing the rest up front keeps the URL
// parser from being handed paths, queries, fragments or credentials.
const HOST_CHARS = /^[A-Za-z0-9.:[\]-]+$/

// Parsed as an http URL so case, IPv6 brackets and default ports are normalised.
// One trailing dot ("name.ts.net.") is the same host, so it is dropped.
function parse(host: string): { hostname: string; port: string } | null {
  const value = host.trim()
  if (!HOST_CHARS.test(value)) return null
  try {
    const url = new URL(`http://${value}`)
    if (url.username || url.password || url.pathname !== '/' || url.search || url.hash) {
      return null
    }
    return { hostname: url.hostname.replace(/\.$/, ''), port: url.port }
  } catch {
    return null
  }
}

let cache: { source: string; entries: Entry[] } | null = null

function entries(): Entry[] {
  const source = process.env.ALLOWED_HOSTS ?? ''
  if (cache?.source !== source) {
    const list = [...DEFAULT_HOSTS, ...source.split(',')].filter((h) => h.trim())
    const parsed: Entry[] = []
    for (const item of list) {
      const p = parse(item)
      if (p) parsed.push({ hostname: p.hostname, port: /:\d+$/.test(item.trim()) ? p.port : null })
      else console.warn(`ALLOWED_HOSTS: ignoring "${item}"`)
    }
    cache = { source, entries: parsed }
  }
  return cache.entries
}

/** True when a Host header value ("name", "name:port", "[::1]:3000") is allowed. */
export function isAllowedHost(host: string | null): boolean {
  if (!host) return false
  const p = parse(host)
  if (!p) return false
  return entries().some((e) => e.hostname === p.hostname && (e.port === null || e.port === p.port))
}

/** True when an Origin header value ("https://name:port") names an allowed host. */
export function isAllowedOrigin(origin: string): boolean {
  try {
    const url = new URL(origin)
    if (url.protocol !== 'http:' && url.protocol !== 'https:') return false
    return isAllowedHost(url.host)
  } catch {
    return false // "null" from sandboxed frames and privacy modes
  }
}

/**
 * The host headers a request arrived with. A reverse proxy in front (such as
 * tailscale serve) may add X-Forwarded-Host; a page can also set that header
 * itself, so when present it has to pass as well.
 */
export function requestHosts(headers: Headers): (string | null)[] {
  const forwarded = headers.get('x-forwarded-host')
  return [headers.get('host'), ...(forwarded ? forwarded.split(',').map((h) => h.trim()) : [])]
}
