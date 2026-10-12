// A local, in-memory Yeastar P-Series PBX (the OpenAPI the texts use, batch SM):
// send texts and receive them without a PBX.
//
//   npm run fake:yeastar
//
// One fake: this script only listens. The API behaviour is
// supabase/functions/_shared/testing/fake-yeastar.ts (the one the Deno tests
// use). It runs with Deno, the functions' import map and lock.
//
// The functions reach it through supabase/functions/.env:
//   YEASTAR_BASE_URL=http://host.docker.internal:55393
// (honoured only while APP_URL is local; the clinic's own address in
// Paramètres → Textos is then ignored). The seed's credentials and number:
// local-dev-yeastar-client / local-dev-yeastar-secret, +1 418 555-0199.
//
// Admin routes (no token; each posts the signed webhook and answers its outcome):
//   POST /__fake/inbound      { from, body }        a text from a client (event 30031)
//   POST /__fake/deliver/:msgId?status=1|2[&error=] a delivery report (event 30032)
//   GET  /__fake/messages     the texts sent through the fake (ids and bodies)
//
// Webhooks go to FAKE_YEASTAR_WEBHOOK_URL (default: the local sms-webhook for
// the seed org) with X-Signature (HMAC-SHA256 of the body, base64) keyed with
// FAKE_YEASTAR_WEBHOOK_SECRET (default: the seed's local-dev-yeastar-webhook-secret).
//
// The server listens on 127.0.0.1:55393 (FAKE_YEASTAR_HOST / FAKE_YEASTAR_PORT).
// On Linux Docker, set FAKE_YEASTAR_HOST to the docker bridge address (as for
// fake:documenso). Logs carry the method, the path's kind and the status only:
// never a number, a body or a token.

import { fakeYeastar } from '../supabase/functions/_shared/testing/fake-yeastar.ts'
import { signYeastarBody } from '../supabase/functions/_shared/sms/webhook.ts'

const env = (name: string) => Deno.env.get(name) || undefined
const hostname = env('FAKE_YEASTAR_HOST') ?? '127.0.0.1'
const port = Number(env('FAKE_YEASTAR_PORT') ?? 55393)
const webhookUrl = env('FAKE_YEASTAR_WEBHOOK_URL') ??
  'http://127.0.0.1:55321/functions/v1/sms-webhook?org=00000000-0000-0000-0000-000000000001'
const webhookSecret = env('FAKE_YEASTAR_WEBHOOK_SECRET') ??
  'local-dev-yeastar-webhook-secret'

const fake = fakeYeastar()

async function postWebhook(envelope: unknown): Promise<Response> {
  const body = JSON.stringify(envelope)
  const res = await fetch(webhookUrl, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'X-Signature': await signYeastarBody(body, webhookSecret),
    },
    body,
  })
  const text = await res.text()
  return Response.json({ webhook_status: res.status, webhook_body: text })
}

async function admin(req: Request, url: URL): Promise<Response> {
  if (req.method === 'GET' && url.pathname === '/__fake/messages') {
    return Response.json(fake.messages)
  }
  if (req.method === 'POST' && url.pathname === '/__fake/inbound') {
    const body = await req.json().catch(() => ({})) as Record<string, unknown>
    if (typeof body.from !== 'string' || typeof body.body !== 'string') {
      return Response.json({ error: 'from and body are required' }, {
        status: 400,
      })
    }
    return await postWebhook(
      fake.inboundEvent({ from: body.from, body: body.body }),
    )
  }
  const deliver = /^\/__fake\/deliver\/([0-9]+)$/.exec(url.pathname)
  if (req.method === 'POST' && deliver) {
    const msgId = Number(deliver[1])
    const status = url.searchParams.get('status') === '2' ? 2 : 1
    const sent = fake.messages.find((m) => m.msgId === msgId)
    return await postWebhook(fake.deliveryEvent({
      msgId,
      status,
      sessionId: sent?.sessionId,
      error: url.searchParams.get('error') ?? undefined,
    }))
  }
  return Response.json({ error: 'not found' }, { status: 404 })
}

Deno.serve({
  hostname,
  port,
  onListen: () =>
    console.log(`[fake-yeastar] listening on http://${hostname}:${port}`),
}, async (req) => {
  const url = new URL(req.url)
  const kind = url.pathname.startsWith('/__fake/')
    ? 'admin'
    : url.pathname.replace(/^\/openapi\/v1\.0\//, '').split('?')[0]
  let res: Response
  try {
    res = url.pathname.startsWith('/__fake/')
      ? await admin(req, url)
      : await fake.handler(req)
  } catch (error) {
    console.error(
      '[fake-yeastar] handler error',
      error instanceof Error ? error.name : 'Error',
    )
    res = Response.json({ errcode: 500, errmsg: 'INTERNAL' }, { status: 500 })
  }
  console.log(`[fake-yeastar] ${req.method} ${kind} ${res.status}`)
  return res
})
