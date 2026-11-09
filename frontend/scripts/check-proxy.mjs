// Checks the request guards in proxy.ts and app/api/[...path]/route.ts
// against the real built server.
//
//   npm run build && node scripts/check-proxy.mjs
//
// The script starts everything it talks to: a stub backend and `next start`,
// each on a free loopback port, with BACKEND_URL pointing at the stub. It
// never connects to a server it did not start, so it cannot write to a real
// database. Extra hosts (as on a tailnet) are checked through the Host header.
import { spawn } from 'node:child_process'
import http from 'node:http'
import net from 'node:net'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
const EXTRA_HOSTS = ['ci-mac.tailnet.example', '100.64.0.1']
const READ_TIMEOUT_MS = 3_000
const MB = 1024 * 1024

// ---- the stub backend and the server under test --------------------------

const stubRequests = []
const stub = http.createServer((req, res) => {
  req.resume()
  req.on('end', () => {
    stubRequests.push(`${req.method} ${req.url}`)
    res.writeHead(200, { 'content-type': 'application/json' })
    res.end('{"stub":true}')
  })
})
await new Promise((resolve) => stub.listen(0, '127.0.0.1', resolve))

async function freePort() {
  const server = net.createServer()
  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve))
  const { port } = server.address()
  await new Promise((resolve) => server.close(resolve))
  return port
}

const PORT = await freePort()
const LOCAL = `localhost:${PORT}`
const next = spawn(
  process.execPath,
  [path.join(ROOT, 'node_modules/next/dist/bin/next'), 'start', '-H', '127.0.0.1', '-p', String(PORT)],
  {
    cwd: ROOT,
    env: {
      ...process.env,
      BACKEND_URL: `http://127.0.0.1:${stub.address().port}`,
      ALLOWED_HOSTS: EXTRA_HOSTS.join(','),
      BODY_READ_TIMEOUT_MS: String(READ_TIMEOUT_MS),
    },
    stdio: ['ignore', 'pipe', 'pipe'],
  },
)
let nextLog = ''
next.stdout.on('data', (d) => (nextLog += d))
next.stderr.on('data', (d) => (nextLog += d))

// Never leave the server behind, whatever way this script ends.
process.on('exit', () => next.kill())
for (const signal of ['SIGINT', 'SIGTERM']) process.on(signal, () => process.exit(130))

function shutdown(code) {
  next.kill()
  stub.close()
  process.exit(code)
}

for (let i = 0; ; i++) {
  const up = await new Promise((resolve) => {
    http
      .get({ host: '127.0.0.1', port: PORT, path: '/', headers: { host: LOCAL } }, (res) => {
        res.resume()
        resolve(true)
      })
      .on('error', () => resolve(false))
  })
  if (up) break
  if (i > 60 || next.exitCode !== null) {
    console.error(`next start did not come up:\n${nextLog}`)
    shutdown(1)
  }
  await new Promise((resolve) => setTimeout(resolve, 500))
}

// ---- one request ----------------------------------------------------------

/**
 * Send one request and report the status, how much body was sent before the
 * answer, how long the answer took, and whether the server then closed the
 * connection (closedMs) or left it open waiting for more body.
 *
 * Body modes: `body` (all at once), `stream` (bytes, about 100 MB/s), `drip`
 * (one byte every half second for that many ms), `stall` (send `prefix`, if
 * any, then nothing).
 */
function request({ method = 'GET', path: url = '/', headers = {}, body, stream, drip, stall }) {
  return new Promise((resolve, reject) => {
    let sent = 0
    const started = Date.now()
    let answered = null
    const req = http.request({
      host: '127.0.0.1',
      port: PORT,
      method,
      path: url,
      // keep-alive as browsers send it, so a closed socket is the server's choice
      headers: { host: LOCAL, connection: 'keep-alive', ...headers },
      agent: false,
    })
    const finish = (closedMs) => {
      clearTimeout(giveUp)
      req.destroy()
      resolve({ ...answered, closedMs })
    }
    // A server that never answers is a failure to report, not a hang.
    const giveUp = setTimeout(() => {
      if (answered) return
      answered = { status: 'no answer', sent, ms: Date.now() - started, connection: null }
      finish(null)
    }, 20_000)
    req.on('response', (res) => {
      res.resume()
      answered = {
        status: res.statusCode,
        sent,
        ms: Date.now() - started,
        connection: res.headers.connection ?? null,
      }
      // Did the server close the socket, or is it still waiting for body?
      const at = Date.now()
      const timer = setTimeout(() => finish(null), 3_000)
      req.socket.once('close', () => {
        clearTimeout(timer)
        finish(Date.now() - at)
      })
    })
    req.on('error', (error) => {
      if (answered) return // writes after the server closed the socket
      reject(error)
    })
    const open = () => !req.destroyed && !answered
    if (stream) {
      const chunk = Buffer.alloc(MB, 97)
      const pump = () => {
        if (!open()) return
        if (sent >= stream) return req.end()
        sent += chunk.length
        if (req.write(chunk)) setTimeout(pump, 10)
        else req.once('drain', () => setTimeout(pump, 10))
      }
      pump()
    } else if (drip) {
      const tick = () => {
        if (!open()) return
        if (Date.now() - started > drip) return req.end()
        sent += 1
        req.write('{')
        setTimeout(tick, 500)
      }
      tick()
    } else if (stall) {
      req.flushHeaders()
      if (stall.prefix) {
        sent += Buffer.byteLength(stall.prefix)
        req.write(stall.prefix)
      }
    } else {
      req.end(body)
    }
  })
}

// ---- the checks -------------------------------------------------------------

const json = { 'content-type': 'application/json' }
const write = { method: 'POST', path: '/api/rounds/new', headers: json, body: '{}' }
const chunked = { ...json, 'transfer-encoding': 'chunked' }
const reachedStub = (r) => r.status === 200
const refusedAndClosed = (status, within) => (r) =>
  r.status === status && r.ms < within && r.closedMs !== null && r.closedMs < 1_000
const deadline = READ_TIMEOUT_MS + 1_500

const cases = [
  ['page, unknown Host', { headers: { host: 'evil.example' } }, 421],
  ['page, rebound Host with port', { headers: { host: `evil.example:${PORT}` } }, 421],
  ['api, unknown Host', { path: '/api/meta', headers: { host: 'evil.example' } }, 421],
  ['page, unknown X-Forwarded-Host', { headers: { 'x-forwarded-host': 'evil.example' } }, 421],
  ['page, localhost', {}, 200],
  ['page, 127.0.0.1', { headers: { host: `127.0.0.1:${PORT}` } }, 200],
  ['page, Host with a fragment', { headers: { host: 'localhost#x' } }, 421],
  ['page, Host with a path', { headers: { host: `localhost:${PORT}/x` } }, 421],
  ['page, Host with credentials', { headers: { host: `user@localhost:${PORT}` } }, 421],
  ['page, Host with one trailing dot', { headers: { host: `localhost.:${PORT}` } }, 200],
  ['page, unknown Host with trailing dot', { headers: { host: 'evil.example.' } }, 421],
  ['write, cross-site Origin', { ...write, headers: { ...json, origin: 'http://evil.example' } }, 403],
  [
    'write, rebinding (Origin = Host = attacker)',
    { ...write, headers: { ...json, host: `evil.example:${PORT}`, origin: `http://evil.example:${PORT}` } },
    421,
  ],
  ['write, Origin null', { ...write, headers: { ...json, origin: 'null' } }, 403],
  ['write, Sec-Fetch-Site cross-site', { ...write, headers: { ...json, 'sec-fetch-site': 'cross-site' } }, 403],
  ['write, same origin reaches the backend', { ...write, headers: { ...json, origin: `http://${LOCAL}` } }, reachedStub],
  ['write, no Origin (curl) reaches the backend', write, reachedStub],
  ['traversal', { path: '/api/%2e%2e/openapi.json' }, 404],
  ['write, 70 KB with content-length', { ...write, body: 'a'.repeat(70 * 1024) }, 413],
  [
    'write, 300 MB chunked: refused early, socket closed',
    { ...write, body: undefined, headers: chunked, stream: 300 * MB },
    (r) => r.status === 413 && r.sent < 50 * MB && r.closedMs !== null && r.closedMs < 1_000,
  ],
  [
    'write, 70 KB then stalls: 413 at once, socket closed',
    { ...write, body: undefined, headers: chunked, stall: { prefix: 'a'.repeat(70 * 1024) } },
    refusedAndClosed(413, 1_500),
  ],
  [
    'write, headers then no body: 408 at the deadline, socket closed',
    { ...write, body: undefined, headers: { ...json, 'content-length': '100' }, stall: {} },
    refusedAndClosed(408, deadline),
  ],
  [
    'write, a few bytes then stalls: 408 at the deadline, socket closed',
    { ...write, body: undefined, headers: chunked, stall: { prefix: '{"a"' } },
    refusedAndClosed(408, deadline),
  ],
  [
    'write, slow drip: 408 at the deadline, socket closed',
    { ...write, body: undefined, headers: chunked, drip: READ_TIMEOUT_MS + 10_000 },
    refusedAndClosed(408, deadline),
  ],
  ['page, write with a body', { method: 'POST', path: '/rate', headers: json, body: '{}' }, 405],
  [
    'page, write with a body, unknown Host (nothing served)',
    { method: 'POST', path: '/', headers: { ...json, host: 'evil.example' }, body: '{}' },
    405,
  ],
  ['page, write without a body', { method: 'POST', path: '/rate' }, 405],
  ...['POST', 'PUT', 'PATCH', 'DELETE'].flatMap((method) =>
    ['/', '/rate', '/nope'].map((url) => [
      `page, ${method} ${url} with 2 GB content-length, dripping: answered, socket closed`,
      { method, path: url, headers: { ...json, 'content-length': String(2 * 1024 * MB) }, drip: 20_000 },
      (r) => (r.status === 405 || r.status === 404) && r.ms < 1_500 && r.closedMs !== null && r.closedMs < 1_000,
    ]),
  ),
  [
    'page, 300 MB chunked write: refused early, socket closed',
    { method: 'POST', path: '/rate', headers: chunked, stream: 300 * MB },
    (r) => r.status === 405 && r.sent < 50 * MB && r.closedMs !== null && r.closedMs < 1_000,
  ],
  ...EXTRA_HOSTS.flatMap((name) => {
    const host = `${name}:${PORT}`
    return [
      [`page, ${host}`, { headers: { host } }, 200],
      [`write, Host and Origin ${host}`, { ...write, headers: { ...json, host, origin: `http://${host}` } }, reachedStub],
      [
        `write, Host ${host} but Origin not listed`,
        { ...write, headers: { ...json, host, origin: 'http://not-listed.example' } },
        403,
      ],
    ]
  }),
  ['page, a name not on the list', { headers: { host: `not-listed.example:${PORT}` } }, 421],
]

let failures = 0
const report = (ok, label, r, note = '') => {
  if (!ok) failures++
  const closed = r.closedMs === null ? 'left open' : `closed after ${r.closedMs} ms`
  console.log(`${ok ? 'ok  ' : 'FAIL'} ${r.status} ${label} [${r.ms} ms, sent ${r.sent} B, ${closed}]${note}`)
}

for (const [label, options, expected] of cases) {
  const r = await request(options)
  const ok = typeof expected === 'function' ? expected(r) : r.status === expected
  report(ok, label, r)
}

// Many stalled bodies at once must each be answered at the deadline and let
// go, not pile up until Node's five-minute request timeout.
const STALLED = 50
const startedAll = Date.now()
const stalled = await Promise.all(
  Array.from({ length: STALLED }, () =>
    request({ ...write, body: undefined, headers: { ...json, 'content-length': '100' }, stall: {} }),
  ),
)
const allOk = stalled.every(refusedAndClosed(408, deadline))
const worst = stalled.reduce((a, b) => (b.ms > a.ms ? b : a))
report(allOk, `${STALLED} stalled bodies at once, all 408 and closed (${Date.now() - startedAll} ms total)`, worst, ' (slowest)')

const proxied = stubRequests.length
console.log(`stub backend saw ${proxied} request(s): ${[...new Set(stubRequests)].join(', ')}`)
if (failures) {
  console.error(`${failures} check(s) failed\n--- next start log ---\n${nextLog}`)
  shutdown(1)
}
shutdown(0)
