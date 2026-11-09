// Checks the request guards in proxy.ts and app/api/[...path]/route.ts
// against a running `next start`. No backend needed: every refusal happens
// before the proxy calls it.
//
//   node scripts/check-proxy.mjs                    # http://127.0.0.1:3000
//   PORT=3001 EXTRA_HOST=100.113.71.18:3001 node scripts/check-proxy.mjs
//
// EXTRA_HOST, if set, must be on the server's ALLOWED_HOSTS and is expected
// to be served, as it would be over a tailnet. BODY_READ_TIMEOUT_MS must match
// the server's (default 15000). Exits non-zero on any failure.
import http from 'node:http'

const PORT = Number(process.env.PORT ?? 3000)
const LOCAL = `localhost:${PORT}`
const MB = 1024 * 1024
const READ_TIMEOUT_MS = Number(process.env.BODY_READ_TIMEOUT_MS ?? 15_000)

function request({ method = 'GET', path = '/', headers = {}, body, stream, drip }) {
  return new Promise((resolve, reject) => {
    let sent = 0
    const started = Date.now()
    const req = http.request(
      { host: '127.0.0.1', port: PORT, method, path, headers: { host: LOCAL, ...headers } },
      (res) => {
        res.resume()
        resolve({ status: res.statusCode, sent, ms: Date.now() - started })
        if (stream || drip) req.destroy() // stop uploading once the server has answered
      },
    )
    req.on('error', (error) => {
      // The server may answer 413 and close while we are still sending.
      if (req.res) return
      reject(error)
    })
    if (stream) {
      const chunk = Buffer.alloc(MB, 97)
      // About 100 MB/s, so the upload lasts long enough to see whether the
      // server answers before it has all arrived.
      const pump = () => {
        if (req.destroyed || req.res) return
        if (sent >= stream) return req.end()
        sent += chunk.length
        if (req.write(chunk)) setTimeout(pump, 10)
        else req.once('drain', () => setTimeout(pump, 10))
      }
      pump()
    } else if (drip) {
      // One byte every half second: never too large, only too slow.
      const tick = () => {
        if (req.destroyed || req.res) return
        if (Date.now() - started > drip) return req.end()
        sent += 1
        req.write('{')
        setTimeout(tick, 500)
      }
      tick()
    } else {
      req.end(body)
    }
  })
}

const json = { 'content-type': 'application/json' }
const write = { method: 'POST', path: '/api/rounds/new', headers: json, body: '{}' }
const passed = (s) => s !== 403 && s !== 413 && s !== 421

const cases = [
  ['page, unknown Host', { headers: { host: 'evil.example' } }, 421],
  ['page, rebound Host with port', { headers: { host: `evil.example:${PORT}` } }, 421],
  ['api, unknown Host', { path: '/api/meta', headers: { host: 'evil.example' } }, 421],
  ['page, unknown X-Forwarded-Host', { headers: { 'x-forwarded-host': 'evil.example' } }, 421],
  ['page, localhost', {}, 200],
  ['page, 127.0.0.1', { headers: { host: `127.0.0.1:${PORT}` } }, 200],
  ['write, cross-site Origin', { ...write, headers: { ...json, origin: 'http://evil.example' } }, 403],
  [
    'write, rebinding (Origin = Host = attacker)',
    { ...write, headers: { ...json, host: `evil.example:${PORT}`, origin: `http://evil.example:${PORT}` } },
    421,
  ],
  ['write, Origin null', { ...write, headers: { ...json, origin: 'null' } }, 403],
  ['write, Sec-Fetch-Site cross-site', { ...write, headers: { ...json, 'sec-fetch-site': 'cross-site' } }, 403],
  ['write, same origin passes the guards', { ...write, headers: { ...json, origin: `http://${LOCAL}` } }, passed],
  ['write, no Origin (curl) passes the guards', write, passed],
  ['write, 70 KB with content-length', { ...write, body: 'a'.repeat(70 * 1024) }, 413],
  [
    'write, 300 MB chunked, no content-length',
    { ...write, body: undefined, headers: { ...json, 'transfer-encoding': 'chunked' }, stream: 300 * MB },
    (s, sent) => s === 413 && sent < 50 * MB,
  ],
  ['traversal', { path: '/api/%2e%2e/openapi.json' }, 404],
  ['page, Host with a fragment', { headers: { host: `localhost#x` } }, 421],
  ['page, Host with a path', { headers: { host: `localhost:${PORT}/x` } }, 421],
  ['page, Host with credentials', { headers: { host: `user@localhost:${PORT}` } }, 421],
  ['page, Host with one trailing dot', { headers: { host: `localhost.:${PORT}` } }, 200],
  ['page, unknown Host with trailing dot', { headers: { host: 'evil.example.' } }, 421],
  ['page, write with a body', { method: 'POST', path: '/rate', headers: json, body: '{}' }, 405],
  [
    'page, write with a body, unknown Host (nothing served)',
    { method: 'POST', path: '/', headers: { ...json, host: 'evil.example' }, body: '{}' },
    405,
  ],
  ['page, write without a body', { method: 'POST', path: '/rate' }, 405],
  [
    'page, 300 MB chunked write',
    { method: 'POST', path: '/rate', headers: { ...json, 'transfer-encoding': 'chunked' }, stream: 300 * MB },
    (s, sent) => s === 405 && sent < 50 * MB,
  ],
  [
    `write, slow drip (deadline ${READ_TIMEOUT_MS} ms)`,
    { ...write, body: undefined, headers: { ...json, 'transfer-encoding': 'chunked' }, drip: READ_TIMEOUT_MS + 10_000 },
    (s, _sent, ms) => s === 408 && ms < READ_TIMEOUT_MS + 3_000,
  ],
]

if (process.env.EXTRA_HOST) {
  const host = process.env.EXTRA_HOST
  cases.push(
    [`page, ${host}`, { headers: { host } }, 200],
    [`write, Origin http://${host}`, { ...write, headers: { ...json, host, origin: `http://${host}` } }, passed],
    [
      `write, Host ${host} but Origin not listed`,
      { ...write, headers: { ...json, host, origin: 'http://not-listed.example' } },
      403,
    ],
    ['page, a name not on the list', { headers: { host: `not-listed.example:${PORT}` } }, 421],
  )
}

let failures = 0
for (const [name, options, expected] of cases) {
  const { status, sent, ms } = await request(options)
  const ok = typeof expected === 'function' ? expected(status, sent, ms) : status === expected
  if (!ok) failures++
  const note = options.stream
    ? ` (sent ${Math.round(sent / MB)} MB before the answer)`
    : options.drip
      ? ` (answered after ${(ms / 1000).toFixed(1)} s)`
      : ''
  console.log(`${ok ? 'ok  ' : 'FAIL'} ${status} ${name}${note}`)
}
if (failures) {
  console.error(`${failures} check(s) failed`)
  process.exit(1)
}
