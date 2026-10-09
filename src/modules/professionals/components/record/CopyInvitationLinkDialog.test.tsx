import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { t } from '@/i18n'
import { FunctionCallError } from '@/core/supabase/functions'
import type { Onboarding } from '../../api/parse'
import { recordWithStatus } from '../../test/fixtures-domain'
import { IDS } from '../../test/fixtures'
import { renderRecordTab } from '../../test/record-tab'
import { RecordActions } from './RecordActions'

const mocks = vi.hoisted(() => ({
  record: { fetchProfessionalRecord: vi.fn() },
  invitations: { copyProfessionalInvitationLink: vi.fn() },
  settings: { fetchProfessionalsSettings: vi.fn() },
  toast: { success: vi.fn(), error: vi.fn(), warning: vi.fn() },
}))
vi.mock('../../api/record', async (importOriginal) => ({ ...(await importOriginal<typeof import('../../api/record')>()), ...mocks.record }))
vi.mock('../../api/invitations', async (importOriginal) => ({ ...(await importOriginal<typeof import('../../api/invitations')>()), ...mocks.invitations }))
vi.mock('../../api/settings', async (importOriginal) => ({ ...(await importOriginal<typeof import('../../api/settings')>()), ...mocks.settings }))
vi.mock('@/shared/ui/sonner', () => ({ toast: mocks.toast }))
vi.mock('@sentry/react', () => ({ captureException: vi.fn() }))

const A = 'modules.professionals.onboarding.actions'
const D = 'modules.professionals.onboarding.copyLink'
const URL_ = 'http://localhost:5173/invitation#t=AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA'

const notSent: Onboarding = {
  invitation: {
    state: 'sent',
    sentAt: '2026-10-05T14:00:00Z',
    expiresAt: '2026-10-12T14:00:00Z',
    openedAt: null,
    usedAt: null,
    delivery: 'email',
    emailStatus: null,
    emailError: 'not_configured',
  },
  submission: null,
  onboardingApproved: false,
}

beforeEach(() => {
  vi.useFakeTimers({ toFake: ['Date'] })
  vi.setSystemTime(new Date('2026-10-08T20:00:00Z'))
  mocks.settings.fetchProfessionalsSettings.mockResolvedValue({ collectSin: false, invitationExpiryDays: 7, invitationReminderAfterDays: 3 })
})
afterEach(() => {
  vi.useRealTimers()
  vi.clearAllMocks()
})

/** The adjointe chooses « Copier le lien d'invitation » in the header's menu. */
async function openDialog(onboarding: Onboarding | null = notSent) {
  const record = recordWithStatus('invited', false)
  mocks.record.fetchProfessionalRecord.mockResolvedValue(record)
  const rendered = renderRecordTab(<RecordActions />, { record, role: 'admin_assistant', onboarding })
  await userEvent.click(screen.getByRole('button', { name: t('modules.professionals.record.actions.more') }))
  await userEvent.click(await screen.findByRole('menuitem', { name: t(`${A}.copyLink`) }))
  return { ...rendered, dialog: await screen.findByRole('alertdialog') }
}

describe('CopyInvitationLinkDialog (P4-491)', () => {
  it('confirms first: a new link without email, the live one stopping, its lifetime; nothing called yet', async () => {
    const { dialog } = await openDialog()
    expect(dialog).toHaveAccessibleName("Copier le lien d'invitation pour Marie Tremblay ?")
    await waitFor(() =>
      expect(dialog).toHaveAccessibleDescription(
        'Un nouveau lien sera créé pour Marie, sans courriel : vous le lui transmettez vous-même (texto, votre propre courriel…). Le lien du 5 oct. ne fonctionnera plus. Le lien sera valide 7 jours.',
      ),
    )
    expect(mocks.invitations.copyProfessionalInvitationLink).not.toHaveBeenCalled()
  })

  it('without a live link, says nothing of a previous one', async () => {
    const { dialog } = await openDialog(null)
    expect(dialog).not.toHaveAccessibleDescription(/ne fonctionnera plus/)
  })

  it('« Créer le lien » shows the link once, read-only, with « Copier » and the warning; nothing cached', async () => {
    mocks.invitations.copyProfessionalInvitationLink.mockResolvedValue({ url: URL_, expiresAt: '2026-10-15T14:00:00Z' })
    const writeText = vi.fn(async () => undefined)
    Object.defineProperty(navigator, 'clipboard', { value: { writeText }, configurable: true })
    const { dialog, queryClient } = await openDialog()
    await userEvent.click(within(dialog).getByRole('button', { name: t(`${D}.confirm`) }))
    const ready = await screen.findByRole('alertdialog', { name: "Lien d'invitation pour Marie Tremblay" })
    expect(mocks.invitations.copyProfessionalInvitationLink).toHaveBeenCalledWith(IDS.professional)
    expect(ready).toHaveAccessibleDescription("Ce lien permet à Marie de créer son accès. Ne le transmettez qu'à cette personne. Il expire le 15 oct. 2026.")
    const field = within(ready).getByRole('textbox', { name: t(`${D}.label`) })
    expect(field).toHaveValue(URL_)
    expect(field).toHaveAttribute('readonly')
    await userEvent.click(within(ready).getByRole('button', { name: t(`${D}.copy`) }))
    expect(writeText).toHaveBeenCalledWith(URL_)
    expect(await within(ready).findByRole('status')).toHaveTextContent(t(`${D}.copied`))
    // Neither the query cache nor the mutation cache holds it.
    expect(JSON.stringify(queryClient.getQueryCache().getAll().map((q) => q.state.data))).not.toContain('#t=')
    expect(JSON.stringify(queryClient.getMutationCache().getAll().map((m) => m.state.data))).not.toContain('#t=')
    // « Fermer » drops it.
    await userEvent.click(within(ready).getByRole('button', { name: t('common.close') }))
    await waitFor(() => expect(screen.queryByRole('alertdialog')).not.toBeInTheDocument())
    expect(screen.queryByDisplayValue(URL_)).not.toBeInTheDocument()
  })

  it('a refused copy (an account was created meanwhile) stays in the dialog with « Fermer » only', async () => {
    mocks.invitations.copyProfessionalInvitationLink.mockRejectedValue({ code: 'P0001', message: 'Ce professionnel a déjà un compte.', hint: 'account' })
    const { dialog } = await openDialog()
    await userEvent.click(within(dialog).getByRole('button', { name: t(`${D}.confirm`) }))
    expect(await within(dialog).findByRole('alert')).toHaveTextContent('Ce professionnel a déjà un compte.')
    expect(within(dialog).queryByRole('button', { name: t(`${D}.confirm`) })).not.toBeInTheDocument()
    expect(within(dialog).getByRole('button', { name: t('common.close') })).toBeInTheDocument()
  })

  it('too many calls: one plain sentence in the dialog, the button stays', async () => {
    mocks.invitations.copyProfessionalInvitationLink.mockRejectedValue(new FunctionCallError('rate_limited', 429, 'Too many', {}, 5))
    const { dialog } = await openDialog()
    await userEvent.click(within(dialog).getByRole('button', { name: t(`${D}.confirm`) }))
    expect(await within(dialog).findByRole('alert')).toHaveTextContent(/^Trop de demandes en peu de temps\. Réessayez dans/)
    expect(within(dialog).getByRole('button', { name: t(`${D}.confirm`) })).toBeInTheDocument()
  })
})
