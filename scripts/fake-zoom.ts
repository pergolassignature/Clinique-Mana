// A local, in-memory Zoom for « Vidéoconférence » (RZ): the consent page (it
// answers at once with a code, back to the app), the token endpoint, the
// revocation, `users/me` and the meetings. Connect a professional's Zoom in
// « Mon agenda → Vidéoconférence » without a Zoom app.
//
//   npm run fake:zoom
//
// One fake: this script only listens. The behaviour is
// supabase/functions/_shared/testing/fake-zoom.ts (the one the Deno tests
// use). Every account connected locally is the fake's one user.
//
// The functions reach it through supabase/functions/.env (honoured only while
// APP_URL is local):
//   ZOOM_OAUTH_BASE_URL=http://host.docker.internal:55394
//   ZOOM_API_BASE_URL=http://host.docker.internal:55394
//   ZOOM_OAUTH_PUBLIC_URL=http://127.0.0.1:55394
// and the seed org's secrets (supabase/seed.sql) hold the fake's Zoom app.
// The meetings' links (https://fake-zoom.test/j/…) open nothing.
// The server listens on 127.0.0.1:55394 (FAKE_ZOOM_HOST / FAKE_ZOOM_PORT).
//
// Logs carry the method, the path's kind and the status only: never a token.

import { fakeZoom } from '../supabase/functions/_shared/testing/fake-zoom.ts'

const env = (name: string) => Deno.env.get(name) || undefined
const hostname = env('FAKE_ZOOM_HOST') ?? '127.0.0.1'
const port = Number(env('FAKE_ZOOM_PORT') ?? 55394)
const fake = fakeZoom()

const kindOf = (pathname: string): string => {
  if (pathname.startsWith('/oauth/')) return pathname
  if (pathname.startsWith('/v2/meetings/')) return '/v2/meetings/:id'
  return pathname.startsWith('/v2/') ? pathname : 'other'
}

Deno.serve({
  hostname,
  port,
  onListen: () =>
    console.log(`[fake-zoom] listening on http://${hostname}:${port}`),
}, async (req) => {
  const { pathname } = new URL(req.url)
  let res: Response
  try {
    res = await fake.handler(req)
  } catch (error) {
    console.error(
      '[fake-zoom] handler error',
      error instanceof Error ? error.name : 'Error',
    )
    res = Response.json({ code: 500, message: 'Internal' }, { status: 500 })
  }
  // A long-running server keeps no call log (the tests read it, not this).
  fake.calls.length = 0
  console.log(`[fake-zoom] ${req.method} ${kindOf(pathname)} ${res.status}`)
  return res
})
