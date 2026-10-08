import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { t } from '@/i18n'
import { FunctionCallError } from '@/core/supabase/functions'
import type { Onboarding } from '../../api/parse'
import { professionalKeys } from '../../hooks/keys'
import { recordWithStatus } from '../../test/fixtures-domain'
import { IDS } from '../../test/fixtures'
import { renderRecordTab } from '../../test/record-tab'
import { RecordActions } from './RecordActions'

const mocks = vi.hoisted(() => ({
  record: { fetchProfessionalRecord: vi.fn() },
  invitations: { sendProfessionalInvitation: vi.fn(), revokeProfessionalInvitation: vi.fn(), requestProfessionalUpdate: vi.fn() },
  settings: { fetchProfessionalsSettings: vi.fn() },
  toast: { success: vi.fn(), error: vi.fn(), warning: vi.fn() },
}))
vi.mock('../../api/record', async (importOriginal) => ({ ...(await importOriginal<typeof import('../../api/record')>()), ...mocks.record }))
vi.mock('../../api/invitations', async (importOriginal) => ({ ...(await importOriginal<typeof import('../../api/invitations')>()), ...mocks.invitations }))
vi.mock('../../api/settings', async (importOriginal) => ({ ...(await importOriginal<typeof import('../../api/settings')>()), ...mocks.settings }))
vi.mock('@/shared/ui/sonner', () => ({ toast: mocks.toast }))
vi.mock('@sentry/react', () => ({ captureException: vi.fn() }))

const A = 'modules.professionals.onboarding.actions'
const O = 'modules.professionals.onboarding'
const ID = IDS.professional

const live: Onboarding = {
  invitation: { state: 'sent', sentAt: '2026-10-05T14:00:00Z', expiresAt: '2026-10-12T14:00:00Z', openedAt: null, usedAt: null },
  submission: null,
  onboardingApproved: false,
}

beforeEach(() => {
  mocks.settings.fetchProfessionalsSettings.mockResolvedValue({ collectSin: false, invitationExpiryDays: 7, invitationReminderAfterDays: 3 })
})
afterEach(() => vi.clearAllMocks())

/** The adjointe opens a menu item of a file. */
async function choose(item: string, { complete = false, onboarding = null as Onboarding | null } = {}) {
  const record = recordWithStatus(complete ? 'active' : 'invited', complete)
  mocks.record.fetchProfessionalRecord.mockResolvedValue(record)
  const rendered = renderRecordTab(<RecordActions />, { record, role: 'admin_assistant', onboarding })
  await userEvent.click(screen.getByRole('button', { name: t('modules.professionals.record.actions.more') }))
  await userEvent.click(await screen.findByRole('menuitem', { name: item }))
  return { ...rendered, dialog: await screen.findByRole(item === t(`${A}.requestUpdate`) ? 'dialog' : 'alertdialog') }
}

describe('InvitationDialog', () => {
  it('« Envoyer l’invitation »: names the address and the link’s lifetime, then toasts where it went', async () => {
    mocks.invitations.sendProfessionalInvitation.mockResolvedValue({ expiresAt: '2026-10-15T14:00:00Z', emailProblem: null })
    const { dialog, invalidated } = await choose(t(`${A}.send`))
    await waitFor(() => expect(dialog).toHaveAccessibleDescription(/marie\.t@exemple\.ca.*Le lien sera valide 7 jours\./))
    await userEvent.click(within(dialog).getByRole('button', { name: t(`${A}.send`) }))
    await waitFor(() => expect(screen.queryByRole('alertdialog')).not.toBeInTheDocument())
    expect(mocks.invitations.sendProfessionalInvitation).toHaveBeenCalledExactlyOnceWith(ID, 'send')
    expect(mocks.toast.success).toHaveBeenCalledWith(t(`${O}.toasts.sentExpires`, { email: 'marie.t@exemple.ca', date: '15 oct. 2026' }))
    expect(invalidated()).toEqual(expect.arrayContaining([professionalKeys.record(ID), professionalKeys.lists(), professionalKeys.history(ID)]))
  })

  it('the link created but not emailed: a warning that says « Renvoyer l’invitation »', async () => {
    mocks.invitations.sendProfessionalInvitation.mockResolvedValue({ expiresAt: null, emailProblem: { code: 'provider_error', retryAfter: null } })
    const { dialog } = await choose(t(`${A}.resend`), { onboarding: live })
    await userEvent.click(within(dialog).getByRole('button', { name: t(`${A}.resend`) }))
    await waitFor(() => expect(mocks.toast.warning).toHaveBeenCalledWith(t(`${O}.toasts.createdNotSent`), {
      description: `${t(`${O}.emailProblems.provider_error`)} ${t(`${O}.emailAdvice.invitation`)}`,
    }))
  })

  it('a refused address: what to correct, no « Renvoyer » advice', async () => {
    mocks.invitations.sendProfessionalInvitation.mockResolvedValue({ expiresAt: null, emailProblem: { code: 'invalid_request', retryAfter: null } })
    const { dialog } = await choose(t(`${A}.send`))
    await userEvent.click(within(dialog).getByRole('button', { name: t(`${A}.send`) }))
    await waitFor(() => expect(mocks.toast.warning).toHaveBeenCalledWith(t(`${O}.toasts.createdNotSent`), { description: t(`${O}.emailProblems.invalid_request`) }))
  })

  it('a double click refused by the file’s guard stays in the dialog, in plain words', async () => {
    mocks.invitations.sendProfessionalInvitation.mockRejectedValue(new FunctionCallError('rate_limited', 429, 'Too many', {}, 5))
    const { dialog } = await choose(t(`${A}.resend`), { onboarding: live })
    await userEvent.click(within(dialog).getByRole('button', { name: t(`${A}.resend`) }))
    expect(await within(dialog).findByRole('alert')).toHaveTextContent(t(`${O}.errors.justSent`))
  })

  it('a refusal (the file got an account meanwhile) shows the database’s sentence and refetches the file', async () => {
    mocks.invitations.sendProfessionalInvitation.mockRejectedValue({ code: 'P0001', message: 'Ce professionnel a déjà un compte.', hint: 'account' })
    const { dialog, invalidated } = await choose(t(`${A}.send`))
    await userEvent.click(within(dialog).getByRole('button', { name: t(`${A}.send`) }))
    expect(await within(dialog).findByRole('alert')).toHaveTextContent('Ce professionnel a déjà un compte.')
    await waitFor(() => expect(invalidated()).toContainEqual(professionalKeys.record(ID)))
  })

  it('the function failing otherwise (unreachable answer): says which action failed', async () => {
    mocks.invitations.revokeProfessionalInvitation.mockRejectedValue(new FunctionCallError('internal', 404, 'Unexpected answer'))
    const { dialog } = await choose(t(`${A}.revoke`), { onboarding: live })
    await userEvent.click(within(dialog).getByRole('button', { name: t(`${A}.revoke`) }))
    expect(await within(dialog).findByRole('alert')).toHaveTextContent(t(`${O}.errors.revokeFailed`))
  })

  it('« Révoquer l’invitation »: confirmed, then « Invitation révoquée »', async () => {
    mocks.invitations.revokeProfessionalInvitation.mockResolvedValue(undefined)
    const { dialog } = await choose(t(`${A}.revoke`), { onboarding: live })
    await userEvent.click(within(dialog).getByRole('button', { name: t(`${A}.revoke`) }))
    await waitFor(() => expect(mocks.toast.success).toHaveBeenCalledWith(t(`${O}.toasts.revoked`)))
    expect(mocks.invitations.revokeProfessionalInvitation).toHaveBeenCalledExactlyOnceWith(ID)
  })
})

describe('RequestUpdateDialog', () => {
  const U = `${O}.requestUpdate`
  const approved: Onboarding = { invitation: null, submission: null, onboardingApproved: true }

  it('asks for at least one section, then sends them in the questionnaire’s order', async () => {
    mocks.invitations.requestProfessionalUpdate.mockResolvedValue({ submissionId: 's1', emailProblem: null })
    const { dialog } = await choose(t(`${A}.requestUpdate`), { complete: true, onboarding: approved })
    expect(within(dialog).getAllByRole('checkbox')).toHaveLength(11)
    await userEvent.click(within(dialog).getByRole('button', { name: t(`${U}.confirm`) }))
    expect(within(dialog).getByRole('alert')).toHaveTextContent(t(`${U}.required`))
    expect(mocks.invitations.requestProfessionalUpdate).not.toHaveBeenCalled()
    await userEvent.click(within(dialog).getByRole('checkbox', { name: t(`${O}.sections.languages`) }))
    await userEvent.click(within(dialog).getByRole('checkbox', { name: t(`${O}.sections.portrait`) }))
    await userEvent.click(within(dialog).getByRole('button', { name: t(`${U}.confirm`) }))
    await waitFor(() => expect(screen.queryByRole('dialog')).not.toBeInTheDocument())
    expect(mocks.invitations.requestProfessionalUpdate).toHaveBeenCalledExactlyOnceWith(ID, ['portrait', 'languages'])
    expect(mocks.toast.success).toHaveBeenCalledWith(t(`${O}.toasts.updateSent`, { email: 'marie.t@exemple.ca' }))
  })

  it('the request open but its email failed: says so, and how the professional finds it (P4-267)', async () => {
    mocks.invitations.requestProfessionalUpdate.mockResolvedValue({ submissionId: 's1', emailProblem: { code: 'provider_error', retryAfter: null } })
    const { dialog } = await choose(t(`${A}.requestUpdate`), { complete: true, onboarding: approved })
    await userEvent.click(within(dialog).getByRole('checkbox', { name: t(`${O}.sections.photo`) }))
    await userEvent.click(within(dialog).getByRole('button', { name: t(`${U}.confirm`) }))
    await waitFor(() => expect(mocks.toast.warning).toHaveBeenCalledWith(t(`${O}.toasts.updateNotSent`), {
      description: `${t(`${O}.emailProblems.provider_error`)} ${t(`${O}.emailAdvice.update`, { firstName: 'Marie' })}`,
    }))
  })
})
