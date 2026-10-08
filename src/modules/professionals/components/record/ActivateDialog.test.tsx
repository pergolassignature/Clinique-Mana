import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { t } from '@/i18n'
import type { ProfessionalRecord, StatusChange } from '../../api/parse'
import { professionalKeys } from '../../hooks/keys'
import { recordWithStatus } from '../../test/fixtures-domain'
import { IDS } from '../../test/fixtures'
import { HARNESS_HEADING } from '../../test/RecordHarness'
import { renderRecordTab } from '../../test/record-tab'
import type { FixtureRole } from '@/test/role-fixtures'
import { OverviewTab } from './tabs/OverviewTab'
import { RecordActions } from './RecordActions'

const mocks = vi.hoisted(() => ({
  record: { fetchProfessionalRecord: vi.fn(), activateProfessional: vi.fn() },
  toast: { success: vi.fn(), error: vi.fn() },
}))
vi.mock('../../api/record', async (importOriginal) => ({ ...(await importOriginal<typeof import('../../api/record')>()), ...mocks.record }))
vi.mock('@/shared/ui/sonner', () => ({ toast: mocks.toast }))
vi.mock('@sentry/react', () => ({ captureException: vi.fn() }))

const A = 'modules.professionals.record.activate'
const ID = IDS.professional
let stored: ProfessionalRecord

/** The database after a successful activation (what the refetch reads). */
function activated(): StatusChange {
  stored = { ...stored, professional: { ...stored.professional, status: 'active' } }
  return { status: 'active', accountChange: null, profileId: null }
}

beforeEach(() => {
  mocks.record.fetchProfessionalRecord.mockImplementation(async () => stored)
  mocks.record.activateProfessional.mockImplementation(async () => activated())
})
afterEach(() => vi.clearAllMocks())

function renderActions(record: ProfessionalRecord, role: FixtureRole = 'admin_assistant') {
  stored = record
  return renderRecordTab(<RecordActions />, { record, role })
}

const dialog = () => screen.getByRole('alertdialog')
const button = (name: string) => screen.getByRole('button', { name })
const reasonField = () => within(dialog()).getByRole('textbox', { name: `${t(`${A}.reason`)} ${t('common.form.required')}` })
const refusal = (body: { message: string; hint?: string }) => ({ code: 'P0001', ...body })

describe('ActivateDialog — complete file', () => {
  it('confirms, activates without a reason, toasts, and sends focus to the « … » menu once « Activer » is gone', async () => {
    renderActions(recordWithStatus('draft', true))
    await userEvent.click(button(t('modules.professionals.record.actions.activate')))

    expect(within(dialog()).getByRole('heading', { name: t(`${A}.title`, { name: 'Marie Tremblay' }) })).toBeInTheDocument()
    expect(dialog()).toHaveAccessibleDescription(t(`${A}.body`, { firstName: 'Marie' }))
    expect(within(dialog()).queryByRole('textbox')).not.toBeInTheDocument()
    expect(within(dialog()).getByRole('button', { name: t('common.cancel') })).toHaveFocus()

    await userEvent.click(within(dialog()).getByRole('button', { name: t(`${A}.confirm`) }))
    await waitFor(() => expect(screen.queryByRole('alertdialog')).not.toBeInTheDocument())
    expect(mocks.record.activateProfessional).toHaveBeenCalledExactlyOnceWith(ID, undefined)
    expect(mocks.toast.success).toHaveBeenCalledWith(t('modules.professionals.toasts.activated'))
    expect(screen.queryByRole('button', { name: t('modules.professionals.record.actions.activate') })).not.toBeInTheDocument()
    await waitFor(() => expect(button(t('modules.professionals.record.actions.more'))).toHaveFocus())
  })

  it('keeps showing what was confirmed while it saves, and cannot be closed then', async () => {
    let finish: (change: StatusChange) => void = () => {}
    mocks.record.activateProfessional.mockImplementation(() => new Promise<StatusChange>((resolve) => (finish = resolve)))
    renderActions(recordWithStatus('draft', true))
    await userEvent.click(button(t('modules.professionals.record.actions.activate')))
    await userEvent.click(within(dialog()).getByRole('button', { name: t(`${A}.confirm`) }))

    const pending = within(dialog()).getByRole('button', { name: t(`${A}.pending`) })
    expect(pending).toHaveAttribute('aria-disabled', 'true')
    expect(dialog()).toHaveAttribute('aria-busy', 'true')
    await userEvent.click(within(dialog()).getByRole('button', { name: t('common.cancel') }))
    await userEvent.keyboard('{Escape}')
    expect(dialog()).toBeInTheDocument()

    // Activated: the cached record already says « Actif » while the refetch is held.
    let refetched: () => void = () => {}
    mocks.record.fetchProfessionalRecord.mockImplementation(() => new Promise((resolve) => (refetched = () => resolve(stored))))
    finish(activated())
    await waitFor(() => expect(mocks.record.fetchProfessionalRecord).toHaveBeenCalled())
    // The header already follows the cached status (« Activer » gone behind the modal)…
    await waitFor(() => expect(screen.queryByRole('button', { name: t('modules.professionals.record.actions.activate'), hidden: true })).not.toBeInTheDocument())
    // …while the dialog still shows what was confirmed.
    expect(within(dialog()).getByRole('heading', { name: t(`${A}.title`, { name: 'Marie Tremblay' }) })).toBeInTheDocument()
    expect(within(dialog()).getByRole('button', { name: t(`${A}.pending`) })).toBeInTheDocument()
    expect(within(dialog()).queryByRole('button', { name: t('common.close') })).not.toBeInTheDocument()

    refetched()
    await waitFor(() => expect(screen.queryByRole('alertdialog')).not.toBeInTheDocument())
  })

  it('returns focus to « Activer » on « Annuler », with no call', async () => {
    renderActions(recordWithStatus('in_review', true))
    const activate = button(t('modules.professionals.record.actions.activate'))
    await userEvent.click(activate)
    await userEvent.click(within(dialog()).getByRole('button', { name: t('common.cancel') }))
    expect(screen.queryByRole('alertdialog')).not.toBeInTheDocument()
    await waitFor(() => expect(activate).toHaveFocus())
    expect(mocks.record.activateProfessional).not.toHaveBeenCalled()
  })
})

describe('ActivateDialog — override (incomplete file)', () => {
  it('lists what is missing, asks the reason, and the suggestion fills it', async () => {
    renderActions(recordWithStatus('draft', false), 'admin')
    await userEvent.click(button(t('modules.professionals.record.actions.activate')))

    const missing = t(`${A}.missing`, { item: 'Profil de jumelage complet', missing: 'une clientèle et un motif' })
    expect(dialog()).toHaveAccessibleDescription(expect.stringContaining(missing))
    expect(within(dialog()).getByText(t(`${A}.incomplete`))).toBeInTheDocument()
    expect(reasonField()).toHaveFocus()
    expect(reasonField()).toHaveValue('')

    await userEvent.click(within(dialog()).getByRole('button', { name: t(`${A}.confirmOverride`) }))
    expect(await within(dialog()).findByText(t('modules.professionals.validation.overrideReason'))).toBeInTheDocument()
    expect(mocks.record.activateProfessional).not.toHaveBeenCalled()
    expect(reasonField()).toHaveFocus()

    await userEvent.click(within(dialog()).getByRole('button', { name: t(`${A}.suggestionText`) }))
    expect(reasonField()).toHaveValue(t(`${A}.suggestionText`))
    expect(within(dialog()).queryByText(t('modules.professionals.validation.overrideReason'))).not.toBeInTheDocument()
    await userEvent.click(within(dialog()).getByRole('button', { name: t(`${A}.confirmOverride`) }))
    await waitFor(() => expect(mocks.record.activateProfessional).toHaveBeenCalledExactlyOnceWith(ID, t(`${A}.suggestionText`)))
  })

  it('sends a typed reason trimmed, and Enter in it never confirms', async () => {
    renderActions(recordWithStatus('draft', false), 'admin')
    await userEvent.click(button(t('modules.professionals.record.actions.activate')))
    await userEvent.type(reasonField(), '  Validé par téléphone{Enter}')
    expect(mocks.record.activateProfessional).not.toHaveBeenCalled()
    await userEvent.click(within(dialog()).getByRole('button', { name: t(`${A}.confirmOverride`) }))
    await waitFor(() => expect(mocks.record.activateProfessional).toHaveBeenCalledExactlyOnceWith(ID, 'Validé par téléphone'))
  })

  it('shows a `reason` refusal under the field', async () => {
    mocks.record.activateProfessional.mockRejectedValue(refusal({ message: 'Indiquez la raison (au moins 5 caractères).', hint: 'reason' }))
    renderActions(recordWithStatus('draft', false), 'admin')
    await userEvent.click(button(t('modules.professionals.record.actions.activate')))
    await userEvent.type(reasonField(), 'Raison valide')
    await userEvent.click(within(dialog()).getByRole('button', { name: t(`${A}.confirmOverride`) }))

    await waitFor(() => expect(reasonField()).toHaveAccessibleDescription(expect.stringContaining('Indiquez la raison (au moins 5 caractères).')))
    expect(reasonField()).toHaveFocus()
    expect(within(dialog()).queryByRole('alert')).not.toBeInTheDocument()
    expect(mocks.toast.error).not.toHaveBeenCalled()
  })
})

describe('ActivateDialog — refusals that change the dialog', () => {
  it('« déjà actif » (HINT status): the message above the buttons, the record refetched, then only « Fermer »', async () => {
    mocks.record.activateProfessional.mockImplementation(async () => {
      stored = { ...stored, professional: { ...stored.professional, status: 'active' } }
      throw refusal({ message: 'Ce professionnel est déjà actif.', hint: 'status' })
    })
    const { invalidated } = renderActions(recordWithStatus('draft', true))
    await userEvent.click(button(t('modules.professionals.record.actions.activate')))
    await userEvent.click(within(dialog()).getByRole('button', { name: t(`${A}.confirm`) }))

    expect(await within(dialog()).findByRole('alert')).toHaveTextContent('Ce professionnel est déjà actif.')
    expect(invalidated()).toContainEqual(professionalKeys.record(ID))
    await waitFor(() => expect(within(dialog()).queryByRole('button', { name: t(`${A}.confirm`) })).not.toBeInTheDocument())
    await userEvent.click(within(dialog()).getByRole('button', { name: t('common.close') }))
    expect(screen.queryByRole('alertdialog')).not.toBeInTheDocument()
    // « Activer » went with the refetch: focus goes to the menu.
    await waitFor(() => expect(button(t('modules.professionals.record.actions.more'))).toHaveFocus())
  })

  it('a `reason` refusal without the field (the file became incomplete): says so and the refetch brings the field', async () => {
    mocks.record.activateProfessional.mockImplementation(async () => {
      stored = recordWithStatus('draft', false)
      throw refusal({ message: 'Indiquez la raison (au moins 5 caractères).', hint: 'reason' })
    })
    renderActions(recordWithStatus('draft', true), 'admin')
    await userEvent.click(button(t('modules.professionals.record.actions.activate')))
    await userEvent.click(within(dialog()).getByRole('button', { name: t(`${A}.confirm`) }))

    expect(await within(dialog()).findByRole('alert')).toHaveTextContent(t(`${A}.nowIncomplete`))
    expect(await within(dialog()).findByRole('textbox', { name: `${t(`${A}.reason`)} ${t('common.form.required')}` })).toBeInTheDocument()
    expect(within(dialog()).getByRole('button', { name: t(`${A}.confirmOverride`) })).toBeInTheDocument()
  })

  it('the adjointe on a file that became incomplete (HINT readiness): the message, the gaps, nothing to confirm', async () => {
    mocks.record.activateProfessional.mockImplementation(async () => {
      stored = recordWithStatus('draft', false)
      throw refusal({ message: "Le dossier n'est pas complet. Seule l'administration peut activer un dossier incomplet.", hint: 'readiness' })
    })
    renderActions(recordWithStatus('draft', true))
    await userEvent.click(button(t('modules.professionals.record.actions.activate')))
    await userEvent.click(within(dialog()).getByRole('button', { name: t(`${A}.confirm`) }))

    expect(await within(dialog()).findByRole('alert')).toHaveTextContent("Seule l'administration peut activer un dossier incomplet.")
    expect(await within(dialog()).findByText(t(`${A}.incomplete`))).toBeInTheDocument()
    expect(within(dialog()).queryByRole('textbox')).not.toBeInTheDocument()
    expect(within(dialog()).getByRole('button', { name: t('common.close') })).toBeInTheDocument()
    expect(within(dialog()).getAllByRole('button')).toHaveLength(1)
  })
})

describe('ActivateDialog — reactivation', () => {
  it('names the deactivation, says the account comes back, and confirms « Réactiver »', async () => {
    const record = recordWithStatus('inactive', true)
    record.professional = { ...record.professional, profileId: IDS.admin, deactivationReasonId: IDS.ended, deactivationNote: 'Fin du contrat', deactivationDisabledAccount: true }
    renderActions(record)
    await userEvent.click(button(t('modules.professionals.record.actions.reactivate')))

    expect(within(dialog()).getByRole('heading', { name: t(`${A}.titleReactivate`, { name: 'Marie Tremblay' }) })).toBeInTheDocument()
    expect(dialog()).toHaveAccessibleDescription(
      expect.stringContaining(`${t(`${A}.body`, { firstName: 'Marie' })} ${t(`${A}.accountBack`, { firstName: 'Marie' })}`),
    )
    expect(dialog()).toHaveAccessibleDescription(expect.stringContaining(t(`${A}.deactivatedFor`, { reason: 'Fin de collaboration — Fin du contrat' })))
    await userEvent.click(within(dialog()).getByRole('button', { name: t(`${A}.confirmReactivate`) }))
    await waitFor(() => expect(mocks.record.activateProfessional).toHaveBeenCalledExactlyOnceWith(ID, undefined))
  })

  it('says nothing about the account when this module did not disable it; « Réactiver quand même » with the override', async () => {
    renderActions(recordWithStatus('inactive', false), 'admin')
    await userEvent.click(button(t('modules.professionals.record.actions.reactivate')))
    expect(dialog()).not.toHaveAccessibleDescription(expect.stringContaining(t(`${A}.accountBack`, { firstName: 'Marie' })))
    expect(within(dialog()).getByRole('button', { name: t(`${A}.confirmOverrideReactivate`) })).toBeInTheDocument()
  })
})

describe('Aperçu « Prochaine action »', () => {
  it('« Activer » opens the same dialog; once active, focus goes to the record heading', async () => {
    stored = recordWithStatus('draft', true)
    renderRecordTab(<OverviewTab />, { record: stored, role: 'admin_assistant' })
    const next = screen.getByRole('heading', { level: 3, name: t('modules.professionals.record.overview.nextAction.title') }).closest('.rounded-lg') as HTMLElement
    expect(within(next).getByText(t('modules.professionals.readiness.nextAction.readyToActivate'))).toBeInTheDocument()
    await userEvent.click(within(next).getByRole('button', { name: t('modules.professionals.record.actions.activate') }))
    await userEvent.click(within(dialog()).getByRole('button', { name: t(`${A}.confirm`) }))

    await waitFor(() => expect(screen.queryByRole('alertdialog')).not.toBeInTheDocument())
    expect(mocks.record.activateProfessional).toHaveBeenCalledExactlyOnceWith(ID, undefined)
    expect(await within(next).findByText(t('modules.professionals.readiness.nextAction.nothingToDo'))).toBeInTheDocument()
    await waitFor(() => expect(screen.getByRole('heading', { level: 1, name: HARNESS_HEADING })).toHaveFocus())
  })
})
