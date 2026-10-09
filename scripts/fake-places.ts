// A local, in-memory Google Places API (New) for development (P4-220): the
// address field's suggestions without a Google key or a bill.
//
//   npm run fake:places
//
// One fake: this script only listens. The behaviour and the canned Québec
// places are supabase/functions/_shared/testing/fake-places.ts (the one the
// Deno tests use). Try « saint-denis », « wellington », « laurier »,
// « drummond », « rang », « route 132 », « lac-écho », « queen ».
//
// The functions reach it through supabase/functions/.env:
//   GOOGLE_PLACES_API_KEY=local-dev-google-places-key
//   GOOGLE_PLACES_BASE_URL=http://host.docker.internal:55391
// (honoured only while APP_URL is local). The server listens on
// 127.0.0.1:55391 (FAKE_PLACES_HOST / FAKE_PLACES_PORT); on Linux Docker,
// set FAKE_PLACES_HOST to the docker bridge address (as for fake:documenso).
//
// Logs carry the method, the path's kind and the status only: never the
// typed text nor a place id.

import { fakePlaces } from '../supabase/functions/_shared/testing/fake-places.ts'

const env = (name: string) => Deno.env.get(name) || undefined
const hostname = env('FAKE_PLACES_HOST') ?? '127.0.0.1'
const port = Number(env('FAKE_PLACES_PORT') ?? 55391)

const fake = fakePlaces()

Deno.serve({
  hostname,
  port,
  onListen: () =>
    console.log(`[fake-places] listening on http://${hostname}:${port}`),
}, async (req) => {
  const { pathname } = new URL(req.url)
  const kind = pathname === '/v1/places:autocomplete'
    ? 'autocomplete'
    : pathname.startsWith('/v1/places/')
    ? 'details'
    : 'other'
  let res: Response
  try {
    res = await fake.handler(req)
  } catch (error) {
    console.error(
      '[fake-places] handler error',
      error instanceof Error ? error.name : 'Error',
    )
    res = Response.json({ error: { code: 500, status: 'INTERNAL' } }, {
      status: 500,
    })
  }
  // A long-running server keeps no call log (the tests read it, not this).
  fake.calls.length = 0
  console.log(`[fake-places] ${req.method} ${kind} ${res.status}`)
  return res
})
