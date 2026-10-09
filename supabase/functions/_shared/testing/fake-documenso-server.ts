/**
 * The HTTP face of `fakeDocumenso` for local development (Task 3.32, P3-23):
 * a request handler that serves the fake's API on whatever host the request
 * names, adds the admin routes and posts the webhooks. `scripts/fake-documenso.ts`
 * (`npm run fake:documenso`) listens with it; the behaviour itself is all in
 * `./fake-documenso.ts`, so the tests and the local server share one fake.
 * Never deployed.
 *
 * Admin routes (no key; each posts the webhook and answers its outcome):
 *   POST /__fake/open/:envelopeId[?recipient=101]         DOCUMENT_OPENED
 *   POST /__fake/sign/:envelopeId[?recipient=101]         DOCUMENT_SIGNED (stays pending)
 *   POST /__fake/complete/:envelopeId                     DOCUMENT_COMPLETED
 *   POST /__fake/reject/:envelopeId[?recipient=&reason=]  DOCUMENT_REJECTED
 *   GET  /__fake/documents              envelope ids, titles, statuses (no address)
 * Signing pages, for the app's own signing (P4-488; a recipient's token in the path):
 *   GET  /embed/sign/:token   what `@documenso/embed-react` `EmbedSignDocument` frames: posts
 *                             `document-ready` to its parent, and « Signer » signs and completes
 *                             the envelope (the webhooks), then posts `document-completed`;
 *                             `denyFraming` refuses to be framed (`X-Frame-Options: DENY`,
 *                             `frame-ancestors 'none'`), to test the app's fallback
 *   GET  /sign/:token         the full page: « Signer » completes, then goes to the envelope's
 *                             `redirectUrl` (meta), as Documenso does
 *   POST /__fake/sign-token/:token  what both pages' « Signer » calls
 * Cancelling a pending envelope through the API posts DOCUMENT_CANCELLED
 * after the answer, as Documenso does.
 */
import {
  type FakeDocumenso,
  fakeDocumenso,
  type FakeDocumensoOptions,
} from './fake-documenso.ts'

/** Options of `fakeDocumensoServer`. */
export interface FakeDocumensoServerOptions
  extends Omit<FakeDocumensoOptions, 'onEvent' | 'fallback'> {
  /** Where every webhook is posted (with `X-Documenso-Secret`). */
  webhookUrl: string
  /** Posts the webhooks (default: the global `fetch`). */
  fetch?: typeof fetch
  /** Per-webhook timeout (default 10 s). */
  webhookTimeoutMs?: number
  /** One line per webhook outcome: event, envelope id, status. Never an address. */
  log?: (line: string) => void
  /** The embed page refuses to be framed (the app's fallback, P4-488). */
  denyFraming?: boolean
}

/** A webhook delivery, as the admin routes answer it. */
export type WebhookOutcome =
  & { event: string; envelopeId: string }
  & ({ webhookStatus: number } | { webhookError: string })

/** The handler and its fake. */
export interface FakeDocumensoServer {
  fake: FakeDocumenso
  /** Answers one request: `/__fake/…` or the API (the host is ignored). */
  handler(req: Request): Promise<Response>
  /** Resolves once the webhooks posted on the fake's own initiative are done. */
  idle(): Promise<void>
}

const json = (status: number, body: unknown) =>
  new Response(JSON.stringify(body), {
    status,
    headers: { 'Content-Type': 'application/json' },
  })

const ACTIONS = {
  open: 'DOCUMENT_OPENED',
  sign: 'DOCUMENT_SIGNED',
  complete: 'DOCUMENT_COMPLETED',
  reject: 'DOCUMENT_REJECTED',
} as const

/** Builds the fake and its HTTP handler. */
export function fakeDocumensoServer(
  options: FakeDocumensoServerOptions,
): FakeDocumensoServer {
  const send = options.fetch ?? fetch
  const timeoutMs = options.webhookTimeoutMs ?? 10_000
  const pending = new Set<Promise<unknown>>()

  /** Posts `event` for the envelope; answers the outcome (never throws). */
  async function emit(
    event: string,
    envelopeId: string,
  ): Promise<WebhookOutcome> {
    const req = fake.webhookRequest(options.webhookUrl, event, envelopeId)
    try {
      const res = await send(req, { signal: AbortSignal.timeout(timeoutMs) })
      await res.body?.cancel()
      options.log?.(`webhook ${event} ${envelopeId} → ${res.status}`)
      return { event, envelopeId, webhookStatus: res.status }
    } catch (error) {
      options.log?.(`webhook ${event} ${envelopeId} → unreachable`)
      return {
        event,
        envelopeId,
        webhookError: error instanceof Error ? error.name : 'Error',
      }
    }
  }

  const fake = fakeDocumenso({
    ...options,
    onEvent(event, envelopeId) {
      const delivery = emit(event, envelopeId)
      pending.add(delivery)
      delivery.finally(() => pending.delete(delivery))
    },
  })

  /** The envelope and recipient a signing token names. */
  function byToken(token: string) {
    for (const doc of fake.documents.values()) {
      const recipient = doc.recipients.find((r) => r.token === token)
      if (recipient) return { doc, recipient }
    }
    return null
  }

  const page = (script: string, frame: boolean) =>
    new Response(
      '<!doctype html><html lang="fr"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1"><title>Signer</title>' +
        '<style>body{font-family:system-ui,sans-serif;margin:0;padding:24px;background:#f7f7f5;color:#222}main{max-width:560px;margin:auto;background:#fff;border:1px solid #ddd;border-radius:8px;padding:24px}button{font:inherit;padding:10px 16px;border-radius:6px;border:0;background:#1f6f5c;color:#fff;cursor:pointer}</style>' +
        '</head><body><main><h1 style="font-size:18px">Documenso (local)</h1><p>Document de test du faux Documenso.</p><p id="state"></p><button id="sign" type="button">Signer</button></main><script>' +
        script + '</script></body></html>',
      {
        status: 200,
        headers: {
          'Content-Type': 'text/html; charset=utf-8',
          'Cache-Control': 'no-store',
          ...(frame && !options.denyFraming
            ? {
              'Content-Security-Policy':
                'frame-ancestors http://localhost:* http://127.0.0.1:*',
            }
            : {
              'X-Frame-Options': 'DENY',
              'Content-Security-Policy': "frame-ancestors 'none'",
            }),
        },
      },
    )

  function signingPage(url: URL): Response | null {
    const match = /^\/(embed\/)?sign\/([A-Za-z0-9_-]{1,128})$/.exec(
      url.pathname,
    )
    if (!match) return null
    const embedded = match[1] !== undefined
    const found = byToken(match[2])
    if (!found) return json(404, { message: 'Not found', code: 'NOT_FOUND' })
    const token = JSON.stringify(match[2])
    const done = embedded
      ? `parent.postMessage({ action: 'document-completed', data: { token: ${token}, documentId: ${found.doc.legacyId}, recipientId: ${
        Number(found.recipient.id)
      } } }, '*')`
      : `location.href = ${
        JSON.stringify(String(found.doc.meta.redirectUrl ?? '/'))
      }`
    const script =
      (embedded
        ? "parent.postMessage({ action: 'document-ready' }, '*');"
        : '') +
      "document.getElementById('sign').onclick = async () => {" +
      `const res = await fetch('/__fake/sign-token/' + ${token}, { method: 'POST' });` +
      "document.getElementById('state').textContent = res.ok ? 'Signé.' : 'Erreur ' + res.status;" +
      `if (res.ok) { ${done} } };`
    return page(script, embedded)
  }

  async function admin(req: Request, url: URL): Promise<Response> {
    const signToken = /^\/__fake\/sign-token\/([A-Za-z0-9_-]{1,128})$/.exec(
      url.pathname,
    )
    if (req.method === 'POST' && signToken) {
      const found = byToken(signToken[1])
      if (!found || found.doc.status !== 'PENDING') {
        return json(400, { message: 'Nothing to sign', code: 'BAD_REQUEST' })
      }
      fake.sign(found.doc.id, found.recipient.id)
      await emit('DOCUMENT_SIGNED', found.doc.id)
      if (found.doc.recipients.every((r) => r.signingStatus === 'SIGNED')) {
        fake.complete(found.doc.id)
        return json(200, await emit('DOCUMENT_COMPLETED', found.doc.id))
      }
      return json(200, { signed: true })
    }
    if (req.method === 'GET' && url.pathname === '/__fake/documents') {
      return json(
        200,
        [...fake.documents.values()].map((d) => ({
          id: d.id,
          externalId: d.externalId,
          title: d.title,
          status: d.status,
          recipients: d.recipients.map((r) => ({
            id: r.id,
            signingOrder: r.signingOrder,
            readStatus: r.readStatus,
            signingStatus: r.signingStatus,
          })),
        })),
      )
    }
    const match = /^\/__fake\/(open|sign|complete|reject)\/(envelope_[a-z]+)$/
      .exec(
        url.pathname,
      )
    if (req.method !== 'POST' || !match) {
      return json(404, { message: 'Not found', code: 'NOT_FOUND' })
    }
    const action = match[1] as keyof typeof ACTIONS
    const id = match[2]
    const doc = fake.documents.get(id)
    if (!doc) {
      return json(404, { message: 'Envelope not found', code: 'NOT_FOUND' })
    }
    if (doc.status !== 'PENDING') {
      return json(400, {
        message: `Envelope is ${doc.status}`,
        code: 'BAD_REQUEST',
      })
    }
    const recipient = url.searchParams.get('recipient') ?? undefined
    try {
      if (action === 'open') fake.open(id, recipient)
      else if (action === 'sign') fake.sign(id, recipient)
      else if (action === 'complete') fake.complete(id)
      else {
        fake.reject(id, recipient, url.searchParams.get('reason') || undefined)
      }
    } catch {
      return json(400, { message: 'No such recipient', code: 'BAD_REQUEST' })
    }
    return json(200, await emit(ACTIONS[action], id))
  }

  return {
    fake,
    async handler(req) {
      const url = new URL(req.url)
      if (url.pathname.startsWith('/__fake/')) return await admin(req, url)
      if (req.method === 'GET') {
        const signing = signingPage(url)
        if (signing) return signing
      }
      // The functions container calls host.docker.internal, a browser
      // 127.0.0.1: the fake answers its own origin, so re-address.
      const hasBody = !['GET', 'HEAD'].includes(req.method)
      return await fake.fetch(`${fake.baseUrl}${url.pathname}${url.search}`, {
        method: req.method,
        headers: req.headers,
        body: hasBody ? await req.arrayBuffer() : undefined,
      })
    },
    async idle() {
      // The fake reports its own events in a microtask after answering.
      await new Promise((resolve) => setTimeout(resolve, 0))
      while (pending.size) await Promise.all(pending)
    },
  }
}
