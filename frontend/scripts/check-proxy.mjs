// Checks the request guards in proxy.ts and app/api/[...path]/route.ts
// against a running `next start`. No backend needed: every refusal happens
// before the proxy calls it.
//
//   node scripts/check-proxy.mjs                    # http://127.0.0.1:3000
//   PORT=3001 EXTRA_HOST=100.113.71.18:3001 node scripts/check-proxy.mjs
//
// EXTRA_HOST, if set, must be on the server's ALLOWED_HOSTS and is expected
// to be served. Exits non-zero on any failure.
import http from 'node:http'

const PORT = Number(process.env.PORT ?? 3000)
const LOCAL = `localhost:${PORT}`
const MB = 1024 * 1024

function request({ method = 'GET', path = '/', headers = {}, body, stream }) {
  return new Promise((resolve, reject) => {
    let sent = 0
    const req = http.request(
      { host: '127.0.0.1', port: PORT, method, path, headers: { host: LOCAL, ...headers } },
      (res) => {
        res.resume()
        resolve({ status: res.statusCode, sent })
        if (stream) req.destroy() // stop uploading once the server has answered
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
]

if (process.env.EXTRA_HOST) {
  const host = process.env.EXTRA_HOST
  cases.push(
    [`page, ${host}`, { headers: { host } }, 200],
    [`write, Origin http://${host}`, { ...write, headers: { ...json, host, origin: `http://${host}` } }, passed],
  )
}

let failures = 0
for (const [name, options, expected] of cases) {
  const { status, sent } = await request(options)
  const ok = typeof expected === 'function' ? expected(status, sent) : status === expected
  if (!ok) failures++
  const note = options.stream ? ` (sent ${Math.round(sent / MB)} MB before the answer)` : ''
  console.log(`${ok ? 'ok  ' : 'FAIL'} ${status} ${name}${note}`)
}
if (failures) {
  console.error(`${failures} check(s) failed`)
  process.exit(1)
}
