/**
 * A thin Gmail API client over `fetch` (no SDK: ADR 0008 ships every npm
 * package in every function). Each call: a bearer token, a timeout, a cap on
 * the answer's size, and Google's error bodies never read into anything
 * logged or returned: a failure is a `GmailError` whose `code` is ours.
 *
 * Retries: a 429 or a 5xx is tried again twice (0.5 s then 2 s); a 401 means
 * the token is no longer good (the caller refreshes once, then marks the
 * mailbox `needs_reconnect`); a 404 is `not_found` (a message deleted
 * meanwhile), except on `history.list`, where it is `history_gone` (the start
 * id is too old: a full pass follows, as Google documents for 404 and 410).
 */
import { z } from 'zod'

/** Per call. */
export const GMAIL_TIMEOUT_MS = 20_000
/** The largest answer read (a `format=full` message with inline images can reach a few MB). */
const MAX_ANSWER_BYTES = 8 * 1024 * 1024
/** The largest attachment read (the storage purpose caps files at 10 MB; base64 adds a third). */
const MAX_ATTACHMENT_BYTES = 15 * 1024 * 1024
const RETRY_DELAYS_MS = [500, 2_000]

/** Our codes for a failed call. */
export type GmailErrorCode =
  | 'unauthorized'
  | 'forbidden'
  | 'not_found'
  | 'history_gone'
  | 'rate_limited'
  | 'bad_request'
  | 'timeout'
  | 'unreachable'
  | 'provider_error'
  | 'unusable_answer'
  | 'too_large'

export class GmailError extends Error {
  constructor(readonly code: GmailErrorCode, readonly status?: number) {
    super(code)
    this.name = 'GmailError'
  }
}

const headerSchema = z.object({ name: z.string(), value: z.string() })
export type GmailHeader = z.infer<typeof headerSchema>

const bodySchema = z.looseObject({
  attachmentId: z.string().optional(),
  size: z.number().optional(),
  data: z.string().optional(),
})

/** A MIME part as Gmail returns it (`format=full`); `parts` nests. */
export interface GmailPart {
  partId?: string
  mimeType?: string
  filename?: string
  headers?: GmailHeader[]
  body?: z.infer<typeof bodySchema>
  parts?: GmailPart[]
}

const partSchema: z.ZodType<GmailPart> = z.lazy(() =>
  z.looseObject({
    partId: z.string().optional(),
    mimeType: z.string().optional(),
    filename: z.string().optional(),
    headers: z.array(headerSchema).optional(),
    body: bodySchema.optional(),
    parts: z.array(partSchema).optional(),
  })
)

export const messageSchema = z.looseObject({
  id: z.string(),
  threadId: z.string(),
  labelIds: z.array(z.string()).optional(),
  snippet: z.string().optional(),
  historyId: z.string().optional(),
  internalDate: z.string().optional(),
  sizeEstimate: z.number().optional(),
  payload: partSchema.optional(),
})
export type GmailMessage = z.infer<typeof messageSchema>

const messageRefSchema = z.looseObject({
  id: z.string(),
  threadId: z.string().optional(),
})

const listSchema = z.looseObject({
  messages: z.array(messageRefSchema).optional(),
  nextPageToken: z.string().optional(),
  resultSizeEstimate: z.number().optional(),
})

const labelChangeSchema = z.looseObject({
  message: messageRefSchema,
  labelIds: z.array(z.string()).optional(),
})
const historyRecordSchema = z.looseObject({
  id: z.string(),
  messagesAdded: z.array(z.looseObject({ message: messageRefSchema }))
    .optional(),
  messagesDeleted: z.array(z.looseObject({ message: messageRefSchema }))
    .optional(),
  labelsAdded: z.array(labelChangeSchema).optional(),
  labelsRemoved: z.array(labelChangeSchema).optional(),
})
export type HistoryRecord = z.infer<typeof historyRecordSchema>
const historySchema = z.looseObject({
  history: z.array(historyRecordSchema).optional(),
  nextPageToken: z.string().optional(),
  historyId: z.string().optional(),
})

const profileSchema = z.looseObject({
  emailAddress: z.string(),
  historyId: z.string().optional(),
  messagesTotal: z.number().optional(),
})
const watchSchema = z.looseObject({
  historyId: z.string().optional(),
  expiration: z.string(),
})
const labelSchema = z.looseObject({
  id: z.string(),
  name: z.string(),
  type: z.string().optional(),
  labelListVisibility: z.string().optional(),
  color: z.looseObject({
    backgroundColor: z.string().optional(),
    textColor: z.string().optional(),
  })
    .optional(),
})
export type GmailLabel = z.infer<typeof labelSchema>
const labelsSchema = z.looseObject({ labels: z.array(labelSchema).optional() })
const attachmentSchema = z.looseObject({
  data: z.string(),
  size: z.number().optional(),
})

const sentSchema = z.looseObject({
  id: z.string().regex(/^[A-Za-z0-9_-]{1,64}$/),
  threadId: z.string().regex(/^[A-Za-z0-9_-]{1,64}$/),
})

export interface GmailClientOptions {
  fetch: typeof fetch
  /** The API origin (`gmailOrigins(env).api`). */
  origin: string
  accessToken: string
  /** The caller's signal (a job's per-org timeout, a request's disconnect). */
  signal?: AbortSignal
  sleep?: (ms: number) => Promise<void>
}

const defaultSleep = (ms: number) => new Promise<void>((r) => setTimeout(r, ms))

/** `TimeoutError` or an abort from the caller's signal. */
function isAbort(error: unknown): boolean {
  return error instanceof DOMException &&
    (error.name === 'TimeoutError' || error.name === 'AbortError')
}

/** Reads at most `max` bytes of a response's body as text; `too_large` beyond. */
async function readText(res: Response, max: number): Promise<string> {
  const reader = res.body?.getReader()
  if (!reader) return ''
  const chunks: Uint8Array[] = []
  let total = 0
  for (;;) {
    const { done, value } = await reader.read()
    if (done) break
    total += value.byteLength
    if (total > max) {
      await reader.cancel()
      throw new GmailError('too_large')
    }
    chunks.push(value)
  }
  const bytes = new Uint8Array(total)
  let at = 0
  for (const chunk of chunks) {
    bytes.set(chunk, at)
    at += chunk.byteLength
  }
  return new TextDecoder('utf-8').decode(bytes)
}

/** The Gmail API for one mailbox (`users/me`). */
export class GmailClient {
  readonly #opts: GmailClientOptions

  constructor(opts: GmailClientOptions) {
    this.#opts = opts
  }

  /** One request with retries; the parsed JSON, or null for a 204. */
  async #call<S extends z.ZodType>(
    method: 'GET' | 'POST',
    path: string,
    schema: S,
    options: {
      query?: Record<string, string | string[]>
      body?: unknown
      maxBytes?: number
      notFound?: GmailErrorCode
      /** A raw body (an upload) instead of JSON. */
      raw?: { contentType: string; bytes: Uint8Array }
      /** `upload`: Google's upload endpoint (`/upload/gmail/v1/…`). */
      base?: 'api' | 'upload'
      /** False for a call that must never run twice (a send): no retry on 429 / 5xx. */
      retry?: boolean
    } = {},
  ): Promise<z.output<S>> {
    const prefix = options.base === 'upload' ? '/upload/gmail/v1' : '/gmail/v1'
    const url = new URL(`${this.#opts.origin}${prefix}/users/me/${path}`)
    for (const [key, value] of Object.entries(options.query ?? {})) {
      for (const v of Array.isArray(value) ? value : [value]) {
        url.searchParams.append(key, v)
      }
    }
    const sleep = this.#opts.sleep ?? defaultSleep
    for (let attempt = 0;; attempt++) {
      let res: Response
      try {
        const signals = [AbortSignal.timeout(GMAIL_TIMEOUT_MS)]
        if (this.#opts.signal) signals.push(this.#opts.signal)
        res = await this.#opts.fetch(url, {
          method,
          headers: {
            Authorization: `Bearer ${this.#opts.accessToken}`,
            Accept: 'application/json',
            ...(options.raw
              ? { 'Content-Type': options.raw.contentType }
              : options.body !== undefined
              ? { 'Content-Type': 'application/json' }
              : {}),
          },
          body: options.raw
            ? options.raw.bytes
            : options.body !== undefined
            ? JSON.stringify(options.body)
            : undefined,
          redirect: 'error',
          signal: AbortSignal.any(signals),
        })
      } catch (error) {
        if (this.#opts.signal?.aborted) throw new GmailError('timeout')
        throw new GmailError(isAbort(error) ? 'timeout' : 'unreachable')
      }
      if (res.ok) {
        if (res.status === 204) {
          await res.body?.cancel()
          return schema.parse(null)
        }
        let text: string
        try {
          text = await readText(res, options.maxBytes ?? MAX_ANSWER_BYTES)
        } catch (error) {
          if (error instanceof GmailError) throw error
          throw new GmailError('unusable_answer')
        }
        let json: unknown
        try {
          json = text === '' ? null : JSON.parse(text)
        } catch {
          throw new GmailError('unusable_answer')
        }
        const parsed = schema.safeParse(json)
        if (!parsed.success) throw new GmailError('unusable_answer')
        return parsed.data
      }
      await res.body?.cancel()
      const retryable = res.status === 429 || res.status >= 500
      if (
        retryable && options.retry !== false &&
        attempt < RETRY_DELAYS_MS.length
      ) {
        await sleep(RETRY_DELAYS_MS[attempt])
        continue
      }
      switch (res.status) {
        case 400:
          throw new GmailError('bad_request', 400)
        case 401:
          throw new GmailError('unauthorized', 401)
        case 403:
          throw new GmailError('forbidden', 403)
        case 404:
        case 410:
          throw new GmailError(options.notFound ?? 'not_found', res.status)
        case 429:
          throw new GmailError('rate_limited', 429)
        default:
          throw new GmailError('provider_error', res.status)
      }
    }
  }

  getProfile() {
    return this.#call('GET', 'profile', profileSchema)
  }

  listLabels() {
    return this.#call('GET', 'labels', labelsSchema)
  }

  /** `messages.list`: ids only, 100 per page by default. */
  listMessages(
    query: {
      q?: string
      pageToken?: string
      maxResults?: number
      labelIds?: string[]
    },
  ) {
    const params: Record<string, string | string[]> = {
      maxResults: String(query.maxResults ?? 100),
    }
    if (query.q) params.q = query.q
    if (query.pageToken) params.pageToken = query.pageToken
    if (query.labelIds?.length) params.labelIds = query.labelIds
    return this.#call('GET', 'messages', listSchema, { query: params })
  }

  /** `messages.get` with `format=full` (headers, parts, bodies) or `metadata`. */
  getMessage(id: string, format: 'full' | 'metadata' | 'minimal' = 'full') {
    return this.#call(
      'GET',
      `messages/${encodeURIComponent(id)}`,
      messageSchema,
      {
        query: { format },
      },
    )
  }

  /** `history.list` from `startHistoryId`; 404 / 410 → `history_gone`. */
  listHistory(
    query: { startHistoryId: string; pageToken?: string; maxResults?: number },
  ) {
    const params: Record<string, string | string[]> = {
      startHistoryId: query.startHistoryId,
      maxResults: String(query.maxResults ?? 500),
      historyTypes: [
        'messageAdded',
        'messageDeleted',
        'labelAdded',
        'labelRemoved',
      ],
    }
    if (query.pageToken) params.pageToken = query.pageToken
    return this.#call('GET', 'history', historySchema, {
      query: params,
      notFound: 'history_gone',
    })
  }

  /** `messages.attachments.get`: base64url bytes. */
  getAttachment(messageId: string, attachmentId: string) {
    return this.#call(
      'GET',
      `messages/${encodeURIComponent(messageId)}/attachments/${
        encodeURIComponent(attachmentId)
      }`,
      attachmentSchema,
      { maxBytes: MAX_ATTACHMENT_BYTES },
    )
  }

  /** `users.watch`: Pub/Sub notifications for the whole mailbox; Google's expiry (ms) and history id. */
  watch(topicName: string) {
    return this.#call('POST', 'watch', watchSchema, { body: { topicName } })
  }

  /** `users.stop`: no more notifications. */
  async stop(): Promise<void> {
    await this.#call('POST', 'stop', z.null())
  }

  /** `messages.batchModify` (at most 1 000 ids). */
  async batchModify(
    ids: string[],
    addLabelIds: string[],
    removeLabelIds: string[],
  ): Promise<void> {
    await this.#call('POST', 'messages/batchModify', z.null(), {
      body: { ids, addLabelIds, removeLabelIds },
    })
  }

  /**
   * `messages.send` through the upload endpoint (`uploadType=multipart`: the
   * metadata, then the RFC 5322 bytes), in `threadId` when it continues one.
   * Never retried: Gmail may have sent before failing to answer.
   */
  sendMessage(rfc822: Uint8Array, threadId?: string | null) {
    const boundary = `send_${crypto.randomUUID()}`
    const encoder = new TextEncoder()
    const head = encoder.encode(
      `--${boundary}\r\nContent-Type: application/json; charset=UTF-8\r\n\r\n` +
        JSON.stringify(threadId ? { threadId } : {}) +
        `\r\n--${boundary}\r\nContent-Type: message/rfc822\r\n\r\n`,
    )
    const tail = encoder.encode(`\r\n--${boundary}--\r\n`)
    const bytes = new Uint8Array(head.length + rfc822.length + tail.length)
    bytes.set(head, 0)
    bytes.set(rfc822, head.length)
    bytes.set(tail, head.length + rfc822.length)
    return this.#call('POST', 'messages/send', sentSchema, {
      base: 'upload',
      query: { uploadType: 'multipart' },
      raw: { contentType: `multipart/related; boundary=${boundary}`, bytes },
      retry: false,
    })
  }

  /** `threads.modify`: every message of the thread. */
  modifyThread(
    threadId: string,
    addLabelIds: string[],
    removeLabelIds: string[],
  ) {
    return this.#call(
      'POST',
      `threads/${encodeURIComponent(threadId)}/modify`,
      z.looseObject({ id: z.string() }),
      { body: { addLabelIds, removeLabelIds } },
    )
  }
}

/** Decodes Gmail's base64url (`-`, `_`, no padding) into bytes. */
export function decodeBase64Url(data: string): Uint8Array {
  const base64 = data.replaceAll('-', '+').replaceAll('_', '/')
  const padded = base64 + '='.repeat((4 - base64.length % 4) % 4)
  const binary = atob(padded)
  const bytes = new Uint8Array(binary.length)
  for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i)
  return bytes
}
