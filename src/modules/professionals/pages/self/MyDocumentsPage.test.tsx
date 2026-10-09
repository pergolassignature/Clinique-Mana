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
import { DOC_IDS, documentJson, documentsFixture, PHOTO_JSON } from '../../test/fixtures-documents'
import { CATALOG, recordFixture } from '../../test/fixtures-domain'
import { setupQueryClient } from '../../test/query-client'
import { MyDocumentsPage } from './MyDocumentsPage'

const mocks = vi.hoisted(() => ({
  self: { fetchMyProfessionalRecord: vi.fn() },
  catalog: { fetchProfessionalsCatalog: vi.fn() },
  documents: { fetchMyDocuments: vi.fn(), uploadProfessionalDocument: vi.fn(), documentDownloadUrl: vi.fn() },
  toast: { success: vi.fn(), error: vi.fn(), warning: vi.fn() },
}))
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
})
afterEach(() => vi.clearAllMocks())

describe('MyDocumentsPage — banners by the clinic’s date', () => {
  it('no banner while the insurance is valid', async () => {
    renderPage()
    await loaded()
    expect(screen.getByRole('heading', { level: 1, name: t(`${M}.pageTitle`) })).toBeInTheDocument()
    expect(screen.queryByRole('alert')).not.toBeInTheDocument()
  })

  it('expiring within the reminder window: « Votre assurance expire le 31 mars 2027 »', async () => {
    renderPage(documentsFixture({ today: '2027-03-26' }))
    await loaded()
    expect(screen.getByRole('alert')).toHaveTextContent(t(`${M}.banners.expiring`, { date: '31 mars 2027' }))
  })

  it('expired: asks for the new proof to keep receiving new clients', async () => {
    renderPage(documentsFixture({ today: '2027-04-01' }))
    await loaded()
    expect(screen.getByRole('alert')).toHaveTextContent(t(`${M}.banners.expired`))
  })

  it('a new proof already sent: a thank-you, never the warning', async () => {
    renderPage(
      documentsFixture({
        today: '2027-04-01',
        documents: [documentJson({ id: DOC_IDS.insuranceRenewal, status: 'pending', expires_on: '2028-03-31', reviewed_at: null, reviewed_by_name: null }), documentJson(), PHOTO_JSON],
      }),
    )
    await loaded()
    expect(screen.queryByRole('alert')).not.toBeInTheDocument()
    expect(screen.getByText(t(`${M}.banners.renewalPending`))).toBeInTheDocument()
  })
})

describe('MyDocumentsPage — her own documents', () => {
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
    expect(screen.queryByRole('button', { name: /^(Vérifier|Refuser)/ })).not.toBeInTheDocument()
    // « … » holds « Télécharger » only.
    await userEvent.click(within(insurance).getByRole('button', { name: /^Autres actions/ }))
    expect((await screen.findAllByRole('menuitem')).map((item) => item.textContent)).toEqual([t(`${D}.actions.download`)])
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

  it('an account without a professional file: says so', async () => {
    renderPage(null)
    expect(await screen.findByText(t(`${M}.noFile.title`))).toBeInTheDocument()
    cleanup()
  })
})
