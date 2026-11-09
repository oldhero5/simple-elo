// Every request body this app sends is a few hundred bytes of JSON.
export const MAX_BODY_BYTES = 64 * 1024

// A client gets this long to send the whole body. Without it a slow drip of a
// byte every few seconds holds a connection for Node's 5-minute requestTimeout.
export const BODY_READ_TIMEOUT_MS = Number(process.env.BODY_READ_TIMEOUT_MS ?? 15_000)

// Cancel without waiting. Cancelling a stream whose client has gone quiet
// does not settle until the socket closes, so awaiting it would hold the
// request until Node's own timeout. The caller answers with Connection: close,
// which closes the socket.
function stop(reader: ReadableStreamDefaultReader<Uint8Array>) {
  reader.cancel().catch(() => {})
}

export type ReadResult =
  | { ok: true; body: Uint8Array<ArrayBuffer> }
  | { ok: false; reason: 'too_large' | 'timeout' }

/**
 * Read the body, giving up as soon as it passes `limit` bytes or takes longer
 * than `timeoutMs`. Never holds more than `limit` in memory, so a chunked
 * upload with no content-length cannot grow the server.
 */
export async function readCapped(
  request: Request,
  limit: number,
  timeoutMs: number = BODY_READ_TIMEOUT_MS,
): Promise<ReadResult> {
  if (!request.body) return { ok: true, body: new Uint8Array(new ArrayBuffer(0)) }
  const reader = request.body.getReader()
  let timer: ReturnType<typeof setTimeout> | undefined
  const deadline = new Promise<'timeout'>((resolve) => {
    timer = setTimeout(() => resolve('timeout'), timeoutMs)
  })
  const chunks: Uint8Array[] = []
  let size = 0
  try {
    for (;;) {
      const next = await Promise.race([reader.read(), deadline])
      if (next === 'timeout') {
        stop(reader)
        return { ok: false, reason: 'timeout' }
      }
      if (next.done) break
      size += next.value.byteLength
      if (size > limit) {
        stop(reader)
        return { ok: false, reason: 'too_large' }
      }
      chunks.push(next.value)
    }
  } finally {
    clearTimeout(timer)
  }
  const body = new Uint8Array(new ArrayBuffer(size))
  let offset = 0
  for (const chunk of chunks) {
    body.set(chunk, offset)
    offset += chunk.byteLength
  }
  return { ok: true, body }
}
