/**
 * An in-memory signing database for the signing function tests: the RPCs of
 * `core_signing` (Task 3.31), `core_signing_function_support`,
 * `core_signing_envelope` (keyed by envelope id, plan E-1…E-3), the system
 * files of `core_storage`, the webhook claims of Task 3.2 and the rate
 * limiter, as `fakeSupabase` routes. It follows the SQL closely enough for
 * the functions' flows (idempotency, drafts, monotonic events, completion
 * protection, staged files); the SQL itself is tested by pgTAP. Test-only:
 * never deployed.
 */
import type { RpcRoute, StorageRoute } from './fake-supabase.ts'

const TEST_PURPOSE = 'core.signing_test'
const DAY_MS = 86_400_000

/** A signer row (its address stays here, as in the database). */
export interface FakeSigner {
  id: string
  role: string
  name: string
  email: string
  order: number
  recipient_id: string | null
  status: 'pending' | 'viewed' | 'signed' | 'rejected'
}

/** A `signature_requests` row with its signers. */
export interface FakeSignatureRequest {
  id: string
  org_id: string
  module_key: string
  purpose: string
  subject_type: string
  subject_id: string
  title: string
  status: string
  view_permission: string
  idempotency_key: string
  envelope_id: string | null
  source_file_id: string | null
  /** N, the sent document's pages (`mark_signature_request_sent`'s `p_page_count`). */
  page_count: number | null
  signed_file_id: string | null
  signed_sha256: string | null
  last_error: string | null
  rejection_reason: string | null
  sent_by: string | null
  created_at: string
  sent_at: string | null
  expires_at: string | null
  completed_event_at: string | null
  completed_at: string | null
  expired_at: string | null
  /** `begin_signature_request_send`'s claim. */
  send_started_at: string | null
  /** When the latest claim started; never cleared (the reconcile's clock for drafts). */
  last_send_at: string | null
  /** Earlier envelopes a re-send replaced (the latest 20). */
  superseded_envelope_ids: string[]
  signers: FakeSigner[]
}

/** A `stored_files` row (system files only). */
export interface FakeStoredFile {
  id: string
  org_id: string
  bucket: string
  object_path: string
  purpose: string
  subject_id: string
  view_permission: string | null
  sha256: string
  size_bytes: number
  /** `register_system_file`'s `p_original_name`. */
  original_name: string
  status: 'ready' | 'deleted'
  retain_until: string | null
  created_at: string
}

/** A `webhook_events` row. */
export interface FakeWebhookEvent {
  id: string
  event_id: string
  org_id: string
  status: 'claimed' | 'completed' | 'failed'
  token: string
  payload: Record<string, unknown>
  error: string | null
}

/** A `signature_request_syncs` row (`record_signature_sync`). */
export interface FakeSync {
  attempted_at: string
  synced_at: string | null
  error_code: string | null
  failing_since: string | null
  /** `{code: last report}`. */
  reported: Record<string, string>
}

/** Options; the defaults are the local seed's (fake Documenso, 7 days). */
export interface FakeSigningDbOptions {
  orgId: string
  now: () => Date
  baseUrl?: string | null
  apiKey?: string | null
  webhookSecret?: string | null
  expiryDays?: number
  /** Modules enabled for the org (`core` always). */
  modules?: string[]
  /** `get_signing_context().version` for a template version id. */
  versions?: Record<string, Record<string, unknown>>
  logo?: { file_id: string; bucket: string; object_path: string } | null
  signature?: { file_id: string; bucket: string; object_path: string } | null
}

/** The fake: its routes and its state. */
export interface FakeSigningDb {
  rpc: Record<string, RpcRoute>
  storage: Record<string, StorageRoute>
  requests: Map<string, FakeSignatureRequest>
  files: Map<string, FakeStoredFile>
  events: Map<string, FakeWebhookEvent>
  /** The reconcile's state per request id (`record_signature_sync`). */
  syncs: Map<string, FakeSync>
  /** Uploaded objects by `bucket/path`. */
  objects: Map<string, Uint8Array>
  /** Inserts a request directly (as a test fixture). */
  insertRequest(
    row: Partial<FakeSignatureRequest> & { id: string },
  ): FakeSignatureRequest
  /** Inserts a system file directly (as a test fixture). */
  insertFile(row: Partial<FakeStoredFile> & { id: string }): FakeStoredFile
}

const P0001 = (message: string) => ({ error: { code: 'P0001', message } })
/** `private.signing_superseded`. */
const supersede = (ids: string[], old: string | null, next: unknown) =>
  old === null || next == null || old === next || ids.includes(old)
    ? ids
    : [...ids, old].slice(-20)
/** `'600 seconds'` (what the functions send) in ms. */
const intervalMs = (value: unknown) => {
  const match = /^(\d+) seconds$/.exec(String(value))
  if (!match) throw new Error(`fake: unsupported interval ${value}`)
  return Number(match[1]) * 1000
}
const E22023 = { error: { code: '22023', message: 'Invalid' } }
/** The envelope id check of `signature_requests.envelope_id` and the RPCs. */
const ENVELOPE_ID = /^envelope_[A-Za-z0-9_-]{1,64}$/
const envelopeArg = (value: unknown) =>
  typeof value === 'string' && ENVELOPE_ID.test(value) ? value : null
/** `signature_requests_org_id_envelope_id_key`'s violation. */
const E23505 = {
  error: {
    code: '23505',
    message: 'duplicate key value violates unique constraint',
  },
}

/** Builds the fake for one org (another org id finds nothing). */
export function fakeSigningDb(options: FakeSigningDbOptions): FakeSigningDb {
  const { orgId, now } = options
  const iso = () => now().toISOString()
  const requests = new Map<string, FakeSignatureRequest>()
  const files = new Map<string, FakeStoredFile>()
  const events = new Map<string, FakeWebhookEvent>()
  const syncs = new Map<string, FakeSync>()
  const objects = new Map<string, Uint8Array>()
  const modules = new Set(['core', ...(options.modules ?? [])])
  let sequence = 0
  const uuid = (prefix: string) =>
    `${prefix}-0000-4000-8000-${String(++sequence).padStart(12, '0')}`

  /** Another request of `r`'s org already holds `envelopeId` (one envelope per org). */
  const envelopeTaken = (r: FakeSignatureRequest, envelopeId: string | null) =>
    envelopeId !== null &&
    [...requests.values()].some((o) =>
      o.id !== r.id && o.org_id === r.org_id && o.envelope_id === envelopeId
    )

  const open = (r: FakeSignatureRequest) =>
    ['sent', 'viewed'].includes(r.status) ||
    (r.status === 'draft' && r.last_error !== 'abandoned')

  const signersJson = (r: FakeSignatureRequest) =>
    [...r.signers].sort((a, b) => a.order - b.order)
      .map((s) => ({ role: s.role, signer_id: s.id }))

  function insertRequest(
    row: Partial<FakeSignatureRequest> & { id: string },
  ): FakeSignatureRequest {
    const full: FakeSignatureRequest = {
      org_id: orgId,
      module_key: 'core',
      purpose: TEST_PURPOSE,
      subject_type: 'signing_test',
      subject_id: '00000000-0000-4000-8000-0000000000a1',
      title: 'Document test',
      status: 'draft',
      view_permission: 'settings.integrations_manage',
      idempotency_key: `key-${row.id}`,
      envelope_id: null,
      source_file_id: null,
      page_count: null,
      signed_file_id: null,
      signed_sha256: null,
      last_error: null,
      rejection_reason: null,
      sent_by: null,
      created_at: iso(),
      sent_at: null,
      expires_at: null,
      completed_event_at: null,
      completed_at: null,
      expired_at: null,
      send_started_at: null,
      last_send_at: null,
      superseded_envelope_ids: [],
      signers: [],
      ...row,
    }
    requests.set(full.id, full)
    return full
  }

  function insertFile(
    row: Partial<FakeStoredFile> & { id: string },
  ): FakeStoredFile {
    const full: FakeStoredFile = {
      org_id: orgId,
      bucket: 'documents',
      object_path: `${orgId}/core/${row.subject_id ?? row.id}/${row.id}.pdf`,
      purpose: 'signing_source',
      subject_id: row.id,
      view_permission: 'settings.integrations_manage',
      sha256: 'c'.repeat(64),
      size_bytes: 1000,
      original_name: 'Document.pdf',
      status: 'ready',
      retain_until: new Date(now().getTime() + DAY_MS).toISOString(),
      created_at: iso(),
      ...row,
    }
    files.set(full.id, full)
    return full
  }

  /** The row for `p_request_id` in the org, never by document id (apply_signing_event). */
  function findForEvent(org: string, id: string): FakeSignatureRequest | null {
    const row = requests.get(id) ?? null
    return row && row.org_id === org ? row : null
  }

  const stagedSourceOf = (r: FakeSignatureRequest) =>
    r.status !== 'draft' ? null : [...files.values()]
      .filter((f) =>
        f.org_id === r.org_id && f.subject_id === r.id &&
        f.purpose === 'signing_source' && f.status === 'ready' &&
        f.view_permission === r.view_permission && f.retain_until !== null &&
        f.retain_until > iso()
      )
      .sort((a, b) => b.created_at.localeCompare(a.created_at))[0]?.id ?? null

  const rpc: Record<string, RpcRoute> = {
    get_signing_context: (a) => {
      if (a.p_org_id !== orgId) return E22023
      const version = a.p_template_version_id === null
        ? null
        : options.versions?.[String(a.p_template_version_id)]
      if (version === undefined) return E22023
      const moduleKey = (version?.module_key as string | undefined) ?? 'core'
      return {
        data: {
          module_key: moduleKey,
          module_enabled: modules.has(moduleKey),
          timezone: 'America/Toronto',
          settings: {
            base_url: options.baseUrl === undefined
              ? 'http://host.docker.internal:55390'
              : options.baseUrl,
            expiry_days: options.expiryDays ?? 7,
          },
          version,
          clinic: {
            name: 'Clinique MANA (local)',
            signatory_name: 'Christine Tremblay',
            signatory_email: 'direction@mana.test',
          },
          logo: options.logo ?? null,
          signature: options.signature ?? null,
        },
      }
    },
    get_signing_credentials: (a) => {
      if (a.p_org_id !== orgId) return { data: [] }
      return {
        data: [{
          base_url: options.baseUrl === undefined
            ? 'http://host.docker.internal:55390'
            : options.baseUrl,
          api_key: options.apiKey === undefined
            ? 'local-dev-documenso-key'
            : options.apiKey,
          expiry_days: options.expiryDays ?? 7,
        }],
      }
    },
    get_org_secret: (a) => {
      if (a.p_org_id !== orgId) return { data: null }
      const value = a.p_key === 'documenso_api_key'
        ? options.apiKey === undefined
          ? 'local-dev-documenso-key'
          : options.apiKey
        : a.p_key === 'documenso_webhook_secret'
        ? options.webhookSecret === undefined
          ? 'local-dev-documenso-webhook-secret'
          : options.webhookSecret
        : null
      return { data: value }
    },
    create_signature_request: ({ p }) => {
      const input = p as Record<string, unknown>
      if (input.org_id !== orgId) return E22023
      if (!modules.has(String(input.module_key))) return E22023
      const signers = input.signers as {
        role: string
        name: string
        email: string
        order: number
      }[]
      const emails = signers.map((s) => s.email.trim().toLowerCase())
      if (new Set(emails).size !== emails.length) {
        return P0001('Chaque signataire doit avoir sa propre adresse courriel.')
      }
      let row = [...requests.values()].find((r) =>
        r.org_id === orgId && r.idempotency_key === input.idempotency_key
      )
      const existing = row !== undefined
      const key = (
        x: { role: string; order: number; name: string; email: string },
      ) =>
        [x.role, x.order, x.name.trim(), x.email.trim().toLowerCase()].join('|')
      if (
        row &&
        [...signers.map(key)].sort().join(';') !==
          [...row.signers.map(key)].sort().join(';')
      ) {
        return P0001(
          'Les signataires ne correspondent pas à la demande existante.',
        )
      }
      if (!row) {
        const subject = input.subject_id
        if (
          input.purpose !== TEST_PURPOSE &&
          [...requests.values()].some((r) =>
            r.org_id === orgId && r.subject_id === subject &&
            r.purpose === input.purpose && open(r)
          )
        ) {
          return P0001(
            'Une demande de signature est déjà en cours pour ce dossier.',
          )
        }
        row = insertRequest({
          id: uuid('5e000000'),
          module_key: String(input.module_key),
          purpose: String(input.purpose),
          subject_type: String(input.subject_type),
          subject_id: String(subject),
          title: String(input.title),
          view_permission: String(input.view_permission),
          idempotency_key: String(input.idempotency_key),
          sent_by: (input.sent_by as string | null) ?? null,
          signers: signers.map((s) => ({
            id: uuid('5f000000'),
            role: s.role,
            name: s.name,
            email: s.email,
            order: s.order,
            recipient_id: null,
            status: 'pending' as const,
          })),
        })
      }
      return {
        data: [{
          id: row.id,
          existing,
          status: row.status,
          signers: signersJson(row),
          last_error: row.last_error,
          created_at: row.created_at,
          envelope_id: row.envelope_id,
        }],
      }
    },
    begin_signature_request_send: (a) => {
      const r = requests.get(String(a.p_id))
      if (!r || r.org_id !== a.p_org_id) return E22023
      if (r.status !== 'draft' || r.last_error === 'abandoned') {
        return { data: false }
      }
      const stale = now().getTime() - intervalMs(a.p_stale_after)
      if (
        r.send_started_at !== null && Date.parse(r.send_started_at) > stale
      ) return { data: false }
      r.send_started_at = iso()
      r.last_send_at = r.send_started_at
      r.last_error = null
      return { data: true }
    },
    register_system_file: (a) => {
      if (a.p_org_id !== orgId || a.p_module_key !== 'core') return E22023
      const id = uuid('f1000000')
      const file = insertFile({
        id,
        bucket: String(a.p_bucket),
        object_path: `${orgId}/core/${a.p_subject_id}/${id}.pdf`,
        purpose: String(a.p_purpose),
        subject_id: String(a.p_subject_id),
        view_permission: (a.p_view_permission as string | null) ??
          'settings.integrations_manage',
        sha256: String(a.p_sha256),
        size_bytes: Number(a.p_size_bytes),
        original_name: String(a.p_original_name),
      })
      return { data: [{ file_id: file.id, object_path: file.object_path }] }
    },
    discard_system_file: (a) => {
      const f = files.get(String(a.p_file_id))
      if (
        !f || f.org_id !== a.p_org_id || f.status !== 'ready' ||
        f.retain_until === null ||
        !['signing_source', 'signing_signed'].includes(f.purpose)
      ) return { data: false }
      f.status = 'deleted'
      return { data: true }
    },
    mark_signature_request_sent: (a) => {
      const r = requests.get(String(a.p_id))
      if (!r || r.status !== 'draft' || r.last_error === 'abandoned') {
        return E22023
      }
      const source = files.get(String(a.p_source_file_id))
      if (
        !source || source.purpose !== 'signing_source' ||
        source.subject_id !== r.id || source.status !== 'ready' ||
        source.view_permission !== r.view_permission ||
        (source.retain_until !== null && source.retain_until <= iso())
      ) return E22023
      const recipients = a.p_signer_recipients as {
        role: string
        recipient_id: string
      }[]
      if (
        recipients.length !== r.signers.length ||
        !recipients.every((e) => r.signers.some((s) => s.role === e.role))
      ) return E22023
      if (!(String(a.p_expires_at) > iso())) return E22023
      const pageCount = a.p_page_count ?? null
      if (
        pageCount !== null &&
        !(Number.isInteger(pageCount) && Number(pageCount) >= 1 &&
          Number(pageCount) <= 10000)
      ) return E22023
      const envelopeId = envelopeArg(a.p_envelope_id)
      if (!envelopeId) return E22023
      if (envelopeTaken(r, envelopeId)) return E23505
      source.retain_until = null
      for (const e of recipients) {
        r.signers.find((s) => s.role === e.role)!.recipient_id = e.recipient_id
      }
      Object.assign(r, {
        status: 'sent',
        superseded_envelope_ids: supersede(
          r.superseded_envelope_ids,
          r.envelope_id,
          envelopeId,
        ),
        envelope_id: envelopeId,
        source_file_id: source.id,
        page_count: pageCount as number | null,
        sent_at: iso(),
        expires_at: a.p_expires_at,
        last_error: null,
        send_started_at: null,
      })
      return { data: null }
    },
    recover_signature_request: (a) => {
      const r = requests.get(String(a.p_id))
      if (
        !r || r.org_id !== a.p_org_id || r.status !== 'draft' ||
        r.last_error === 'abandoned'
      ) return E22023
      // Only the draft's own recorded envelope.
      const envelopeId = envelopeArg(a.p_envelope_id)
      if (!envelopeId || r.envelope_id !== envelopeId) return E22023
      const recipients = a.p_signer_recipients as {
        role: string
        recipient_id: string
      }[]
      if (
        recipients.length !== r.signers.length ||
        !recipients.every((e) => r.signers.some((s) => s.role === e.role))
      ) return E22023
      const sourceId = stagedSourceOf(r)
      if (sourceId) files.get(sourceId)!.retain_until = null
      for (const e of recipients) {
        r.signers.find((s) => s.role === e.role)!.recipient_id = e.recipient_id
      }
      Object.assign(r, {
        status: 'sent',
        source_file_id: sourceId,
        sent_at: iso(),
        expires_at: null,
        completed_event_at: iso(),
        last_error: null,
        send_started_at: null,
      })
      return { data: sourceId }
    },
    mark_signature_request_failed: (a) => {
      const r = requests.get(String(a.p_id))
      if (!r || r.status !== 'draft') return E22023
      const next = envelopeArg(a.p_envelope_id)
      if (a.p_envelope_id != null && !next) return E22023
      if (envelopeTaken(r, next)) return E23505
      if (r.last_error !== 'abandoned') r.last_error = String(a.p_error_code)
      r.superseded_envelope_ids = supersede(
        r.superseded_envelope_ids,
        r.envelope_id,
        next,
      )
      r.envelope_id = next ?? r.envelope_id
      r.send_started_at = null
      return { data: null }
    },
    apply_signing_event: (a) => {
      if (typeof a.p_request_id !== 'string') return E22023
      const row = findForEvent(String(a.p_org_id), a.p_request_id)
      const answer = (outcome: string, download = false) => ({
        data: [{
          outcome,
          request_id: row?.id ?? null,
          module_key: row?.module_key ?? null,
          needs_download: download,
        }],
      })
      if (!row) return answer('not_found')
      const envelopeId = a.p_envelope_id as string | null
      if (envelopeId && row.superseded_envelope_ids.includes(envelopeId)) {
        return answer('ignored')
      }
      if (
        row.status !== 'draft' && envelopeId &&
        row.envelope_id !== envelopeId
      ) {
        return {
          data: [{
            outcome: 'not_found',
            request_id: null,
            module_key: null,
            needs_download: false,
          }],
        }
      }
      if (!modules.has(row.module_key)) return answer('ignored')
      if (row.status === 'draft') {
        return answer(
          row.last_error !== 'abandoned' &&
            (row.envelope_id ?? envelopeId) != null
            ? 'retry'
            : 'ignored',
        )
      }
      if (!['sent', 'viewed'].includes(row.status)) return answer('ignored')
      const recipient = row.signers.find((s) =>
        s.recipient_id !== null && s.recipient_id === a.p_recipient_id
      )
      let changed = false
      switch (a.p_event) {
        case 'DOCUMENT_OPENED':
          if (recipient?.status === 'pending') {
            recipient.status = 'viewed'
            changed = true
          }
          if (row.status === 'sent') {
            row.status = 'viewed'
            changed = true
          }
          break
        case 'DOCUMENT_SIGNED':
        case 'DOCUMENT_RECIPIENT_COMPLETED':
          if (recipient && ['pending', 'viewed'].includes(recipient.status)) {
            recipient.status = 'signed'
            changed = true
            if (row.status === 'sent') row.status = 'viewed'
          }
          break
        case 'DOCUMENT_COMPLETED':
          for (const s of row.signers) s.status = 'signed'
          row.completed_event_at ??= iso()
          return answer('applied', true)
        case 'DOCUMENT_REJECTED':
          if (row.completed_event_at === null) {
            if (recipient) recipient.status = 'rejected'
            row.status = 'rejected'
            row.rejection_reason = (a.p_reason as string | null) ?? null
            changed = true
          }
          break
        case 'DOCUMENT_CANCELLED':
          if (row.completed_event_at === null) {
            row.status = 'cancelled'
            changed = true
          }
          break
      }
      return answer(changed ? 'applied' : 'ignored')
    },
    complete_signature_request: (a) => {
      const r = requests.get(String(a.p_id))
      if (!r) return E22023
      if (r.status === 'signed' && r.signed_file_id === a.p_signed_file_id) {
        return { data: null }
      }
      if (!['sent', 'viewed'].includes(r.status)) return E22023
      const f = files.get(String(a.p_signed_file_id))
      if (
        !f || f.purpose !== 'signing_signed' || f.subject_id !== r.id ||
        f.status !== 'ready' || f.sha256 !== a.p_signed_sha256 ||
        f.view_permission !== r.view_permission
      ) return E22023
      f.retain_until = null
      for (const s of r.signers) s.status = 'signed'
      Object.assign(r, {
        status: 'signed',
        completed_at: iso(),
        completed_event_at: r.completed_event_at ?? iso(),
        signed_file_id: f.id,
        signed_sha256: f.sha256,
      })
      return { data: null }
    },
    get_signing_request: (a) => {
      const r = requests.get(String(a.p_id))
      if (!r || r.org_id !== a.p_org_id) return { data: null }
      return {
        data: {
          id: r.id,
          module_key: r.module_key,
          purpose: r.purpose,
          title: r.title,
          status: r.status,
          view_permission: r.view_permission,
          envelope_id: r.envelope_id,
          expires_at: r.expires_at,
          completed_event_at: r.completed_event_at,
          last_error: r.last_error,
          staged_source_file_id: stagedSourceOf(r),
          signers: [...r.signers].sort((x, y) => x.order - y.order)
            .map((s) => ({
              role: s.role,
              order: s.order,
              recipient_id: s.recipient_id,
            })),
        },
      }
    },
    get_signature_request: (a) => {
      const r = requests.get(String(a.p_id))
      return {
        data: r && r.org_id === orgId
          ? [{
            id: r.id,
            org_id: r.org_id,
            module_key: r.module_key,
            purpose: r.purpose,
            subject_type: r.subject_type,
            subject_id: r.subject_id,
            title: r.title,
            status: r.status,
            envelope_id: r.envelope_id,
            expires_at: r.expires_at,
            sent_at: r.sent_at,
            completed_at: r.completed_at,
            last_error: r.last_error,
          }]
          : [],
      }
    },
    list_signature_requests_to_reconcile: (a) => {
      const dayAgo = new Date(now().getTime() - DAY_MS).toISOString()
      const hourAgo = new Date(now().getTime() - DAY_MS / 24).toISOString()
      const action = (r: FakeSignatureRequest) =>
        r.status === 'draft'
          ? r.envelope_id === null ? 'abandon' : 'sync'
          : r.completed_event_at !== null
          ? 'sync'
          : r.expires_at !== null && r.expires_at < iso()
          ? 'expire'
          : 'sync'
      // The SQL's order: completed without the PDF, never or least recently
      // attempted, expire/abandon, expiry, creation.
      const key = (r: FakeSignatureRequest) => [
        r.status !== 'draft' && r.completed_event_at !== null ? 0 : 1,
        syncs.get(r.id)?.attempted_at ?? '',
        ['expire', 'abandon'].includes(action(r)) ? 0 : 1,
        r.expires_at ?? '9999',
        r.created_at,
        r.id,
      ]
      const compare = (x: FakeSignatureRequest, y: FakeSignatureRequest) => {
        const [a1, b1] = [key(x), key(y)]
        for (let i = 0; i < a1.length; i++) {
          if (a1[i] < b1[i]) return -1
          if (a1[i] > b1[i]) return 1
        }
        return 0
      }
      const rows = [...requests.values()]
        .filter((r) =>
          r.org_id === a.p_org_id && open(r) && modules.has(r.module_key) &&
          (r.status !== 'draft' ||
            (r.last_send_at ?? r.created_at) <
              (r.envelope_id === null ? dayAgo : hourAgo))
        )
        .sort(compare)
        .map((r) => ({
          id: r.id,
          module_key: r.module_key,
          status: r.status,
          envelope_id: r.envelope_id,
          expires_at: r.expires_at,
          action: action(r),
        }))
      return { data: rows.slice(0, Number(a.p_limit ?? 100)) }
    },
    record_signature_sync: (a) => {
      const r = requests.get(String(a.p_id))
      if (!r || r.org_id !== a.p_org_id) return { data: [] }
      const code = a.p_error_code == null ? null : String(a.p_error_code)
      const row: FakeSync = syncs.get(r.id) ?? {
        attempted_at: iso(),
        synced_at: null,
        error_code: null,
        failing_since: null,
        reported: {},
      }
      row.attempted_at = iso()
      if (code !== null) {
        row.failing_since ??= iso()
        row.error_code = code
      } else if (a.p_read !== false) {
        // A read (the SQL default); `p_read` false: the attempt only.
        row.synced_at = iso()
        row.failing_since = null
        row.error_code = null
      }
      syncs.set(r.id, row)
      const dayAgo = new Date(now().getTime() - DAY_MS).toISOString()
      const due = [...new Set((a.p_report_codes ?? []) as string[])].sort()
        .filter((c) => !(c in row.reported) || row.reported[c] <= dayAgo)
      for (const c of due) row.reported[c] = iso()
      return { data: due }
    },
    expire_signature_request: (a) => {
      const r = requests.get(String(a.p_id))
      if (
        !r || !['sent', 'viewed'].includes(r.status) ||
        r.expires_at === null || !(r.expires_at < iso()) ||
        r.completed_event_at !== null
      ) return { data: false }
      r.status = 'expired'
      r.expired_at = iso()
      return { data: true }
    },
    // Phase 4 (a contract replaced): sent or viewed → cancelled, a live draft → abandoned; a
    // request Documenso completed → P0001; already closed → false.
    cancel_signature_request: (a) => {
      const r = requests.get(String(a.p_id))
      if (!r) return E22023
      if (r.status === 'signed' || r.completed_event_at !== null) {
        return P0001(
          'Ce document a déjà été signé : la demande ne peut plus être annulée.',
        )
      }
      if (r.status === 'sent' || r.status === 'viewed') {
        r.status = 'cancelled'
        return { data: true }
      }
      if (r.status === 'draft' && r.last_error !== 'abandoned') {
        r.last_error = 'abandoned'
        return { data: true }
      }
      return { data: false }
    },
    claim_webhook_event: (a) => {
      const key = `${a.p_provider}:${a.p_event_id}`
      const found = events.get(key)
      if (found?.status === 'completed') {
        return { data: [{ status: 'duplicate', id: null, claim_token: null }] }
      }
      if (found?.status === 'claimed') {
        return {
          data: [{ status: 'in_progress', id: null, claim_token: null }],
        }
      }
      const row: FakeWebhookEvent = found ?? {
        id: uuid('e1000000'),
        event_id: String(a.p_event_id),
        org_id: String(a.p_org_id),
        status: 'claimed',
        token: '',
        payload: a.p_payload as Record<string, unknown>,
        error: null,
      }
      row.status = 'claimed'
      row.token = uuid('70000000')
      events.set(key, row)
      return {
        data: [{ status: 'claimed', id: row.id, claim_token: row.token }],
      }
    },
    complete_webhook_event: (a) => {
      const row = [...events.values()].find((e) => e.id === a.p_id)
      if (!row || row.token !== a.p_claim_token) return { data: false }
      row.status = 'completed'
      row.payload = {}
      return { data: true }
    },
    fail_webhook_event: (a) => {
      const row = [...events.values()].find((e) => e.id === a.p_id)
      if (!row || row.token !== a.p_claim_token) return { data: false }
      row.status = 'failed'
      row.error = String(a.p_error)
      return { data: true }
    },
    consume_rate_limit: {
      data: [{ allowed: true, hits: 1, retry_after_seconds: 0 }],
    },
  }

  const storage: Record<string, StorageRoute> = {
    upload: (bucket, path, body) => {
      const key = `${bucket}/${path}`
      if (objects.has(key)) {
        return { error: { message: 'The resource already exists' } }
      }
      objects.set(key, body as Uint8Array)
      return { data: { path } }
    },
    download: (bucket, path) => {
      const bytes = objects.get(`${bucket}/${path}`)
      return bytes
        ? { data: new Blob([bytes as Uint8Array<ArrayBuffer>]) }
        : { error: { message: 'Object not found', status: 404 } }
    },
  }

  return {
    rpc,
    storage,
    requests,
    files,
    events,
    syncs,
    objects,
    insertRequest,
    insertFile,
  }
}
