import { assert, assertEquals, assertFalse, assertMatch } from '@std/assert'
import { createHandler } from './handler.ts'
import { createMasker } from './mask.ts'
import {
  buildSystemPrompt,
  buildUserTurn,
  splitSubjectAndBody,
} from './prompts.ts'
import { costCents, OPENAI_ORIGIN, openAiOrigin } from './openai.ts'
import type { Deps } from '../_shared/deps.ts'
import { withEnv } from '../_shared/testing/env.ts'
import {
  accessFixture,
  ADMIN_ID,
  ORG_ID,
} from '../_shared/testing/email-fixtures.ts'
import { FAKE_OPENAI_KEY, fakeOpenAi } from '../_shared/testing/fake-openai.ts'
import {
  fakeSupabase,
  type RpcRoute,
} from '../_shared/testing/fake-supabase.ts'
import { fixedClock } from '../_shared/testing/fixed-clock.ts'

const URL_ = 'http://fn.test/functions/v1/communications-draft'
const ALLOWED = { allowed: true, hits: 1, retry_after_seconds: 0 }
const CLIENT_ID = '0b1c2d3e-4f50-4a61-8b72-9c8d7e6f5a4b'

const CONTEXT = {
  enabled: true,
  model: 'gpt-5.4',
  monthly_cap_cents: 5000,
  input_cents_per_mtok: 125,
  output_cents_per_mtok: 1000,
  month_spent_cents: 0,
  person: { first_name: 'Camille', last_name: 'Fictive' },
  sender_name: 'Julie Conseillère',
  clinic_name: 'Clinique Exemple',
}

function setup(
  options: {
    permissions?: string[]
    rpc?: Record<string, RpcRoute>
    limit?: typeof ALLOWED
    secret?: unknown
  } = {},
) {
  const openai = fakeOpenAi()
  const user = fakeSupabase({
    user: { id: ADMIN_ID },
    rpc: {
      get_my_access: {
        data: {
          ...accessFixture(options.permissions ?? ['communications.ai_draft']),
          modules: ['communications'],
        },
      },
    },
  })
  const service = fakeSupabase({
    rpc: {
      consume_rate_limit: () => ({ data: [options.limit ?? ALLOWED] }),
      ai_draft_context_for_service: { data: CONTEXT },
      get_org_secret: {
        data: 'secret' in options ? options.secret : FAKE_OPENAI_KEY,
      },
      record_ai_request_for_service: {
        data: 'b5b5b5b5-0000-4000-8000-000000000001',
      },
      ...options.rpc,
    },
  })
  const deps: Deps = {
    env: (key) =>
      ({
        APP_URL: 'http://localhost:5173',
        OPENAI_API_BASE_URL: 'http://fake-openai.test',
      } as Record<string, string>)[key],
    fetch: (input, init) => {
      const url = new URL(input instanceof Request ? input.url : String(input))
      if (url.origin === 'http://fake-openai.test') {
        return openai.fetch(input, init)
      }
      return Promise.reject(new Error('no other network in this test'))
    },
    now: fixedClock('2027-03-10T15:00:00Z').now,
    serviceClient: () => service.client,
    userClient: () => user.client,
  }
  const inner = createHandler(deps)
  const handler = async (req: Request) => {
    let res!: Response
    await withEnv(
      { INTERNAL_FUNCTION_SECRET: 'local-dev-test-secret' },
      async () => {
        res = await inner(req)
      },
    )
    return res
  }
  return { handler, service, openai }
}

const post = (body: unknown) =>
  new Request(URL_, {
    method: 'POST',
    headers: {
      Authorization: 'Bearer jwt',
      'Content-Type': 'application/json',
      Origin: 'http://localhost:5173',
    },
    body: JSON.stringify(body),
  })

const recorded = (s: ReturnType<typeof setup>) =>
  s.service.calls.filter((c) => c.fn === 'record_ai_request_for_service').map((
    c,
  ) => c.args)

Deno.test('a reply drafted: names, addresses and numbers never reach OpenAI; the answer gives them back; the call recorded without text', async () => {
  const s = setup()
  const res = await s.handler(post({
    mode: 'reply',
    instruction:
      'Proposez mardi à Camille, joignable au 514 555-1234 ou à camille@exemple.test.',
    draft: '',
    original:
      'Bonjour, ici Camille Fictive. Mon dossier 1234567 : pouvez-vous me rappeler ?',
    subject_empty: true,
    client_id: CLIENT_ID,
  }))
  assertEquals(res.status, 200)
  const body = await res.json()
  assertEquals(body.subject, 'Suivi de votre demande')
  assertMatch(body.text, /^Bonjour \{\{person\.first_name\}\},/)
  const sent = JSON.stringify(s.openai.requests)
  for (
    const secret of [
      'Camille',
      'Fictive',
      '514 555-1234',
      'camille@exemple.test',
      '1234567',
      'Julie',
      'Clinique Exemple',
    ]
  ) {
    assertFalse(sent.includes(secret), `OpenAI saw ${secret}`)
  }
  assert(
    sent.includes('{{person.first_name}}') &&
      sent.includes('[[téléphone-1]]') && sent.includes('[[courriel-1]]') &&
      sent.includes('[[numéro-1]]'),
  )
  assertEquals(s.openai.requests[0]!.model, 'gpt-5.4')
  const [call] = recorded(s)
  assertEquals(call!.p_status, 'ok')
  assertEquals(call!.p_org_id, ORG_ID)
  assertEquals(call!.p_kind, 'reply')
  assert(
    (call!.p_prompt_tokens as number) > 0 && (call!.p_cost_cents as number) > 0,
  )
  assertFalse(JSON.stringify(call).includes('Proposez'))
  // The history comes back with the tokens put back, for « Raffiner ».
  assertEquals(body.history.length, 2)
  assert(body.history[0].content.includes('514 555-1234'))
})

Deno.test('« Raffiner »: the history sent again (masked), no subject line asked', async () => {
  const s = setup()
  const res = await s.handler(post({
    mode: 'refine',
    instruction: 'Plus court, et ajoutez le 450 555-9876.',
    history: [{ role: 'user', content: 'Instruction: une réponse à Camille' }, {
      role: 'assistant',
      content: 'Bonjour {{person.first_name}},\n\nMerci.',
    }],
  }))
  assertEquals(res.status, 200)
  const body = await res.json()
  assertEquals(body.subject, null)
  assertMatch(body.text, /raffinée/)
  const messages = s.openai.requests[0]!.messages
  assertEquals(messages.length, 4)
  assertEquals(
    messages[3]!.content,
    'Raffinement: Plus court, et ajoutez le [[téléphone-1]].',
  )
  assertFalse(messages[1]!.content.includes('Camille'))
  assertEquals(recorded(s)[0]!.p_kind, 'refine')
})

Deno.test("off, or the month's cap reached: refused in French, OpenAI never called", async () => {
  const off = setup({
    rpc: {
      ai_draft_context_for_service: { data: { ...CONTEXT, enabled: false } },
    },
  })
  const res = await off.handler(
    post({ mode: 'write', instruction: 'Un courriel de bienvenue.' }),
  )
  assertEquals(res.status, 400)
  assertEquals(
    (await res.json()).error.message,
    'L’IA n’est pas activée : un administrateur l’active dans Paramètres → IA.',
  )
  const capped = setup({
    rpc: {
      ai_draft_context_for_service: {
        data: { ...CONTEXT, month_spent_cents: 5000 },
      },
    },
  })
  const res2 = await capped.handler(
    post({ mode: 'write', instruction: 'Un courriel de bienvenue.' }),
  )
  assertEquals(res2.status, 400)
  assertMatch(
    (await res2.json()).error.message,
    /^Le plafond mensuel de l’IA est atteint \(50 \$\)/,
  )
  assertEquals(off.openai.requests.length + capped.openai.requests.length, 0)
})

Deno.test("the caller's limit, a missing permission, no key, no instruction", async () => {
  const limited = setup({
    limit: { allowed: false, hits: 41, retry_after_seconds: 120 },
  })
  assertEquals(
    (await limited.handler(post({ mode: 'write', instruction: 'x' }))).status,
    429,
  )
  const forbidden = setup({ permissions: ['communications.inbox'] })
  assertEquals(
    (await forbidden.handler(post({ mode: 'write', instruction: 'x' }))).status,
    403,
  )
  const noKey = setup({ secret: null })
  const res = await noKey.handler(post({ mode: 'write', instruction: 'x' }))
  assertEquals(res.status, 503)
  assertEquals((await res.json()).error.code, 'not_configured')
  const empty = setup()
  assertEquals(
    (await empty.handler(post({ mode: 'write', instruction: '  ' }))).status,
    400,
  )
  assertEquals(
    limited.openai.requests.length + noKey.openai.requests.length +
      empty.openai.requests.length,
    0,
  )
})

Deno.test('OpenAI refusing: the credit, a busy service, an error; each recorded as failed, nothing billed', async () => {
  const quota = setup()
  const res = await quota.handler(
    post({ mode: 'write', instruction: 'FAKE_QUOTA' }),
  )
  assertEquals(res.status, 400)
  assertMatch(
    (await res.json()).error.message,
    /crédit OpenAI de la clinique est épuisé/,
  )
  assertEquals(recorded(quota)[0]!.p_error_code, 'quota')
  const busy = setup()
  assertEquals(
    (await busy.handler(post({ mode: 'write', instruction: 'FAKE_429' })))
      .status,
    429,
  )
  const broken = setup()
  const res3 = await broken.handler(
    post({ mode: 'write', instruction: 'FAKE_500' }),
  )
  assertEquals(res3.status, 502)
  assertEquals(recorded(broken)[0]!.p_cost_cents, 0)
})

Deno.test('the masker: whole words, any case, longest first; tokens given back', () => {
  const m = createMasker({
    firstName: 'Ève',
    lastName: 'Roy',
    senderName: 'Julie Tremblay',
    clinicName: 'Clinique MANA',
  })
  const masked = m.mask(
    'Bonjour ÈVE ROY, ici Julie Tremblay de Clinique MANA. Royaume ; eve@x.ca ; 819-555-0101 poste 22.',
  )
  assertEquals(
    masked,
    'Bonjour {{person.first_name}} {{person.last_name}}, ici {{sender.name}} de {{clinic.name}}. Royaume ; [[courriel-1]] ; [[téléphone-1]].',
  )
  assertEquals(
    m.unmask('Écrivez à [[courriel-1]] ou au [[téléphone-1]].'),
    'Écrivez à eve@x.ca ou au 819-555-0101 poste 22.',
  )
})

Deno.test("the prompts: PS Hub's rules, the placeholders, nothing clinical, the subject line only when asked", () => {
  const known = buildSystemPrompt({
    mode: 'write',
    subjectEmpty: true,
    personKnown: true,
  })
  assertMatch(known, /N'écris jamais d'information clinique/)
  assertMatch(known, /utilise \{\{person\.first_name\}\}/)
  assertMatch(known, /Commence par une ligne "Objet:/)
  assertMatch(
    buildSystemPrompt({
      mode: 'reply',
      subjectEmpty: false,
      personKnown: false,
    }),
    /salue sans nom/,
  )
  const turn = buildUserTurn({
    mode: 'reply',
    instruction: 'Merci.',
    draft: '',
    original: '§'.repeat(5000),
    subjectEmpty: false,
    personKnown: false,
  })
  assertMatch(turn, /^Message original auquel l'utilisateur réagit/)
  assertEquals(turn.match(/§/g)!.length, 3000)
  assertMatch(turn, /Ne pas inclure de ligne "Objet:"/)
  assertEquals(splitSubjectAndBody('Objet : Votre rendez-vous\n\nBonjour,'), {
    subject: 'Votre rendez-vous',
    body: 'Bonjour,',
  })
  assertEquals(splitSubjectAndBody('Bonjour,'), {
    subject: null,
    body: 'Bonjour,',
  })
})

Deno.test("the origin: OpenAI's, the fake only on a dev machine; the cost at the clinic's prices", () => {
  assertEquals(
    openAiOrigin((k) =>
      ({
        APP_URL: 'https://app.cliniquemana.com',
        OPENAI_API_BASE_URL: 'http://evil.test',
      } as Record<string, string>)[k]
    ),
    OPENAI_ORIGIN,
  )
  assertEquals(
    openAiOrigin((k) =>
      ({
        APP_URL: 'http://localhost:5173',
        OPENAI_API_BASE_URL: 'http://host.docker.internal:55398',
      } as Record<string, string>)[k]
    ),
    'http://host.docker.internal:55398',
  )
  assertEquals(
    costCents({ promptTokens: 1_000_000, completionTokens: 100_000 }, {
      input: 125,
      output: 1000,
    }),
    225,
  )
})
