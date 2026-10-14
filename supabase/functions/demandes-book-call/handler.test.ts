import { assert, assertEquals } from '@std/assert'
import { createHandler, leadingZeroBits } from './handler.ts'
import type { Deps } from '../_shared/deps.ts'
import { fakeFetch } from '../_shared/testing/fake-fetch.ts'
import {
  fakeSupabase,
  type RpcRoute,
} from '../_shared/testing/fake-supabase.ts'
import { fixedClock } from '../_shared/testing/fixed-clock.ts'
import { withEnv } from '../_shared/testing/env.ts'
import {
  emailContextFixture,
  ORG_ID,
} from '../_shared/testing/email-fixtures.ts'

const URL_ = 'http://fn.test/functions/v1/demandes-book-call'
const APP = 'http://localhost:5173'
const MAILPIT = 'POST http://mailpit.test:8025/api/v1/send'
const SECRET = 'local-dev-internal-function-secret'
const ALLOWED = { allowed: true, hits: 1, retry_after_seconds: 0 }
const REFUSED = { allowed: false, hits: 6, retry_after_seconds: 600 }
const DEMANDE = '00000000-0000-4000-8000-0000000000d1'
const SLOT = '2026-10-14T13:00:00.000Z'
const TEST_BITS = 4

const openPage = {
  open: true,
  clinic_name: 'Clinique MANA',
  timezone: 'America/Toronto',
  slot_minutes: 15,
  slots: [SLOT],
  referral_sources: [{
    id: '00000000-0000-4000-8000-0000000000a1',
    name: 'Instagram',
  }],
}
const booked = {
  demande_id: DEMANDE,
  task_id: '00000000-0000-4000-8000-0000000000t1'.replace('t', 'e'),
  reference: 'DEM-2026-0007',
  starts_at: SLOT,
  clinic_name: 'Clinique MANA',
  timezone: 'America/Toronto',
  language: 'fr',
  first_name: 'Camille',
  email: 'camille@exemple.test',
  link_expires_at: SLOT,
}

function setup(
  options: {
    page?: RpcRoute
    book?: RpcRoute
    limit?: (bucket: string) => typeof ALLOWED
  } = {},
) {
  const service = fakeSupabase({
    rpc: {
      consume_rate_limit: (args) => ({
        data: [options.limit?.(String(args.p_bucket)) ?? ALLOWED],
      }),
      demandes_booking_page_for_service: options.page ?? { data: openPage },
      book_discovery_call_for_service: options.book ?? { data: booked },
      cancel_discovery_call_for_service: (args) => ({
        data: {
          state: String(args.p_token_hash).length === 66
            ? 'cancelled'
            : 'invalid',
        },
      }),
      get_email_context: (args) => ({
        data: emailContextFixture({
          module_key: 'demandes',
          template: {
            key: String(args.p_template_key),
            subject: 'Votre appel — {{clinic.name}}',
            body: 'Bonjour {{person.first_name}}, le {{call.starts_at}}.',
            button_label: 'Annuler l’appel',
            view_permission: 'demandes.view',
            variables: [
              {
                path: 'person.first_name',
                label: 'p',
                sample: 'x',
                required: true,
                kind: 'text',
              },
              {
                path: 'clinic.name',
                label: 'c',
                sample: 'x',
                required: true,
                kind: 'text',
              },
              {
                path: 'call.starts_at',
                label: 'd',
                sample: 'x',
                required: true,
                kind: 'datetime',
              },
            ],
          },
        }),
      }),
      queue_email: { data: '00000000-0000-4000-8000-0000000000e9' },
      mark_email_sent: { data: null },
      mark_email_failed: { data: null },
    },
  })
  const http = fakeFetch({
    [MAILPIT]: () => new Response(JSON.stringify({ ID: 'm' }), { status: 200 }),
  })
  const env: Record<string, string> = {
    APP_URL: APP,
    EMAIL_TRANSPORT: 'mailpit',
    MAILPIT_URL: 'http://mailpit.test:8025',
    INTERNAL_FUNCTION_SECRET: SECRET,
  }
  const deps: Deps = {
    env: (key) => env[key],
    fetch: http.fetch,
    now: fixedClock('2026-10-12T15:00:00Z').now,
    serviceClient: () => service.client,
    userClient: () => {
      throw new Error('no user on the public page')
    },
  }
  return { handler: createHandler(deps, { powBits: TEST_BITS }), service, http }
}

const run = (fn: () => Promise<void>) =>
  withEnv({
    INTERNAL_FUNCTION_SECRET: SECRET,
    SENTRY_DSN: undefined,
    ALLOWED_ORIGINS: undefined,
  }, fn)
const post = (b: unknown) =>
  new Request(URL_, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Origin: APP },
    body: JSON.stringify(b),
  })

/** What the page does: find a nonce with enough leading zero bits. */
async function solve(ticket: string, bits: number): Promise<string> {
  for (let n = 0;; n++) {
    if ((await leadingZeroBits(ticket, String(n))) >= bits) return String(n)
  }
}

async function ticketFrom(handler: (req: Request) => Promise<Response>) {
  const res = await handler(post({ action: 'page', org: ORG_ID }))
  const body = await res.json()
  return {
    body,
    ticket: body.check.ticket as string,
    nonce: await solve(body.check.ticket, body.check.bits),
  }
}

const bookBody = (
  ticket: string,
  nonce: string,
  over: Record<string, unknown> = {},
) => ({
  action: 'book',
  org: ORG_ID,
  ticket,
  nonce,
  starts_at: SLOT,
  first_name: 'Camille',
  last_name: 'Essai',
  email: 'camille@exemple.test',
  phone_e164: '+15145550101',
  language: 'fr',
  referral_source_id: '00000000-0000-4000-8000-0000000000a1',
  source: {
    utm: { utm_source: 'instagram', utm_campaign: 'automne' },
    referrer: 'https://site.test/services',
    landing: 'https://site.test/?utm_source=instagram',
  },
  ...over,
})

Deno.test('demandes-book-call: page → the slots, the list and a signed check; never cached', async () => {
  await run(async () => {
    const s = setup()
    const res = await s.handler(post({ action: 'page', org: ORG_ID }))
    assertEquals(res.status, 200)
    assertEquals(res.headers.get('Cache-Control'), 'no-store')
    const body = await res.json()
    assertEquals(body.slots, [SLOT])
    assertEquals(body.check.bits, TEST_BITS)
    assert(
      typeof body.check.ticket === 'string' && body.check.ticket.includes('.'),
    )
    assertEquals(
      s.service.calls[0].fn,
      'consume_rate_limit',
      'the per-IP limit comes first',
    )
    assertEquals(s.service.calls[0].args.p_bucket, 'demandes.booking_page_ip')
  })
})

Deno.test('demandes-book-call: a closed clinic (P3-40, off, unknown) reads only « open: false »', async () => {
  await run(async () => {
    const s = setup({ page: { data: { open: false } } })
    const res = await s.handler(post({ action: 'page', org: ORG_ID }))
    assertEquals(await res.json(), { open: false })
  })
})

Deno.test('demandes-book-call: book → the source and a hashed cancel token to the database, the confirmation with the cancel link', async () => {
  await run(async () => {
    const s = setup()
    const { ticket, nonce } = await ticketFrom(s.handler)
    const res = await s.handler(post(bookBody(ticket, nonce)))
    assertEquals(res.status, 200)
    assertEquals(await res.json(), {
      starts_at: SLOT,
      timezone: 'America/Toronto',
      emailed: true,
    })
    const call = s.service.calls.find((c) =>
      c.fn === 'book_discovery_call_for_service'
    )!
    const payload = call.args.p_payload as Record<string, unknown>
    assertEquals(payload.source_utm, {
      utm_source: 'instagram',
      utm_campaign: 'automne',
    })
    assertEquals(payload.source_referrer, 'https://site.test/services')
    assertEquals(
      payload.source_landing_page,
      'https://site.test/?utm_source=instagram',
    )
    assertEquals(
      payload.referral_source_id,
      '00000000-0000-4000-8000-0000000000a1',
    )
    assert(
      /^\\x[0-9a-f]{64}$/.test(String(call.args.p_token_hash)),
      'only the hash reaches the database',
    )
    const mail = JSON.parse(s.http.calls[0].body)
    assertEquals(mail.To[0].Email, 'camille@exemple.test')
    assert(
      /\/appel-decouverte\/annuler#t=[A-Za-z0-9_-]{43}/.test(mail.Text),
      'the cancel link',
    )
    const buckets = s.service.calls.filter((c) => c.fn === 'consume_rate_limit')
      .map((c) => c.args.p_bucket)
    assert(
      buckets.indexOf('demandes.booking_ip') <
        buckets.indexOf('demandes.booking_challenge'),
      'per IP, then the check once',
    )
  })
})

Deno.test('demandes-book-call: an address that already has a call reads like a booking; the earlier call is confirmed to that address', async () => {
  await run(async () => {
    const EARLIER = '2026-10-15T18:00:00.000Z'
    const s = setup({
      book: {
        data: {
          ...booked,
          starts_at: EARLIER,
          requested_starts_at: SLOT,
          first_name: 'Marie',
          language: 'en',
        },
      },
    })
    const { ticket, nonce } = await ticketFrom(s.handler)
    const res = await s.handler(
      post(bookBody(ticket, nonce, { first_name: 'Intrus' })),
    )
    assertEquals(res.status, 200)
    assertEquals(
      await res.json(),
      { starts_at: SLOT, timezone: 'America/Toronto', emailed: true },
      'the same answer as a booking: the slot asked for, never the earlier call',
    )
    const context = s.service.calls.find((c) => c.fn === 'get_email_context')!
    assertEquals(
      context.args.p_template_key,
      'demandes.discovery_call_booked_en',
      'the earlier call’s language',
    )
    const mail = JSON.parse(s.http.calls[0].body)
    assertEquals(mail.To[0].Email, 'camille@exemple.test')
    assert(mail.Text.includes('Marie'), 'the earlier call’s first name')
    assert(!mail.Text.includes('Intrus'), 'never the name typed this time')
    assert(
      /\/appel-decouverte\/annuler#t=[A-Za-z0-9_-]{43}/.test(mail.Text),
      'with its fresh cancel link',
    )
  })
})

Deno.test('demandes-book-call: a name of 100 characters is refused before the database', async () => {
  await run(async () => {
    const s = setup()
    const { ticket, nonce } = await ticketFrom(s.handler)
    const res = await s.handler(
      post(bookBody(ticket, nonce, { last_name: 'x'.repeat(100) })),
    )
    assertEquals(res.status, 400)
    assertEquals(
      s.service.calls.filter((c) => c.fn === 'book_discovery_call_for_service')
        .length,
      0,
    )
  })
})

Deno.test('demandes-book-call: no work, a forged or another clinic’s check → refused before any write', async () => {
  await run(async () => {
    const s = setup()
    const { ticket, nonce } = await ticketFrom(s.handler)
    let bad = '0'
    while ((await leadingZeroBits(ticket, bad)) >= TEST_BITS) {
      bad = String(Number(bad) + 1)
    }
    for (
      const body of [
        bookBody(ticket, bad),
        bookBody(`${ticket.split('.')[0]}.AAAA`, nonce),
        bookBody(ticket, nonce, {
          org: '00000000-0000-4000-8000-0000000000ff',
        }),
      ]
    ) {
      const res = await s.handler(post(body))
      assertEquals(res.status, 400)
    }
    assertEquals(
      s.service.calls.filter((c) => c.fn === 'book_discovery_call_for_service')
        .length,
      0,
    )
  })
})

Deno.test('demandes-book-call: a check is used once', async () => {
  await run(async () => {
    let spent = false
    const s = setup({
      limit: (bucket) => {
        if (bucket !== 'demandes.booking_challenge') return ALLOWED
        const answer = spent ? REFUSED : ALLOWED
        spent = true
        return answer
      },
    })
    const { ticket, nonce } = await ticketFrom(s.handler)
    assertEquals((await s.handler(post(bookBody(ticket, nonce)))).status, 200)
    const again = await s.handler(post(bookBody(ticket, nonce)))
    assertEquals(again.status, 400)
    assertEquals(
      s.service.calls.filter((c) => c.fn === 'book_discovery_call_for_service')
        .length,
      1,
    )
  })
})

Deno.test('demandes-book-call: the per-IP limit stops a booking before anything', async () => {
  await run(async () => {
    const s = setup({
      limit: (bucket) => (bucket === 'demandes.booking_ip' ? REFUSED : ALLOWED),
    })
    const { ticket, nonce } = await ticketFrom(s.handler)
    const res = await s.handler(post(bookBody(ticket, nonce)))
    assertEquals(res.status, 429)
    assertEquals(
      s.service.calls.filter((c) => c.fn === 'book_discovery_call_for_service')
        .length,
      0,
    )
  })
})

Deno.test('demandes-book-call: a refusal of the database is its French sentence', async () => {
  await run(async () => {
    const s = setup({
      book: {
        error: {
          code: 'P0001',
          message: 'Cette plage n’est plus libre : choisissez-en une autre.',
          hint: 'slot',
        },
      },
    })
    const { ticket, nonce } = await ticketFrom(s.handler)
    const res = await s.handler(post(bookBody(ticket, nonce)))
    assertEquals(res.status, 400)
    const body = await res.json()
    assertEquals(body.error.refusal, true)
    assertEquals(s.http.calls.length, 0, 'no email')
  })
})

Deno.test('demandes-book-call: cancel → a malformed token is gone before any read; a good one cancels', async () => {
  await run(async () => {
    const s = setup()
    const gone = await s.handler(post({ action: 'cancel', token: 'court' }))
    assertEquals(gone.status, 410)
    assertEquals(
      s.service.calls.filter((c) =>
        c.fn === 'cancel_discovery_call_for_service'
      ).length,
      0,
    )
    const token = 'AAECAwQFBgcICQoLDA0ODxAREhMUFRYXGBkaGxwdHh8'
    const res = await s.handler(post({ action: 'cancel', token }))
    assertEquals(res.status, 200)
    assertEquals(await res.json(), { state: 'cancelled' })
  })
})
