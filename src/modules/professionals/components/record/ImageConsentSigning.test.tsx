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
  contracts: { fetchProfessionalImageConsent: vi.fn(), sendProfessionalContract: vi.fn() },
  record: { fetchProfessionalRecord: vi.fn() },
  toast: { success: vi.fn(), error: vi.fn(), warning: vi.fn() },
}))
vi.mock('../../api/contracts', async (importOriginal) => ({ ...(await importOriginal<typeof import('../../api/contracts')>()), ...mocks.contracts }))
vi.mock('../../api/record', async (importOriginal) => ({ ...(await importOriginal<typeof import('../../api/record')>()), ...mocks.record }))
vi.mock('@/shared/ui/sonner', () => ({ toast: mocks.toast }))
vi.mock('@sentry/react', () => ({ captureException: vi.fn() }))

afterEach(() => vi.clearAllMocks())

const I = 'modules.professionals.imageConsent'

/** The consent's card has no clinic signer and is read with professionals.view (P4-483). */
const consentJson = (request: Record<string, unknown> | null) => {
  const { clinic_signer: _signer, ...json } = contractJson(request === null ? null : { ...request, can_read: true })
  return json
}

async function open(json: Record<string, unknown> | null, { role = 'admin', permissions }: { role?: FixtureRole; permissions?: string[] } = {}) {
  mocks.contracts.fetchProfessionalImageConsent.mockResolvedValue(json === null ? null : parsedContract(json))
  mocks.record.fetchProfessionalRecord.mockResolvedValue(recordFixture())
  renderRecordTab(<ImageConsentSigning />, { record: recordFixture(), role, permissions })
  await screen.findByText(t(`${I}.heading`))
  await waitFor(() => expect(screen.queryByText(t('common.loading'))).not.toBeInTheDocument())
}

describe('ImageConsentSigning (P4-480 – P4-486)', () => {
  it('nothing sent: « Envoyer pour signature » after a confirmation, sent as the image consent', async () => {
    mocks.contracts.sendProfessionalContract.mockResolvedValue(REQUEST_ID)
    await open(consentJson(null))
    expect(screen.getByText(t(`${I}.state.none`))).toBeInTheDocument()
    expect(screen.getByText(t(`${I}.none`, { firstName: 'Marie' }))).toBeInTheDocument()
    await userEvent.click(screen.getByRole('button', { name: t(`${I}.actions.send`) }))
    const dialog = await screen.findByRole('alertdialog', { name: t(`${I}.confirm.send.title`, { firstName: 'Marie' }) })
    await userEvent.click(within(dialog).getByRole('button', { name: t(`${I}.confirm.send.action`) }))
    await waitFor(() =>
      expect(mocks.contracts.sendProfessionalContract).toHaveBeenCalledExactlyOnceWith(IDS.professional, 'send', expect.any(String), 'image_consent'),
    )
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
    mocks.contracts.sendProfessionalContract.mockResolvedValue(REQUEST_ID)
    await open(consentJson(SIGNED_REQUEST))
    expect(screen.getByText(/Signé le/, { selector: 'p' })).toBeInTheDocument()
    expect(screen.getByText(t(`${I}.signedHelp`))).toBeInTheDocument()
    expect(screen.queryByRole('button', { name: t('modules.professionals.contract.actions.pdf') })).not.toBeInTheDocument()
    await userEvent.click(screen.getByRole('button', { name: t(`${I}.actions.renew`) }))
    const dialog = await screen.findByRole('alertdialog', { name: t(`${I}.confirm.renew.title`, { firstName: 'Marie' }) })
    await userEvent.click(within(dialog).getByRole('button', { name: t(`${I}.confirm.renew.action`) }))
    await waitFor(() => expect(mocks.contracts.sendProfessionalContract).toHaveBeenCalledWith(IDS.professional, 'send', expect.any(String), 'image_consent'))
  })
})
