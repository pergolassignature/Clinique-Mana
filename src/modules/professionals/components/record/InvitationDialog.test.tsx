import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { act, cleanup, screen, waitFor, within } from '@testing-library/react'
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
  // Thursday 8 October 2026, 16:00 in Toronto: the fixtures' links are live.
  vi.useFakeTimers({ toFake: ['Date'] })
  vi.setSystemTime(new Date('2026-10-08T20:00:00Z'))
  mocks.settings.fetchProfessionalsSettings.mockResolvedValue({ collectSin: false, invitationExpiryDays: 7, invitationReminderAfterDays: 3 })
})
afterEach(() => {
  vi.useRealTimers()
  vi.clearAllMocks()
})

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

  it('too many calls (the file’s 5 s guard or the hourly count): one plain sentence that names neither, in the dialog', async () => {
    mocks.invitations.sendProfessionalInvitation.mockRejectedValueOnce(new FunctionCallError('rate_limited', 429, 'Too many', {}, 5))
    mocks.invitations.sendProfessionalInvitation.mockRejectedValueOnce(new FunctionCallError('rate_limited', 429, 'Too many', {}, 2700))
    const { dialog } = await choose(t(`${A}.resend`), { onboarding: live })
    const confirm = within(dialog).getByRole('button', { name: t(`${A}.resend`) })
    await userEvent.click(confirm)
    expect(await within(dialog).findByRole('alert')).toHaveTextContent('Trop de demandes en peu de temps. Réessayez dans un instant.')
    expect(dialog).not.toHaveTextContent(/vient d.être envoyée/)
    // Not final: the same button can try again.
    await userEvent.click(confirm)
    await waitFor(() => expect(within(dialog).getByRole('alert')).toHaveTextContent('Trop de demandes en peu de temps. Réessayez dans environ 45 minutes.'))
  })

  it('a second press before the first renders as pending is ignored: one call, and the dialog closes on its success', async () => {
    mocks.invitations.sendProfessionalInvitation.mockResolvedValue({ expiresAt: '2026-10-15T14:00:00Z', emailProblem: null })
    const { dialog } = await choose(t(`${A}.resend`), { onboarding: live })
    const confirm = within(dialog).getByRole('button', { name: t(`${A}.resend`) })
    act(() => {
      confirm.click()
      confirm.click()
    })
    await waitFor(() => expect(screen.queryByRole('alertdialog')).not.toBeInTheDocument())
    expect(mocks.invitations.sendProfessionalInvitation).toHaveBeenCalledOnce()
  })

  it.each([
    ['account', 'Ce professionnel a déjà un compte.'],
    ['status', "Un dossier inactif ne peut pas recevoir d'invitation."],
    ['invitation', 'Aucune invitation en cours.'],
  ])('a refusal a retry cannot change (%s): the database’s sentence, the file refetched, « Fermer » only', async (hint, message) => {
    mocks.invitations.sendProfessionalInvitation.mockRejectedValue({ code: 'P0001', message, hint })
    const { dialog, invalidated } = await choose(t(`${A}.send`))
    await userEvent.click(within(dialog).getByRole('button', { name: t(`${A}.send`) }))
    expect(await within(dialog).findByRole('alert')).toHaveTextContent(message)
    await waitFor(() => expect(invalidated()).toContainEqual(professionalKeys.record(ID)))
    expect(within(dialog).queryByRole('button', { name: t(`${A}.send`) })).not.toBeInTheDocument()
    await userEvent.click(within(dialog).getByRole('button', { name: t('common.close') }))
    await waitFor(() => expect(screen.queryByRole('alertdialog')).not.toBeInTheDocument())
  })

  it('the function failing otherwise (unreachable answer): says which action failed', async () => {
    mocks.invitations.revokeProfessionalInvitation.mockRejectedValue(new FunctionCallError('internal', 404, 'Unexpected answer'))
    const { dialog } = await choose(t(`${A}.revoke`), { onboarding: live })
    await userEvent.click(within(dialog).getByRole('button', { name: t(`${A}.revoke`) }))
    expect(await within(dialog).findByRole('alert')).toHaveTextContent(t(`${O}.errors.revokeFailed`))
  })

  it('« Révoquer l’invitation » mentions the questionnaire only when one was sent', async () => {
    const { dialog } = await choose(t(`${A}.revoke`), { onboarding: live })
    expect(dialog).toHaveAccessibleDescription(
      'Le lien envoyé à marie.t@exemple.ca ne fonctionnera plus. Vous pourrez inviter Marie de nouveau. Le dossier redeviendra « À inviter ».',
    )
    cleanup()
    const sent: Onboarding = { ...live, submission: { id: 's1', kind: 'onboarding', status: 'submitted', submittedAt: '2026-10-07T14:00:00Z' } }
    const again = await choose(t(`${A}.revoke`), { onboarding: sent })
    expect(again.dialog).toHaveAccessibleDescription(/ne fonctionnera plus\. Le questionnaire envoyé sera fermé sans être appliqué\. Vous pourrez/)
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

  it('a refused address on an update request: corrected in « Mon compte », and the request stays open', async () => {
    mocks.invitations.requestProfessionalUpdate.mockResolvedValue({ submissionId: 's1', emailProblem: { code: 'invalid_request', retryAfter: null } })
    const { dialog } = await choose(t(`${A}.requestUpdate`), { complete: true, onboarding: approved })
    await userEvent.click(within(dialog).getByRole('checkbox', { name: t(`${O}.sections.photo`) }))
    await userEvent.click(within(dialog).getByRole('button', { name: t(`${U}.confirm`) }))
    await waitFor(() => expect(mocks.toast.warning).toHaveBeenCalledWith(t(`${O}.toasts.updateNotSent`), {
      description:
        "Le service d'envoi a refusé l'adresse du dossier. Marie a un compte : c'est dans « Mon compte » que cette adresse se modifie (il n'y a pas d'invitation à renvoyer). " +
        "La demande reste ouverte : prévenez Marie qu'elle l'attend dans son questionnaire.",
    }))
  })
})
