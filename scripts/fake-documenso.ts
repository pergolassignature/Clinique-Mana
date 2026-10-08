// A local, in-memory Documenso v2 (envelope API) for development (Task 3.32, P3-23). Nothing
// is written to disk; every restart starts empty.
//
//   npm run fake:documenso
//
// One fake: this script only listens. The API behaviour is
// supabase/functions/_shared/testing/fake-documenso.ts (the one the Deno tests
// use) and the admin routes and webhooks are
// supabase/functions/_shared/testing/fake-documenso-server.ts; see their
// comments. It runs with Deno (already needed for the function tests), with
// the functions' import map and lock, so it adds no dependency.
//
// Admin routes (no key; each posts the webhook and answers its outcome):
//   POST /__fake/open/:envelopeId[?recipient=101]         DOCUMENT_OPENED
//   POST /__fake/sign/:envelopeId[?recipient=101]         DOCUMENT_SIGNED (stays pending)
//   POST /__fake/complete/:envelopeId                     DOCUMENT_COMPLETED
//   POST /__fake/reject/:envelopeId[?recipient=&reason=]  DOCUMENT_REJECTED
//   GET  /__fake/documents              envelope ids, titles, statuses (no address)
//
// Envelope ids look like Documenso's (`envelope_aaaaaaaaaaaaaaab`, …ac, …):
// read them from GET /__fake/documents.
//
// The API needs `Authorization: local-dev-documenso-key` (no `Bearer`).
// Webhooks go to FAKE_DOCUMENSO_WEBHOOK_URL (default: the local
// signing-webhook for the seed org) with
// `X-Documenso-Secret: local-dev-documenso-webhook-secret`.
//
// The server listens on 127.0.0.1:55390 (FAKE_DOCUMENSO_HOST /
// FAKE_DOCUMENSO_PORT). The functions container reaches it as
// http://host.docker.internal:55390 (the seed's signing_settings.base_url).
// That name exists on OrbStack and Docker Desktop, not on Linux Docker: there,
// set FAKE_DOCUMENSO_HOST to the docker bridge address (e.g. 172.17.0.1) and
// point signing_settings.base_url at it.
//
// Logs carry the method, the path and the status only: never a key or an
// address.

import { fakeDocumensoServer } from '../supabase/functions/_shared/testing/fake-documenso-server.ts'

const SEED_ORG_ID = '00000000-0000-0000-0000-000000000001'
const env = (name: string) => Deno.env.get(name) || undefined
const webhookUrl = env('FAKE_DOCUMENSO_WEBHOOK_URL') ??
  `http://127.0.0.1:55321/functions/v1/signing-webhook?org=${SEED_ORG_ID}`
const hostname = env('FAKE_DOCUMENSO_HOST') ?? '127.0.0.1'
const port = Number(env('FAKE_DOCUMENSO_PORT') ?? 55390)

const server = fakeDocumensoServer({
  webhookUrl,
  log: (line) => console.log(`[fake-documenso] ${line}`),
})

Deno.serve({
  hostname,
  port,
  onListen: () => {
    const target = new URL(webhookUrl)
    console.log(`[fake-documenso] listening on http://${hostname}:${port}`)
    console.log(
      `[fake-documenso] webhooks → ${target.origin}${target.pathname}`,
    )
  },
}, async (req) => {
  const { pathname } = new URL(req.url)
  let res: Response
  try {
    res = await server.handler(req)
  } catch (error) {
    console.error(
      '[fake-documenso] handler error',
      error instanceof Error ? error.name : 'Error',
    )
    res = Response.json(
      { message: 'Internal error', code: 'INTERNAL_SERVER_ERROR' },
      { status: 500 },
    )
  }
  // A long-running server keeps no call log (the tests read it, not this).
  server.fake.calls.length = 0
  console.log(`[fake-documenso] ${req.method} ${pathname} ${res.status}`)
  return res
})
