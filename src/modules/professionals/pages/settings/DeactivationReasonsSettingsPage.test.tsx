import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { t } from '@/i18n'
import { CATALOG } from '../../test/fixtures-domain'
import { IDS } from '../../test/fixtures'
import { renderProfessionalsSettingsPage } from '../../test/settings-page'
import { DeactivationReasonsSettingsPage } from './DeactivationReasonsSettingsPage'

const mocks = vi.hoisted(() => ({
  api: {
    fetchProfessionalsCatalog: vi.fn(),
    fetchReferenceUsage: vi.fn(),
    saveReference: vi.fn(),
    setReferenceActive: vi.fn(),
    reorderReference: vi.fn(),
  },
  toast: { success: vi.fn(), error: vi.fn() },
}))
vi.mock('../../api/catalog', async (importOriginal) => ({ ...(await importOriginal<typeof import('../../api/catalog')>()), ...mocks.api }))
vi.mock('@/shared/ui/sonner', () => ({ toast: mocks.toast }))
vi.mock('@sentry/react', () => ({ captureException: vi.fn() }))

const R = 'modules.professionals.settings.deactivationReasons'

beforeEach(() => {
  mocks.api.fetchProfessionalsCatalog.mockResolvedValue(CATALOG)
  mocks.api.fetchReferenceUsage.mockResolvedValue(new Map())
})
afterEach(() => vi.clearAllMocks())

async function renderPage({ readOnly = false } = {}) {
  renderProfessionalsSettingsPage(<DeactivationReasonsSettingsPage />, { sectionId: 'deactivation-reasons', readOnly })
  await screen.findByRole('table')
}

const dialog = () => screen.getByRole('dialog')
const rowOf = (name: string) => {
  const row = screen.getAllByRole('row').find((r) => r.querySelector('[data-name]')?.textContent === name)
  if (!row) throw new Error(`no row ${name}`)
  return row
}
/** A row's cells after its header (the name): note, account. */
const flags = (name: string) =>
  within(rowOf(name))
    .getAllByRole('cell')
    .slice(0, 2)
    .map((cell) => cell.textContent)
const checkbox = (key: 'requiresNote' | 'disablesAccount') => within(dialog()).getByRole('checkbox', { name: t(`${R}.${key}`) })
async function openEdit(name: string) {
  await userEvent.click(screen.getByRole('button', { name: t('modules.professionals.settings.list.actions.menu', { name }) }))
  await userEvent.click(await screen.findByRole('menuitem', { name: t('modules.professionals.settings.list.actions.edit') }))
}

describe('DeactivationReasonsSettingsPage', () => {
  it('shows « Note requise » and « Désactive le compte » as Oui / Non, in order, reorderable', async () => {
    await renderPage()
    expect(screen.getByRole('heading', { level: 1, name: t(`${R}.title`) })).toBeInTheDocument()
    expect(screen.getByRole('columnheader', { name: t(`${R}.requiresNote`) })).toBeInTheDocument()
    expect(screen.getByRole('columnheader', { name: t(`${R}.disablesAccount`) })).toBeInTheDocument()
    expect(flags('Congé')).toEqual([t(`${R}.no`), t(`${R}.no`)])
    expect(flags('Fin de collaboration')).toEqual([t(`${R}.no`), t(`${R}.yes`)])
    expect(flags('Autre')).toEqual([t(`${R}.yes`), t(`${R}.no`)])
    expect(within(rowOf('Autre')).getByRole('img', { name: t(`${R}.system`) })).toBeInTheDocument()
    expect(screen.getByRole('button', { name: t('modules.professionals.settings.list.actions.moveDown', { name: 'Congé' }) })).toBeInTheDocument()
  })

  it('adds a reason with its two checkboxes; the account one says what it does', async () => {
    await renderPage()
    mocks.api.saveReference.mockResolvedValue('00000000-0000-4000-8000-000000000304')
    await userEvent.click(screen.getByRole('button', { name: t(`${R}.add`) }))
    expect(screen.getByRole('dialog', { name: t(`${R}.createTitle`) })).toBeInTheDocument()
    await userEvent.type(within(dialog()).getByRole('textbox', { name: /^Nom/ }), 'Retraite')
    expect(checkbox('disablesAccount')).toHaveAccessibleDescription(t(`${R}.disablesAccountHelp`))
    // Space toggles the draft only: nothing is saved before « Ajouter ».
    checkbox('disablesAccount').focus()
    await userEvent.keyboard(' ')
    expect(checkbox('disablesAccount')).toBeChecked()
    expect(mocks.api.saveReference).not.toHaveBeenCalled()
    await userEvent.click(within(dialog()).getByRole('button', { name: t('modules.professionals.settings.list.dialog.create') }))
    await waitFor(() => expect(screen.queryByRole('dialog')).not.toBeInTheDocument())
    expect(mocks.api.saveReference).toHaveBeenCalledWith('deactivation_reasons', {
      id: null,
      name: 'Retraite',
      requiresNote: false,
      disablesAccount: true,
    })
  })

  it('keeps the note required on « Autre »', async () => {
    await renderPage()
    await openEdit('Autre')
    expect(checkbox('requiresNote')).toBeChecked()
    await userEvent.click(checkbox('requiresNote'))
    await userEvent.click(within(dialog()).getByRole('button', { name: t('common.save') }))
    expect(await within(dialog()).findByText(t('modules.professionals.validation.otherReasonNote'))).toBeInTheDocument()
    expect(checkbox('requiresNote')).toHaveAccessibleDescription(
      `${t(`${R}.requiresNoteHelp`)} ${t('modules.professionals.validation.otherReasonNote')}`,
    )
    expect(mocks.api.saveReference).not.toHaveBeenCalled()
  })

  it('focuses the checkbox in error after a failed save, its error read with it', async () => {
    await renderPage()
    await openEdit('Autre')
    await userEvent.click(checkbox('requiresNote'))
    await userEvent.click(within(dialog()).getByRole('button', { name: t('common.save') }))
    await waitFor(() => expect(checkbox('requiresNote')).toHaveFocus())
    expect(checkbox('requiresNote')).toHaveAttribute('aria-invalid', 'true')
  })

  it('hides the two flag columns at phone width, so the actions stay visible', async () => {
    await renderPage()
    expect(screen.getByRole('columnheader', { name: t(`${R}.requiresNote`) })).toHaveClass('max-sm:hidden')
    expect(screen.getByRole('columnheader', { name: t(`${R}.disablesAccount`) })).toHaveClass('max-sm:hidden')
    expect(screen.getByRole('columnheader', { name: t('modules.professionals.settings.list.columns.usage') })).toHaveClass('max-sm:hidden')
  })

  it('edits a reason with its saved flags', async () => {
    await renderPage()
    mocks.api.saveReference.mockResolvedValue(IDS.ended)
    await openEdit('Fin de collaboration')
    expect(checkbox('requiresNote')).not.toBeChecked()
    expect(checkbox('disablesAccount')).toBeChecked()
    await userEvent.click(checkbox('requiresNote'))
    await userEvent.click(within(dialog()).getByRole('button', { name: t('common.save') }))
    await waitFor(() =>
      expect(mocks.api.saveReference).toHaveBeenCalledWith('deactivation_reasons', {
        id: IDS.ended,
        name: 'Fin de collaboration',
        requiresNote: true,
        disablesAccount: true,
      }),
    )
  })

  it('read-only: no « Ajouter », no reorder, no menus', async () => {
    await renderPage({ readOnly: true })
    expect(screen.getByText(t('common.readOnlyNotice.title'))).toBeInTheDocument()
    expect(screen.queryByRole('button', { name: t(`${R}.add`) })).not.toBeInTheDocument()
    expect(screen.queryByRole('button', { name: /^(Monter|Descendre|Actions pour)/ })).not.toBeInTheDocument()
  })
})
