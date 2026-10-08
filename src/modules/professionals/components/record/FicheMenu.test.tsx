import { afterEach, describe, expect, it, vi } from 'vitest'
import { screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { t } from '@/i18n'
import type { ProfessionalRecord } from '../../api/parse'
import { IDS } from '../../test/fixtures'
import { recordWithStatus } from '../../test/fixtures-domain'
import { renderRecordTab } from '../../test/record-tab'
import { FicheMenu } from './FicheMenu'

const mocks = vi.hoisted(() => ({
  renderFichePdf: vi.fn(),
  saveBlob: vi.fn(),
  markFicheGenerated: vi.fn(),
  fetchOrganization: vi.fn(),
  toastError: vi.fn(),
}))
vi.mock('../../pdf/generate-fiche-pdf', () => ({ renderFichePdf: mocks.renderFichePdf }))
vi.mock('@/shared/lib/files', async (importOriginal) => ({ ...(await importOriginal<typeof import('@/shared/lib/files')>()), saveBlob: mocks.saveBlob }))
vi.mock('../../api/fiche', () => ({ markFicheGenerated: mocks.markFicheGenerated }))
vi.mock('@/core/settings/organization/api', () => ({ fetchOrganization: mocks.fetchOrganization }))
vi.mock('@/shared/ui/sonner', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@/shared/ui/sonner')>()),
  toast: { error: mocks.toastError, success: vi.fn() },
}))
vi.mock('@sentry/react', () => ({ captureException: vi.fn() }))

const M = 'modules.professionals.fiche.menu'
const ORGANIZATION = { name: 'Clinique MANA', phone: null, email: null, website: null, logo_file_id: null }
const PDF = new Blob(['%PDF-1.3'], { type: 'application/pdf' })

afterEach(() => vi.resetAllMocks())

function renderMenu(record: ProfessionalRecord = recordWithStatus('active', true)) {
  mocks.fetchOrganization.mockResolvedValue(ORGANIZATION)
  mocks.renderFichePdf.mockResolvedValue(PDF)
  mocks.markFicheGenerated.mockResolvedValue(undefined)
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
    expect(mocks.renderFichePdf).toHaveBeenCalledWith(expect.objectContaining({ record, titleId: IDS.psychologue, organization: ORGANIZATION }))
    expect(mocks.saveBlob).toHaveBeenCalledWith(PDF, 'Fiche - Marie Tremblay.pdf')
    const [saved, stamped] = [mocks.saveBlob.mock.invocationCallOrder[0], mocks.markFicheGenerated.mock.invocationCallOrder[0]]
    expect(saved).toBeLessThan(stamped ?? 0)
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
    const items = await screen.findAllByRole('menuitem')
    expect(items.map((item) => item.getAttribute('aria-label'))).toEqual([
      t(`${M}.downloadTitle`, { title: 'Psychologue' }),
      t(`${M}.downloadTitle`, { title: 'Naturopathe' }),
    ])
    await userEvent.click(items[1] as HTMLElement)
    await waitFor(() => expect(mocks.renderFichePdf).toHaveBeenCalledWith(expect.objectContaining({ titleId: IDS.naturopathe })))
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
