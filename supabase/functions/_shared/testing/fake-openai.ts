/**
 * An in-memory OpenAI Chat Completions (Communications CM4) for the Deno tests
 * and the local server (`scripts/fake-openai.ts`, `npm run fake:openai`):
 * `POST /v1/chat/completions` with the fake's key, a draft written from the
 * request (an « Objet: » line when the prompt asks for one), and the usage.
 * An instruction holding `FAKE_429` answers a rate limit, `FAKE_QUOTA` an
 * exhausted credit, `FAKE_500` a server error. Test-only and the local fake:
 * no `index.ts` imports this folder.
 */

/** The fake's key (the seed's org secret holds the same value). */
export const FAKE_OPENAI_KEY = 'sk-local-dev-openai'

export interface FakeOpenAiRequest {
  model: string
  messages: { role: string; content: string }[]
  max_completion_tokens?: number
}

export interface FakeOpenAi {
  fetch: typeof fetch
  handler(req: Request): Promise<Response>
  /** Every request body received, in order (the tests check what OpenAI would have seen). */
  requests: FakeOpenAiRequest[]
  calls: { path: string; status: number }[]
}

const tokens = (text: string) => Math.max(1, Math.ceil(text.length / 4))

/** The fake's answer to a conversation. */
function draftFor(body: FakeOpenAiRequest): string {
  const system = body.messages.find((m) => m.role === 'system')?.content ?? ''
  const last =
    [...body.messages].reverse().find((m) => m.role === 'user')?.content ?? ''
  const subject = /Inclure une ligne "Objet:"/.test(last)
    ? 'Objet: Suivi de votre demande\n\n'
    : ''
  const greeting = /\{\{person\.first_name\}\}/.test(system)
    ? 'Bonjour {{person.first_name}},'
    : 'Bonjour,'
  if (last.startsWith('Raffinement:')) {
    return `${greeting}\n\nVoici la version raffinée de la réponse (IA simulée).\n\nAu plaisir,`
  }
  return `${subject}${greeting}\n\nMerci pour votre message. Voici une réponse rédigée par l'IA simulée.\n\nAu plaisir,`
}

export function fakeOpenAi(): FakeOpenAi {
  const requests: FakeOpenAiRequest[] = []
  const calls: { path: string; status: number }[] = []
  const json = (status: number, body: unknown) =>
    Response.json(body, { status })

  async function handler(req: Request): Promise<Response> {
    const { pathname } = new URL(req.url)
    const answer = (status: number, body: unknown) => {
      calls.push({ path: pathname, status })
      return json(status, body)
    }
    if (req.method !== 'POST' || pathname !== '/v1/chat/completions') {
      return answer(404, {
        error: { message: 'Not found', type: 'invalid_request_error' },
      })
    }
    if (req.headers.get('authorization') !== `Bearer ${FAKE_OPENAI_KEY}`) {
      return answer(401, {
        error: {
          message: 'Incorrect API key provided',
          type: 'invalid_request_error',
          code: 'invalid_api_key',
        },
      })
    }
    let body: FakeOpenAiRequest
    try {
      body = await req.json()
    } catch {
      return answer(400, {
        error: { message: 'Invalid JSON', type: 'invalid_request_error' },
      })
    }
    if (!body?.model || !Array.isArray(body.messages)) {
      return answer(400, {
        error: {
          message: 'model and messages are required',
          type: 'invalid_request_error',
        },
      })
    }
    requests.push(body)
    const all = body.messages.map((m) => m.content).join('\n')
    if (all.includes('FAKE_429')) {
      return answer(429, {
        error: {
          message: 'Rate limit reached',
          type: 'requests',
          code: 'rate_limit_exceeded',
        },
      })
    }
    if (all.includes('FAKE_QUOTA')) {
      return answer(429, {
        error: {
          message: 'You exceeded your current quota',
          type: 'insufficient_quota',
          code: 'insufficient_quota',
        },
      })
    }
    if (all.includes('FAKE_500')) {
      return answer(500, {
        error: { message: 'The server had an error', type: 'server_error' },
      })
    }
    const content = draftFor(body)
    return answer(200, {
      id: `chatcmpl-fake-${requests.length}`,
      object: 'chat.completion',
      model: body.model,
      choices: [{
        index: 0,
        message: { role: 'assistant', content },
        finish_reason: 'stop',
      }],
      usage: {
        prompt_tokens: tokens(all),
        completion_tokens: tokens(content),
        total_tokens: tokens(all) + tokens(content),
      },
    })
  }

  return {
    handler,
    requests,
    calls,
    fetch: (input, init) => handler(new Request(input, init)),
  }
}
