import { describe, expect, it, vi } from 'vitest'
import { act, fireEvent, screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { t } from '@/i18n'
import { ROLE_PERMISSIONS, type FixtureRole } from '@/test/role-fixtures'
import type { InvitationInfo, Onboarding } from '../../api/parse'
import type { ProfessionalStatus } from '../../lib/constants'
import { recordWithStatus } from '../../test/fixtures-domain'
import { renderRecordTab } from '../../test/record-tab'
import { RecordActions } from './RecordActions'

const mocks = vi.hoisted(() => ({
  record: { fetchProfessionalRecord: vi.fn() },
  settings: { fetchProfessionalsSettings: vi.fn(async () => ({ collectSin: false, invitationExpiryDays: 7, invitationReminderAfterDays: 3 })) },
}))
vi.mock('../../api/record', async (importOriginal) => ({ ...(await importOriginal<typeof import('../../api/record')>()), ...mocks.record }))
vi.mock('../../api/settings', async (importOriginal) => ({ ...(await importOriginal<typeof import('../../api/settings')>()), ...mocks.settings }))
vi.mock('@sentry/react', () => ({ captureException: vi.fn() }))

const ACTIVATE = t('modules.professionals.record.actions.activate')
const REACTIVATE = t('modules.professionals.record.actions.reactivate')
const MORE = t('modules.professionals.record.actions.more')

function renderActions(status: ProfessionalStatus, complete: boolean, role: FixtureRole, onboarding: Onboarding | null = null, permissions?: string[]) {
  const record = recordWithStatus(status, complete)
  mocks.record.fetchProfessionalRecord.mockResolvedValue(record)
  renderRecordTab(<RecordActions />, { record, role, onboarding, permissions })
}

/** The adjointe's defaults without `professionals.invite` (the 4a menu). */
const NO_INVITE = ROLE_PERMISSIONS.admin_assistant.filter((p) => p !== 'professionals.invite')

/** The menu's items, in order. */
async function menuItems() {
  await userEvent.click(screen.getByRole('button', { name: MORE }))
  return (await screen.findAllByRole('menuitem')).map((i) => i.textContent)
}

/** The buttons the header shows, by name. */
const buttons = () => screen.queryAllByRole('button').map((b) => b.getAttribute('aria-label') ?? b.textContent)

describe('RecordActions', () => {
  it.each<[string, ProfessionalStatus, boolean, FixtureRole, string[]]>([
    ['adjointe, complete draft: « Activer » and the menu', 'draft', true, 'admin_assistant', [ACTIVATE, MORE]],
    ['adjointe, incomplete draft: the menu only (Aperçu says what is missing)', 'draft', false, 'admin_assistant', [MORE]],
    ['admin, incomplete draft: « Activer » (override)', 'draft', false, 'admin', [ACTIVATE, MORE]],
    ['active: the menu only', 'active', true, 'admin', [MORE]],
    ['inactive and complete: « Réactiver », no menu', 'inactive', true, 'admin_assistant', [REACTIVATE]],
    ['conseillère: nothing', 'draft', true, 'counselor', []],
  ])('%s', (_, status, complete, role, expected) => {
    renderActions(status, complete, role)
    expect(buttons()).toEqual(expected)
  })

  it('makes « Activer » the teal action and the menu an outline button', () => {
    renderActions('draft', true, 'admin_assistant')
    expect(screen.getByRole('button', { name: ACTIVATE })).toHaveClass('bg-primary')
    expect(screen.getByRole('button', { name: MORE })).toHaveClass('border-border')
  })

  it('holds only « Désactiver » in the « … » menu without professionals.invite, not red (destructive only in the confirmation)', async () => {
    renderActions('active', true, 'admin_assistant', null, NO_INVITE)
    await userEvent.click(screen.getByRole('button', { name: MORE }))
    const items = await screen.findAllByRole('menuitem')
    expect(items.map((i) => i.textContent)).toEqual([t('modules.professionals.record.actions.deactivate')])
    expect(items[0]).not.toHaveClass('text-destructive')
  })

  it('opens the « … » menu from the keyboard', async () => {
    renderActions('active', true, 'admin_assistant', null, NO_INVITE)
    screen.getByRole('button', { name: MORE }).focus()
    await userEvent.keyboard('{Enter}')
    expect(await screen.findByRole('menuitem', { name: t('modules.professionals.record.actions.deactivate') })).toHaveFocus()
  })

  it('forgets a « Désactiver » when the menu opens again before its close came through', async () => {
    renderActions('active', true, 'admin_assistant')
    const more = screen.getByRole('button', { name: MORE })
    await userEvent.click(more)
    const item = await screen.findByRole('menuitem', { name: t('modules.professionals.record.actions.deactivate') })
    // Chosen, then the menu reopened in the same moment: Radix runs the first close's autofocus
    // (where the dialog would open) in a timer, after the menu is open again.
    fireEvent.click(item)
    fireEvent.keyDown(more, { key: 'Enter' })
    await act(() => new Promise((resolve) => setTimeout(resolve, 0)))
    expect(screen.getByRole('menu')).toBeInTheDocument()
    expect(screen.queryByRole('alertdialog')).not.toBeInTheDocument()

    // Closing this menu without choosing opens nothing either.
    await userEvent.keyboard('{Escape}')
    await waitFor(() => expect(more).toHaveFocus())
    expect(screen.queryByRole('menu')).not.toBeInTheDocument()
    expect(screen.queryByRole('alertdialog')).not.toBeInTheDocument()
  })

  it('opens the deactivation once the menu has closed, and again after a cancel', async () => {
    renderActions('active', true, 'admin_assistant')
    for (let round = 0; round < 2; round++) {
      await userEvent.click(screen.getByRole('button', { name: MORE }))
      await userEvent.click(await screen.findByRole('menuitem', { name: t('modules.professionals.record.actions.deactivate') }))
      expect(await screen.findByRole('alertdialog')).toBeInTheDocument()
      await userEvent.click(screen.getByRole('button', { name: t('common.cancel') }))
      expect(screen.queryByRole('alertdialog')).not.toBeInTheDocument()
    }
  })
})

describe('RecordActions — the invitation menu (Task 4b.3)', () => {
  const A = 'modules.professionals.onboarding.actions'
  const DEACTIVATE = t('modules.professionals.record.actions.deactivate')
  const invitation = (state: InvitationInfo['state']): Onboarding => ({
    invitation: { state, sentAt: '2026-10-05T14:00:00Z', expiresAt: '2026-10-12T14:00:00Z', openedAt: null, usedAt: null },
    submission: null,
    onboardingApproved: false,
  })

  it.each<[string, Onboarding | null, string[]]>([
    ['no invitation: « Envoyer l’invitation »', null, [t(`${A}.send`), DEACTIVATE]],
    ['a live link: « Renvoyer » and « Révoquer »', invitation('sent'), [t(`${A}.resend`), t(`${A}.revoke`), DEACTIVATE]],
    ['an opened link: the same', invitation('opened'), [t(`${A}.resend`), t(`${A}.revoke`), DEACTIVATE]],
    ['an expired link: « Envoyer un nouveau lien »', invitation('expired'), [t(`${A}.new_link`), DEACTIVATE]],
    ['a revoked link: « Envoyer l’invitation » again', invitation('revoked'), [t(`${A}.send`), DEACTIVATE]],
  ])('without an account, %s', async (_, onboarding, items) => {
    renderActions('invited', false, 'admin_assistant', onboarding)
    expect(await menuItems()).toEqual(items)
  })

  it('with an account: « Demander une mise à jour », unless a submission is open', async () => {
    renderActions('active', true, 'admin_assistant', { invitation: null, submission: null, onboardingApproved: true })
    expect(await menuItems()).toEqual([t(`${A}.requestUpdate`), DEACTIVATE])
  })

  it('no « Demander une mise à jour » while a submission is open', async () => {
    renderActions('active', true, 'admin_assistant', { invitation: null, submission: { id: 's1', kind: 'update', status: 'draft', submittedAt: null }, onboardingApproved: true })
    expect(await menuItems()).toEqual([DEACTIVATE])
  })

  it('nothing for an inactive file, nor for the conseillère', () => {
    renderActions('inactive', false, 'admin', null)
    expect(screen.queryByRole('button', { name: MORE })).not.toBeInTheDocument()
  })

  it('« Renvoyer l’invitation » confirms first: the address, the old link stopping', async () => {
    renderActions('invited', false, 'admin_assistant', invitation('sent'))
    await userEvent.click(screen.getByRole('button', { name: MORE }))
    await userEvent.click(await screen.findByRole('menuitem', { name: t(`${A}.resend`) }))
    const dialog = await screen.findByRole('alertdialog', { name: "Renvoyer l'invitation à Marie Tremblay ?" })
    expect(dialog).toHaveAccessibleDescription(/Un nouveau lien sera envoyé à marie\.t@exemple\.ca\. Le lien envoyé le 5 oct\. ne fonctionnera plus\./)
    expect(within(dialog).getByRole('button', { name: t(`${A}.resend`) })).toHaveClass('bg-primary')
  })

  it('« Révoquer l’invitation » is destructive in its confirmation, and says the file goes back to « À inviter »', async () => {
    renderActions('invited', false, 'admin_assistant', invitation('opened'))
    await userEvent.click(screen.getByRole('button', { name: MORE }))
    await userEvent.click(await screen.findByRole('menuitem', { name: t(`${A}.revoke`) }))
    const dialog = await screen.findByRole('alertdialog', { name: "Révoquer l'invitation de Marie Tremblay ?" })
    expect(dialog).toHaveAccessibleDescription(/redeviendra « À inviter »/)
    expect(within(dialog).getByRole('button', { name: t(`${A}.revoke`) })).toHaveClass('bg-destructive')
  })
})
