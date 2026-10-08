import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { t } from '@/i18n'
import { usageKey } from '../../api/catalog'
import type { ProfessionalsCatalog } from '../../api/parse'
import { CATALOG } from '../../test/fixtures-domain'
import { IDS } from '../../test/fixtures'
import { renderProfessionalsSettingsPage } from '../../test/settings-page'
import { ProfessionsSettingsPage } from './ProfessionsSettingsPage'

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

const P = 'modules.professionals.settings.professions'
const LIST = 'modules.professionals.settings.list'

const ARCHIVED_CATEGORY = '00000000-0000-4000-8000-0000000000b9'
const ARCHIVED_ORDER = '00000000-0000-4000-8000-0000000000a9'
const NEW_ID = '00000000-0000-4000-8000-0000000000c9'

/** Parents count their active titles; a title counts its professionals. */
const USAGE = new Map([
  [usageKey('professional_orders', IDS.opq), 1],
  [usageKey('profession_categories', IDS.psychologie), 2],
  [usageKey('profession_titles', IDS.psychologue), 3],
])

/**
 * The fixture plus an archived category and an archived order, which « Ancien titre » (archived)
 * still has: they must not be offered for a new title, but stay shown on the title that has them.
 */
function catalogWithArchivedParents(): ProfessionalsCatalog {
  const [category] = CATALOG.categories
  const [order] = CATALOG.orders
  if (!category || !order) throw new Error('fixture')
  return {
    ...CATALOG,
    categories: [...CATALOG.categories, { ...category, id: ARCHIVED_CATEGORY, key: 'ancienne', name: 'Ancienne catégorie', sortOrder: 90, isActive: false }],
    orders: [
      ...CATALOG.orders,
      { ...order, id: ARCHIVED_ORDER, key: 'ancien_ordre', name: 'Ancien ordre', acronym: 'AO', sortOrder: 90, isActive: false },
    ],
    titles: CATALOG.titles.map((title) => (title.id === IDS.archivedTitle ? { ...title, categoryId: ARCHIVED_CATEGORY, orderId: ARCHIVED_ORDER } : title)),
  }
}

beforeEach(() => {
  mocks.api.fetchProfessionalsCatalog.mockResolvedValue(CATALOG)
  mocks.api.fetchReferenceUsage.mockResolvedValue(USAGE)
})
afterEach(() => vi.clearAllMocks())

async function renderPage({ readOnly = false } = {}) {
  renderProfessionalsSettingsPage(<ProfessionsSettingsPage />, { sectionId: 'professions', readOnly })
  await waitFor(() => expect(screen.getAllByRole('table')).toHaveLength(3))
}

const card = (list: 'orders' | 'categories' | 'titles') => screen.getByRole('region', { name: t(`${P}.${list}.title`) })
const dialog = () => screen.getByRole('dialog')
const rowOf = (list: 'orders' | 'categories' | 'titles', name: string) => {
  const row = within(card(list))
    .getAllByRole('row')
    .find((r) => r.querySelector('[data-name]')?.textContent === name)
  if (!row) throw new Error(`no row ${name}`)
  return row
}
/** A row's cells after its header (the name). */
const cells = (list: 'orders' | 'categories' | 'titles', name: string) =>
  within(rowOf(list, name))
    .getAllByRole('cell')
    .map((cell) => cell.textContent)
const textbox = (name: string) => within(dialog()).getByRole('textbox', { name: new RegExp(`^${name}`) })
const combobox = (name: string) => within(dialog()).getByRole('combobox', { name: new RegExp(`^${name}`) })
const options = (select: HTMLElement) =>
  within(select)
    .getAllByRole('option')
    .map((option) => option.textContent)

async function chooseAction(name: string, action: 'edit' | 'archive' | 'restore') {
  await userEvent.click(screen.getByRole('button', { name: t(`${LIST}.actions.menu`, { name }) }))
  await userEvent.click(await screen.findByRole('menuitem', { name: t(`${LIST}.actions.${action}`) }))
}
async function add(list: 'orders' | 'categories' | 'titles') {
  await userEvent.click(within(card(list)).getByRole('button', { name: t(`${P}.${list}.add`) }))
}
const submit = (label: string) => userEvent.click(within(dialog()).getByRole('button', { name: label }))

describe('ProfessionsSettingsPage', () => {
  it('stacks three cards under visible headings, each « Ajouter » outline', async () => {
    await renderPage()
    expect(screen.getByRole('heading', { level: 2, name: t(`${P}.title`) })).toBeInTheDocument()
    for (const list of ['orders', 'categories', 'titles'] as const) {
      const heading = within(card(list)).getByRole('heading', { level: 3, name: t(`${P}.${list}.title`) })
      expect(heading.parentElement).not.toHaveClass('sr-only')
      expect(within(card(list)).getByText(t(`${P}.${list}.description`))).toBeInTheDocument()
      // Several lists on one page: no teal button at rest.
      expect(within(card(list)).getByRole('button', { name: t(`${P}.${list}.add`) })).not.toHaveClass('bg-primary')
    }
    expect(screen.getByText(t(`${P}.categories.description`))).toHaveTextContent('Services et tarifs fixe les prix par catégorie.')
  })

  it('shows each order with its acronym, licence label and its active titles', async () => {
    await renderPage()
    expect(within(card('orders')).getByRole('columnheader', { name: t(`${P}.orders.acronym`) })).toBeInTheDocument()
    expect(within(card('orders')).getByRole('columnheader', { name: t(`${P}.orders.licenceLabel`) })).toBeInTheDocument()
    expect(cells('orders', 'Ordre des psychologues du Québec')).toEqual(['OPQ', 'N° de permis', '1 titre', ''])
    expect(cells('categories', 'Psychologie')).toEqual(['2 titres', ''])
    // A parent nobody's title uses says so, not « Personne ».
    expect(within(rowOf('categories', 'Naturopathie')).getByText(t(`${P}.titleCount.none`))).toHaveClass('sr-only')
  })

  it('shows each title with its category and order, « — » when it has no order', async () => {
    await renderPage()
    // Secondary at phone width, so the order and the actions stay visible at 375 px.
    expect(within(card('titles')).getByRole('columnheader', { name: t(`${P}.titles.category`) })).toHaveClass('max-sm:hidden')
    expect(within(card('titles')).getByRole('columnheader', { name: t(`${P}.titles.order`) })).toBeInTheDocument()
    expect(cells('titles', 'Psychologue')).toEqual(['Psychologie', 'OPQ', '3 professionnels', ''])
    const naturopathe = within(rowOf('titles', 'Naturopathe')).getAllByRole('cell')
    expect(naturopathe[0]).toHaveTextContent('Naturopathie')
    expect(within(naturopathe[1] as HTMLElement).getByText('—')).toHaveAttribute('aria-hidden', 'true')
    expect(within(naturopathe[1] as HTMLElement).getByText(t(`${P}.titles.noOrderLabel`))).toHaveClass('sr-only')
  })

  it('marks an archived category or order on the titles that keep it', async () => {
    mocks.api.fetchProfessionalsCatalog.mockResolvedValue(catalogWithArchivedParents())
    await renderPage()
    await userEvent.click(within(card('titles')).getByRole('button', { name: /^Tous/ }))
    expect(cells('titles', 'Ancien titre').slice(0, 2)).toEqual([
      t(`${P}.titles.archivedCategory`, { name: 'Ancienne catégorie' }),
      t(`${P}.titles.archivedOrder`, { name: 'AO' }),
    ])
  })

  it('searches titles on their category and order too', async () => {
    await renderPage()
    await userEvent.type(within(card('titles')).getByRole('searchbox'), 'opq')
    expect(within(card('titles')).queryByText('Naturopathe')).not.toBeInTheDocument()
    expect(rowOf('titles', 'Psychologue').querySelector('mark')?.textContent).toBe('OPQ')
  })

  it('adds an order: acronym upper-cased as typed, « N° de permis » by default', async () => {
    await renderPage()
    mocks.api.saveReference.mockResolvedValue(NEW_ID)
    await add('orders')
    expect(screen.getByRole('dialog', { name: t(`${P}.orders.createTitle`) })).toBeInTheDocument()
    expect(textbox('Nom')).toHaveFocus()
    expect(textbox(t(`${P}.orders.licenceLabel`))).toHaveValue(t(`${P}.orders.licenceLabelDefault`))
    expect(textbox(t(`${P}.orders.licencePattern`))).toHaveAccessibleDescription(t(`${P}.orders.licencePatternHelp`))
    await userEvent.type(textbox('Nom'), 'Ordre des orthophonistes et audiologistes du Québec')
    await userEvent.type(textbox(t(`${P}.orders.acronym`)), 'oo aq')
    expect(textbox(t(`${P}.orders.acronym`))).toHaveValue('OO AQ')
    await userEvent.clear(textbox(t(`${P}.orders.acronym`)))
    await userEvent.type(textbox(t(`${P}.orders.acronym`)), 'ooaq')
    expect(textbox(t(`${P}.orders.acronym`))).toHaveValue('OOAQ')
    await userEvent.click(textbox(t(`${P}.orders.licencePattern`)))
    await userEvent.paste('^[0-9]{4}$')
    await submit(t(`${LIST}.dialog.create`))
    await waitFor(() => expect(screen.queryByRole('dialog')).not.toBeInTheDocument())
    expect(mocks.api.saveReference).toHaveBeenCalledWith('professional_orders', {
      id: null,
      name: 'Ordre des orthophonistes et audiologistes du Québec',
      acronym: 'OOAQ',
      licenceLabel: 'N° de permis',
      licencePattern: '^[0-9]{4}$',
    })
  })

  it('refuses a licence format the browser cannot check like the database', async () => {
    await renderPage()
    await add('orders')
    await userEvent.type(textbox('Nom'), 'Ordre des chimistes')
    await userEvent.type(textbox(t(`${P}.orders.acronym`)), 'OCQ')
    await userEvent.click(textbox(t(`${P}.orders.licencePattern`)))
    await userEvent.paste('^[[:digit:]]{5}$')
    await submit(t(`${LIST}.dialog.create`))
    expect(await within(dialog()).findByText(t('modules.professionals.validation.licencePatternSyntax'))).toBeInTheDocument()
    expect(mocks.api.saveReference).not.toHaveBeenCalled()
  })

  it('edits an order with its saved licence label and format', async () => {
    await renderPage()
    await chooseAction('Ordre des psychologues du Québec', 'edit')
    expect(screen.getByRole('dialog', { name: t(`${P}.orders.editTitle`) })).toBeInTheDocument()
    expect(textbox(t(`${P}.orders.acronym`))).toHaveValue('OPQ')
    expect(textbox(t(`${P}.orders.licencePattern`))).toHaveValue('^[0-9]{5}$')
  })

  it('adds a category (name only)', async () => {
    await renderPage()
    mocks.api.saveReference.mockResolvedValue(NEW_ID)
    await add('categories')
    expect(screen.getByRole('dialog', { name: t(`${P}.categories.createTitle`) })).toBeInTheDocument()
    expect(within(dialog()).getAllByRole('textbox')).toHaveLength(1)
    await userEvent.type(textbox('Nom'), 'Orthophonie')
    await submit(t(`${LIST}.dialog.create`))
    await waitFor(() => expect(mocks.api.saveReference).toHaveBeenCalledWith('profession_categories', { id: null, name: 'Orthophonie' }))
  })

  it('offers only active categories and orders for a new title, « Aucun ordre » first, sent as null', async () => {
    mocks.api.fetchProfessionalsCatalog.mockResolvedValue(catalogWithArchivedParents())
    await renderPage()
    mocks.api.saveReference.mockResolvedValue(NEW_ID)
    await add('titles')
    expect(screen.getByRole('dialog', { name: t(`${P}.titles.createTitle`) })).toBeInTheDocument()
    const category = combobox(t(`${P}.titles.category`))
    expect(options(category)).toEqual([t(`${P}.titles.categoryPlaceholder`), 'Psychologie', 'Naturopathie'])
    const order = combobox(t(`${P}.titles.order`))
    expect(options(order)).toEqual([t(`${P}.titles.noOrder`), 'Ordre des psychologues du Québec (OPQ)'])
    expect(order).toHaveValue('')
    expect(order).toHaveAccessibleDescription(t(`${P}.titles.orderHelp`))
    // A new title: nobody has it yet, so no note about licences.
    await userEvent.selectOptions(order, IDS.opq)
    expect(within(dialog()).queryByText(t(`${P}.titles.licenceNote`))).not.toBeInTheDocument()
    await userEvent.selectOptions(order, '')

    await userEvent.type(textbox('Nom'), 'Naturothérapeute')
    await submit(t(`${LIST}.dialog.create`))
    expect(await within(dialog()).findByText(t('modules.professionals.validation.categoryRequired'))).toBeInTheDocument()
    await userEvent.selectOptions(category, IDS.naturopathie)
    await submit(t(`${LIST}.dialog.create`))
    await waitFor(() => expect(screen.queryByRole('dialog')).not.toBeInTheDocument())
    expect(mocks.api.saveReference).toHaveBeenCalledWith('profession_titles', { id: null, name: 'Naturothérapeute', categoryId: IDS.naturopathie, orderId: null })
  })

  it('keeps an archived category and order shown on the title that has them', async () => {
    mocks.api.fetchProfessionalsCatalog.mockResolvedValue(catalogWithArchivedParents())
    await renderPage()
    await userEvent.click(within(card('titles')).getByRole('button', { name: /^Archivés/ }))
    await chooseAction('Ancien titre', 'edit')
    const category = combobox(t(`${P}.titles.category`))
    expect(category).toHaveValue(ARCHIVED_CATEGORY)
    expect(options(category)).toEqual([
      t(`${P}.titles.categoryPlaceholder`),
      'Psychologie',
      'Naturopathie',
      t(`${P}.titles.archivedCategory`, { name: 'Ancienne catégorie' }),
    ])
    const order = combobox(t(`${P}.titles.order`))
    expect(order).toHaveValue(ARCHIVED_ORDER)
    expect(options(order)).toEqual([
      t(`${P}.titles.noOrder`),
      'Ordre des psychologues du Québec (OPQ)',
      t(`${P}.titles.archivedOrder`, { name: 'Ancien ordre (AO)' }),
    ])
  })

  it('warns that a licence will be required when a title gains an order', async () => {
    await renderPage()
    mocks.api.saveReference.mockResolvedValue(IDS.naturopathe)
    await chooseAction('Naturopathe', 'edit')
    const order = combobox(t(`${P}.titles.order`))
    expect(within(dialog()).queryByText(t(`${P}.titles.licenceNote`))).not.toBeInTheDocument()
    await userEvent.selectOptions(order, IDS.opq)
    expect(within(dialog()).getByText(t(`${P}.titles.licenceNote`))).toBeInTheDocument()
    await userEvent.selectOptions(order, '')
    expect(within(dialog()).queryByText(t(`${P}.titles.licenceNote`))).not.toBeInTheDocument()
    await userEvent.selectOptions(order, IDS.opq)
    await submit(t('common.save'))
    await waitFor(() =>
      expect(mocks.api.saveReference).toHaveBeenCalledWith('profession_titles', {
        id: IDS.naturopathe,
        name: 'Naturopathe',
        categoryId: IDS.naturopathie,
        orderId: IDS.opq,
      }),
    )
  })

  it('no licence note for a title that already has an order', async () => {
    await renderPage()
    await chooseAction('Psychologue', 'edit')
    expect(combobox(t(`${P}.titles.order`))).toHaveValue(IDS.opq)
    expect(within(dialog()).queryByText(t(`${P}.titles.licenceNote`))).not.toBeInTheDocument()
  })

  it('says how many active titles a category holds, and shows the refusal of the database', async () => {
    await renderPage()
    mocks.api.setReferenceActive.mockRejectedValue({ code: 'P0001', message: "Archivez d'abord les titres de cette catégorie." })
    await chooseAction('Psychologie', 'archive')
    const confirm = await screen.findByRole('alertdialog')
    expect(within(confirm).getByText(t(`${P}.categories.archive.bodyOther`, { count: '2' }))).toBeInTheDocument()
    await userEvent.click(within(confirm).getByRole('button', { name: t(`${LIST}.archive.confirm`) }))
    expect(await within(confirm).findByRole('alert')).toHaveTextContent("Archivez d'abord les titres de cette catégorie.")
    expect(mocks.api.setReferenceActive).toHaveBeenCalledWith('profession_categories', IDS.psychologie, false)
    expect(mocks.toast.error).not.toHaveBeenCalled()
  })

  it('archives an unused category, and says a title keeps its professionals', async () => {
    await renderPage()
    mocks.api.setReferenceActive.mockResolvedValue(undefined)
    await chooseAction('Naturopathie', 'archive')
    let confirm = await screen.findByRole('alertdialog')
    expect(within(confirm).getByText(t(`${P}.categories.archive.bodyNone`))).toBeInTheDocument()
    await userEvent.click(within(confirm).getByRole('button', { name: t(`${LIST}.archive.confirm`) }))
    await waitFor(() => expect(screen.queryByRole('alertdialog')).not.toBeInTheDocument())
    expect(mocks.api.setReferenceActive).toHaveBeenCalledWith('profession_categories', IDS.naturopathie, false)

    await chooseAction('Psychologue', 'archive')
    confirm = await screen.findByRole('alertdialog')
    expect(within(confirm).getByText(t(`${P}.titles.archive.bodyOther`, { count: '3' }))).toBeInTheDocument()
  })

  it('shows why a title cannot be restored before its order', async () => {
    mocks.api.fetchProfessionalsCatalog.mockResolvedValue(catalogWithArchivedParents())
    await renderPage()
    mocks.api.setReferenceActive.mockRejectedValue({ code: 'P0001', message: "Restaurez d'abord sa catégorie." })
    await userEvent.click(within(card('titles')).getByRole('button', { name: /^Archivés/ }))
    await chooseAction('Ancien titre', 'restore')
    const confirm = await screen.findByRole('alertdialog')
    await userEvent.click(within(confirm).getByRole('button', { name: t(`${LIST}.restore.confirm`) }))
    expect(await within(confirm).findByRole('alert')).toHaveTextContent("Restaurez d'abord sa catégorie.")
  })

  it('read-only for the adjointe: the notice once, no « Ajouter », no actions', async () => {
    await renderPage({ readOnly: true })
    expect(screen.getAllByText(t('common.readOnlyNotice.title'))).toHaveLength(1)
    expect(screen.queryByRole('button', { name: /^Ajouter/ })).not.toBeInTheDocument()
    expect(screen.queryByRole('button', { name: /^Actions pour/ })).not.toBeInTheDocument()
    expect(cells('titles', 'Psychologue')).toEqual(['Psychologie', 'OPQ', '3 professionnels'])
  })
})
