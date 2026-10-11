import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { t } from '@/i18n'
import type { ProfessionalRecord } from '../../api/parse'
import { IDS } from '../../test/fixtures'
import { CONSENT_DOC_JSON, DOC_IDS, documentJson, documentsFixture, PHOTO_JSON } from '../../test/fixtures-documents'
import { recordWithStatus } from '../../test/fixtures-domain'
import { renderRecordTab } from '../../test/record-tab'
import { PublicPhotoSection } from './PublicPhotoSection'

const mocks = vi.hoisted(() => ({
  render: vi.fn(),
  download: vi.fn(),
  fetchProfessionalDocuments: vi.fn(),
  signedFileUrl: vi.fn(),
}))
// The fiche's rendering is FicheMenu's (tested there); the dialog's own behaviour is tested here.
vi.mock('../../hooks/use-fiche', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../../hooks/use-fiche')>()),
  useRenderFiche: () => mocks.render,
  useDownloadFiche: () => ({ mutate: mocks.download, isPending: false }),
}))
vi.mock('../../api/documents', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../../api/documents')>()),
  fetchProfessionalDocuments: mocks.fetchProfessionalDocuments,
}))
vi.mock('@/core/storage/hooks', () => ({
  useSignedFileUrl: (fileId: string | null, options: unknown) => {
    if (fileId) mocks.signedFileUrl(fileId, options)
    return { data: fileId ? { url: 'https://storage.test/photo-card.png' } : undefined, refetch: vi.fn() }
  },
}))
vi.mock('@sentry/react', () => ({ captureException: vi.fn() }))

const P = 'modules.professionals.record.publicProfile.photo'
const F = 'modules.professionals.fiche.preview'
const PDF = new Blob(['%PDF-1.3'], { type: 'application/pdf' })
const blobUrls = { create: vi.fn(() => 'about:blank#fiche'), revoke: vi.fn() }
Object.assign(URL, { createObjectURL: blobUrls.create, revokeObjectURL: blobUrls.revoke })

beforeEach(() => {
  mocks.render.mockResolvedValue({ blob: PDF, fileName: 'Fiche - Marie Tremblay.pdf' })
  mocks.fetchProfessionalDocuments.mockResolvedValue(documentsFixture())
})
afterEach(() => vi.clearAllMocks())

const withPhoto = (): ProfessionalRecord => ({ ...recordWithStatus('active', true), photoFileId: DOC_IDS.photoFile })

describe('PublicPhotoSection (gap audit V1, H3)', () => {
  it('shows the verified photo at a fixed size, lazily, from its card copy, and says the fiche may show it', async () => {
    renderRecordTab(<PublicPhotoSection />, { record: withPhoto(), role: 'counselor' })
    const photo = await screen.findByRole('img', { name: t(`${P}.alt`, { name: 'Marie Tremblay' }) })
    expect(photo).toHaveAttribute('loading', 'lazy')
    expect(photo).toHaveAttribute('width', '128')
    expect(photo).toHaveAttribute('height', '128')
    expect(mocks.signedFileUrl).toHaveBeenCalledWith(DOC_IDS.photoFile, expect.objectContaining({ variant: 'card' }))
    expect(screen.getByText(t(`${P}.verified`), { exact: false })).toBeInTheDocument()
    expect(await screen.findByText(t(`${P}.consentOnFile`))).toBeInTheDocument()
    expect(screen.getByRole('link', { name: t(`${P}.manage`) })).toHaveAttribute('href', `/professionnels/${IDS.professional}/documents`)
  })

  it('without a consent on file, says the fiche shows the initials', async () => {
    mocks.fetchProfessionalDocuments.mockResolvedValue(
      documentsFixture({ documents: [documentJson(), PHOTO_JSON, { ...CONSENT_DOC_JSON, status: 'pending' }] }),
    )
    renderRecordTab(<PublicPhotoSection />, { record: withPhoto(), role: 'counselor' })
    expect(await screen.findByText(t(`${P}.noConsent`))).toBeInTheDocument()
  })

  it('a withdrawn consent (P4-549): the fiche shows the initials', async () => {
    mocks.fetchProfessionalDocuments.mockResolvedValue(
      documentsFixture({ documents: [documentJson(), PHOTO_JSON, { ...CONSENT_DOC_JSON, withdrawn_on: '2026-10-09', withdrawn_at: '2026-10-09T15:00:00Z' }] }),
    )
    renderRecordTab(<PublicPhotoSection />, { record: withPhoto(), role: 'counselor' })
    expect(await screen.findByText(t(`${P}.noConsent`))).toBeInTheDocument()
  })

  it('without a photo: says so, signs nothing', async () => {
    renderRecordTab(<PublicPhotoSection />, { record: recordWithStatus('active', true), role: 'counselor' })
    expect(screen.getByText(t(`${P}.none`), { exact: false })).toBeInTheDocument()
    expect(screen.queryByRole('img')).not.toBeInTheDocument()
    expect(mocks.signedFileUrl).not.toHaveBeenCalled()
  })

  it('« Aperçu de la fiche » renders the fiche in a dialog (nothing saved nor stamped); « Télécharger » saves it', async () => {
    renderRecordTab(<PublicPhotoSection />, { record: withPhoto(), role: 'counselor' })
    await userEvent.click(screen.getByRole('button', { name: t(`${P}.preview`) }))
    const dialog = await screen.findByRole('dialog', { name: t(`${F}.title`, { name: 'Marie Tremblay' }) })
    const frame = await within(dialog).findByTitle(t(`${F}.frameTitle`, { name: 'Marie Tremblay' }))
    expect(frame).toHaveAttribute('src', 'about:blank#fiche')
    // The fiche « Télécharger » makes, for the primary title; nothing downloaded.
    expect(mocks.render).toHaveBeenCalledWith(expect.objectContaining({ titleId: IDS.psychologue }))
    expect(mocks.download).not.toHaveBeenCalled()

    await userEvent.click(within(dialog).getByRole('button', { name: t(`${F}.download`) }))
    expect(mocks.download).toHaveBeenCalledWith(expect.objectContaining({ titleId: IDS.psychologue }))
    await userEvent.keyboard('{Escape}')
    await waitFor(() => expect(blobUrls.revoke).toHaveBeenCalledWith('about:blank#fiche'))
  })

  it('a fiche that cannot be made says so in the dialog', async () => {
    mocks.render.mockRejectedValue(new Error('boom'))
    renderRecordTab(<PublicPhotoSection />, { record: withPhoto(), role: 'counselor' })
    await userEvent.click(screen.getByRole('button', { name: t(`${P}.preview`) }))
    expect(await screen.findByText(t('modules.professionals.fiche.errors.render'))).toBeInTheDocument()
  })
})
