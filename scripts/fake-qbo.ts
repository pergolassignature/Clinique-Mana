// A local, in-memory Intuit for the QuickBooks connection (plan §8, FQ): the
// consent page, the token and revocation endpoints, and the QuickBooks API
// over one company pre-filled with Christine's chart of accounts and a few
// fictional customers (as GOrendezvous would have made them). Connect
// QuickBooks in « Paramètres → QuickBooks » without an Intuit account.
//
//   npm run fake:qbo
//
// One fake: this script only listens. The behaviour is
// supabase/functions/_shared/testing/fake-qbo.ts (the one the Deno tests use).
//
// The functions reach it through supabase/functions/.env (honoured only while
// APP_URL is local):
//   QBO_APPCENTER_BASE_URL=http://host.docker.internal:55394
//   QBO_APPCENTER_PUBLIC_URL=http://127.0.0.1:55394
//   QBO_OAUTH_BASE_URL=http://host.docker.internal:55394
//   QBO_REVOKE_BASE_URL=http://host.docker.internal:55394
//   QBO_API_BASE_URL=http://host.docker.internal:55394
// and the seed org's secrets (supabase/seed.sql) hold the fake's application.
//
// `curl -X POST http://127.0.0.1:55394/__fake/reset` empties the company and
// fills it again. The server listens on 127.0.0.1:55394 (FAKE_QBO_HOST /
// FAKE_QBO_PORT). Logs carry the method, the path's kind and the status only:
// never a token or a customer.

import {
  fakeQbo,
  seedCompany,
} from '../supabase/functions/_shared/testing/fake-qbo.ts'

const env = (name: string) => Deno.env.get(name) || undefined
const hostname = env('FAKE_QBO_HOST') ?? '127.0.0.1'
const port = Number(env('FAKE_QBO_PORT') ?? 55394)

let fake = fakeQbo()
seedCompany(fake)

const kindOf = (pathname: string): string => {
  if (pathname.startsWith('/__fake/')) return pathname
  if (pathname === '/connect/oauth2') return 'consent'
  if (pathname.startsWith('/oauth2/')) return 'token'
  if (pathname.startsWith('/v2/oauth2/')) return 'revoke'
  if (pathname.startsWith('/v3/company/')) return 'qbo-api'
  return 'other'
}

Deno.serve({
  hostname,
  port,
  onListen: () =>
    console.log(`[fake-qbo] listening on http://${hostname}:${port}`),
}, async (req) => {
  const { pathname } = new URL(req.url)
  let res: Response
  try {
    if (pathname === '/__fake/reset' && req.method === 'POST') {
      fake = fakeQbo()
      seedCompany(fake)
      res = Response.json({ ok: true })
    } else {
      res = await fake.handler(req)
    }
  } catch (error) {
    console.error(
      '[fake-qbo] handler error',
      error instanceof Error ? error.name : 'Error',
    )
    res = Response.json({ error: 'server_error' }, { status: 500 })
  }
  // A long-running server keeps no call log (the tests read it, not this).
  fake.calls.length = 0
  console.log(`[fake-qbo] ${req.method} ${kindOf(pathname)} ${res.status}`)
  return res
})
