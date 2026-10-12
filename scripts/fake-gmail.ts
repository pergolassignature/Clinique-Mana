// A local, in-memory Google for the Gmail integration (plan §11, CM1): the
// OAuth consent page and token endpoint, and the Gmail API, over one mailbox
// pre-filled with a few fictional French messages. Connect a mailbox in
// « Paramètres → Courriels Gmail » without a Google project.
//
//   npm run fake:gmail
//
// One fake: this script only listens. The behaviour is
// supabase/functions/_shared/testing/fake-gmail.ts (the one the Deno tests
// use). Every mailbox connected locally is this one mailbox
// (FAKE_GMAIL_ADDRESS, default info@clinique.test).
//
// The functions reach it through supabase/functions/.env (honoured only while
// APP_URL is local):
//   GMAIL_API_BASE_URL=http://host.docker.internal:55392
//   GOOGLE_OAUTH_BASE_URL=http://host.docker.internal:55392
//   GOOGLE_ACCOUNTS_BASE_URL=http://host.docker.internal:55392
//   GOOGLE_CERTS_BASE_URL=http://host.docker.internal:55392
//   GOOGLE_ACCOUNTS_PUBLIC_URL=http://127.0.0.1:55392
// and the seed org's secrets and settings (supabase/seed.sql) hold the fake's
// OAuth client and the push's service account.
//
// A new message: `curl -X POST http://127.0.0.1:55392/__fake/deliver`
// (optional JSON body `{ "from", "subject", "text" }`). Once the mailbox is
// watched, every change posts Pub/Sub's authenticated push to the local
// gmail-webhook (FAKE_GMAIL_WEBHOOK_URL, default the seed org), as Google
// would: a token signed by this fake's own key (served at /oauth2/v3/certs)
// for the seed's service account and the org's audience. The server listens
// on 127.0.0.1:55392 (FAKE_GMAIL_HOST / FAKE_GMAIL_PORT).
//
// Logs carry the method, the path's kind and the status only: never an
// address, a token or a message.

import {
  fakeGmail,
  seedMailbox,
} from '../supabase/functions/_shared/testing/fake-gmail.ts'
import {
  createOidcSigner,
  pushClaims,
} from '../supabase/functions/_shared/testing/google-oidc-signer.ts'
import { pushAudience } from '../supabase/functions/_shared/gmail/env.ts'

const env = (name: string) => Deno.env.get(name) || undefined
const hostname = env('FAKE_GMAIL_HOST') ?? '127.0.0.1'
const port = Number(env('FAKE_GMAIL_PORT') ?? 55392)
const mailbox = env('FAKE_GMAIL_ADDRESS') ?? 'info@clinique.test'
const SEED_ORG = '00000000-0000-0000-0000-000000000001'
const webhookUrl = env('FAKE_GMAIL_WEBHOOK_URL') ??
  `http://127.0.0.1:55321/functions/v1/gmail-webhook?org=${SEED_ORG}`
/** The seed's `pubsub_service_account`. */
const PUSH_ACCOUNT = 'gmail-push@mana-local.iam.gserviceaccount.com'
const signer = await createOidcSigner('fake-google-key')

let pushes = 0
const fake = fakeGmail({
  emailAddress: mailbox,
  signer,
  onWatchNotification: (payload) => {
    pushes++
    const body = {
      message: {
        data: btoa(JSON.stringify(payload)),
        messageId: `fake-push-${Date.now()}-${pushes}`,
      },
      subscription: 'projects/mana-local/subscriptions/gmail-push',
    }
    // Pub/Sub pushes after the change: never inside the request that made it.
    setTimeout(async () => {
      const token = await signer.sign(
        pushClaims(pushAudience(SEED_ORG), PUSH_ACCOUNT, Date.now() / 1000),
      )
      fetch(webhookUrl, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${token}`,
        },
        body: JSON.stringify(body),
      }).then(async (res) => {
        await res.body?.cancel()
        console.log(`[fake-gmail] push → gmail-webhook ${res.status}`)
      }).catch((error) =>
        console.error(
          '[fake-gmail] push failed',
          error instanceof Error ? error.name : 'Error',
        )
      )
    }, 50)
  },
})
seedMailbox(fake, mailbox)

const kindOf = (pathname: string): string => {
  if (pathname.startsWith('/__fake/')) return pathname
  if (pathname.startsWith('/o/oauth2/')) return 'consent'
  if (pathname === '/oauth2/v3/certs') return 'certs'
  if (pathname === '/token' || pathname === '/revoke') return pathname.slice(1)
  if (pathname.startsWith('/gmail/v1/')) return 'gmail-api'
  return 'other'
}

Deno.serve({
  hostname,
  port,
  onListen: () =>
    console.log(`[fake-gmail] listening on http://${hostname}:${port}`),
}, async (req) => {
  const { pathname } = new URL(req.url)
  let res: Response
  try {
    if (pathname === '/__fake/deliver' && req.method === 'POST') {
      let input: { from?: unknown; subject?: unknown; text?: unknown } = {}
      try {
        const text = await req.text()
        input = text ? JSON.parse(text) : {}
      } catch {
        input = {}
      }
      const message = fake.deliver({
        from: typeof input.from === 'string'
          ? input.from
          : 'Client Fictif <client.fictif@example.test>',
        to: mailbox,
        subject: typeof input.subject === 'string'
          ? input.subject
          : 'Nouvelle demande (message local)',
        text: typeof input.text === 'string'
          ? input.text
          : 'Bonjour, je souhaite prendre rendez-vous. Merci.',
        labelIds: ['INBOX', 'UNREAD'],
      })
      res = Response.json({ id: message.id, threadId: message.threadId })
    } else if (pathname === '/__fake/reset' && req.method === 'POST') {
      fake.reset()
      seedMailbox(fake, mailbox)
      res = Response.json({ ok: true })
    } else {
      res = await fake.handler(req)
    }
  } catch (error) {
    console.error(
      '[fake-gmail] handler error',
      error instanceof Error ? error.name : 'Error',
    )
    res = Response.json({ error: { code: 500, status: 'INTERNAL' } }, {
      status: 500,
    })
  }
  // A long-running server keeps no call log (the tests read it, not this).
  fake.calls.length = 0
  console.log(`[fake-gmail] ${req.method} ${kindOf(pathname)} ${res.status}`)
  return res
})
