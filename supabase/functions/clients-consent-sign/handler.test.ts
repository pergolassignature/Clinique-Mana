import { assert, assertEquals } from '@std/assert'
import { createHandler, IDENTITY_MISMATCH } from './handler.ts'
import type { Deps } from '../_shared/deps.ts'
import type { PdfDocument } from '../_shared/pdf/model.ts'
import { generateToken, hashToken } from '../_shared/links.ts'
import { fakeDocumenso } from '../_shared/testing/fake-documenso.ts'
import { fakeSigningDb } from '../_shared/testing/fake-signing-db.ts'
import {
  fakeSupabase,
  type RpcRoute,
} from '../_shared/testing/fake-supabase.ts'
import { fixedClock } from '../_shared/testing/fixed-clock.ts'
import { captureConsole, withEnv } from '../_shared/testing/env.ts'
import {
  LOCAL_APP_URL,
  sentRequest,
  SIGNING_ORG,
} from '../_shared/testing/signing-fixtures.ts'

const URL_ = 'http://fn.test/functions/v1/clients-consent-sign'
const VERSION_ID = '00000000-0000-4000-8000-0000000000e3'
const CONSENT_REQUEST = '00000000-0000-4000-8000-0000000000c1'
const PUBLIC_URL = 'http://127.0.0.1:55390'
const TOKEN = generateToken()
const ALLOWED = { allowed: true, hits: 1, retry_after_seconds: 0 }

const body: PdfDocument = {
  title: 'Consentement général',
  footer: { text: '{{clinic.name}}' },
  blocks: [
    { type: 'paragraph', runs: [{ text: 'Pour {{client.full_name}}.' }] },
    { type: 'paragraph', runs: [{ text: '{{consent.clauses}}' }] },
    {
      type: 'signaturePage',
      signers: [
        { role: 'client', label: '{{signer.full_name}}' },
        { role: 'client_2', label: '{{signer_2.full_name}}' },
      ],
    },
  ],
}
const variable = (path: string, required = true) => ({
  path,
  label: path,
  sample: path,
  required,
  kind: 'text',
})
const version = {
  id: VERSION_ID,
  module_key: 'clients',
  view_permission: 'clients.view',
  body,
  variables: [
    variable('clinic.name'),
    variable('client.full_name'),
    variable('signer.full_name'),
    variable('signer_2.full_name', false),
    variable('consent.clauses', false),
  ],
  signers: [
    { role: 'client', label: 'Client', order: 1, required: true },
    { role: 'client_2', label: 'Deuxième parent', order: 2, required: false },
  ],
  email_subject: 'Consentement général — {{clinic.name}}',
  email_message: '',
}

const CLAUSES = [{
  key: 'accord',
  kind: 'agree',
  text_fr: 'J’accepte.',
  text_en: 'I agree.',
}]

const prepared = (signers = 2, role = 'client_2') => ({
  state: 'prepared',
  org_id: SIGNING_ORG,
  consent_request_id: CONSENT_REQUEST,
  role,
  template_version_id: VERSION_ID,
  title: 'Consentement général — Théo Gagnon',
  values: {
    client: { full_name: 'Théo Gagnon', first_name: 'Théo' },
    signer: { full_name: 'Marc Gagnon' },
    signer_2: { full_name: signers === 2 ? 'Nadia Roy' : null },
    today: '2026-10-12',
  },
  signers: [
    {
      role: 'client',
      name: 'Marc Gagnon',
      email: 'marc@exemple.test',
      order: 1,
    },
    ...(signers === 2
      ? [{
        role: 'client_2',
        name: 'Nadia Roy',
        email: 'nadia@exemple.test',
        order: 2,
      }]
      : []),
  ],
  clauses: CLAUSES,
  answers: { accord: 'yes' },
  language: 'fr',
  sent_by: null,
  idempotency_key: `client-consent:${CONSENT_REQUEST}:key-12345678`,
})

const ready = {
  state: 'ready',
  org_id: SIGNING_ORG,
  request_id: CONSENT_REQUEST,
  role: 'client',
  language: 'fr',
  clinic_name: 'Clinique MANA',
  consent_name: 'Consentement général',
  client_first_name: 'Théo',
  signer_first_name: 'Marc',
  clauses: CLAUSES,
  answers: null,
  can_answer: true,
  signing: null,
}

function setup(
  options: {
    open?: RpcRoute
    start?: RpcRoute
    limits?: Record<string, typeof ALLOWED>
  } = {},
) {
  const clock = fixedClock('2026-10-12T12:00:00.000Z')
  const fake = fakeDocumenso()
  const db = fakeSigningDb({
    orgId: SIGNING_ORG,
    now: clock.now,
    modules: ['clients'],
    versions: { [VERSION_ID]: version },
  })
  const service = fakeSupabase({
    rpc: {
      ...db.rpc,
      consume_rate_limit: (args) => ({
        data: [options.limits?.[args.p_bucket as string] ?? ALLOWED],
      }),
      open_client_consent_for_service: options.open ?? { data: ready },
      start_client_consent_signing_for_service: options.start ??
        { data: prepared() },
    },
    storage: db.storage,
  })
  const env: Record<string, string | undefined> = {
    APP_URL: LOCAL_APP_URL,
    DOCUMENSO_PUBLIC_URL: PUBLIC_URL,
  }
  const deps: Deps = {
    env: (key) => env[key],
    fetch: fake.fetch,
    now: clock.now,
    serviceClient: () => service.client,
    userClient: () => {
      throw new Error('no user on the public page')
    },
  }
  return { fake, db, service, handler: createHandler(deps) }
}

const run = (fn: () => Promise<void>) =>
  withEnv({
    SENTRY_DSN: undefined,
    ALLOWED_ORIGINS: undefined,
    INTERNAL_FUNCTION_SECRET: 'local-dev-internal-function-secret',
  }, fn)

const post = (b: Record<string, unknown>) =>
  new Request(URL_, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ token: TOKEN, first_name: 'Théo', ...b }),
  })

const rpcNames = (s: ReturnType<typeof setup>) =>
  s.service.calls.map((c) => c.fn)

Deno.test('clients-consent-sign: a malformed token is gone (410) before any read', async () => {
  await run(async () => {
    const s = setup()
    const res = await s.handler(post({ action: 'open', token: 'abc' }))
    assertEquals(res.status, 410)
    assertEquals((await res.json()).error.code, 'link_invalid')
    assertEquals(s.service.calls, [])
  })
})

Deno.test('clients-consent-sign: the per-IP limit, then the per-link limit, come before any lookup', async () => {
  await run(async () => {
    const byIp = setup({
      limits: {
        'clients.consent_sign_ip': {
          allowed: false,
          hits: 61,
          retry_after_seconds: 30,
        },
      },
    })
    assertEquals((await byIp.handler(post({ action: 'open' }))).status, 429)
    assertEquals(rpcNames(byIp), ['consume_rate_limit'])
    const byLink = setup({
      limits: {
        'clients.consent_link': {
          allowed: false,
          hits: 21,
          retry_after_seconds: 600,
        },
      },
    })
    assertEquals((await byLink.handler(post({ action: 'open' }))).status, 429)
    assertEquals(rpcNames(byLink), ['consume_rate_limit', 'consume_rate_limit'])
  })
})

Deno.test('clients-consent-sign: open → the page, by the token hash (never the token), no org id, never cached', async () => {
  await run(async () => {
    const s = setup()
    const res = await s.handler(post({ action: 'open', birth_year: 2018 }))
    assertEquals(res.status, 200)
    assertEquals(res.headers.get('Cache-Control'), 'no-store')
    const page = await res.json()
    assertEquals(page.consent_name, 'Consentement général')
    assertEquals(page.can_answer, true)
    assert(!('org_id' in page))
    const call = s.service.calls.find((c) =>
      c.fn === 'open_client_consent_for_service'
    )!
    assertEquals(call.args, {
      p_token_hash: await hashToken(TOKEN),
      p_first_name: 'Théo',
      p_birth_year: 2018,
    })
    assert(
      !JSON.stringify(s.service.calls).includes(TOKEN),
      'the token never reaches an RPC',
    )
  })
})

Deno.test('clients-consent-sign: a wrong identity is a French refusal; a dead link 410', async () => {
  await run(async () => {
    const wrong = setup({
      open: { data: { state: 'identity_mismatch', org_id: SIGNING_ORG } },
    })
    const res = await wrong.handler(post({ action: 'open' }))
    assertEquals(res.status, 400)
    const answer = await res.json()
    assertEquals(answer.error.refusal, true)
    assertEquals(answer.error.message, IDENTITY_MISMATCH)
    const dead = setup({ open: { data: { state: 'invalid' } } })
    assertEquals((await dead.handler(post({ action: 'open' }))).status, 410)
  })
})

Deno.test('clients-consent-sign: start → one envelope for both parents, no Documenso email, the second parent gets her own token', async () => {
  await run(async () => {
    const s = setup()
    const res = await s.handler(
      post({
        action: 'start',
        answers: { accord: 'yes' },
        idempotency_key: 'key-12345678',
      }),
    )
    assertEquals(res.status, 200)
    assertEquals(res.headers.get('Cache-Control'), 'no-store')
    const answer = await res.json()
    const row = s.db.requests.get(answer.request_id)!
    assertEquals(row.purpose, 'clients.consent')
    assertEquals(row.module_key, 'clients')
    assertEquals(row.view_permission, 'clients.view')
    assertEquals(row.subject_type, 'client_consent_request')
    assertEquals(row.subject_id, CONSENT_REQUEST)
    assertEquals(row.signers.map((x) => x.role).sort(), ['client', 'client_2'])
    const doc = s.fake.documents.get(row.envelope_id!)!
    assertEquals(doc.meta.distributionMethod, 'NONE')
    assertEquals(doc.meta.redirectUrl, `${LOCAL_APP_URL}/consentement?signe=1`)
    assertEquals(
      doc.meta.signingOrder,
      'PARALLEL',
      'each parent signs whenever she opens her link',
    )
    assertEquals(doc.meta.language, 'fr')
    const second = doc.recipients.find((r) => r.email === 'nadia@exemple.test')!
    assertEquals(answer.token, second.token, 'the caller is the second parent')
    assertEquals(answer.host, PUBLIC_URL)
    assert(!JSON.stringify(answer).includes('@'), 'no address in the answer')
    const startCall = s.service.calls.find((c) =>
      c.fn === 'start_client_consent_signing_for_service'
    )!
    assertEquals(startCall.args.p_answers, { accord: 'yes' })
    assertEquals(startCall.args.p_idempotency_key, 'key-12345678')
  })
})

Deno.test('clients-consent-sign: one signer → the second box is left out of the envelope', async () => {
  await run(async () => {
    const s = setup({ start: { data: prepared(1, 'client') } })
    const res = await s.handler(
      post({ action: 'start', idempotency_key: 'key-12345678' }),
    )
    assertEquals(res.status, 200)
    const answer = await res.json()
    const row = s.db.requests.get(answer.request_id)!
    assertEquals(row.signers.map((x) => x.role), ['client'])
    const doc = s.fake.documents.get(row.envelope_id!)!
    assertEquals(doc.recipients.length, 1)
  })
})

Deno.test('clients-consent-sign: an English request → Documenso in English, and back to the English « Thank you »', async () => {
  await run(async () => {
    const s = setup({
      start: { data: { ...prepared(1, 'client'), language: 'en' } },
    })
    const res = await s.handler(
      post({ action: 'start', idempotency_key: 'key-12345678' }),
    )
    assertEquals(res.status, 200)
    const answer = await res.json()
    const doc = s.fake.documents.get(
      s.db.requests.get(answer.request_id)!.envelope_id!,
    )!
    assertEquals(doc.meta.language, 'en')
    assertEquals(
      doc.meta.redirectUrl,
      `${LOCAL_APP_URL}/consentement?signe=1&lang=en`,
    )
  })
})

Deno.test('clients-consent-sign: an envelope already out is resumed with the signer’s own token', async () => {
  await run(async () => {
    let resume: Record<string, unknown> = {}
    const s = setup({ start: () => ({ data: resume }) })
    const old = await sentRequest(s.fake, s.db, {
      purpose: 'clients.consent',
      module_key: 'clients',
      subject_type: 'client_consent_request',
      subject_id: CONSENT_REQUEST,
      idempotency_key: 'client-consent:old',
    })
    resume = {
      state: 'resume',
      org_id: SIGNING_ORG,
      request_id: old.id,
      envelope_id: old.envelope_id,
      recipient_id: old.signers[0].recipient_id,
    }
    const before = s.fake.documents.size
    const res = await s.handler(
      post({ action: 'start', idempotency_key: 'key-12345678' }),
    )
    const answer = await res.json()
    assertEquals(res.status, 200)
    assertEquals(answer.request_id, old.id)
    assertEquals(
      answer.token,
      s.fake.documents.get(old.envelope_id!)!.recipients[0].token,
    )
    assertEquals(s.fake.documents.size, before, 'no new envelope')
  })
})

Deno.test('clients-consent-sign: a refusal from the database passes with its field; start needs a key', async () => {
  await run(async () => {
    const s = setup({
      start: {
        error: {
          code: 'P0001',
          message:
            'Pour signer ce consentement, vous devez accepter chaque clause marquée « Accord requis ».',
          hint: 'answers',
        },
      },
    })
    const lines = await captureConsole('error', async () => {
      const res = await s.handler(
        post({
          action: 'start',
          answers: { accord: 'no' },
          idempotency_key: 'key-12345678',
        }),
      )
      assertEquals(res.status, 400)
      const answer = await res.json()
      assertEquals(answer.error.refusal, true)
      assertEquals(answer.error.field, 'answers')
    })
    assertEquals(lines, [], 'an expected refusal is not reported')
    const noKey = await setup().handler(post({ action: 'start' }))
    assertEquals(noKey.status, 400)
  })
})
