/**
 * An in-memory Yeastar P-Series PBX (the OpenAPI the SMS code uses, batch
 * SM), for the Deno tests and the local server (`scripts/fake-yeastar.ts`).
 * Test-only: no `index.ts` imports this folder.
 *
 * Routes (`handler`):
 * - `POST /openapi/v1.0/get_token` { username, password } → tokens when they
 *   are the fake's credentials, else `errcode` 10001; `tokenLimit: true`
 *   answers 60002 (« MAX LIMITATION EXCEEDED »);
 * - `POST /openapi/v1.0/refresh_token` { refresh_token } → new tokens for a
 *   known refresh token, else 10001;
 * - `GET /openapi/v1.0/message_channel/list?access_token=…` → one SMS channel
 *   `general` holding `did`, plus a voice channel; an unknown or expired token
 *   answers 10004 (the PBX's « invalid token »);
 * - `GET /openapi/v1.0/message_session/get?access_token=…&id=…` → the
 *   session's DID and channel: the fake's own number for a session it knows,
 *   another tenant's for one declared with `foreignSession`, else 30002;
 * - `POST /openapi/v1.0/message/send?access_token=…` → `msg_id`,
 *   `session_id` (one session per destination); `request_id` seen before
 *   answers the same ids; a destination ending in `0000` is refused
 *   (errcode 30004, the PBX's « invalid number »); the text is kept in
 *   `messages`.
 *
 * `inboundEvent` / `deliveryEvent` build the webhook envelopes the PBX posts
 * (30031, 30032), and `signedWebhook` the request for them (`X-Signature`,
 * base64 HMAC-SHA256 of the body: `signYeastarBody`).
 *
 * Logs nothing.
 */
import { signYeastarBody } from '../sms/webhook.ts'

export interface FakeYeastarOptions {
  clientId?: string
  clientSecret?: string
  /** The clinic's SMS number, as the channel lists it. */
  did?: string
  /** `get_token` answers the PBX's token cap. */
  tokenLimit?: boolean
  /** Access tokens last this long (seconds). */
  accessTtlSeconds?: number
  now?: () => Date
}

export interface FakeSentMessage {
  msgId: number
  sessionId: number
  to: string
  body: string
  requestId: string | null
  channel: string
  did: string
}

export interface FakeYeastar {
  handler: (req: Request) => Promise<Response>
  /** Every accepted `message/send`, in order. */
  messages: FakeSentMessage[]
  /** The `get_token` and `refresh_token` calls, in order. */
  tokenCalls: Array<'get_token' | 'refresh_token'>
  /** Live access tokens (expired ones are forgotten). */
  tokens: Map<string, number>
  /** Drops every live token: the next call needs a refresh or new tokens. */
  revokeTokens: () => void
  /** Declares a session of another tenant (its DID), for `message_session/get`. */
  foreignSession: (sessionId: number, did: string) => void
  /** The 30031 envelope of a text from `from` (and its `msg_id`). */
  inboundEvent: (
    input: {
      from: string
      body: string
      msgId?: number
      sessionId?: number
      files?: unknown[]
      at?: Date
    },
  ) => Record<string, unknown>
  /** The 30032 envelope of a delivery report for `msgId`. */
  deliveryEvent: (
    input: { msgId: number; status: 1 | 2; sessionId?: number; error?: string },
  ) => Record<string, unknown>
}

export const FAKE_YEASTAR_CLIENT_ID = 'local-dev-yeastar-client'
export const FAKE_YEASTAR_CLIENT_SECRET = 'local-dev-yeastar-secret'
export const FAKE_YEASTAR_DID = '+14185550199'
export const FAKE_YEASTAR_SERIAL = '3631A2124788'

const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), {
    status,
    headers: { 'Content-Type': 'application/json' },
  })

export function fakeYeastar(options: FakeYeastarOptions = {}): FakeYeastar {
  const clientId = options.clientId ?? FAKE_YEASTAR_CLIENT_ID
  const clientSecret = options.clientSecret ?? FAKE_YEASTAR_CLIENT_SECRET
  const did = options.did ?? FAKE_YEASTAR_DID
  const accessTtl = options.accessTtlSeconds ?? 1800
  const now = options.now ?? (() => new Date())
  const tokens = new Map<string, number>()
  const refreshTokens = new Set<string>()
  const messages: FakeSentMessage[] = []
  const tokenCalls: FakeYeastar['tokenCalls'] = []
  const sessions = new Map<string, number>()
  const foreignSessions = new Map<number, string>()
  const byRequest = new Map<string, FakeSentMessage>()
  let nextToken = 1
  let nextMsg = 10_000
  let nextSession = 3_000
  let nextInbound = 20_000

  const issue = () => {
    const access = `fake-access-${nextToken}`
    const refresh = `fake-refresh-${nextToken}`
    nextToken++
    tokens.set(access, now().getTime() + accessTtl * 1000)
    refreshTokens.add(refresh)
    return {
      errcode: 0,
      errmsg: 'SUCCESS',
      access_token: access,
      access_token_expire_time: accessTtl,
      refresh_token: refresh,
      refresh_token_expire_time: 86_400,
    }
  }
  const validToken = (url: URL) => {
    const token = url.searchParams.get('access_token') ?? ''
    const until = tokens.get(token)
    if (until === undefined) return false
    if (until <= now().getTime()) {
      tokens.delete(token)
      return false
    }
    return true
  }
  const readJson = async (req: Request): Promise<Record<string, unknown>> => {
    try {
      const body = await req.json()
      return body && typeof body === 'object' ? body : {}
    } catch {
      return {}
    }
  }

  const handler = async (req: Request): Promise<Response> => {
    const url = new URL(req.url)
    const path = url.pathname.replace(/^\/openapi\/v1\.0\//, '')
    if (!url.pathname.startsWith('/openapi/v1.0/')) {
      return json({ errcode: 404 }, 404)
    }
    if (req.method === 'POST' && path === 'get_token') {
      tokenCalls.push('get_token')
      const body = await readJson(req)
      if (options.tokenLimit) {
        return json({ errcode: 60002, errmsg: 'MAX LIMITATION EXCEEDED' })
      }
      if (body.username !== clientId || body.password !== clientSecret) {
        return json({ errcode: 10001, errmsg: 'INVALID USERNAME OR PASSWORD' })
      }
      return json(issue())
    }
    if (req.method === 'POST' && path === 'refresh_token') {
      tokenCalls.push('refresh_token')
      const body = await readJson(req)
      const refresh = typeof body.refresh_token === 'string'
        ? body.refresh_token
        : ''
      if (!refreshTokens.has(refresh)) {
        return json({ errcode: 10001, errmsg: 'INVALID REFRESH TOKEN' })
      }
      refreshTokens.delete(refresh)
      return json(issue())
    }
    if (!validToken(url)) {
      return json({ errcode: 10004, errmsg: 'INVALID TOKEN' })
    }
    if (req.method === 'GET' && path === 'message_channel/list') {
      return json({
        errcode: 0,
        errmsg: 'SUCCESS',
        total_number: 2,
        list: [
          {
            id: 1,
            channel: 'voice-main',
            type: 'voice',
            number: ['+14185550100'],
          },
          { id: 2, channel: 'general', type: 'sms', number: [did] },
        ],
      })
    }
    if (req.method === 'GET' && path === 'message_session/get') {
      const id = Number(url.searchParams.get('id'))
      const foreign = foreignSessions.get(id)
      const own = [...sessions.entries()].find(([, s]) => s === id)
      if (!foreign && !own) {
        return json({ errcode: 30002, errmsg: 'NOT FOUND' })
      }
      return json({
        errcode: 0,
        errmsg: 'SUCCESS',
        list: {
          id,
          channel_type: 'sms',
          channel_name: foreign ? 'other-tenant' : 'general',
          did_number: foreign ?? did,
          to_number: own ? own[0] : '+10000000000',
          origin: '',
        },
      })
    }
    if (req.method === 'POST' && path === 'message/send') {
      const body = await readJson(req)
      const requestId = typeof body.request_id === 'string'
        ? body.request_id
        : null
      if (requestId && byRequest.has(requestId)) {
        const seen = byRequest.get(requestId)!
        return json({
          errcode: 0,
          errmsg: 'SUCCESS',
          msg_id: seen.msgId,
          session_id: seen.sessionId,
        })
      }
      const to = typeof body.to === 'string' ? body.to : ''
      const text = typeof body.msg_body === 'string' ? body.msg_body : ''
      if (
        body.channel !== 'general' || typeof body.did_number !== 'string' ||
        to === '' || text === '' || body.sender_type !== 9
      ) {
        return json({ errcode: 30001, errmsg: 'INVALID PARAMETER' })
      }
      if (to.endsWith('0000')) {
        return json({ errcode: 30004, errmsg: 'INVALID NUMBER' })
      }
      let sessionId = sessions.get(to)
      if (sessionId === undefined) {
        sessionId = nextSession++
        sessions.set(to, sessionId)
      }
      const sent: FakeSentMessage = {
        msgId: nextMsg++,
        sessionId,
        to,
        body: text,
        requestId,
        channel: body.channel,
        did: body.did_number,
      }
      messages.push(sent)
      if (requestId) byRequest.set(requestId, sent)
      return json({
        errcode: 0,
        errmsg: 'SUCCESS',
        msg_id: sent.msgId,
        session_id: sent.sessionId,
      })
    }
    return json({ errcode: 404, errmsg: 'NOT FOUND' }, 404)
  }

  return {
    handler,
    messages,
    tokenCalls,
    tokens,
    revokeTokens: () => tokens.clear(),
    foreignSession: (sessionId, foreignDid) => {
      foreignSessions.set(sessionId, foreignDid)
    },
    inboundEvent: ({ from, body, msgId, sessionId, files, at }) => {
      let session = sessionId ?? sessions.get(from)
      if (session === undefined) {
        session = nextSession++
        sessions.set(from, session)
      }
      const seconds = Math.floor((at ?? now()).getTime() / 1000)
      return {
        type: 30031,
        sn: FAKE_YEASTAR_SERIAL,
        msg: {
          session_id: session,
          msg_id: msgId ?? nextInbound++,
          delivery_status: 1,
          sender: {
            user_id: 0,
            user_no: from,
            user_type: 2,
            avatar: '',
            username: '',
          },
          msg_type: 0,
          msg_body: body,
          msg_files: files ? JSON.stringify(files) : '',
          send_time: seconds,
          receive_time: seconds,
          msg_kind: 0,
        },
      }
    },
    deliveryEvent: ({ msgId, status, sessionId, error }) => ({
      type: 30032,
      sn: FAKE_YEASTAR_SERIAL,
      msg: {
        session_id: sessionId ?? 0,
        msg_id: msgId,
        delivery_status: status,
        sender: { user_id: 0, user_no: 'api', user_type: 9 },
        msg_type: 0,
        msg_body: '',
        msg_files: '',
        send_error: status === 2 ? (error ?? 'invalid_phone_number') : '',
        send_error_msg: status === 2 ? 'bad number' : '',
        send_time: 0,
        receive_time: 0,
        msg_kind: 0,
      },
    }),
  }
}

/** The request the PBX would post: the envelope as JSON, signed in `X-Signature`. */
export async function signedWebhook(
  url: string,
  envelope: unknown,
  secret: string,
  init: { signature?: string; ip?: string } = {},
): Promise<Request> {
  const body = JSON.stringify(envelope)
  return new Request(url, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'X-Signature': init.signature ?? await signYeastarBody(body, secret),
      'x-forwarded-for': init.ip ?? '203.0.113.9',
    },
    body,
  })
}
