import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { t } from '@/i18n'
import { usageKey } from '../../api/catalog'
import type { ProfessionalsCatalog } from '../../api/parse'
import { motifIconLabel } from '../../lib/display'
import { MotifsSettingsPage } from '../../pages/settings/MotifsSettingsPage'
import { CATALOG } from '../../test/fixtures-domain'
import { IDS } from '../../test/fixtures'
import { renderProfessionalsSettingsPage } from '../../test/settings-page'

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

const M = 'modules.professionals.settings.motifs'
const C = `${M}.categories`
const LIST = 'modules.professionals.settings.list'

const RELATIONS = '00000000-0000-4000-8000-0000000000f3'
const NEW_ID = '00000000-0000-4000-8000-0000000000f9'

/** The fixture (Vie intérieure, Brain; Ancienne catégorie, archived) plus « Relations et famille » after them, no description. */
function catalog(): ProfessionalsCatalog {
  const [category] = CATALOG.motifCategories
  if (!category) throw new Error('fixture')
  return {
    ...CATALOG,
    motifCategories: [
      ...CATALOG.motifCategories,
      { ...category, id: RELATIONS, key: 'relations', name: 'Relations et famille', description: null, icon: 'Users', sortOrder: 30 },
    ],
  }
}

beforeEach(() => {
  mocks.api.fetchProfessionalsCatalog.mockResolvedValue(catalog())
  mocks.api.fetchReferenceUsage.mockResolvedValue(new Map([[usageKey('motif_categories', IDS.innerLife), 2]]))
})
afterEach(() => vi.clearAllMocks())

/** Renders the Motifs page and opens the categories sheet. */
async function openSheet({ readOnly = false } = {}) {
  renderProfessionalsSettingsPage(<MotifsSettingsPage />, { sectionId: 'motifs', readOnly })
  await userEvent.click(await screen.findByRole('button', { name: t(readOnly ? `${M}.viewCategories` : `${M}.manageCategories`) }))
  return screen.findByRole('dialog', { name: t(`${C}.title`) })
}

const rowOf = (sheet: HTMLElement, name: string) => {
  const row = within(sheet)
    .getAllByRole('row')
    .find((r) => r.querySelector('[data-name]')?.textContent === name)
  if (!row) throw new Error(`no row ${name}`)
  return row
}
const editDialog = (title: 'createTitle' | 'editTitle') => screen.getByRole('dialog', { name: t(`${C}.${title}`) })

async function chooseAction(name: string, action: 'edit' | 'archive' | 'restore') {
  await userEvent.click(screen.getByRole('button', { name: t(`${LIST}.actions.menu`, { name }) }))
  await userEvent.click(await screen.findByRole('menuitem', { name: t(`${LIST}.actions.${action}`) }))
}

describe('MotifCategoriesSheet', () => {
  it('opens from « Gérer les catégories »: the categories with their icon, description and motif count', async () => {
    const sheet = await openSheet()
    expect(sheet).toHaveAccessibleDescription(t(`${C}.description`))
    expect(within(sheet).getByRole('table', { name: t(`${C}.title`) })).toBeInTheDocument()
    const innerLife = rowOf(sheet, 'Vie intérieure')
    expect(within(innerLife).getByRole('img', { name: motifIconLabel('Brain') })).toBeInTheDocument()
    expect(innerLife).toHaveTextContent('Anxiété, dépression, estime de soi et bien-être émotionnel')
    expect(innerLife).toHaveTextContent(t(`${C}.motifCount.other`, { count: '2' }))
    // No description: « — », read as « Aucune description »; no motif: « Aucun motif ».
    const relations = rowOf(sheet, 'Relations et famille')
    expect(within(relations).getByText(t(`${C}.noDescription`))).toHaveClass('sr-only')
    expect(within(relations).getByText(t(`${C}.motifCount.none`))).toHaveClass('sr-only')
    expect(within(sheet).getByRole('columnheader', { name: t(`${C}.descriptionLabel`) })).toHaveClass('max-sm:hidden')
    // « Ajouter » outline: the page under the sheet has its teal button.
    expect(within(sheet).getByRole('button', { name: t(`${C}.add`) })).not.toHaveClass('bg-primary')
  })

  it('keeps its X out of the tab order; Escape closes it and focus goes back to the button', async () => {
    const sheet = await openSheet()
    expect(within(sheet).getByRole('button', { name: t('common.close') })).toHaveAttribute('tabindex', '-1')
    await userEvent.keyboard('{Escape}')
    await waitFor(() => expect(screen.queryByRole('dialog')).not.toBeInTheDocument())
    expect(screen.getByRole('button', { name: t(`${M}.manageCategories`) })).toHaveFocus()
  })

  it('adds a category: the icon is chosen in the picker, nothing saves before « Ajouter »', async () => {
    const sheet = await openSheet()
    mocks.api.saveReference.mockResolvedValue(NEW_ID)
    await userEvent.click(within(sheet).getByRole('button', { name: t(`${C}.add`) }))
    const dialog = editDialog('createTitle')
    expect(within(dialog).getByRole('textbox', { name: /^Nom/ })).toHaveFocus()
    const picker = within(dialog).getByRole('radiogroup', { name: t(`${C}.icon`) })
    // A new category starts with the column's default icon.
    expect(within(picker).getByRole('radio', { name: motifIconLabel('Brain') })).toBeChecked()
    await userEvent.type(within(dialog).getByRole('textbox', { name: /^Nom/ }), 'Travail et carrière')
    await userEvent.type(within(dialog).getByRole('textbox', { name: t(`${C}.descriptionLabel`) }), '  Emploi, études et orientation ')
    within(picker).getByRole('radio', { name: motifIconLabel('Brain') }).focus()
    await userEvent.keyboard('{ArrowRight}{ArrowRight}{ArrowRight}')
    expect(within(picker).getByRole('radio', { name: motifIconLabel('Briefcase') })).toHaveFocus()
    await userEvent.keyboard('{Enter}')
    expect(within(picker).getByRole('radio', { name: motifIconLabel('Briefcase') })).toBeChecked()
    expect(mocks.api.saveReference).not.toHaveBeenCalled()
    await userEvent.click(within(dialog).getByRole('button', { name: t(`${LIST}.dialog.create`) }))
    await waitFor(() =>
      expect(mocks.api.saveReference).toHaveBeenCalledWith('motif_categories', {
        id: null,
        name: 'Travail et carrière',
        description: 'Emploi, études et orientation',
        icon: 'Briefcase',
      }),
    )
  })

  it('edits a category: its icon is checked, an emptied description is sent as null', async () => {
    const sheet = await openSheet()
    mocks.api.saveReference.mockResolvedValue(IDS.innerLife)
    await chooseAction('Vie intérieure', 'edit')
    const dialog = editDialog('editTitle')
    expect(within(dialog).getByRole('radio', { name: motifIconLabel('Brain') })).toBeChecked()
    await userEvent.clear(within(dialog).getByRole('textbox', { name: t(`${C}.descriptionLabel`) }))
    await userEvent.click(within(dialog).getByRole('radio', { name: motifIconLabel('Heart') }))
    await userEvent.click(within(dialog).getByRole('button', { name: t('common.save') }))
    await waitFor(() =>
      expect(mocks.api.saveReference).toHaveBeenCalledWith('motif_categories', { id: IDS.innerLife, name: 'Vie intérieure', description: null, icon: 'Heart' }),
    )
    // The sheet stays open on its list.
    expect(sheet).toBeInTheDocument()
  })

  it('archiving says its motifs will show under « Autres »', async () => {
    await openSheet()
    mocks.api.setReferenceActive.mockResolvedValue(undefined)
    await chooseAction('Vie intérieure', 'archive')
    const confirm = await screen.findByRole('alertdialog')
    expect(within(confirm).getByText(t(`${C}.archive.bodyOther`, { count: '2' }))).toBeInTheDocument()
    await userEvent.click(within(confirm).getByRole('button', { name: t(`${LIST}.archive.confirm`) }))
    await waitFor(() => expect(mocks.api.setReferenceActive).toHaveBeenCalledWith('motif_categories', IDS.innerLife, false))
  })

  it('archiving an empty category says nobody moves', async () => {
    await openSheet()
    await chooseAction('Relations et famille', 'archive')
    expect(within(await screen.findByRole('alertdialog')).getByText(t(`${C}.archive.bodyNone`))).toBeInTheDocument()
  })

  it('reorders the categories (the order of the groups), sending every id', async () => {
    const sheet = await openSheet()
    mocks.api.reorderReference.mockResolvedValue(undefined)
    await userEvent.click(within(sheet).getByRole('button', { name: t(`${LIST}.actions.moveUp`, { name: 'Relations et famille' }) }))
    await waitFor(() => expect(mocks.api.reorderReference).toHaveBeenCalledWith('motif_categories', [RELATIONS, IDS.innerLife, IDS.archivedCategory]))
  })

  it('read-only: « Voir les catégories », the list without « Ajouter » or actions', async () => {
    const sheet = await openSheet({ readOnly: true })
    expect(rowOf(sheet, 'Vie intérieure')).toBeInTheDocument()
    expect(within(sheet).queryByRole('button', { name: t(`${C}.add`) })).not.toBeInTheDocument()
    expect(within(sheet).queryByRole('button', { name: /^Actions pour/ })).not.toBeInTheDocument()
    expect(within(sheet).queryByRole('button', { name: /^(Monter|Descendre)/ })).not.toBeInTheDocument()
  })
})
