// A local, in-memory OpenAI for « Rédiger avec l'IA » (Communications CM4): the Chat Completions
// endpoint, answering a fixed draft. Try the composer's bar without an OpenAI key or a cost.
//
//   npm run fake:openai
//
// One fake: this script only listens. The behaviour is
// supabase/functions/_shared/testing/fake-openai.ts (the one the Deno tests use).
//
// The function reaches it through supabase/functions/.env (honoured only while APP_URL is local):
//   OPENAI_API_BASE_URL=http://host.docker.internal:55398
// and the seed org's secret `openai_api_key` (supabase/seed.sql) holds the fake's key.
// The server listens on 127.0.0.1:55398 (FAKE_OPENAI_HOST / FAKE_OPENAI_PORT).
//
// Logs carry the method, the path and the status only: never a prompt or a key.

import { fakeOpenAi } from '../supabase/functions/_shared/testing/fake-openai.ts'

const env = (name: string) => Deno.env.get(name) || undefined
const hostname = env('FAKE_OPENAI_HOST') ?? '127.0.0.1'
const port = Number(env('FAKE_OPENAI_PORT') ?? 55398)
const fake = fakeOpenAi()

Deno.serve({
  hostname,
  port,
  onListen: () => console.log(`[fake-openai] listening on http://${hostname}:${port}`),
}, async (req) => {
  const { pathname } = new URL(req.url)
  let res: Response
  try {
    res = await fake.handler(req)
  } catch (error) {
    console.error('[fake-openai] handler error', error instanceof Error ? error.name : 'Error')
    res = Response.json({ error: { message: 'Internal', type: 'server_error' } }, { status: 500 })
  }
  // A long-running server keeps no request log (the tests read it, not this).
  fake.requests.length = 0
  fake.calls.length = 0
  console.log(`[fake-openai] ${req.method} ${pathname === '/v1/chat/completions' ? pathname : 'other'} ${res.status}`)
  return res
})
