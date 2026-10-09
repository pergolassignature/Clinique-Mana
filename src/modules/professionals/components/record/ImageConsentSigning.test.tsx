import { afterEach, describe, expect, it, vi } from 'vitest'
import { screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { t } from '@/i18n'
import type { FixtureRole } from '@/test/role-fixtures'
import { IDS } from '../../test/fixtures'
import { contractJson, parsedContract, REQUEST_ID, requestJson, SIGNED_REQUEST } from '../../test/fixtures-contract'
import { recordFixture } from '../../test/fixtures-domain'
import { renderRecordTab } from '../../test/record-tab'
import { ImageConsentSigning } from './ImageConsentSigning'

const mocks = vi.hoisted(() => ({
  contracts: { fetchProfessionalImageConsent: vi.fn(), sendProfessionalContract: vi.fn(), previewProfessionalContract: vi.fn() },
  record: { fetchProfessionalRecord: vi.fn() },
  toast: { success: vi.fn(), error: vi.fn(), warning: vi.fn() },
}))
vi.mock('../../api/contracts', async (importOriginal) => ({ ...(await importOriginal<typeof import('../../api/contracts')>()), ...mocks.contracts }))
vi.mock('../../api/record', async (importOriginal) => ({ ...(await importOriginal<typeof import('../../api/record')>()), ...mocks.record }))
vi.mock('@/shared/ui/sonner', () => ({ toast: mocks.toast }))
vi.mock('@sentry/react', () => ({ captureException: vi.fn() }))

afterEach(() => vi.clearAllMocks())
// jsdom has no blob URLs (and would fetch one in the iframe): the preview's PDF is shown through one (P4-502).
Object.assign(URL, { createObjectURL: vi.fn(() => 'about:blank#pdf'), revokeObjectURL: vi.fn() })
const PREVIEW = { bytes: new Uint8Array([37, 80, 68, 70]), pageCount: 2, title: 'Consentement', signers: [{ role: 'professional', name: 'Marie Tremblay', order: 1 }], summary: [] }

const I = 'modules.professionals.imageConsent'

/** The consent's card has no clinic signer and is read with professionals.view (P4-484). */
const consentJson = (request: Record<string, unknown> | null) => {
  const json = contractJson(request === null ? null : { ...request, can_read: true })
  delete json.clinic_signer
  return json
}

async function open(json: Record<string, unknown> | null, { role = 'admin', permissions }: { role?: FixtureRole; permissions?: string[] } = {}) {
  mocks.contracts.fetchProfessionalImageConsent.mockResolvedValue(json === null ? null : parsedContract(json))
  mocks.record.fetchProfessionalRecord.mockResolvedValue(recordFixture())
  renderRecordTab(<ImageConsentSigning />, { record: recordFixture(), role, permissions })
  await screen.findByText(t(`${I}.heading`))
  await waitFor(() => expect(screen.queryByText(t('common.loading'))).not.toBeInTheDocument())
}

describe('ImageConsentSigning (P4-481 – P4-486)', () => {
  it('nothing sent: « Envoyer pour signature » shows the form first (P4-502), then sends it as the image consent', async () => {
    mocks.contracts.previewProfessionalContract.mockResolvedValue(PREVIEW)
    mocks.contracts.sendProfessionalContract.mockResolvedValue(REQUEST_ID)
    await open(consentJson(null))
    expect(screen.getByText(t(`${I}.state.none`))).toBeInTheDocument()
    expect(screen.getByText(t(`${I}.none`, { firstName: 'Marie' }))).toBeInTheDocument()
    await userEvent.click(screen.getByRole('button', { name: t(`${I}.actions.send`) }))
    const dialog = await screen.findByRole('dialog', { name: t(`${I}.preview.title`, { firstName: 'Marie' }) })
    await within(dialog).findByTitle(t('modules.professionals.contract.preview.frameTitle'))
    const [, action, key, form] = mocks.contracts.previewProfessionalContract.mock.calls[0]!
    expect([action, form]).toEqual(['send', 'image_consent'])
    await userEvent.click(within(dialog).getByRole('button', { name: t(`${I}.preview.send`, { firstName: 'Marie' }) }))
    await waitFor(() => expect(mocks.contracts.sendProfessionalContract).toHaveBeenCalledExactlyOnceWith(IDS.professional, 'send', key, 'image_consent'))
    await waitFor(() => expect(mocks.toast.success).toHaveBeenCalledWith(t(`${I}.toasts.send`, { firstName: 'Marie' })))
  })

  it('the adjointe (professionals.manage, no compensation) may send it', async () => {
    await open(consentJson(null), { role: 'admin_assistant' })
    expect(screen.getByRole('button', { name: t(`${I}.actions.send`) })).toBeInTheDocument()
  })

  it('a conseillère sees the state without a send button', async () => {
    await open(consentJson(null), { role: 'counselor' })
    expect(screen.getByText(t(`${I}.state.none`))).toBeInTheDocument()
    expect(screen.queryByRole('button', { name: t(`${I}.actions.send`) })).not.toBeInTheDocument()
  })

  it('out for signature: « Envoyé le … », « Synchroniser », « Renvoyer le courriel », « Régénérer »', async () => {
    await open(consentJson(requestJson()))
    expect(screen.getByText(/Envoyé le/)).toBeInTheDocument()
    for (const name of [t('modules.professionals.contract.actions.sync'), t(`${I}.actions.resend`), t(`${I}.actions.regenerate`)]) {
      expect(screen.getByRole('button', { name })).toBeInTheDocument()
    }
  })

  it('signed: « Signé le … », the PDF is the document below, and a renewal is offered', async () => {
    mocks.contracts.previewProfessionalContract.mockResolvedValue(PREVIEW)
    mocks.contracts.sendProfessionalContract.mockResolvedValue(REQUEST_ID)
    await open(consentJson(SIGNED_REQUEST))
    expect(screen.getByText(/Signé le/, { selector: 'p' })).toBeInTheDocument()
    expect(screen.getByText(t(`${I}.signedHelp`))).toBeInTheDocument()
    expect(screen.queryByRole('button', { name: t('modules.professionals.contract.actions.pdf') })).not.toBeInTheDocument()
    await userEvent.click(screen.getByRole('button', { name: t(`${I}.actions.renew`) }))
    const dialog = await screen.findByRole('dialog', { name: t(`${I}.preview.title`, { firstName: 'Marie' }) })
    expect(dialog).toHaveTextContent(t(`${I}.confirm.renew.body`, { firstName: 'Marie', version: '2' }))
    await within(dialog).findByTitle(t('modules.professionals.contract.preview.frameTitle'))
    await userEvent.click(within(dialog).getByRole('button', { name: t(`${I}.preview.send`, { firstName: 'Marie' }) }))
    await waitFor(() => expect(mocks.contracts.sendProfessionalContract).toHaveBeenCalledWith(IDS.professional, 'send', expect.any(String), 'image_consent'))
  })
})
