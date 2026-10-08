/**
 * Fixtures for the signing tests: a minimal PDF, and a request already sent
 * (its document distributed in the fake Documenso, its row `sent` in the
 * fake database). Test-only: never deployed.
 */
import { documensoClient } from '../documenso.ts'
import type { FakeDocumenso } from './fake-documenso.ts'
import type { FakeSignatureRequest, FakeSigningDb } from './fake-signing-db.ts'

export const SIGNING_ORG = '00000000-0000-4000-8000-000000000001'
export const OTHER_ORG = '00000000-0000-4000-8000-000000000002'
export const DOCUMENSO_KEY = 'local-dev-documenso-key'
export const WEBHOOK_SECRET = 'local-dev-documenso-webhook-secret'
export const SIGNER_EMAIL = 'ana.gagnon@example.test'
export const CLINIC_EMAIL = 'direction@mana.test'

/** The smallest PDF `sniff` accepts: a version header and `%%EOF`. */
export const MINIMAL_PDF = new TextEncoder().encode(
  '%PDF-1.4\n1 0 obj << >> endobj\ntrailer << >>\n%%EOF\n',
)

/** One or two signers (professional first, then the clinic). */
export const SIGNERS = [
  { role: 'professional', name: 'Ana Gagnon', email: SIGNER_EMAIL, order: 1 },
  { role: 'clinic', name: 'Christine Tremblay', email: CLINIC_EMAIL, order: 2 },
] as const

let next = 0

/**
 * A request sent through the fake Documenso: its document is created with
 * `signers` (default: the professional only), fields placed, distributed,
 * and its row inserted as `sent` (or `over.status`) with the recipient ids.
 */
export async function sentRequest(
  fake: FakeDocumenso,
  db: FakeSigningDb,
  over: Partial<FakeSignatureRequest> = {},
  signers: readonly (typeof SIGNERS)[number][] = [SIGNERS[0]],
): Promise<FakeSignatureRequest> {
  const id = over.id ??
    `5a000000-0000-4000-8000-${String(++next).padStart(12, '0')}`
  const client = documensoClient(fake.baseUrl, DOCUMENSO_KEY, fake.fetch)
  const created = await client.createDocument(MINIMAL_PDF, {
    title: 'Contrat',
    externalId: id,
    recipients: signers.map((s) => ({
      email: s.email,
      name: s.name,
      role: 'SIGNER' as const,
      signingOrder: s.order,
    })),
    meta: {
      subject: 'Contrat à signer',
      message: '',
      language: 'fr',
      distributionMethod: 'EMAIL',
      signingOrder: signers.length > 1 ? 'SEQUENTIAL' : 'PARALLEL',
      timezone: 'America/Toronto',
    },
  })
  await client.addFields(
    created.documentId,
    created.recipients.map((r) => ({
      recipientId: r.id,
      type: 'SIGNATURE' as const,
      page: 1,
      x: 10,
      y: 80,
      width: 20,
      height: 5,
    })),
  )
  await client.distribute(created.documentId)
  fake.calls.length = 0
  return db.insertRequest({
    status: 'sent',
    documenso_document_id: created.documentId,
    envelope_id: created.envelopeId,
    sent_at: '2026-10-01T12:00:00.000Z',
    expires_at: '2026-10-15T12:00:00.000Z',
    signers: signers.map((s, i) => ({
      id: `5b000000-0000-4000-8000-${String(++next).padStart(12, '0')}`,
      role: s.role,
      name: s.name,
      email: s.email,
      order: s.order,
      recipient_id: created.recipients[i].id,
      status: 'pending' as const,
    })),
    ...over,
    id,
  })
}
