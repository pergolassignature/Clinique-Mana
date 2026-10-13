/**
 * OpenAI's Chat Completions (CM4), with `fetch` only (no SDK: ADR 0008, every npm package ships in
 * every function). The origin is OpenAI's; on a dev machine (`APP_URL` local) `OPENAI_API_BASE_URL`
 * points at the local fake (`npm run fake:openai`, port 55398). A stray value on a hosted project is
 * ignored, so the key never goes elsewhere. Nothing logs a prompt, an answer or the key.
 */
import { isLocalAppUrl } from '../_shared/local.ts'

export const OPENAI_ORIGIN = 'https://api.openai.com'
/** The org secret holding the clinic's key (Paramètres → IA, SecretField). */
export const OPENAI_SECRET_KEY = 'openai_api_key'
/** The longest answer asked for (PS Hub's full reply). */
export const MAX_COMPLETION_TOKENS = 3_072
const TIMEOUT_MS = 45_000

export function openAiOrigin(env: (key: string) => string | undefined): string {
  const raw = env('OPENAI_API_BASE_URL')?.trim()
  if (!raw || !isLocalAppUrl(env('APP_URL'))) return OPENAI_ORIGIN
  try {
    const url = new URL(raw)
    return url.protocol === 'http:' || url.protocol === 'https:'
      ? url.origin
      : OPENAI_ORIGIN
  } catch {
    return OPENAI_ORIGIN
  }
}

export type OpenAiFailure =
  | 'rate_limited'
  | 'quota'
  | 'auth'
  | 'timeout'
  | 'provider_error'
  | 'empty'

export class OpenAiError extends Error {
  constructor(readonly code: OpenAiFailure, readonly status: number) {
    super(`openai: ${code}`)
  }
}

export interface ChatMessage {
  role: 'system' | 'user' | 'assistant'
  content: string
}

export interface ChatResult {
  content: string
  promptTokens: number
  completionTokens: number
}

export async function chatComplete(options: {
  fetch: typeof fetch
  origin: string
  key: string
  model: string
  messages: ChatMessage[]
  signal?: AbortSignal
}): Promise<ChatResult> {
  const signals = [
    AbortSignal.timeout(TIMEOUT_MS),
    ...(options.signal ? [options.signal] : []),
  ]
  let res: Response
  try {
    res = await options.fetch(`${options.origin}/v1/chat/completions`, {
      method: 'POST',
      headers: {
        authorization: `Bearer ${options.key}`,
        'content-type': 'application/json',
      },
      body: JSON.stringify({
        model: options.model,
        messages: options.messages,
        max_completion_tokens: MAX_COMPLETION_TOKENS,
      }),
      signal: AbortSignal.any(signals),
      redirect: 'error',
    })
  } catch (error) {
    throw new OpenAiError(
      error instanceof DOMException && error.name === 'TimeoutError'
        ? 'timeout'
        : 'provider_error',
      0,
    )
  }
  let body: unknown = null
  try {
    body = await res.json()
  } catch {
    body = null
  }
  if (!res.ok) {
    const code = (body as { error?: { code?: unknown; type?: unknown } } | null)
      ?.error
    if (res.status === 401 || res.status === 403) {
      throw new OpenAiError('auth', res.status)
    }
    if (res.status === 429) {
      throw new OpenAiError(
        code?.code === 'insufficient_quota' ||
          code?.type === 'insufficient_quota'
          ? 'quota'
          : 'rate_limited',
        res.status,
      )
    }
    throw new OpenAiError('provider_error', res.status)
  }
  const parsed = body as {
    choices?: { message?: { content?: unknown } }[]
    usage?: { prompt_tokens?: unknown; completion_tokens?: unknown }
  } | null
  const content = parsed?.choices?.[0]?.message?.content
  if (typeof content !== 'string' || content.trim() === '') {
    throw new OpenAiError('empty', res.status)
  }
  const count = (
    value: unknown,
  ) => (typeof value === 'number' && Number.isFinite(value) && value >= 0
    ? Math.round(value)
    : 0)
  return {
    content,
    promptTokens: count(parsed?.usage?.prompt_tokens),
    completionTokens: count(parsed?.usage?.completion_tokens),
  }
}

/** The cost in cents of a call, at the clinic's prices per million tokens. */
export function costCents(
  result: Pick<ChatResult, 'promptTokens' | 'completionTokens'>,
  prices: { input: number; output: number },
): number {
  return Math.round(
    ((result.promptTokens * prices.input +
      result.completionTokens * prices.output) / 1_000_000) * 10_000,
  ) / 10_000
}
