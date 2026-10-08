#!/usr/bin/env node
// A local, in-memory Documenso v2 for development (Task 3.32, P3-23). No
// dependency; nothing is written to disk; every restart starts empty.
//
//   npm run fake:documenso
//
// It serves the paths of DOCUMENSO_PATHS in supabase/functions/_shared/documenso.ts
// with the behaviour of supabase/functions/_shared/testing/fake-documenso.ts
// (keep the three in step):
// - `Authorization: local-dev-documenso-key` (no `Bearer`), else 401;
// - ids are deterministic: documents 1, 2, …; recipients 101, 102, …;
//   timestamps tick one second per change from 2026-01-01T12:00:00Z;
// - fields only on a draft; distribute needs a SIGNATURE field per signer and
//   is a no-op on a pending document;
// - delete: a draft disappears; a pending or rejected document becomes
//   CANCELLED (a pending one posts DOCUMENT_CANCELLED, as Documenso does); a
//   cancelled one answers 404, a completed one 400;
// - the signed download is the uploaded PDF plus a trailing comment.
//
// Admin routes (no key; each posts the webhook and answers its outcome):
//   POST /__fake/open/:id[?recipient=101]      DOCUMENT_OPENED
//   POST /__fake/sign/:id[?recipient=101]      DOCUMENT_SIGNED (stays pending)
//   POST /__fake/complete/:id                  DOCUMENT_COMPLETED
//   POST /__fake/reject/:id[?recipient=&reason=]  DOCUMENT_REJECTED
//   GET  /__fake/documents                     ids, titles, statuses (no address)
//
// Webhooks go to FAKE_DOCUMENSO_WEBHOOK_URL (default: the local
// signing-webhook for the seed org) with
// `X-Documenso-Secret: local-dev-documenso-webhook-secret`. The server listens
// on 127.0.0.1:55390 (FAKE_DOCUMENSO_HOST / FAKE_DOCUMENSO_PORT); the functions
// container reaches it as http://host.docker.internal:55390. Logs carry the
// method, the path and the status only: never a key or an address.

import { createServer } from 'node:http'

const API_KEY = 'local-dev-documenso-key'
const WEBHOOK_SECRET = 'local-dev-documenso-webhook-secret'
const SEED_ORG_ID = '00000000-0000-0000-0000-000000000001'
const WEBHOOK_URL = process.env.FAKE_DOCUMENSO_WEBHOOK_URL ||
  `http://127.0.0.1:55321/functions/v1/signing-webhook?org=${SEED_ORG_ID}`
const HOST = process.env.FAKE_DOCUMENSO_HOST || '127.0.0.1'
const PORT = Number(process.env.FAKE_DOCUMENSO_PORT || 55390)
const START = Date.parse('2026-01-01T12:00:00.000Z')
const WEBHOOK_TIMEOUT_MS = 10_000

/** @type {Map<string, any>} */
const documents = new Map()
let nextDocument = 1
let nextRecipient = 101
let ticks = 0
const tick = () => new Date(START + 1000 * ticks++).toISOString()

const json = (status, body) =>
  new Response(JSON.stringify(body), {
    status,
    headers: { 'Content-Type': 'application/json' },
  })
const failure = (status, message) =>
  json(status, { message, code: status === 401 ? 'UNAUTHORIZED' : 'ERROR' })
const inPercent = (v, min) => typeof v === 'number' && v >= min && v <= 100

function documentJson(doc) {
  return {
    id: Number(doc.id),
    envelopeId: `envelope_${doc.id}`,
    externalId: doc.externalId,
    title: doc.title,
    status: doc.status,
    createdAt: doc.createdAt,
    updatedAt: doc.updatedAt,
    completedAt: doc.completedAt,
    documentMeta: doc.meta,
    recipients: doc.recipients.map((r) => ({
      ...r,
      id: Number(r.id),
      documentId: Number(doc.id),
    })),
    fields: doc.fields.map((f) => ({
      recipientId: Number(f.recipientId),
      type: f.type,
      page: f.page,
      positionX: f.x,
      positionY: f.y,
      width: f.width,
      height: f.height,
    })),
  }
}

async function body(req) {
  try {
    const value = await req.json()
    return value !== null && typeof value === 'object' ? value : {}
  } catch {
    return {}
  }
}

const find = (id) => documents.get(String(id))

// ---------------------------------------------------------------------------
// Webhooks
// ---------------------------------------------------------------------------

/** Posts `event` for `doc`; answers the delivery outcome (never throws). */
async function emit(event, doc) {
  const { fields: _fields, ...payload } = documentJson(doc)
  try {
    const res = await fetch(WEBHOOK_URL, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'X-Documenso-Secret': WEBHOOK_SECRET,
      },
      body: JSON.stringify({
        event,
        payload,
        createdAt: tick(),
        webhookEndpoint: WEBHOOK_URL,
      }),
      signal: AbortSignal.timeout(WEBHOOK_TIMEOUT_MS),
    })
    await res.body?.cancel()
    console.log(`[fake-documenso] webhook ${event} ${doc.id} → ${res.status}`)
    return { event, documentId: doc.id, webhookStatus: res.status }
  } catch (error) {
    console.log(`[fake-documenso] webhook ${event} ${doc.id} → unreachable`)
    return { event, documentId: doc.id, webhookError: error?.name ?? 'Error' }
  }
}

// ---------------------------------------------------------------------------
// API
// ---------------------------------------------------------------------------

async function create(req) {
  let form
  try {
    form = await req.formData()
  } catch {
    return failure(400, 'Expected multipart/form-data')
  }
  const file = form.get('file')
  let payload
  try {
    payload = JSON.parse(String(form.get('payload')))
  } catch {
    return failure(400, 'Invalid payload')
  }
  const recipients = Array.isArray(payload?.recipients) ? payload.recipients : []
  if (!(file instanceof Blob) || typeof payload?.title !== 'string') {
    return failure(400, 'Missing file or title')
  }
  const pdf = new Uint8Array(await file.arrayBuffer())
  if (new TextDecoder().decode(pdf.subarray(0, 5)) !== '%PDF-') {
    return failure(400, 'The file is not a PDF')
  }
  const id = String(nextDocument++)
  const at = tick()
  documents.set(id, {
    id,
    externalId: typeof payload.externalId === 'string' ? payload.externalId : null,
    title: payload.title,
    status: 'DRAFT',
    createdAt: at,
    updatedAt: at,
    completedAt: null,
    meta: payload.meta ?? {},
    pdf,
    recipients: recipients.map((r, i) => ({
      id: String(nextRecipient++),
      email: String(r.email),
      name: String(r.name),
      role: String(r.role ?? 'SIGNER'),
      signingOrder: Number(r.signingOrder ?? i + 1),
      readStatus: 'NOT_OPENED',
      signingStatus: 'NOT_SIGNED',
      sendStatus: 'NOT_SENT',
      signedAt: null,
      rejectionReason: null,
    })),
    fields: [],
  })
  return json(200, { id: Number(id), envelopeId: `envelope_${id}` })
}

async function addFields(req) {
  const input = await body(req)
  const doc = find(input.documentId)
  if (!doc) return failure(404, 'Document not found')
  if (doc.status !== 'DRAFT') return failure(400, 'Document is not a draft')
  const fields = Array.isArray(input.fields) ? input.fields : []
  const valid = fields.every((f) =>
    doc.recipients.some((r) => r.id === String(f.recipientId)) &&
    Number.isInteger(f.pageNumber) && f.pageNumber >= 1 &&
    inPercent(f.pageX, 0) && inPercent(f.pageY, 0) &&
    inPercent(f.width, 1) && inPercent(f.height, 1)
  )
  if (!valid || fields.length === 0) return failure(400, 'Invalid fields')
  for (const f of fields) {
    doc.fields.push({
      recipientId: String(f.recipientId),
      type: String(f.type),
      page: f.pageNumber,
      x: f.pageX,
      y: f.pageY,
      width: f.width,
      height: f.height,
    })
  }
  doc.updatedAt = tick()
  return json(200, { fields: documentJson(doc).fields })
}

async function distribute(req) {
  const doc = find((await body(req)).documentId)
  if (!doc) return failure(404, 'Document not found')
  if (doc.status === 'PENDING') return json(200, documentJson(doc))
  if (doc.status !== 'DRAFT') return failure(400, 'Document is not a draft')
  const unsigned = doc.recipients.some((r) =>
    r.role === 'SIGNER' &&
    !doc.fields.some((f) => f.recipientId === r.id && f.type === 'SIGNATURE')
  )
  if (unsigned) return failure(400, 'Signers need a signature field')
  doc.status = 'PENDING'
  for (const r of doc.recipients) r.sendStatus = 'SENT'
  doc.updatedAt = tick()
  return json(200, documentJson(doc))
}

async function redistribute(req) {
  const input = await body(req)
  const doc = find(input.documentId)
  if (!doc) return failure(404, 'Document not found')
  const ids = Array.isArray(input.recipients) ? input.recipients : []
  if (
    doc.status !== 'PENDING' || ids.length === 0 ||
    !ids.every((id) => doc.recipients.some((r) => r.id === String(id)))
  ) {
    return failure(400, 'Cannot redistribute')
  }
  return json(200, { success: true })
}

async function cancel(req) {
  const doc = find((await body(req)).documentId)
  if (!doc || doc.status === 'CANCELLED') return failure(404, 'Document not found')
  if (doc.status === 'COMPLETED') {
    return failure(400, 'A completed document cannot be deleted')
  }
  if (doc.status === 'DRAFT') {
    documents.delete(doc.id)
    return json(200, { success: true })
  }
  const wasPending = doc.status === 'PENDING'
  doc.status = 'CANCELLED'
  doc.updatedAt = tick()
  // Documenso fires the webhook after answering.
  if (wasPending) setTimeout(() => emit('DOCUMENT_CANCELLED', doc), 0)
  return json(200, { success: true })
}

function download(id, url) {
  const doc = find(id)
  if (!doc) return failure(404, 'Document not found')
  const headers = { 'Content-Type': 'application/pdf' }
  if (url.searchParams.get('version') === 'original') {
    return new Response(doc.pdf, { headers })
  }
  if (doc.status !== 'COMPLETED') return failure(400, 'Document is not completed')
  const suffix = new TextEncoder().encode(`\n% fake-documenso: signed ${doc.id}\n`)
  const signed = new Uint8Array(doc.pdf.length + suffix.length)
  signed.set(doc.pdf)
  signed.set(suffix, doc.pdf.length)
  return new Response(signed, { headers })
}

function list(url) {
  const perPage = Math.max(1, Number(url.searchParams.get('perPage')) || 10)
  const all = [...documents.values()]
  return json(200, {
    data: all.slice(0, perPage).map(documentJson),
    count: all.length,
    currentPage: 1,
    perPage,
    totalPages: Math.max(1, Math.ceil(all.length / perPage)),
  })
}

async function api(req, url) {
  if (req.headers.get('Authorization') !== API_KEY) {
    return failure(401, 'Unauthorized')
  }
  const path = url.pathname
  if (req.method === 'POST') {
    switch (path) {
      case '/api/v2/document/create':
        return await create(req)
      case '/api/v2/document/field/create-many':
        return await addFields(req)
      case '/api/v2/document/distribute':
        return await distribute(req)
      case '/api/v2/document/redistribute':
        return await redistribute(req)
      case '/api/v2/document/delete':
        return await cancel(req)
    }
  }
  if (req.method === 'GET') {
    if (path === '/api/v2/document') return list(url)
    const dl = /^\/api\/v2\/document\/(\d+)\/download$/.exec(path)
    if (dl) return download(dl[1], url)
    const read = /^\/api\/v2\/document\/(\d+)$/.exec(path)
    if (read) {
      const doc = find(read[1])
      return doc ? json(200, documentJson(doc)) : failure(404, 'Not found')
    }
  }
  return failure(404, 'Not found')
}

// ---------------------------------------------------------------------------
// Admin routes
// ---------------------------------------------------------------------------

function recipientOf(doc, recipientId, pick) {
  const ordered = [...doc.recipients].sort((a, b) => a.signingOrder - b.signingOrder)
  return recipientId ? doc.recipients.find((r) => r.id === recipientId) : ordered.find(pick)
}

async function admin(req, url) {
  if (req.method === 'GET' && url.pathname === '/__fake/documents') {
    return json(200, [...documents.values()].map((d) => ({
      id: d.id,
      externalId: d.externalId,
      title: d.title,
      status: d.status,
      recipients: d.recipients.map((r) => ({
        id: r.id,
        signingOrder: r.signingOrder,
        readStatus: r.readStatus,
        signingStatus: r.signingStatus,
      })),
    })))
  }
  const match = /^\/__fake\/(open|sign|complete|reject)\/(\d+)$/.exec(url.pathname)
  if (req.method !== 'POST' || !match) return failure(404, 'Not found')
  const [, action, id] = match
  const doc = find(id)
  if (!doc) return failure(404, 'Document not found')
  if (doc.status !== 'PENDING') return failure(400, `Document is ${doc.status}`)
  const recipientId = url.searchParams.get('recipient')
  const at = tick()
  switch (action) {
    case 'open': {
      const r = recipientOf(doc, recipientId, (r) => r.readStatus === 'NOT_OPENED')
      if (!r) return failure(400, 'No such recipient')
      r.readStatus = 'OPENED'
      doc.updatedAt = at
      return json(200, await emit('DOCUMENT_OPENED', doc))
    }
    case 'sign': {
      const r = recipientOf(doc, recipientId, (r) => r.signingStatus === 'NOT_SIGNED')
      if (!r) return failure(400, 'No such recipient')
      Object.assign(r, { readStatus: 'OPENED', signingStatus: 'SIGNED', signedAt: at })
      doc.updatedAt = at
      return json(200, await emit('DOCUMENT_SIGNED', doc))
    }
    case 'complete': {
      for (const r of doc.recipients) {
        if (r.signingStatus !== 'SIGNED') {
          Object.assign(r, { readStatus: 'OPENED', signingStatus: 'SIGNED', signedAt: at })
        }
      }
      Object.assign(doc, { status: 'COMPLETED', completedAt: at, updatedAt: at })
      return json(200, await emit('DOCUMENT_COMPLETED', doc))
    }
    case 'reject': {
      const r = recipientOf(doc, recipientId, (r) => r.signingStatus === 'NOT_SIGNED')
      if (!r) return failure(400, 'No such recipient')
      Object.assign(r, {
        readStatus: 'OPENED',
        signingStatus: 'REJECTED',
        rejectionReason: url.searchParams.get('reason') || 'Je ne signe pas ce document.',
      })
      Object.assign(doc, { status: 'REJECTED', updatedAt: at })
      return json(200, await emit('DOCUMENT_REJECTED', doc))
    }
  }
}

// ---------------------------------------------------------------------------
// Server
// ---------------------------------------------------------------------------

/** Reads a Node request into a web Request. */
async function toRequest(nodeReq) {
  const chunks = []
  for await (const chunk of nodeReq) chunks.push(chunk)
  const headers = new Headers()
  for (const [name, value] of Object.entries(nodeReq.headers)) {
    for (const v of [value].flat()) if (v !== undefined) headers.append(name, v)
  }
  const hasBody = !['GET', 'HEAD'].includes(nodeReq.method)
  return new Request(`http://${HOST}:${PORT}${nodeReq.url}`, {
    method: nodeReq.method,
    headers,
    body: hasBody ? Buffer.concat(chunks) : undefined,
  })
}

const server = createServer(async (nodeReq, nodeRes) => {
  let res
  let path = '?'
  try {
    const req = await toRequest(nodeReq)
    const url = new URL(req.url)
    path = url.pathname
    res = url.pathname.startsWith('/__fake/')
      ? await admin(req, url)
      : await api(req, url)
  } catch (error) {
    console.error('[fake-documenso] handler error', error?.name ?? 'Error')
    res = failure(500, 'Internal error')
  }
  console.log(`[fake-documenso] ${nodeReq.method} ${path} ${res.status}`)
  nodeRes.writeHead(res.status, Object.fromEntries(res.headers))
  nodeRes.end(Buffer.from(await res.arrayBuffer()))
})

server.listen(PORT, HOST, () => {
  console.log(`[fake-documenso] listening on http://${HOST}:${PORT}`)
  console.log(`[fake-documenso] webhooks → ${new URL(WEBHOOK_URL).origin}${new URL(WEBHOOK_URL).pathname}`)
})
