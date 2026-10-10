import { afterEach, describe, expect, it, vi } from 'vitest'
import { screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { t } from '@/i18n'
import type { ProfessionalRecord } from '../../api/parse'
import { IDS } from '../../test/fixtures'
import { CONSENT_DOC_JSON, DOC_IDS, documentJson, documentsFixture, PHOTO_JSON } from '../../test/fixtures-documents'
import { recordWithStatus } from '../../test/fixtures-domain'
import { renderRecordTab } from '../../test/record-tab'
import { FicheMenu } from './FicheMenu'

const mocks = vi.hoisted(() => ({
  renderFichePdf: vi.fn(),
  saveBlob: vi.fn(),
  markFicheGenerated: vi.fn(),
  fetchPublicFees: vi.fn(),
  fetchOrganization: vi.fn(),
  fetchProfessionalsSettings: vi.fn(),
  fetchProfessionalDocuments: vi.fn(),
  toastError: vi.fn(),
}))
vi.mock('../../pdf/generate-fiche-pdf', () => ({ renderFichePdf: mocks.renderFichePdf }))
vi.mock('@/shared/lib/files', async (importOriginal) => ({ ...(await importOriginal<typeof import('@/shared/lib/files')>()), saveBlob: mocks.saveBlob }))
vi.mock('../../api/fiche', () => ({ markFicheGenerated: mocks.markFicheGenerated, fetchPublicFees: mocks.fetchPublicFees }))
vi.mock('@/core/settings/organization/api', () => ({ fetchOrganization: mocks.fetchOrganization }))
vi.mock('../../api/settings', () => ({ fetchProfessionalsSettings: mocks.fetchProfessionalsSettings }))
vi.mock('../../api/documents', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../../api/documents')>()),
  fetchProfessionalDocuments: mocks.fetchProfessionalDocuments,
}))
vi.mock('@/shared/ui/sonner', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@/shared/ui/sonner')>()),
  toast: { error: mocks.toastError, success: vi.fn() },
}))
vi.mock('@sentry/react', () => ({ captureException: vi.fn() }))

const M = 'modules.professionals.fiche.menu'
const ORGANIZATION = { name: 'Clinique MANA', phone: null, email: null, website: null, logo_file_id: null }
const PDF = new Blob(['%PDF-1.3'], { type: 'application/pdf' })
const FEES = [{ duration: 50, clientPriceCents: 17500 }]
const SETTINGS = { collectSin: false, ficheShowProContact: false, ficheShowClinicFooter: true, ficheShowClosing: true }

afterEach(() => vi.resetAllMocks())

function renderMenu(record: ProfessionalRecord = recordWithStatus('active', true)) {
  mocks.fetchOrganization.mockResolvedValue(ORGANIZATION)
  mocks.fetchProfessionalsSettings.mockResolvedValue(SETTINGS)
  mocks.renderFichePdf.mockResolvedValue(PDF)
  mocks.markFicheGenerated.mockResolvedValue(undefined)
  mocks.fetchPublicFees.mockResolvedValue(FEES)
  mocks.fetchProfessionalDocuments.mockResolvedValue(null)
  return renderRecordTab(<FicheMenu />, { record, role: 'counselor' })
}

const open = () => userEvent.click(screen.getByRole('button', { name: t(`${M}.trigger`) }))

describe('FicheMenu', () => {
  it('downloads the fiche of the only title: rendered, saved as « Fiche - Prénom Nom.pdf », then stamped', async () => {
    const record = recordWithStatus('active', true)
    renderMenu(record)
    await open()
    await userEvent.click(await screen.findByRole('menuitem', { name: t(`${M}.download`) }))

    await waitFor(() => expect(mocks.markFicheGenerated).toHaveBeenCalledWith(IDS.professional))
    expect(mocks.fetchPublicFees).toHaveBeenCalledWith(IDS.professional, IDS.psychologue)
    expect(mocks.renderFichePdf).toHaveBeenCalledWith(
      expect.objectContaining({
        record,
        titleId: IDS.psychologue,
        organization: ORGANIZATION,
        fees: FEES,
        // The clinic's render options, from the module settings (P4-353).
        options: { showProContact: false, showClinicFooter: true, showClosing: true },
        // No verified photo: the initials (P4-202).
        photoFileId: null,
      }),
    )
    expect(mocks.saveBlob).toHaveBeenCalledWith(PDF, 'Fiche - Marie Tremblay.pdf')
    const [saved, stamped] = [mocks.saveBlob.mock.invocationCallOrder[0], mocks.markFicheGenerated.mock.invocationCallOrder[0]]
    expect(saved).toBeLessThan(stamped ?? 0)
  })

  it('prints the newest verified photo (P4-202); an unreadable one leaves the initials, never a failed fiche', async () => {
    renderMenu()
    mocks.fetchProfessionalDocuments.mockResolvedValue(documentsFixture())
    await open()
    await userEvent.click(await screen.findByRole('menuitem', { name: t(`${M}.download`) }))
    await waitFor(() => expect(mocks.renderFichePdf).toHaveBeenCalledWith(expect.objectContaining({ photoFileId: DOC_IDS.photoFile })))
    expect(mocks.fetchProfessionalDocuments).toHaveBeenCalledWith(IDS.professional)
  })

  it('prints no photo without a signed image consent on file (P4-512; « Envoyer par courriel » renders the same fiche)', async () => {
    renderMenu()
    // The photo is verified, but no consent: none, or one still waiting for review.
    mocks.fetchProfessionalDocuments.mockResolvedValue(documentsFixture({ documents: [documentJson(), PHOTO_JSON, { ...CONSENT_DOC_JSON, status: 'pending' }] }))
    await open()
    await userEvent.click(await screen.findByRole('menuitem', { name: t(`${M}.download`) }))
    await waitFor(() => expect(mocks.renderFichePdf).toHaveBeenCalledWith(expect.objectContaining({ photoFileId: null })))
    expect(mocks.saveBlob).toHaveBeenCalled()
  })

  it('a failed read of the documents still makes the fiche, without the photo', async () => {
    renderMenu()
    mocks.fetchProfessionalDocuments.mockRejectedValue(new Error('network'))
    await open()
    await userEvent.click(await screen.findByRole('menuitem', { name: t(`${M}.download`) }))
    await waitFor(() => expect(mocks.renderFichePdf).toHaveBeenCalledWith(expect.objectContaining({ photoFileId: null })))
    expect(mocks.toastError).not.toHaveBeenCalled()
  })

  it('offers one download per title when there are two, the primary first', async () => {
    const record = recordWithStatus('active', true)
    renderMenu({
      ...record,
      professions: [
        { id: 'r2', titleId: IDS.naturopathe, licenceNumber: null, isPrimary: false },
        { id: 'r1', titleId: IDS.psychologue, licenceNumber: '12345', isPrimary: true },
      ],
    })
    await open()
    const items = (await screen.findAllByRole('menuitem')).filter((item) => item.hasAttribute('aria-label'))
    expect(items.map((item) => item.getAttribute('aria-label'))).toEqual([
      t(`${M}.downloadTitle`, { title: 'Psychologue' }),
      t(`${M}.downloadTitle`, { title: 'Naturopathe' }),
    ])
    await userEvent.click(items[1] as HTMLElement)
    await waitFor(() => expect(mocks.renderFichePdf).toHaveBeenCalledWith(expect.objectContaining({ titleId: IDS.naturopathe })))
    // The fees follow the chosen title (P4-218).
    expect(mocks.fetchPublicFees).toHaveBeenCalledWith(IDS.professional, IDS.naturopathe)
  })

  it('makes no fiche when the fees cannot be read: never a wrong « À confirmer » to a client', async () => {
    renderMenu()
    mocks.fetchPublicFees.mockRejectedValue(Object.assign(new Error('x'), { code: 'PGRST301' }))
    await open()
    await userEvent.click(await screen.findByRole('menuitem', { name: t(`${M}.download`) }))
    await waitFor(() => expect(mocks.toastError).toHaveBeenCalled())
    expect(mocks.saveBlob).not.toHaveBeenCalled()
    expect(mocks.markFicheGenerated).not.toHaveBeenCalled()
  })

  it('makes no fiche when the render options cannot be read: never one showing what the clinic hides (P4-353)', async () => {
    renderMenu()
    mocks.fetchProfessionalsSettings.mockRejectedValue(new TypeError('Failed to fetch'))
    await open()
    await userEvent.click(await screen.findByRole('menuitem', { name: t(`${M}.download`) }))
    await waitFor(() => expect(mocks.toastError).toHaveBeenCalled())
    expect(mocks.renderFichePdf).not.toHaveBeenCalled()
    expect(mocks.saveBlob).not.toHaveBeenCalled()
  })

  it('makes a fiche for any status (a draft can be previewed)', async () => {
    renderMenu(recordWithStatus('draft', false))
    await open()
    await userEvent.click(await screen.findByRole('menuitem', { name: t(`${M}.download`) }))
    await waitFor(() => expect(mocks.saveBlob).toHaveBeenCalled())
  })

  it('says so when the fiche cannot be made, and saves nothing', async () => {
    renderMenu()
    mocks.renderFichePdf.mockRejectedValue(new Error('font fetch failed'))
    await open()
    await userEvent.click(await screen.findByRole('menuitem', { name: t(`${M}.download`) }))
    await waitFor(() => expect(mocks.toastError).toHaveBeenCalledWith(t('modules.professionals.fiche.errors.render')))
    expect(mocks.saveBlob).not.toHaveBeenCalled()
    expect(mocks.markFicheGenerated).not.toHaveBeenCalled()
  })

  it('asks for a reload when the renderer belongs to an older deploy', async () => {
    renderMenu()
    mocks.renderFichePdf.mockRejectedValue(new TypeError('Failed to fetch dynamically imported module: /assets/generate-fiche-pdf-abc.js'))
    await open()
    await userEvent.click(await screen.findByRole('menuitem', { name: t(`${M}.download`) }))
    await waitFor(() => expect(mocks.toastError).toHaveBeenCalledWith(t('modules.professionals.fiche.errors.appUpdated')))
  })

  it('keeps the file when only the stamp fails: nothing shown', async () => {
    renderMenu()
    mocks.markFicheGenerated.mockRejectedValue(Object.assign(new Error('x'), { code: '42501' }))
    await open()
    await userEvent.click(await screen.findByRole('menuitem', { name: t(`${M}.download`) }))
    await waitFor(() => expect(mocks.markFicheGenerated).toHaveBeenCalled())
    expect(mocks.saveBlob).toHaveBeenCalled()
    expect(mocks.toastError).not.toHaveBeenCalled()
  })

  it('shows it is busy while the fiche is being made, and takes no second request', async () => {
    renderMenu()
    let finish: (blob: Blob) => void = () => undefined
    mocks.renderFichePdf.mockReturnValue(new Promise<Blob>((resolve) => (finish = resolve)))
    await open()
    await userEvent.click(await screen.findByRole('menuitem', { name: t(`${M}.download`) }))
    const trigger = screen.getByRole('button', { name: t(`${M}.trigger`) })
    await waitFor(() => expect(trigger).toHaveAttribute('aria-busy', 'true'))
    await open()
    expect(await screen.findByRole('menuitem', { name: t(`${M}.download`) })).toHaveAttribute('aria-disabled', 'true')
    await userEvent.keyboard('{Escape}')
    finish(PDF)
    await waitFor(() => expect(trigger).not.toHaveAttribute('aria-busy'))
    expect(mocks.renderFichePdf).toHaveBeenCalledTimes(1)
  })
})
