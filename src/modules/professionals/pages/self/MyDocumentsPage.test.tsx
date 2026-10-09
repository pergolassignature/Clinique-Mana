import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { QueryClientProvider } from '@tanstack/react-query'
import { t } from '@/i18n'
import { renderWithContexts } from '@/test/contexts'
import { accessForRole } from '@/test/role-fixtures'
import type { ProfessionalDocuments } from '../../api/documents'
import { professionalKeys } from '../../hooks/keys'
import { IDS } from '../../test/fixtures'
import { CONSENT_JSON, DOC_IDS, documentJson, documentsFixture, PHOTO_JSON } from '../../test/fixtures-documents'
import { CATALOG, recordFixture } from '../../test/fixtures-domain'
import { setupQueryClient } from '../../test/query-client'
import { MyDocumentsPage } from './MyDocumentsPage'

const mocks = vi.hoisted(() => ({
  self: { fetchMyProfessionalRecord: vi.fn() },
  catalog: { fetchProfessionalsCatalog: vi.fn() },
  documents: { fetchMyDocuments: vi.fn(), uploadProfessionalDocument: vi.fn(), documentDownloadUrl: vi.fn() },
  toast: { success: vi.fn(), error: vi.fn(), warning: vi.fn() },
  consentSign: { fetchMyImageConsent: vi.fn(), startConsentSigning: vi.fn(), syncMyConsent: vi.fn() },
}))
vi.mock('../../api/consent-sign', async (importOriginal) => ({ ...(await importOriginal<typeof import('../../api/consent-sign')>()), ...mocks.consentSign }))
vi.mock('../../api/self', async (importOriginal) => ({ ...(await importOriginal<typeof import('../../api/self')>()), ...mocks.self }))
vi.mock('../../api/catalog', async (importOriginal) => ({ ...(await importOriginal<typeof import('../../api/catalog')>()), ...mocks.catalog }))
vi.mock('../../api/documents', async (importOriginal) => ({ ...(await importOriginal<typeof import('../../api/documents')>()), ...mocks.documents }))
vi.mock('@/core/storage/hooks', () => ({
  useSignedFileUrl: (fileId: string | null) => ({ data: fileId ? { url: `about:blank#${fileId}` } : undefined, isPending: false, isError: false, error: null, refetch: vi.fn() }),
}))
vi.mock('@/shared/ui/sonner', () => ({ toast: mocks.toast }))
vi.mock('@sentry/react', () => ({ captureException: vi.fn() }))

const M = 'modules.professionals.myDocuments'
const D = 'modules.professionals.documents'
const INSURANCE = "Preuve d'assurance responsabilité"

function renderPage(documents: ProfessionalDocuments | null = documentsFixture()) {
  mocks.documents.fetchMyDocuments.mockResolvedValue(documents)
  const { queryClient, invalidated } = setupQueryClient()
  render(
    renderWithContexts(
      <QueryClientProvider client={queryClient}>
        <MyDocumentsPage />
      </QueryClientProvider>,
      { path: '/mes-documents', access: { access: accessForRole('provider') } },
    ),
  )
  return { invalidated }
}

const loaded = () => screen.findByRole('heading', { name: t(`${D}.required.title`) })

beforeEach(() => {
  mocks.self.fetchMyProfessionalRecord.mockResolvedValue(recordFixture())
  mocks.catalog.fetchProfessionalsCatalog.mockResolvedValue(CATALOG)
  mocks.consentSign.fetchMyImageConsent.mockResolvedValue({ available: true, validUntil: null, request: null })
})
afterEach(() => vi.clearAllMocks())

describe('MyDocumentsPage — banners by the clinic’s date', () => {
  it('no banner while the insurance is valid', async () => {
    renderPage()
    await loaded()
    expect(screen.getByRole('heading', { level: 1, name: t(`${M}.pageTitle`) })).toBeInTheDocument()
    expect(screen.queryByText(t(`${M}.banners.expiredTitle`))).not.toBeInTheDocument()
    expect(screen.queryByText(t(`${M}.banners.expiringTitle`))).not.toBeInTheDocument()
  })

  it('expiring within the reminder window: « Votre assurance expire le 31 mars 2027 »', async () => {
    renderPage(documentsFixture({ today: '2027-03-26' }))
    await loaded()
    expect(screen.getByText(t(`${M}.banners.expiring`, { date: '31 mars 2027' }))).toBeInTheDocument()
    // Shown on load: no live role, so a screen reader does not announce it at every visit.
    expect(screen.queryByRole('alert')).not.toBeInTheDocument()
  })

  it('expired: asks for the new proof to keep receiving new clients', async () => {
    renderPage(documentsFixture({ today: '2027-04-01' }))
    await loaded()
    expect(screen.getByText(t(`${M}.banners.expired`))).toBeInTheDocument()
  })

  it('a new proof already sent: a thank-you, never the warning', async () => {
    renderPage(
      documentsFixture({
        today: '2027-04-01',
        documents: [documentJson({ id: DOC_IDS.insuranceRenewal, status: 'pending', expires_on: '2028-03-31', reviewed_at: null, reviewed_by_name: null }), documentJson(), PHOTO_JSON],
      }),
    )
    await loaded()
    expect(screen.queryByText(t(`${M}.banners.expired`))).not.toBeInTheDocument()
    expect(screen.getByText(t(`${M}.banners.renewalPending`))).toBeInTheDocument()
  })
})

describe('MyDocumentsPage — her own documents', () => {
  it('her e-consent reads its date and version without a signer’s name (the RPC gives none to the provider, P4-472)', async () => {
    renderPage(documentsFixture({ consent: { ...CONSENT_JSON, signer_name: null } }))
    await loaded()
    const consent = screen.getByRole('region', { name: "Consentement droit à l'image" })
    expect(consent).toHaveTextContent('Signé électroniquement le 08 oct. 2026 (version 1)')
    expect(consent).not.toHaveTextContent(' par ')
  })

  it('in her words; no review, no deletion', async () => {
    renderPage(
      documentsFixture({
        documents: [
          documentJson({ status: 'pending', reviewed_at: null, reviewed_by_name: null }),
          documentJson({ id: DOC_IDS.refused, type_id: IDS.photoType, type_key: 'photo', status: 'rejected', expires_on: null, rejection_reason: 'Photo floue.', reviewed_by_name: null, file: null }),
        ],
      }),
    )
    await loaded()
    const insurance = screen.getByRole('region', { name: INSURANCE })
    expect(insurance).toHaveTextContent(t(`${D}.state.pendingSelf`))
    expect(insurance).toHaveTextContent('Téléversé le 01 oct. 2026 par vous')
    const photo = screen.getByRole('region', { name: 'Photo professionnelle' })
    expect(photo).toHaveTextContent(t(`${M}.rejectedNote`))
    expect(photo).toHaveTextContent('Raison : Photo floue.')
    expect(screen.queryByRole('button', { name: /^(Vérifier|Refuser|Autres actions)/ })).not.toBeInTheDocument()
    // Her file's two actions, side by side (no « … » holding one item).
    expect(within(insurance).getByRole('button', { name: /^Aperçu : / })).toBeInTheDocument()
    expect(within(insurance).getByRole('button', { name: /^Télécharger : / })).toBeInTheDocument()
  })

  it('« Téléverser » sends to her own record, as her own upload (always reviewed by the clinic)', async () => {
    mocks.documents.uploadProfessionalDocument.mockResolvedValue(DOC_IDS.insuranceRenewal)
    const { invalidated } = renderPage(documentsFixture({ today: '2027-03-26' }))
    await loaded()
    await userEvent.click(screen.getByRole('button', { name: t(`${D}.actions.replaceLabel`, { type: INSURANCE }) }))
    const dialog = await screen.findByRole('dialog', { name: t(`${D}.upload.title`, { type: INSURANCE }) })
    expect(dialog).toHaveAccessibleDescription(t(`${D}.upload.descriptionSelf`))
    expect(within(dialog).getByText(t(`${D}.upload.reviewedLaterSelf`))).toBeInTheDocument()
    // March 26 → the next period's March 31 (P4-412).
    expect(within(dialog).getByLabelText(new RegExp(t(`${D}.upload.expiresOn`)))).toHaveValue('2028-03-31')
    const file = new File([new TextEncoder().encode('%PDF-1.7\n')], 'assurance.pdf', { type: 'application/pdf' })
    fireEvent.change(dialog.querySelector('input[type="file"]') as HTMLInputElement, { target: { files: [file] } })
    await waitFor(() => expect(screen.queryByRole('dialog')).not.toBeInTheDocument())
    expect(mocks.documents.uploadProfessionalDocument).toHaveBeenCalledExactlyOnceWith(
      expect.objectContaining({ professionalId: IDS.professional, typeKey: 'insurance', expiresOn: '2028-03-31', self: true }),
    )
    expect(mocks.toast.success).toHaveBeenCalledWith(t(`${D}.toasts.uploadedSelf`))
    expect(invalidated()).toContainEqual(professionalKeys.myDocuments())
  })

  it('an admin who practises uploads to her own file as staff (the RPC checks professionals.manage first, P4-464)', async () => {
    mocks.documents.uploadProfessionalDocument.mockResolvedValue(DOC_IDS.insuranceRenewal)
    mocks.documents.fetchMyDocuments.mockResolvedValue(documentsFixture({ documents: [PHOTO_JSON] }))
    const { queryClient } = setupQueryClient()
    render(
      renderWithContexts(
        <QueryClientProvider client={queryClient}>
          <MyDocumentsPage />
        </QueryClientProvider>,
        { path: '/mes-documents', access: { access: accessForRole('admin', { has_professional_file: true }) } },
      ),
    )
    await loaded()
    await userEvent.click(screen.getByRole('button', { name: t(`${D}.actions.uploadLabel`, { type: INSURANCE }) }))
    const dialog = await screen.findByRole('dialog')
    expect(within(dialog).getByText(t(`${D}.upload.reviewedLaterSelf`))).toBeInTheDocument()
    const file = new File([new TextEncoder().encode('%PDF-1.7\n')], 'assurance.pdf', { type: 'application/pdf' })
    fireEvent.change(dialog.querySelector('input[type="file"]') as HTMLInputElement, { target: { files: [file] } })
    await waitFor(() => expect(mocks.documents.uploadProfessionalDocument).toHaveBeenCalledWith(expect.objectContaining({ self: false, professionalId: IDS.professional })))
  })

  it('the image consent is filled in and signed, never uploaded (P4-489): « Remplir et signer »', async () => {
    renderPage(documentsFixture({ consent: null, documents: [] }))
    await loaded()
    const consent = screen.getByRole('region', { name: "Consentement droit à l'image" })
    expect(await within(consent).findByRole('button', { name: t('modules.professionals.consentSign.fill') })).toBeInTheDocument()
    expect(within(consent).queryByRole('button', { name: /^Téléverser/ })).not.toBeInTheDocument()
    // Nor in « Téléverser un document »'s list of types.
    await userEvent.click(screen.getByRole('button', { name: t(`${D}.actions.uploadOther`) }))
    const dialog = await screen.findByRole('dialog')
    expect(dialog).not.toHaveTextContent("Consentement droit à l'image")
  })

  it('an expired consent reads « Renouveler : remplir et signer »; a signed one its dates', async () => {
    mocks.consentSign.fetchMyImageConsent.mockResolvedValue({
      available: true,
      validUntil: null,
      request: { status: 'signed', lastError: null, sentAt: '2025-10-01T14:00:00Z', completedAt: '2025-10-01T14:05:00Z', signedAt: '2025-10-01T14:05:00Z' },
    })
    renderPage(documentsFixture({ consent: null, documents: [] }))
    await loaded()
    expect(await screen.findByRole('button', { name: t('modules.professionals.consentSign.renew') })).toBeInTheDocument()
    cleanup()
    mocks.consentSign.fetchMyImageConsent.mockResolvedValue({
      available: true,
      validUntil: '2027-10-08',
      request: { status: 'signed', lastError: null, sentAt: '2026-10-08T14:00:00Z', completedAt: '2026-10-08T14:05:00Z', signedAt: '2026-10-08T14:05:00Z' },
    })
    renderPage(documentsFixture({ consent: null, documents: [] }))
    await loaded()
    expect(await screen.findByText(/^Signé le .* · valide jusqu'au 8 octobre 2027$/)).toBeInTheDocument()
  })

  it('an account without a professional file: says so', async () => {
    renderPage(null)
    expect(await screen.findByText(t(`${M}.noFile.title`))).toBeInTheDocument()
    cleanup()
  })
})
