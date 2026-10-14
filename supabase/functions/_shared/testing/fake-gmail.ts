/**
 * A fake Google for the Gmail integration (plan §11, CM1): the OAuth
 * endpoints (`/o/oauth2/v2/auth` consent page, `/token`, `/revoke`) and the
 * Gmail API calls the functions make (`users.getProfile`, `labels.list`,
 * `messages.list`, `messages.get`, `messages.attachments.get`,
 * `history.list`, `watch`, `stop`, `messages.batchModify`, `threads.modify`,
 * and CM3's `messages.send` through the upload endpoint),
 * over one in-memory mailbox with a history log, as Google answers them.
 * One fake for the Deno tests (`fakeGmail().fetch`) and local development
 * (`scripts/fake-gmail.ts`, `npm run fake:gmail`). Test-only: no `index.ts`
 * imports it, so it is never deployed.
 *
 * Behaviour, as Google's:
 * - `/o/oauth2/v2/auth` answers a consent page whose « Autoriser » button
 *   sends the browser to `redirect_uri?code=<code>&state=<state>`; the code
 *   is good for one `/token` exchange (10 minutes);
 * - `/token`: `authorization_code` → access + refresh tokens (the scopes
 *   asked); `refresh_token` → a new access token; a revoked refresh token →
 *   400 `invalid_grant`; a wrong client → 401 `invalid_client`;
 * - the API needs a bearer access token that is not expired (401
 *   otherwise); every write bumps the history id and appends records;
 * - `history.list` from an id older than `HISTORY_KEPT` records → 404
 *   (Google's « start history id too old »);
 * - `messages.list` honours `q=newer_than:Nd`, `q=rfc822msgid:<id>`,
 *   `maxResults` and `pageToken`;
 * - `watch` records the topic and answers an expiry 7 days ahead;
 *   `onWatchNotification` (the local server posts Pub/Sub pushes) fires on
 *   each `deliver`;
 * - `messages.send` (`/upload/gmail/v1/users/me/messages/send?uploadType=
 *   multipart`) needs the `gmail.send` scope (403 otherwise), keeps the raw
 *   message in `sent` and adds it to the mailbox with the `SENT` label, in
 *   the thread its metadata names (else a new one), with its own Message-ID;
 *   `failNextSend` makes the next one fail after it was sent (Gmail sent, then
 *   answered 503) or before (refused, 400);
 * - `/oauth2/v3/certs` publishes the `signer`'s key, as Google publishes the
 *   keys of the ID tokens Pub/Sub's authenticated pushes carry;
 * - R6 (Google busy times): `/oauth2/v3/userinfo` answers the account's `sub`
 *   and address; `/calendar/v3/freeBusy` (the `calendar.freebusy` scope, 403
 *   otherwise) answers the `busy` intervals that overlap the asked window,
 *   for `primary` only (times, never a title).
 * Error bodies carry `FAKE_ERROR_MARKER`, so tests can prove the function
 * never passes them on.
 */

import type { OidcSigner } from './google-oidc-signer.ts'

/** The local fake's OAuth client (`supabase/seed.sql` stores them as org secrets). */
export const FAKE_CLIENT_ID =
  'local-dev-google-client-id.apps.googleusercontent.com'
export const FAKE_CLIENT_SECRET = 'local-dev-google-client-secret'
/** Present in every error body the fake sends. */
export const FAKE_ERROR_MARKER = 'FAKE-GOOGLE-ERROR-BODY'
/** How many history records are kept: an older start id is a 404. */
export const HISTORY_KEPT = 500
/** The access token lifetime the fake grants (seconds). */
export const ACCESS_TOKEN_TTL_S = 3_600

/** A message of the mailbox, in Gmail's `format=full` shape (plus the attachment bytes). */
export interface FakeMessage {
  id: string
  threadId: string
  labelIds: string[]
  snippet: string
  internalDate: string
  historyId: string
  sizeEstimate: number
  payload: FakePart
}

export interface FakePart {
  partId: string
  mimeType: string
  filename: string
  headers: { name: string; value: string }[]
  body: { size: number; data?: string; attachmentId?: string }
  parts?: FakePart[]
}

export interface FakeLabel {
  id: string
  name: string
  type: 'system' | 'user'
  labelListVisibility?: string
  color?: { backgroundColor: string; textColor: string }
}

interface HistoryRecord {
  id: string
  messagesAdded?: {
    message: { id: string; threadId: string; labelIds: string[] }
  }[]
  messagesDeleted?: { message: { id: string; threadId: string } }[]
  labelsAdded?: {
    message: { id: string; threadId: string }
    labelIds: string[]
  }[]
  labelsRemoved?: {
    message: { id: string; threadId: string }
    labelIds: string[]
  }[]
}

/** What `deliver` takes: a new inbound message. */
export interface Delivery {
  from: string
  to?: string
  subject: string
  text?: string
  html?: string
  /** A thread to continue (its Gmail id), else a new one. */
  threadId?: string
  labelIds?: string[]
  attachments?: {
    filename: string
    mimeType: string
    bytes: Uint8Array
    contentId?: string
  }[]
  /** Unix ms; defaults to the fake's clock. */
  at?: number
  /** The Message-ID header, with its angle brackets; else `<id@fake.gmail.test>`. */
  messageId?: string
}

export interface FakeGmailOptions {
  /** Signs the push tokens; its key is served at `/oauth2/v3/certs` (404 without one). */
  signer?: OidcSigner
  /** The mailbox address Google reports (`users.getProfile`). */
  emailAddress?: string
  clientId?: string
  clientSecret?: string
  /** The clock (default: `Date.now`). */
  now?: () => number
  /** Google's stable id of the account (`/oauth2/v3/userinfo`'s `sub`). */
  accountSub?: string
  /** Called on every change while a watch is active (the local server posts the Pub/Sub push). */
  onWatchNotification?: (
    payload: { emailAddress: string; historyId: string },
  ) => void
}

export interface FakeGmail {
  fetch: typeof fetch
  /** Answers one request (any host). */
  handler(req: Request): Promise<Response>
  calls: { method: string; path: string; status: number }[]
  /** The mailbox's state, for assertions. */
  messages: Map<string, FakeMessage>
  labels: FakeLabel[]
  historyId: string
  history: HistoryRecord[]
  watch: { topicName: string; expiration: string } | null
  /** The grants: refresh token → revoked. */
  grants: Map<string, { scopes: string[]; revoked: boolean }>
  /** The access tokens: token → expiry (ms) and its grant's refresh token. */
  tokens: Map<string, { expiresAt: number; refresh: string }>
  /** What `messages.send` received: the metadata's thread and the raw RFC 5322 text. */
  sent: { threadId: string | null; raw: string; id: string }[]
  /** Adds an inbound message (a history record, a notification); answers its id. */
  deliver(input: Delivery): FakeMessage
  /** Issues an authorization code (what the consent page does). */
  issueCode(scope?: string): string
  /** The next `messages.send`: sent then a 503 (`after_send`), or refused with a 400 (`refused`). */
  failNextSend(mode: 'after_send' | 'refused'): void
  /** The primary calendar's busy intervals (ISO instants), what FreeBusy answers. */
  busy: { start: string; end: string }[]
  /** The FreeBusy requests received (their window), for assertions. */
  freeBusyCalls: { timeMin: string; timeMax: string; ids: string[] }[]
  /** Removes the messages and the history. */
  reset(): void
}

const b64url = (bytes: Uint8Array): string => {
  let binary = ''
  for (const b of bytes) binary += String.fromCharCode(b)
  return btoa(binary).replaceAll('+', '-').replaceAll('/', '_').replace(
    /=+$/,
    '',
  )
}
const encodeText = (text: string) => b64url(new TextEncoder().encode(text))

const json = (status: number, body: unknown) =>
  new Response(JSON.stringify(body), {
    status,
    headers: { 'Content-Type': 'application/json' },
  })
const error = (status: number, code: string) =>
  json(status, {
    error: { code: status, message: FAKE_ERROR_MARKER, status: code },
  })

/** Builds the fake; `seedMailbox` fills it with a few French messages for local use. */
export function fakeGmail(options: FakeGmailOptions = {}): FakeGmail {
  const emailAddress = options.emailAddress ?? 'info@clinique.test'
  const clientId = options.clientId ?? FAKE_CLIENT_ID
  const clientSecret = options.clientSecret ?? FAKE_CLIENT_SECRET
  const now = options.now ?? (() => Date.now())
  const calls: FakeGmail['calls'] = []
  const messages = new Map<string, FakeMessage>()
  const attachments = new Map<string, Uint8Array>()
  const codes = new Map<string, { scope: string; issuedAt: number }>()
  const grants = new Map<string, { scopes: string[]; revoked: boolean }>()
  const accessTokens = new Map<string, { expiresAt: number; refresh: string }>()
  const history: HistoryRecord[] = []
  const sent: FakeGmail['sent'] = []
  let historyId = 1000
  let counter = 1
  let watch: FakeGmail['watch'] = null
  let labels: FakeLabel[] = defaultLabels()
  let nextSendFailure: 'after_send' | 'refused' | null = null
  const accountSub = options.accountSub ?? '100000000000000000001'
  const busy: FakeGmail['busy'] = []
  const freeBusyCalls: FakeGmail['freeBusyCalls'] = []
  const FREEBUSY = 'https://www.googleapis.com/auth/calendar.freebusy'
  const scopesOf = (req: Request): string[] => {
    const token = /^Bearer\s+(\S+)$/.exec(
      req.headers.get('Authorization') ?? '',
    )?.[1]
    const refresh = token ? accessTokens.get(token)?.refresh : undefined
    return refresh ? grants.get(refresh)?.scopes ?? [] : []
  }

  const nextHistory = (record: Omit<HistoryRecord, 'id'>) => {
    historyId++
    history.push({ id: String(historyId), ...record })
    if (history.length > HISTORY_KEPT) {
      history.splice(0, history.length - HISTORY_KEPT)
    }
    if (watch) {
      options.onWatchNotification?.({
        emailAddress,
        historyId: String(historyId),
      })
    }
  }

  const bearer = (req: Request): boolean => {
    const token = /^Bearer\s+(\S+)$/.exec(
      req.headers.get('Authorization') ?? '',
    )?.[1]
    const entry = token ? accessTokens.get(token) : undefined
    if (!entry || entry.expiresAt <= now()) return false
    const grant = grants.get(entry.refresh)
    return !!grant && !grant.revoked
  }

  function deliver(input: Delivery): FakeMessage {
    const id = `m${String(counter++).padStart(6, '0')}`
    const threadId = input.threadId ?? `t${id.slice(1)}`
    const at = input.at ?? now()
    const labelIds = input.labelIds ?? ['INBOX', 'UNREAD', 'CATEGORY_PERSONAL']
    const headers = [
      { name: 'From', value: input.from },
      { name: 'To', value: input.to ?? emailAddress },
      { name: 'Subject', value: input.subject },
      { name: 'Date', value: new Date(at).toUTCString() },
      {
        name: 'Message-ID',
        value: input.messageId ?? `<${id}@fake.gmail.test>`,
      },
    ]
    const text = input.text ?? ''
    const html = input.html ??
      `<div dir="ltr">${text.replaceAll('\n', '<br>')}</div>`
    const bodyParts: FakePart[] = [
      {
        partId: '0.0',
        mimeType: 'text/plain',
        filename: '',
        headers: [{
          name: 'Content-Type',
          value: 'text/plain; charset="UTF-8"',
        }],
        body: { size: text.length, data: encodeText(text) },
      },
      {
        partId: '0.1',
        mimeType: 'text/html',
        filename: '',
        headers: [{
          name: 'Content-Type',
          value: 'text/html; charset="UTF-8"',
        }],
        body: { size: html.length, data: encodeText(html) },
      },
    ]
    const alternative: FakePart = {
      partId: '0',
      mimeType: 'multipart/alternative',
      filename: '',
      headers: [],
      body: { size: 0 },
      parts: bodyParts,
    }
    let payload: FakePart
    if (input.attachments?.length) {
      const parts: FakePart[] = [alternative]
      input.attachments.forEach((a, i) => {
        const attachmentId = `att-${id}-${i + 1}`
        attachments.set(`${id}/${attachmentId}`, a.bytes)
        parts.push({
          partId: String(i + 1),
          mimeType: a.mimeType,
          filename: a.filename,
          headers: [
            {
              name: 'Content-Type',
              value: `${a.mimeType}; name="${a.filename}"`,
            },
            {
              name: 'Content-Disposition',
              value: `${
                a.contentId ? 'inline' : 'attachment'
              }; filename="${a.filename}"`,
            },
            ...(a.contentId
              ? [{ name: 'Content-ID', value: `<${a.contentId}>` }]
              : []),
          ],
          body: { size: a.bytes.byteLength, attachmentId },
        })
      })
      payload = {
        partId: '',
        mimeType: 'multipart/mixed',
        filename: '',
        headers,
        body: { size: 0 },
        parts,
      }
    } else {
      payload = { ...alternative, partId: '', headers }
    }
    const message: FakeMessage = {
      id,
      threadId,
      labelIds: [...labelIds],
      snippet: text.slice(0, 120),
      internalDate: String(at),
      historyId: String(historyId + 1),
      sizeEstimate: text.length + html.length + 500,
      payload,
    }
    messages.set(id, message)
    nextHistory({
      messagesAdded: [{
        message: { id, threadId, labelIds: message.labelIds },
      }],
    })
    return message
  }

  function issueCode(
    scope =
      'https://www.googleapis.com/auth/gmail.modify https://www.googleapis.com/auth/gmail.send',
  ): string {
    const code = `4/fake-${crypto.randomUUID()}`
    codes.set(code, { scope, issuedAt: now() })
    return code
  }

  function modify(ids: string[], add: string[], remove: string[]) {
    const labelsAdded: NonNullable<HistoryRecord['labelsAdded']> = []
    const labelsRemoved: NonNullable<HistoryRecord['labelsRemoved']> = []
    for (const id of ids) {
      const m = messages.get(id)
      if (!m) continue
      const added = add.filter((l) => !m.labelIds.includes(l))
      const removed = remove.filter((l) => m.labelIds.includes(l))
      m.labelIds = [...m.labelIds.filter((l) => !removed.includes(l)), ...added]
      if (added.length) {
        labelsAdded.push({
          message: { id, threadId: m.threadId },
          labelIds: added,
        })
      }
      if (removed.length) {
        labelsRemoved.push({
          message: { id, threadId: m.threadId },
          labelIds: removed,
        })
      }
    }
    if (labelsAdded.length || labelsRemoved.length) {
      nextHistory({
        ...(labelsAdded.length ? { labelsAdded } : {}),
        ...(labelsRemoved.length ? { labelsRemoved } : {}),
      })
    }
  }

  function serveMessage(m: FakeMessage, format: string) {
    const { payload, ...rest } = m
    if (format === 'minimal') return rest
    if (format === 'metadata') {
      return {
        ...rest,
        payload: {
          partId: '',
          mimeType: payload.mimeType,
          filename: '',
          headers: payload.headers,
          body: { size: 0 },
        },
      }
    }
    return m
  }

  async function handler(req: Request): Promise<Response> {
    const url = new URL(req.url)
    const path = url.pathname
    const res = await route(req, url, path)
    calls.push({ method: req.method, path, status: res.status })
    return res
  }

  async function route(
    req: Request,
    url: URL,
    path: string,
  ): Promise<Response> {
    // --- ID-token keys (Pub/Sub's authenticated push) ----------------------
    if (path === '/oauth2/v3/certs' && req.method === 'GET') {
      if (!options.signer) return error(404, 'NOT_FOUND')
      return new Response(JSON.stringify(await options.signer.jwks()), {
        headers: {
          'Content-Type': 'application/json',
          'Cache-Control': 'public, max-age=21600',
        },
      })
    }
    // --- OAuth -------------------------------------------------------------
    if (path === '/o/oauth2/v2/auth' && req.method === 'GET') {
      const redirect = url.searchParams.get('redirect_uri') ?? ''
      const state = url.searchParams.get('state') ?? ''
      const scope = url.searchParams.get('scope') ?? ''
      if (url.searchParams.get('client_id') !== clientId) {
        return new Response(`${FAKE_ERROR_MARKER}: invalid client`, {
          status: 400,
        })
      }
      const code = issueCode(scope)
      const target = new URL(redirect)
      target.searchParams.set('code', code)
      target.searchParams.set('state', state)
      const escape = (s: string) =>
        s.replaceAll('&', '&amp;').replaceAll('"', '&quot;').replaceAll(
          '<',
          '&lt;',
        )
      return new Response(
        `<!doctype html><html lang="fr"><head><meta charset="utf-8"><title>Fausse page Google</title>
<style>body{font-family:system-ui;margin:3rem auto;max-width:28rem}button{font-size:1rem;padding:.6rem 1rem}</style></head>
<body><h1>Fausse page de consentement Google</h1><p>Boîte : <strong>${
          escape(emailAddress)
        }</strong></p>
<p>Portées : <code>${escape(scope)}</code></p>
<p><a href="${
          escape(target.toString())
        }"><button type="button">Autoriser</button></a></p></body></html>`,
        {
          status: 200,
          headers: { 'Content-Type': 'text/html; charset=utf-8' },
        },
      )
    }
    if (path === '/token' && req.method === 'POST') {
      const form = new URLSearchParams(await req.text())
      if (
        form.get('client_id') !== clientId ||
        form.get('client_secret') !== clientSecret
      ) {
        return json(401, {
          error: 'invalid_client',
          error_description: FAKE_ERROR_MARKER,
        })
      }
      const grant = form.get('grant_type')
      if (grant === 'authorization_code') {
        const code = form.get('code') ?? ''
        const entry = codes.get(code)
        codes.delete(code)
        if (!entry || now() - entry.issuedAt > 600_000) {
          return json(400, {
            error: 'invalid_grant',
            error_description: FAKE_ERROR_MARKER,
          })
        }
        const refresh = `1//fake-refresh-${crypto.randomUUID()}`
        const access = `ya29.fake-${crypto.randomUUID()}`
        grants.set(refresh, {
          scopes: entry.scope.split(' ').filter(Boolean),
          revoked: false,
        })
        accessTokens.set(access, {
          expiresAt: now() + ACCESS_TOKEN_TTL_S * 1000,
          refresh,
        })
        return json(200, {
          access_token: access,
          refresh_token: refresh,
          expires_in: ACCESS_TOKEN_TTL_S,
          scope: entry.scope,
          token_type: 'Bearer',
        })
      }
      if (grant === 'refresh_token') {
        const refresh = form.get('refresh_token') ?? ''
        const g = grants.get(refresh)
        if (!g || g.revoked) {
          return json(400, {
            error: 'invalid_grant',
            error_description: FAKE_ERROR_MARKER,
          })
        }
        const access = `ya29.fake-${crypto.randomUUID()}`
        accessTokens.set(access, {
          expiresAt: now() + ACCESS_TOKEN_TTL_S * 1000,
          refresh,
        })
        return json(200, {
          access_token: access,
          expires_in: ACCESS_TOKEN_TTL_S,
          scope: g.scopes.join(' '),
          token_type: 'Bearer',
        })
      }
      return json(400, {
        error: 'unsupported_grant_type',
        error_description: FAKE_ERROR_MARKER,
      })
    }
    if (path === '/revoke' && req.method === 'POST') {
      const token = new URLSearchParams(await req.text()).get('token') ?? ''
      const viaAccess = accessTokens.get(token)?.refresh
      const refresh = viaAccess ?? token
      const g = grants.get(refresh)
      if (!g) {
        return json(400, {
          error: 'invalid_token',
          error_description: FAKE_ERROR_MARKER,
        })
      }
      g.revoked = true
      return json(200, {})
    }

    // --- R6: the account and its busy times --------------------------------
    if (path === '/oauth2/v3/userinfo' && req.method === 'GET') {
      if (!bearer(req)) return error(401, 'UNAUTHENTICATED')
      return json(200, {
        sub: accountSub,
        email: emailAddress,
        email_verified: true,
      })
    }
    if (path === '/calendar/v3/freeBusy' && req.method === 'POST') {
      if (!bearer(req)) return error(401, 'UNAUTHENTICATED')
      if (!scopesOf(req).includes(FREEBUSY)) {
        return error(403, 'PERMISSION_DENIED')
      }
      let body: {
        timeMin?: string
        timeMax?: string
        items?: { id?: string }[]
      }
      try {
        body = JSON.parse(await req.text())
      } catch {
        return error(400, 'INVALID_ARGUMENT')
      }
      const from = Date.parse(body.timeMin ?? '')
      const to = Date.parse(body.timeMax ?? '')
      if (Number.isNaN(from) || Number.isNaN(to) || to <= from) {
        return error(400, 'INVALID_ARGUMENT')
      }
      const ids = (body.items ?? []).map((i) => i.id ?? '')
      freeBusyCalls.push({
        timeMin: body.timeMin!,
        timeMax: body.timeMax!,
        ids,
      })
      const calendars: Record<string, unknown> = {}
      for (const id of ids) {
        calendars[id] = id === 'primary' || id === emailAddress
          ? {
            busy: busy.filter((b) =>
              Date.parse(b.end) > from && Date.parse(b.start) < to
            ),
          }
          : { busy: [], errors: [{ domain: 'global', reason: 'notFound' }] }
      }
      return json(200, {
        kind: 'calendar#freeBusy',
        timeMin: body.timeMin,
        timeMax: body.timeMax,
        calendars,
      })
    }

    // --- messages.send (the upload endpoint) -------------------------------
    if (
      path === '/upload/gmail/v1/users/me/messages/send' &&
      req.method === 'POST'
    ) {
      if (!bearer(req)) return error(401, 'UNAUTHENTICATED')
      const refresh = accessTokens.get(
        /^Bearer\s+(\S+)$/.exec(req.headers.get('Authorization') ?? '')?.[1] ??
          '',
      )?.refresh
      const scopes = refresh ? grants.get(refresh)?.scopes ?? [] : []
      if (!scopes.includes('https://www.googleapis.com/auth/gmail.send')) {
        return error(403, 'PERMISSION_DENIED')
      }
      const boundary = /boundary=([^;]+)/.exec(
        req.headers.get('Content-Type') ?? '',
      )?.[1]
      if (url.searchParams.get('uploadType') !== 'multipart' || !boundary) {
        return error(400, 'INVALID_ARGUMENT')
      }
      const parts = (await req.text()).split(`--${boundary}`).slice(1, -1)
        .map((p) => p.replace(/^\r\n/, '').replace(/\r\n$/, ''))
      if (parts.length !== 2) return error(400, 'INVALID_ARGUMENT')
      const body = (part: string) => part.slice(part.indexOf('\r\n\r\n') + 4)
      let meta: { threadId?: string }
      try {
        meta = JSON.parse(body(parts[0]))
      } catch {
        return error(400, 'INVALID_ARGUMENT')
      }
      const raw = body(parts[1])
      const head = raw.slice(0, raw.indexOf('\r\n\r\n')).replace(
        /\r\n[ \t]+/g,
        ' ',
      )
      const field = (name: string) =>
        new RegExp(`^${name}: (.*)$`, 'im').exec(head)?.[1] ?? ''
      const decodeWords = (v: string) =>
        v.replace(
          /=\?UTF-8\?B\?([^?]+)\?=\s*/gi,
          (_a, b64: string) =>
            new TextDecoder().decode(
              Uint8Array.from(atob(b64), (c) => c.charCodeAt(0)),
            ),
        )
      if (!field('To') || !field('From')) return error(400, 'INVALID_ARGUMENT')
      const threadId = meta.threadId &&
          [...messages.values()].some((x) => x.threadId === meta.threadId)
        ? meta.threadId
        : undefined
      const failure = nextSendFailure
      nextSendFailure = null
      if (failure === 'refused') return error(400, 'INVALID_ARGUMENT')
      const message = deliver({
        messageId: field('Message-ID') || undefined,
        from: decodeWords(field('From')),
        to: decodeWords(field('To')),
        subject: decodeWords(field('Subject')),
        text: '(message envoyé depuis l’app)',
        threadId,
        labelIds: ['SENT'],
      })
      sent.push({ threadId: meta.threadId ?? null, raw, id: message.id })
      if (failure === 'after_send') return error(503, 'UNAVAILABLE')
      return json(200, {
        id: message.id,
        threadId: message.threadId,
        labelIds: message.labelIds,
      })
    }

    // --- Gmail API -----------------------------------------------------------
    const api = /^\/gmail\/v1\/users\/me\/(.*)$/.exec(path)
    if (!api) return error(404, 'NOT_FOUND')
    if (!bearer(req)) return error(401, 'UNAUTHENTICATED')
    const rest = api[1]
    if (rest === 'profile' && req.method === 'GET') {
      return json(200, {
        emailAddress,
        messagesTotal: messages.size,
        threadsTotal: messages.size,
        historyId: String(historyId),
      })
    }
    if (rest === 'labels' && req.method === 'GET') return json(200, { labels })
    if (rest === 'messages' && req.method === 'GET') {
      const max = Math.min(
        Number(url.searchParams.get('maxResults') ?? 100),
        500,
      )
      const q = url.searchParams.get('q') ?? ''
      const newer = /newer_than:(\d+)d/.exec(q)
      const since = newer ? now() - Number(newer[1]) * 86_400_000 : 0
      const msgid = /rfc822msgid:<?([^<>\s]+)>?/.exec(q)?.[1]
      const labelIds = url.searchParams.getAll('labelIds')
      let all = [...messages.values()].filter((m) =>
        Number(m.internalDate) >= since
      )
        .filter((m) =>
          !msgid ||
          m.payload.headers.some((h) =>
            h.name === 'Message-ID' && h.value === `<${msgid}>`
          )
        )
        .filter((m) => labelIds.every((l) => m.labelIds.includes(l)))
        .sort((a, b) => Number(b.internalDate) - Number(a.internalDate))
      const start = Number(url.searchParams.get('pageToken') ?? 0)
      if (!Number.isInteger(start) || start < 0) {
        return error(400, 'INVALID_ARGUMENT')
      }
      const page = all.slice(start, start + max)
      all = []
      return json(200, {
        messages: page.map((m) => ({ id: m.id, threadId: m.threadId })),
        ...(start + max < messages.size && page.length === max
          ? { nextPageToken: String(start + max) }
          : {}),
        resultSizeEstimate: page.length,
      })
    }
    if (rest === 'messages/batchModify' && req.method === 'POST') {
      const body = await req.json() as {
        ids?: string[]
        addLabelIds?: string[]
        removeLabelIds?: string[]
      }
      if (!Array.isArray(body.ids) || body.ids.length > 1000) {
        return error(400, 'INVALID_ARGUMENT')
      }
      modify(body.ids, body.addLabelIds ?? [], body.removeLabelIds ?? [])
      return new Response(null, { status: 204 })
    }
    let m = /^messages\/([^/]+)\/attachments\/([^/]+)$/.exec(rest)
    if (m && req.method === 'GET') {
      const bytes = attachments.get(
        `${decodeURIComponent(m[1])}/${decodeURIComponent(m[2])}`,
      )
      if (!bytes || !messages.has(decodeURIComponent(m[1]))) {
        return error(404, 'NOT_FOUND')
      }
      return json(200, { size: bytes.byteLength, data: b64url(bytes) })
    }
    m = /^messages\/([^/]+)\/modify$/.exec(rest)
    if (m && req.method === 'POST') {
      const id = decodeURIComponent(m[1])
      if (!messages.has(id)) return error(404, 'NOT_FOUND')
      const body = await req.json() as {
        addLabelIds?: string[]
        removeLabelIds?: string[]
      }
      modify([id], body.addLabelIds ?? [], body.removeLabelIds ?? [])
      return json(200, serveMessage(messages.get(id)!, 'minimal'))
    }
    m = /^messages\/([^/]+)$/.exec(rest)
    if (m && req.method === 'GET') {
      const message = messages.get(decodeURIComponent(m[1]))
      if (!message) return error(404, 'NOT_FOUND')
      return json(
        200,
        serveMessage(message, url.searchParams.get('format') ?? 'full'),
      )
    }
    m = /^threads\/([^/]+)\/modify$/.exec(rest)
    if (m && req.method === 'POST') {
      const threadId = decodeURIComponent(m[1])
      const ids = [...messages.values()].filter((x) => x.threadId === threadId)
        .map((x) => x.id)
      if (ids.length === 0) return error(404, 'NOT_FOUND')
      const body = await req.json() as {
        addLabelIds?: string[]
        removeLabelIds?: string[]
      }
      modify(ids, body.addLabelIds ?? [], body.removeLabelIds ?? [])
      return json(200, { id: threadId, historyId: String(historyId) })
    }
    if (rest === 'history' && req.method === 'GET') {
      const start = url.searchParams.get('startHistoryId') ?? ''
      if (!/^\d+$/.test(start)) return error(400, 'INVALID_ARGUMENT')
      const startN = BigInt(start)
      const oldest = history[0] ? BigInt(history[0].id) : BigInt(historyId) + 1n
      if (startN < oldest - 1n) return error(404, 'NOT_FOUND')
      const max = Math.min(
        Number(url.searchParams.get('maxResults') ?? 100),
        500,
      )
      const after = history.filter((r) => BigInt(r.id) > startN)
      const offset = Number(url.searchParams.get('pageToken') ?? 0)
      const page = after.slice(offset, offset + max)
      return json(200, {
        history: page,
        historyId: String(historyId),
        ...(offset + max < after.length
          ? { nextPageToken: String(offset + max) }
          : {}),
      })
    }
    if (rest === 'watch' && req.method === 'POST') {
      const body = await req.json() as { topicName?: string }
      if (
        !body.topicName ||
        !/^projects\/[^/]+\/topics\/[^/]+$/.test(body.topicName)
      ) return error(400, 'INVALID_ARGUMENT')
      watch = {
        topicName: body.topicName,
        expiration: String(now() + 7 * 86_400_000),
      }
      return json(200, {
        historyId: String(historyId),
        expiration: watch.expiration,
      })
    }
    if (rest === 'stop' && req.method === 'POST') {
      watch = null
      return new Response(null, { status: 204 })
    }
    return error(404, 'NOT_FOUND')
  }

  const fake: FakeGmail = {
    fetch:
      ((input: RequestInfo | URL, init?: RequestInit) =>
        handler(new Request(input, init))) as typeof fetch,
    handler,
    calls,
    messages,
    get labels() {
      return labels
    },
    set labels(value: FakeLabel[]) {
      labels = value
    },
    get historyId() {
      return String(historyId)
    },
    history,
    get watch() {
      return watch
    },
    grants,
    tokens: accessTokens,
    sent,
    busy,
    freeBusyCalls,
    deliver,
    issueCode,
    failNextSend(mode) {
      nextSendFailure = mode
    },
    reset() {
      messages.clear()
      attachments.clear()
      history.length = 0
      sent.length = 0
      calls.length = 0
      watch = null
      counter = 1
      nextSendFailure = null
      busy.length = 0
      freeBusyCalls.length = 0
    },
  }
  return fake
}

function defaultLabels(): FakeLabel[] {
  return [
    { id: 'INBOX', name: 'INBOX', type: 'system' },
    { id: 'SENT', name: 'SENT', type: 'system' },
    { id: 'UNREAD', name: 'UNREAD', type: 'system' },
    { id: 'STARRED', name: 'STARRED', type: 'system' },
    { id: 'TRASH', name: 'TRASH', type: 'system' },
    { id: 'SPAM', name: 'SPAM', type: 'system' },
    { id: 'CATEGORY_PERSONAL', name: 'CATEGORY_PERSONAL', type: 'system' },
    {
      id: 'Label_1',
      name: 'Clients',
      type: 'user',
      labelListVisibility: 'labelShow',
      color: { backgroundColor: '#16a765', textColor: '#ffffff' },
    },
    {
      id: 'Label_2',
      name: 'Paiements',
      type: 'user',
      labelListVisibility: 'labelShow',
    },
  ]
}

/** A few French messages for local use (fictional people). */
export function seedMailbox(
  fake: FakeGmail,
  mailbox = 'info@clinique.test',
): void {
  const day = 86_400_000
  const base = Date.now()
  const pdf = new TextEncoder().encode(
    '%PDF-1.4\n1 0 obj << >> endobj\ntrailer << >>\n%%EOF\n',
  )
  const first = fake.deliver({
    from: 'Amélie Tremblay <amelie.tremblay@example.test>',
    to: mailbox,
    subject: 'Demande de rendez-vous pour mon fils',
    text:
      'Bonjour,\n\nJe cherche un psychologue pour mon fils de 14 ans, idéalement en soirée.\n\nMerci,\nAmélie',
    at: base - 3 * day,
    labelIds: ['INBOX', 'CATEGORY_PERSONAL'],
  })
  fake.deliver({
    from: `Clinique MANA <${mailbox}>`,
    to: 'amelie.tremblay@example.test',
    subject: 'Re: Demande de rendez-vous pour mon fils',
    text:
      'Bonjour Amélie,\n\nAvec plaisir. Une conseillère vous rappellera demain matin.\n\nClinique MANA',
    threadId: first.threadId,
    at: base - 3 * day + 3_600_000,
    labelIds: ['SENT', 'CATEGORY_PERSONAL'],
  })
  fake.deliver({
    from: 'Marc-Antoine Côté <macote@example.test>',
    to: mailbox,
    subject: 'Attestation pour mes assurances',
    text:
      'Bonjour, pourriez-vous m’envoyer une attestation de mes séances de septembre ? Le formulaire est joint. Merci.',
    at: base - 2 * day,
    attachments: [{
      filename: 'formulaire-assurance.pdf',
      mimeType: 'application/pdf',
      bytes: pdf,
    }],
  })
  fake.deliver({
    from: 'Avis Interac <notify@payments.interac.test>',
    to: mailbox,
    subject: 'Virement INTERAC : vous avez reçu 120,00 $ de Julie Bélanger',
    text: 'Vous avez reçu un virement de 120,00 $. Le dépôt est automatique.',
    at: base - day,
    labelIds: ['INBOX', 'UNREAD', 'Label_2'],
  })
  fake.deliver({
    from: 'Jonathan Roy <jroy@example.test>',
    to: mailbox,
    subject: 'Annulation de mon rendez-vous de jeudi',
    text:
      'Bonjour, je dois annuler mon rendez-vous de jeudi 14 h. Est-il possible de le reporter à la semaine prochaine ?',
    at: base - 3_600_000,
  })
}
