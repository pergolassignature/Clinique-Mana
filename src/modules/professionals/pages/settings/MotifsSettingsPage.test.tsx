import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { t } from '@/i18n'
import { usageKey } from '../../api/catalog'
import type { ProfessionalsCatalog } from '../../api/parse'
import { CATALOG } from '../../test/fixtures-domain'
import { IDS } from '../../test/fixtures'
import { renderProfessionalsSettingsPage } from '../../test/settings-page'
import { MotifsSettingsPage } from './MotifsSettingsPage'

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
const LIST = 'modules.professionals.settings.list'
const OTHER = t('modules.professionals.otherCategory')

const RELATIONS = '00000000-0000-4000-8000-0000000000f3'
const COUPLE = '00000000-0000-4000-8000-000000000106'
const NEW_ID = '00000000-0000-4000-8000-000000000199'

const USAGE = new Map([
  [usageKey('motifs', IDS.anxiete), 2],
  [usageKey('motifs', IDS.psychose), 1],
])

/**
 * The fixture (Vie intérieure: Anxiété, Psychose (restricted), Ancien motif (archived); Deuil in an
 * archived category; Sans catégorie) plus « Relations et famille », ordered before Vie intérieure,
 * with « Couple », last in the list's own order.
 */
function catalog(): ProfessionalsCatalog {
  const [category] = CATALOG.motifCategories
  const [motif] = CATALOG.motifs
  if (!category || !motif) throw new Error('fixture')
  return {
    ...CATALOG,
    motifCategories: [
      { ...category, id: RELATIONS, key: 'relations', name: 'Relations et famille', description: null, icon: 'Users', sortOrder: 5 },
      ...CATALOG.motifCategories,
    ],
    motifs: [...CATALOG.motifs, { ...motif, id: COUPLE, key: 'couple', name: 'Couple', categoryId: RELATIONS, sortOrder: 60 }],
  }
}

beforeEach(() => {
  mocks.api.fetchProfessionalsCatalog.mockResolvedValue(catalog())
  mocks.api.fetchReferenceUsage.mockResolvedValue(USAGE)
})
afterEach(() => vi.clearAllMocks())

async function renderPage({ readOnly = false } = {}) {
  renderProfessionalsSettingsPage(<MotifsSettingsPage />, { sectionId: 'motifs', readOnly })
  await screen.findByRole('region', { name: t(`${M}.title`) })
}

const card = () => screen.getByRole('region', { name: t(`${M}.title`) })
const dialog = () => screen.getByRole('dialog')
/** The motif names in the table, in order. */
const names = () =>
  within(card())
    .getAllByRole('row')
    .flatMap((row) => {
      const name = row.querySelector('th[scope="row"] [data-name]')?.textContent
      return name === undefined || name === null ? [] : [name]
    })
const groupHeaders = () =>
  within(card())
    .queryAllByRole('rowheader')
    .filter((cell) => cell.getAttribute('scope') === 'rowgroup')
    .map((cell) => cell.textContent)
const rowOf = (name: string) => {
  const row = within(card())
    .getAllByRole('row')
    .find((r) => r.querySelector('[data-name]')?.textContent === name)
  if (!row) throw new Error(`no row ${name}`)
  return row
}
const cells = (name: string) =>
  within(rowOf(name))
    .getAllByRole('cell')
    .map((cell) => cell.textContent)
const categoryFilter = () => within(card()).getByRole('combobox', { name: t(`${M}.categoryFilter.label`) })
const view = (name: 'byCategory' | 'alphabetical') => within(card()).getByRole('button', { name: t(`${M}.view.${name}`) })
const addButton = () => within(card()).getByRole('button', { name: t(`${M}.add`) })
const nameField = () => within(dialog()).getByRole('textbox', { name: /^Nom/ })
const categoryField = () => within(dialog()).getByRole('combobox', { name: t(`${M}.category`) })
const restrictedSwitch = () => within(dialog()).getByRole('switch', { name: t(`${M}.restrictedLabel`) })
const submit = (label: string) => userEvent.click(within(dialog()).getByRole('button', { name: label }))

async function chooseAction(name: string, action: 'edit' | 'archive' | 'restore') {
  await userEvent.click(screen.getByRole('button', { name: t(`${LIST}.actions.menu`, { name }) }))
  await userEvent.click(await screen.findByRole('menuitem', { name: t(`${LIST}.actions.${action}`) }))
}

describe('MotifsSettingsPage', () => {
  it('says motifs are needs, not a diagnosis; one teal « Ajouter un motif », the categories in the header', async () => {
    await renderPage()
    expect(screen.getByRole('heading', { level: 2, name: t(`${M}.title`) })).toBeInTheDocument()
    expect(screen.getByText(t(`${M}.description`))).toHaveTextContent("Les motifs pour lesquels les clients consultent, dans les mots de la clinique. Chaque professionnel choisit ceux qu'il accompagne.")
    // The page holds one list: its heading is for screen readers only.
    expect(within(card()).getByRole('heading', { level: 3, name: t(`${M}.title`) }).parentElement).toHaveClass('sr-only')
    expect(addButton()).toHaveClass('bg-primary')
    const manage = screen.getByRole('button', { name: t(`${M}.manageCategories`) })
    expect(manage).not.toHaveClass('bg-primary')
    expect(card()).not.toContainElement(manage)
  })

  it('« Par catégorie »: groups in the categories’ order, « Autres » last (no category, or an archived one)', async () => {
    await renderPage()
    expect(view('byCategory')).toHaveAttribute('aria-pressed', 'true')
    expect(groupHeaders()).toEqual(['Relations et famille', 'Vie intérieure', OTHER])
    expect(names()).toEqual(['Couple', 'Anxiété', 'Psychose', 'Deuil', 'Sans catégorie'])
    // The group says the category: no « Catégorie » column.
    expect(within(card()).queryByRole('columnheader', { name: t(`${M}.category`) })).not.toBeInTheDocument()
  })

  it('« Réservé »: dot and « Professions réglementées », else « — » (« Non réservé » to screen readers)', async () => {
    await renderPage()
    expect(within(card()).getByRole('columnheader', { name: t(`${M}.restricted`) })).toBeInTheDocument()
    expect(cells('Psychose')).toEqual([t(`${M}.restrictedCell`), '1 professionnel', ''])
    // Status = dot + word (design system); the words wrap at phone width.
    expect(within(rowOf('Psychose')).getByText(t(`${M}.restrictedCell`)).parentElement?.querySelector('[data-tone="info"]')).toBeInTheDocument()
    expect(cells('Anxiété')).toEqual([`—${t(`${M}.notRestricted`)}`, '2 professionnels', ''])
  })

  it('« Liste A–Z »: by name, with a Catégorie column, no groups and no reorder', async () => {
    await renderPage()
    await userEvent.click(view('alphabetical'))
    expect(view('alphabetical')).toHaveAttribute('aria-pressed', 'true')
    expect(groupHeaders()).toEqual([])
    expect(names()).toEqual(['Anxiété', 'Couple', 'Deuil', 'Psychose', 'Sans catégorie'])
    expect(within(card()).getByRole('columnheader', { name: t(`${M}.category`) })).toHaveClass('max-lg:hidden')
    expect(cells('Anxiété')[0]).toBe('Vie intérieure')
    expect(cells('Deuil')[0]).toBe(t(`${M}.archivedCategory`, { name: 'Ancienne catégorie' }))
    expect(cells('Sans catégorie')[0]).toBe(OTHER)
    expect(within(card()).queryByRole('button', { name: /^(Monter|Descendre)/ })).not.toBeInTheDocument()
    // In A–Z, the search also looks in the category.
    await userEvent.type(within(card()).getByRole('searchbox'), 'relations')
    expect(names()).toEqual(['Couple'])
  })

  it('the view toggle: arrow keys move focus only, Enter switches (decision #36)', async () => {
    await renderPage()
    view('byCategory').focus()
    await userEvent.keyboard('{ArrowRight}')
    expect(view('alphabetical')).toHaveFocus()
    expect(view('alphabetical')).toHaveAttribute('aria-pressed', 'false')
    expect(groupHeaders()).toHaveLength(3)
    await userEvent.keyboard('{Enter}')
    expect(groupHeaders()).toEqual([])
  })

  it('filters by category: the counts follow, and « Ajouter » starts in that category', async () => {
    await renderPage()
    mocks.api.saveReference.mockResolvedValue(NEW_ID)
    expect(within(categoryFilter()).getAllByRole('option').map((o) => o.textContent)).toEqual([
      t(`${M}.categoryFilter.all`),
      'Relations et famille',
      'Vie intérieure',
      OTHER,
    ])
    await userEvent.selectOptions(categoryFilter(), 'Vie intérieure')
    expect(names()).toEqual(['Anxiété', 'Psychose'])
    expect(within(card()).getByRole('button', { name: /^Tous \(3\)/ })).toBeInTheDocument()
    await userEvent.click(addButton())
    expect(categoryField()).toHaveValue(IDS.innerLife)
    await userEvent.type(nameField(), 'Estime de soi')
    await submit(t(`${LIST}.dialog.create`))
    await waitFor(() =>
      expect(mocks.api.saveReference).toHaveBeenCalledWith('motifs', { id: null, name: 'Estime de soi', categoryId: IDS.innerLife, isRestricted: false }),
    )
  })

  it('the « Autres » filter keeps the motifs without an active category; « Ajouter » then has none', async () => {
    await renderPage()
    mocks.api.saveReference.mockResolvedValue(NEW_ID)
    await userEvent.selectOptions(categoryFilter(), OTHER)
    expect(names()).toEqual(['Deuil', 'Sans catégorie'])
    await userEvent.click(addButton())
    expect(categoryField()).toHaveValue('')
    await userEvent.type(nameField(), 'Solitude')
    await submit(t(`${LIST}.dialog.create`))
    await waitFor(() => expect(mocks.api.saveReference).toHaveBeenCalledWith('motifs', { id: null, name: 'Solitude', categoryId: null, isRestricted: false }))
  })

  it('adds a restricted motif: the switch’s value is sent', async () => {
    await renderPage()
    mocks.api.saveReference.mockResolvedValue(NEW_ID)
    await userEvent.click(addButton())
    expect(screen.getByRole('dialog', { name: t(`${M}.createTitle`) })).toBeInTheDocument()
    expect(nameField()).toHaveFocus()
    // Active categories only, « Autres » first.
    expect(within(categoryField()).getAllByRole('option').map((o) => o.textContent)).toEqual([
      t(`${M}.categoryNone`),
      'Relations et famille',
      'Vie intérieure',
    ])
    expect(restrictedSwitch()).not.toBeChecked()
    expect(restrictedSwitch()).toHaveAccessibleDescription(t(`${M}.restrictedHelp`))
    await userEvent.type(nameField(), 'Expertise psycholégale')
    await userEvent.selectOptions(categoryField(), 'Vie intérieure')
    await userEvent.click(restrictedSwitch())
    expect(restrictedSwitch()).toBeChecked()
    await submit(t(`${LIST}.dialog.create`))
    await waitFor(() =>
      expect(mocks.api.saveReference).toHaveBeenCalledWith('motifs', {
        id: null,
        name: 'Expertise psycholégale',
        categoryId: IDS.innerLife,
        isRestricted: true,
      }),
    )
  })

  it('a motif keeps its archived category when renamed (marked « archivée » in the select)', async () => {
    await renderPage()
    mocks.api.saveReference.mockResolvedValue(IDS.deuil)
    await chooseAction('Deuil', 'edit')
    expect(screen.getByRole('dialog', { name: t(`${M}.editTitle`) })).toBeInTheDocument()
    expect(categoryField()).toHaveValue(IDS.archivedCategory)
    expect(within(categoryField()).getByRole('option', { selected: true })).toHaveTextContent(t(`${M}.archivedCategory`, { name: 'Ancienne catégorie' }))
    await userEvent.clear(nameField())
    await userEvent.type(nameField(), 'Deuil et perte')
    await submit(t('common.save'))
    await waitFor(() =>
      expect(mocks.api.saveReference).toHaveBeenCalledWith('motifs', { id: IDS.deuil, name: 'Deuil et perte', categoryId: IDS.archivedCategory, isRestricted: false }),
    )
  })

  it('restricting a motif professionals have: a note says what they will need', async () => {
    await renderPage()
    await chooseAction('Anxiété', 'edit')
    expect(within(dialog()).queryByText(t(`${M}.restrictedNote`))).not.toBeInTheDocument()
    await userEvent.click(restrictedSwitch())
    expect(within(dialog()).getByText(t(`${M}.restrictedNote`))).toBeInTheDocument()
    await userEvent.click(restrictedSwitch())
    expect(within(dialog()).queryByText(t(`${M}.restrictedNote`))).not.toBeInTheDocument()
  })

  it('restricting a motif nobody has: no note', async () => {
    await renderPage()
    await chooseAction('Sans catégorie', 'edit')
    await userEvent.click(restrictedSwitch())
    expect(within(dialog()).queryByText(t(`${M}.restrictedNote`))).not.toBeInTheDocument()
  })

  it('the database decides: its refusal shows in the dialog', async () => {
    await renderPage()
    mocks.api.saveReference.mockRejectedValue({ code: 'P0001', message: 'Catégorie introuvable ou archivée.' })
    await chooseAction('Anxiété', 'edit')
    await userEvent.selectOptions(categoryField(), 'Relations et famille')
    await submit(t('common.save'))
    expect(await within(dialog()).findByRole('alert')).toHaveTextContent('Catégorie introuvable ou archivée.')
  })

  it('archives a motif after saying how many professionals keep it', async () => {
    await renderPage()
    mocks.api.setReferenceActive.mockResolvedValue(undefined)
    await chooseAction('Anxiété', 'archive')
    const confirm = await screen.findByRole('alertdialog')
    expect(within(confirm).getByText(t(`${M}.archive.bodyOther`, { count: '2' }))).toBeInTheDocument()
    await userEvent.click(within(confirm).getByRole('button', { name: t(`${LIST}.archive.confirm`) }))
    await waitFor(() => expect(mocks.api.setReferenceActive).toHaveBeenCalledWith('motifs', IDS.anxiete, false))
  })

  it('reorders within a category, sending the whole list (archived included)', async () => {
    await renderPage()
    mocks.api.reorderReference.mockResolvedValue(undefined)
    // Anxiété is first of Vie intérieure: Couple is in another group.
    expect(within(card()).getByRole('button', { name: t(`${LIST}.actions.moveUp`, { name: 'Anxiété' }) })).toHaveAttribute('aria-disabled', 'true')
    await userEvent.click(within(card()).getByRole('button', { name: t(`${LIST}.actions.moveUp`, { name: 'Psychose' }) }))
    await waitFor(() =>
      expect(mocks.api.reorderReference).toHaveBeenCalledWith('motifs', [IDS.psychose, IDS.anxiete, IDS.deuil, IDS.orphan, IDS.archivedMotif, COUPLE]),
    )
  })

  it('at phone width the « … » menu stays in view: « Utilisé par » hidden, « Réservé » kept', async () => {
    await renderPage()
    expect(within(card()).getByRole('columnheader', { name: t(`${LIST}.columns.usage`) })).toHaveClass('max-sm:hidden')
    expect(within(card()).getByRole('columnheader', { name: t(`${M}.restricted`) })).not.toHaveClass('max-sm:hidden')
    const menu = within(card()).getByRole('button', { name: t(`${LIST}.actions.menu`, { name: 'Psychose' }) })
    expect(menu).not.toHaveClass('max-sm:hidden')
    expect(menu).not.toHaveClass('max-md:hidden')
  })

  it('read-only for the adjointe: the notice once, the motifs, « Voir les catégories », no « Ajouter », no actions', async () => {
    await renderPage({ readOnly: true })
    expect(screen.getAllByText(t('common.readOnlyNotice.title'))).toHaveLength(1)
    expect(names()).toEqual(['Couple', 'Anxiété', 'Psychose', 'Deuil', 'Sans catégorie'])
    expect(screen.queryByRole('button', { name: /^Ajouter/ })).not.toBeInTheDocument()
    expect(screen.queryByRole('button', { name: /^Actions pour/ })).not.toBeInTheDocument()
    expect(screen.queryByRole('button', { name: /^(Monter|Descendre)/ })).not.toBeInTheDocument()
    expect(screen.getByRole('button', { name: t(`${M}.viewCategories`) })).toBeInTheDocument()
    expect(screen.queryByRole('button', { name: t(`${M}.manageCategories`) })).not.toBeInTheDocument()
  })
})
