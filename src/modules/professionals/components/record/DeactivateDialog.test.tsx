import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { t } from '@/i18n'
import { accessKeys } from '@/core/access/access-context'
import type { Onboarding, ProfessionalRecord, StatusChange } from '../../api/parse'
import { professionalCatalogKeys, professionalKeys } from '../../hooks/keys'
import { recordWithStatus } from '../../test/fixtures-domain'
import { IDS } from '../../test/fixtures'
import { HARNESS_HEADING } from '../../test/RecordHarness'
import { renderRecordTab } from '../../test/record-tab'
import { RecordActions } from './RecordActions'

const mocks = vi.hoisted(() => ({
  record: { fetchProfessionalRecord: vi.fn(), deactivateProfessional: vi.fn() },
  toast: { success: vi.fn(), error: vi.fn() },
  captureException: vi.fn(),
}))
vi.mock('../../api/record', async (importOriginal) => ({ ...(await importOriginal<typeof import('../../api/record')>()), ...mocks.record }))
vi.mock('@/shared/ui/sonner', () => ({ toast: mocks.toast }))
vi.mock('@sentry/react', () => ({ captureException: mocks.captureException }))

const D = 'modules.professionals.record.deactivate'
const ID = IDS.professional
const REQUIRED = t('common.form.required')
let stored: ProfessionalRecord

beforeEach(() => {
  mocks.record.fetchProfessionalRecord.mockImplementation(async () => stored)
  mocks.record.deactivateProfessional.mockImplementation(async (): Promise<StatusChange> => {
    stored = { ...stored, professional: { ...stored.professional, status: 'inactive' } }
    return { status: 'inactive', accountChange: null, profileId: null, signinSynced: true }
  })
})
afterEach(() => vi.clearAllMocks())

/** The adjointe on a complete draft, the « … » menu opened and « Désactiver » chosen. */
async function openDeactivate(record: ProfessionalRecord = recordWithStatus('draft', true), onboarding: Onboarding | null = null) {
  stored = record
  const rendered = renderRecordTab(<RecordActions />, { record, role: 'admin_assistant', onboarding })
  await userEvent.click(screen.getByRole('button', { name: t('modules.professionals.record.actions.more') }))
  await userEvent.click(await screen.findByRole('menuitem', { name: t('modules.professionals.record.actions.deactivate') }))
  await screen.findByRole('alertdialog')
  return rendered
}

const dialog = () => screen.getByRole('alertdialog')
const reasonSelect = () => within(dialog()).getByRole('combobox', { name: `${t(`${D}.reason`)} ${REQUIRED}` })
const noteField = () => within(dialog()).getByRole('textbox', { name: new RegExp(`^${t(`${D}.note`)}`) })
const confirmButton = () => within(dialog()).getByRole('button', { name: t(`${D}.confirm`) })
const fieldset = () => within(dialog()).getByRole('group')
const accountWarning = (firstName = 'Marie') => t(`${D}.accountOff`, { firstName })
const refusal = (message: string, hint: string) => ({ code: 'P0001', message, hint })

describe('DeactivateDialog', () => {
  it('opens from the « … » menu on the reason, offers the active reasons, and is destructive only on its confirm button', async () => {
    await openDeactivate()
    expect(within(dialog()).getByRole('heading', { name: t(`${D}.title`, { name: 'Marie Tremblay' }) })).toBeInTheDocument()
    expect(dialog()).toHaveAccessibleDescription(t(`${D}.body`, { firstName: 'Marie' }))
    expect(reasonSelect()).toHaveFocus()
    expect(within(reasonSelect()).getAllByRole('option').map((o) => o.textContent)).toEqual([t(`${D}.reasonPlaceholder`), 'Congé', 'Fin de collaboration', 'Autre'])
    expect(confirmButton()).toHaveClass('bg-destructive')
    expect(within(dialog()).getByRole('button', { name: t('common.cancel') })).not.toHaveClass('bg-destructive')
  })

  it('deactivates with the chosen reason and no note, toasts, then focuses the heading (no action left for the adjointe)', async () => {
    await openDeactivate(recordWithStatus('active', false))
    await userEvent.selectOptions(reasonSelect(), 'Congé')
    await userEvent.click(confirmButton())

    await waitFor(() => expect(screen.queryByRole('alertdialog')).not.toBeInTheDocument())
    expect(mocks.record.deactivateProfessional).toHaveBeenCalledExactlyOnceWith(ID, IDS.leave, null)
    expect(mocks.toast.success).toHaveBeenCalledWith(t('modules.professionals.toasts.deactivated'))
    // Inactive and incomplete: no « Réactiver » without the override, no menu; « Fiche PDF » stays.
    expect(screen.getAllByRole('button').map((b) => b.textContent)).toEqual([t('modules.professionals.fiche.menu.trigger')])
    await waitFor(() => expect(screen.getByRole('heading', { level: 1, name: HARNESS_HEADING })).toHaveFocus())
  })

  it('focuses « Réactiver » once inactive when the file can be reactivated', async () => {
    await openDeactivate(recordWithStatus('active', true))
    await userEvent.selectOptions(reasonSelect(), 'Congé')
    await userEvent.click(confirmButton())
    await waitFor(() => expect(screen.getByRole('button', { name: t('modules.professionals.record.actions.reactivate') })).toHaveFocus())
  })

  it('asks a reason first, and a note when the reason requires one (« Autre »), sent trimmed', async () => {
    await openDeactivate()
    await userEvent.click(confirmButton())
    expect(await within(dialog()).findByText(t('modules.professionals.validation.reasonRequired'))).toBeInTheDocument()
    expect(reasonSelect()).toHaveFocus()
    expect(noteField()).toHaveAccessibleName(t(`${D}.note`))

    await userEvent.selectOptions(reasonSelect(), 'Autre')
    expect(noteField()).toHaveAccessibleName(`${t(`${D}.note`)} ${REQUIRED}`)
    await userEvent.click(confirmButton())
    expect(await within(dialog()).findByText(t('modules.professionals.validation.noteRequired'))).toBeInTheDocument()
    expect(noteField()).toHaveFocus()
    expect(mocks.record.deactivateProfessional).not.toHaveBeenCalled()

    await userEvent.type(noteField(), '  Pause prolongée  ')
    await userEvent.click(confirmButton())
    await waitFor(() => expect(mocks.record.deactivateProfessional).toHaveBeenCalledExactlyOnceWith(ID, IDS.other, 'Pause prolongée'))
  })

  it('warns that the professional can no longer sign in, only for a reason that disables an existing account', async () => {
    const linked = recordWithStatus('active', true)
    linked.professional = { ...linked.professional, profileId: IDS.admin }
    await openDeactivate(linked)
    expect(within(dialog()).queryByText(accountWarning())).not.toBeInTheDocument()
    await userEvent.selectOptions(reasonSelect(), 'Fin de collaboration')
    expect(within(dialog()).getByText(accountWarning()).closest('[aria-live="polite"]')).not.toBeNull()
    await userEvent.selectOptions(reasonSelect(), 'Congé')
    expect(within(dialog()).queryByText(accountWarning())).not.toBeInTheDocument()
  })

  it('says nothing about an account the professional does not have', async () => {
    await openDeactivate(recordWithStatus('draft', false))
    await userEvent.selectOptions(reasonSelect(), 'Fin de collaboration')
    expect(within(dialog()).queryByText(accountWarning())).not.toBeInTheDocument()
  })

  it('says the invitation link stops working and the questionnaire in progress closes (4b.1, P4-301)', async () => {
    const invited = recordWithStatus('invited', false)
    await openDeactivate(invited, {
      invitation: { state: 'sent', sentAt: '2026-10-05T14:00:00Z', expiresAt: '2099-10-12T14:00:00Z', openedAt: null, usedAt: null },
      submission: { id: 's1', kind: 'onboarding', status: 'draft', submittedAt: null },
      onboardingApproved: false,
    })
    expect(dialog()).toHaveAccessibleDescription(
      `${t(`${D}.body`, { firstName: 'Marie' })} ${t(`${D}.invitationStops`, { email: 'marie.t@exemple.ca' })} ${t(`${D}.questionnaireCloses`)}`,
    )
  })

  it('says nothing of a link that no longer works', async () => {
    await openDeactivate(recordWithStatus('invited', false), {
      invitation: { state: 'expired', sentAt: '2026-10-05T14:00:00Z', expiresAt: '2026-10-06T14:00:00Z', openedAt: null, usedAt: null },
      submission: null,
      onboardingApproved: false,
    })
    expect(dialog()).toHaveAccessibleDescription(t(`${D}.body`, { firstName: 'Marie' }))
  })

  it('never acts on arrow keys, Enter or Space in the reason select (decision #36)', async () => {
    await openDeactivate()
    reasonSelect().focus()
    await userEvent.keyboard('{ArrowDown}{ArrowDown}{Enter} {ArrowUp}{Enter}')
    expect(mocks.record.deactivateProfessional).not.toHaveBeenCalled()
    expect(dialog()).toBeInTheDocument()
  })

  it('a `reason` refusal (archived meanwhile): under the select, the choice cleared, the catalogue refetched', async () => {
    mocks.record.deactivateProfessional.mockRejectedValue(refusal('Raison introuvable.', 'reason'))
    const { invalidated } = await openDeactivate()
    await userEvent.selectOptions(reasonSelect(), 'Congé')
    await userEvent.click(confirmButton())

    await waitFor(() => expect(reasonSelect()).toHaveAccessibleDescription('Raison introuvable.'))
    expect(reasonSelect()).toHaveValue('')
    expect(reasonSelect()).toHaveFocus()
    expect(invalidated()).toContainEqual(professionalCatalogKeys.catalog())
    expect(within(dialog()).queryByRole('alert')).not.toBeInTheDocument()
  })

  it('a `note` refusal (now required): under the note', async () => {
    mocks.record.deactivateProfessional.mockRejectedValue(refusal('Précisez la raison.', 'note'))
    const { invalidated } = await openDeactivate()
    await userEvent.selectOptions(reasonSelect(), 'Congé')
    await userEvent.click(confirmButton())

    await waitFor(() => expect(noteField()).toHaveAccessibleDescription('Précisez la raison.'))
    expect(noteField()).toHaveFocus()
    expect(invalidated()).toContainEqual(professionalCatalogKeys.catalog())
  })

  it('« déjà inactif » (HINT status): above the buttons, the record refetched, then only « Fermer »', async () => {
    mocks.record.deactivateProfessional.mockImplementation(async () => {
      stored = { ...stored, professional: { ...stored.professional, status: 'inactive' } }
      throw refusal('Ce dossier est déjà inactif.', 'status')
    })
    const { invalidated } = await openDeactivate()
    await userEvent.selectOptions(reasonSelect(), 'Congé')
    await userEvent.click(confirmButton())

    expect(await within(dialog()).findByRole('alert')).toHaveTextContent('Ce dossier est déjà inactif.')
    expect(invalidated()).toContainEqual(professionalKeys.record(ID))
    await waitFor(() => expect(within(dialog()).queryByRole('button', { name: t(`${D}.confirm`) })).not.toBeInTheDocument())
    expect(within(dialog()).getByRole('button', { name: t('common.close') })).toBeInTheDocument()
    // Nothing left to confirm: nothing left to edit either.
    expect(fieldset()).toBeDisabled()
    expect(reasonSelect()).toBeDisabled()
    expect(noteField()).toBeDisabled()
  })

  it.each([
    ['42501: the generic refusal, the access refetched', { code: '42501', message: 'Permission refusée : professionals.manage' }, t('common.errors.forbidden'), accessKeys.all, false],
    ['40001: the record changed, the professionals refetched', { code: '40001', message: 'Le dossier vient de changer. Réessayez.' }, t('modules.professionals.errors.recordChanged'), professionalKeys.all, false],
    ['a failure: the generic message, reported', { code: 'XX000', message: 'boom' }, t('modules.professionals.errors.saveFailed'), professionalKeys.record(ID), true],
  ])('%s, above the buttons, the dialog still confirmable', async (_, error, message, key, reported) => {
    mocks.record.deactivateProfessional.mockRejectedValue(error)
    const { invalidated } = await openDeactivate()
    await userEvent.selectOptions(reasonSelect(), 'Congé')
    await userEvent.click(confirmButton())

    expect(await within(dialog()).findByRole('alert')).toHaveTextContent(message)
    expect(invalidated()).toContainEqual(key)
    expect(invalidated()).toContainEqual(professionalKeys.record(ID))
    expect(mocks.captureException).toHaveBeenCalledTimes(reported ? 1 : 0)
    expect(mocks.toast.error).not.toHaveBeenCalled()
    expect(reasonSelect()).toBeEnabled()
    expect(confirmButton()).not.toHaveAttribute('aria-disabled')
  })

  it('while saving: the fields inert, « Désactivation… », and neither « Annuler » nor Escape closes it', async () => {
    let finish: (change: StatusChange) => void = () => {}
    mocks.record.deactivateProfessional.mockImplementation(() => new Promise<StatusChange>((resolve) => (finish = resolve)))
    await openDeactivate()
    await userEvent.selectOptions(reasonSelect(), 'Congé')
    await userEvent.type(noteField(), 'Retour en mars')
    await userEvent.click(confirmButton())

    expect(within(dialog()).getByRole('button', { name: t(`${D}.pending`) })).toHaveAttribute('aria-disabled', 'true')
    expect(dialog()).toHaveAttribute('aria-busy', 'true')
    expect(fieldset()).toBeDisabled()
    expect(reasonSelect()).toBeDisabled()
    expect(noteField()).toBeDisabled()
    expect(noteField()).toHaveValue('Retour en mars')
    await userEvent.click(within(dialog()).getByRole('button', { name: t('common.cancel') }))
    await userEvent.keyboard('{Escape}')
    expect(dialog()).toBeInTheDocument()

    stored = { ...stored, professional: { ...stored.professional, status: 'inactive' } }
    finish({ status: 'inactive', accountChange: null, profileId: null, signinSynced: true })
    await waitFor(() => expect(screen.queryByRole('alertdialog')).not.toBeInTheDocument())
    expect(mocks.record.deactivateProfessional).toHaveBeenCalledExactlyOnceWith(ID, IDS.leave, 'Retour en mars')
  })

  it('returns focus to the « … » menu on « Annuler »', async () => {
    await openDeactivate()
    await userEvent.click(within(dialog()).getByRole('button', { name: t('common.cancel') }))
    expect(screen.queryByRole('alertdialog')).not.toBeInTheDocument()
    await waitFor(() => expect(screen.getByRole('button', { name: t('modules.professionals.record.actions.more') })).toHaveFocus())
  })
})
