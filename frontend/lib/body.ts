// Every request body this app sends is a few hundred bytes of JSON.
export const MAX_BODY_BYTES = 64 * 1024

/**
 * Read the body, giving up as soon as it passes `limit` bytes. Returns null
 * when it is too large, without ever holding more than `limit` in memory, so
 * a chunked upload with no content-length cannot grow the server.
 */
export async function readCapped(request: Request, limit: number): Promise<Uint8Array<ArrayBuffer> | null> {
  if (!request.body) return new Uint8Array(0)
  const reader = request.body.getReader()
  const chunks: Uint8Array[] = []
  let size = 0
  for (;;) {
    const { done, value } = await reader.read()
    if (done) break
    size += value.byteLength
    if (size > limit) {
      await reader.cancel().catch(() => {})
      return null
    }
    chunks.push(value)
  }
  const body = new Uint8Array(new ArrayBuffer(size))
  let offset = 0
  for (const chunk of chunks) {
    body.set(chunk, offset)
    offset += chunk.byteLength
  }
  return body
}
