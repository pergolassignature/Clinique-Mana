import { describe, expect, it, vi } from 'vitest'
import { act, fireEvent, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { t } from '@/i18n'
import type { FixtureRole } from '@/test/role-fixtures'
import type { ProfessionalStatus } from '../../lib/constants'
import { recordWithStatus } from '../../test/fixtures-domain'
import { renderRecordTab } from '../../test/record-tab'
import { RecordActions } from './RecordActions'

const mocks = vi.hoisted(() => ({ record: { fetchProfessionalRecord: vi.fn() } }))
vi.mock('../../api/record', async (importOriginal) => ({ ...(await importOriginal<typeof import('../../api/record')>()), ...mocks.record }))
vi.mock('@sentry/react', () => ({ captureException: vi.fn() }))

const ACTIVATE = t('modules.professionals.record.actions.activate')
const REACTIVATE = t('modules.professionals.record.actions.reactivate')
const MORE = t('modules.professionals.record.actions.more')

function renderActions(status: ProfessionalStatus, complete: boolean, role: FixtureRole) {
  const record = recordWithStatus(status, complete)
  mocks.record.fetchProfessionalRecord.mockResolvedValue(record)
  renderRecordTab(<RecordActions />, { record, role })
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

  it('holds only « Désactiver » in the « … » menu, not red (destructive only in the confirmation)', async () => {
    renderActions('active', true, 'admin_assistant')
    await userEvent.click(screen.getByRole('button', { name: MORE }))
    const items = await screen.findAllByRole('menuitem')
    expect(items.map((i) => i.textContent)).toEqual([t('modules.professionals.record.actions.deactivate')])
    expect(items[0]).not.toHaveClass('text-destructive')
  })

  it('opens the « … » menu from the keyboard', async () => {
    renderActions('active', true, 'admin_assistant')
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
