/**
 * Request bodies for edge functions (typed failures: `errors.ts`).
 *
 * JSON bodies are capped (64 KB by default) and validated with Zod. Errors never
 * echo the input: a schema error answers a fixed message, so a body that holds a
 * token or an address is not reflected back or logged.
 */
import type { z } from 'zod'
import { errorResponse } from './auth.ts'

/** Default cap on a JSON request body, in bytes (plan « Conventions »). */
const MAX_JSON_BYTES = 65_536

/**
 * The raw body bytes, or null as soon as they exceed `maxBytes` (64 KB by
 * default; stops reading). For bodies verified before parsing (webhooks).
 */
export async function readCapped(
  req: Request,
  maxBytes = MAX_JSON_BYTES,
): Promise<Uint8Array | null> {
  if (Number(req.headers.get('Content-Length')) > maxBytes) return null
  if (!req.body) return new Uint8Array()
  const reader = req.body.getReader()
  const chunks: Uint8Array[] = []
  let size = 0
  for (;;) {
    const { done, value } = await reader.read()
    if (done) break
    size += value.length
    if (size > maxBytes) {
      await reader.cancel()
      return null
    }
    chunks.push(value)
  }
  const bytes = new Uint8Array(size)
  let offset = 0
  for (const chunk of chunks) {
    bytes.set(chunk, offset)
    offset += chunk.length
  }
  return bytes
}

/**
 * Reads a JSON body of at most `maxBytes` and parses it with `schema`.
 * Returns the schema's output, or a Response to return at once:
 * 413 `invalid_request` over the cap; 400 `invalid_request` for invalid JSON
 * (or UTF-8), or for a value the schema refuses.
 */
export async function readJson<S extends z.ZodType>(
  req: Request,
  schema: S,
  maxBytes = MAX_JSON_BYTES,
): Promise<z.output<S> | Response> {
  const bytes = await readCapped(req, maxBytes)
  if (bytes === null) {
    return errorResponse('invalid_request', 'Request body too large', 413, req)
  }
  let value: unknown
  try {
    value = JSON.parse(new TextDecoder('utf-8', { fatal: true }).decode(bytes))
  } catch {
    return errorResponse('invalid_request', 'Invalid JSON body', 400, req)
  }
  const parsed = schema.safeParse(value)
  return parsed.success
    ? parsed.data
    : errorResponse('invalid_request', 'Invalid request body', 400, req)
}
