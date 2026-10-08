#!/usr/bin/env node
// Posts a signed fake provider webhook to the local functions (Task 3.10).
// Local development only: every value is a local fake.
//
//   node scripts/send-test-webhook.mjs resend --org <org id> --email-log <email_log id> \
//     [--type email.delivered] [--email-id <provider id>] [--id <svix id>] [--url <function url>]
//
// It signs a Resend-shaped event the way Svix does (HMAC-SHA256 of
// `<svix-id>.<timestamp>.<body>` with the base64 bytes after `whsec_`), using
// the seed's org secret `resend_webhook_secret` (supabase/seed.sql). The
// default svix id is derived from the type and the email_log id, so running
// the same command twice sends the same event (the second is a duplicate).
// It prints the HTTP status and the function's `{ outcome }`.
import { createHash, createHmac } from 'node:crypto'
import { parseArgs } from 'node:util'

const LOCAL_SECRET = 'whsec_bG9jYWwtZGV2LXJlc2VuZC13ZWJob29r'
const DEFAULT_URL = 'http://127.0.0.1:55321/functions/v1/resend-webhook'
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i

const { positionals, values } = parseArgs({
  allowPositionals: true,
  options: {
    org: { type: 'string' },
    'email-log': { type: 'string' },
    type: { type: 'string', default: 'email.delivered' },
    'email-id': { type: 'string' },
    id: { type: 'string' },
    url: { type: 'string', default: DEFAULT_URL },
  },
})

function fail(message) {
  console.error(message)
  process.exit(1)
}

if (positionals[0] !== 'resend') fail('Usage: send-test-webhook.mjs resend --org <id> --email-log <id> [--type …]')
if (!UUID.test(values.org ?? '')) fail('--org must be a uuid')
if (!UUID.test(values['email-log'] ?? '')) fail('--email-log must be a uuid')

const url = new URL(values.url)
if (!['127.0.0.1', 'localhost'].includes(url.hostname)) fail('--url must be a local address')
url.searchParams.set('org', values.org)

const svixId = values.id ??
  `msg_local_${createHash('sha256').update(`${values.type}:${values['email-log']}`).digest('hex').slice(0, 24)}`
const timestamp = Math.floor(Date.now() / 1000)
const body = JSON.stringify({
  type: values.type,
  created_at: new Date().toISOString(),
  data: {
    ...(values['email-id'] ? { email_id: values['email-id'] } : {}),
    tags: { email_log_id: values['email-log'] },
  },
})
const key = Buffer.from(LOCAL_SECRET.slice('whsec_'.length), 'base64')
const signature = createHmac('sha256', key).update(`${svixId}.${timestamp}.${body}`).digest('base64')

const res = await fetch(url, {
  method: 'POST',
  headers: {
    'Content-Type': 'application/json',
    'svix-id': svixId,
    'svix-timestamp': String(timestamp),
    'svix-signature': `v1,${signature}`,
  },
  body,
})
console.log(res.status, await res.text())
