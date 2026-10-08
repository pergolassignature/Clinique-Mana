import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { t } from '@/i18n'
import { usageKey } from '../../api/catalog'
import type { ProfessionalsCatalog } from '../../api/parse'
import { CATALOG } from '../../test/fixtures-domain'
import { IDS } from '../../test/fixtures'
import { renderProfessionalsSettingsPage } from '../../test/settings-page'
import { ClientelesSettingsPage } from './ClientelesSettingsPage'

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

const S = 'modules.professionals.settings.clienteles'
const LIST = 'modules.professionals.settings.list'
const V = 'modules.professionals.validation'

const YOUNG_ADULTS = '00000000-0000-4000-8000-0000000000d9'
const NEW_ID = '00000000-0000-4000-8000-0000000000ea'

const USAGE = new Map([
  [usageKey('clienteles', IDS.couples), 2],
  [usageKey('clienteles', IDS.children), 1],
])

/** The fixture plus a clinic's own clientèle (18–25, not system). */
function catalog(): ProfessionalsCatalog {
  const [clientele] = CATALOG.clienteles
  if (!clientele) throw new Error('fixture')
  return {
    ...CATALOG,
    clienteles: [
      ...CATALOG.clienteles,
      { ...clientele, id: YOUNG_ADULTS, key: 'young_adults', name: 'Jeunes adultes', minAge: 18, maxAge: 25, isSystem: false, sortOrder: 80 },
    ],
  }
}

beforeEach(() => {
  mocks.api.fetchProfessionalsCatalog.mockResolvedValue(catalog())
  mocks.api.fetchReferenceUsage.mockResolvedValue(USAGE)
})
afterEach(() => vi.clearAllMocks())

async function renderPage({ readOnly = false } = {}) {
  renderProfessionalsSettingsPage(<ClientelesSettingsPage />, { sectionId: 'clienteles', readOnly })
  await screen.findByRole('table')
}

const card = () => screen.getByRole('region', { name: t(`${S}.title`) })
const dialog = () => screen.getByRole('dialog')
const rowOf = (name: string) => {
  const row = within(card())
    .getAllByRole('row')
    .find((r) => r.querySelector('[data-name]')?.textContent === name)
  if (!row) throw new Error(`no row ${name}`)
  return row
}
/** A row's cells after its header (the name). */
const cells = (name: string) =>
  within(rowOf(name))
    .getAllByRole('cell')
    .map((cell) => cell.textContent)
const textbox = (name: string) => within(dialog()).getByRole('textbox', { name: new RegExp(`^${name}`) })
const filter = (name: RegExp) => userEvent.click(within(card()).getByRole('button', { name }))

async function openMenu(name: string) {
  await userEvent.click(screen.getByRole('button', { name: t(`${LIST}.actions.menu`, { name }) }))
}
async function chooseAction(name: string, action: 'edit' | 'archive' | 'restore') {
  await openMenu(name)
  await userEvent.click(await screen.findByRole('menuitem', { name: t(`${LIST}.actions.${action}`) }))
}
const add = () => userEvent.click(within(card()).getByRole('button', { name: t(`${S}.add`) }))
const submit = (label: string) => userEvent.click(within(dialog()).getByRole('button', { name: label }))

describe('ClientelesSettingsPage', () => {
  it('is the clientèles alone: the page heading, its description, one list and no approaches (P4-240)', async () => {
    await renderPage()
    expect(screen.getByRole('heading', { level: 2, name: t(`${S}.title`) })).toBeInTheDocument()
    expect(screen.getByText(t(`${S}.description`))).toBeInTheDocument()
    expect(screen.getAllByRole('table')).toHaveLength(1)
    expect(screen.queryByText(/approche/i)).not.toBeInTheDocument()
    // One list on the page: « Ajouter une clientèle » is its teal action.
    expect(screen.getByRole('button', { name: t(`${S}.add`) })).toHaveClass('bg-primary')
  })

  it('shows each clientèle’s ages in words, and how many professionals it has', async () => {
    await renderPage()
    expect(within(card()).getByRole('columnheader', { name: t(`${S}.ages`) })).toBeInTheDocument()
    expect(cells('Enfants')).toEqual(['0 à 12 ans', '1 professionnel', ''])
    expect(cells('Aînés').slice(0, 1)).toEqual(['65 ans et plus'])
    // P4-52: « Sans âge », not « Sans limite d'âge » (which reads like « Tous les âges »); muted like the lists' « — ».
    expect(cells('Couples').slice(0, 2)).toEqual(['Sans âge', '2 professionnels'])
    expect(within(rowOf('Couples')).getByText('Sans âge')).toHaveClass('text-subtle')
    expect(within(rowOf('Enfants')).getByText('0 à 12 ans')).not.toHaveClass('text-subtle')
    expect(cells('Jeunes adultes').slice(0, 1)).toEqual(['18 à 25 ans'])
  })

  it('locks the system clientèles: a note, and no « Archiver »', async () => {
    await renderPage()
    expect(within(rowOf('Couples')).getByRole('img', { name: t(`${S}.system`) })).toBeInTheDocument()
    expect(within(rowOf('Jeunes adultes')).queryByRole('img')).not.toBeInTheDocument()
    await openMenu('Enfants')
    expect(await screen.findByRole('menuitem', { name: t(`${LIST}.actions.edit`) })).toBeInTheDocument()
    expect(screen.queryByRole('menuitem', { name: t(`${LIST}.actions.archive`) })).not.toBeInTheDocument()
    await userEvent.keyboard('{Escape}')
    await openMenu('Jeunes adultes')
    expect(await screen.findByRole('menuitem', { name: t(`${LIST}.actions.archive`) })).toBeInTheDocument()
  })

  it('adds an age group: the bounds are sent as numbers', async () => {
    await renderPage()
    mocks.api.saveReference.mockResolvedValue(NEW_ID)
    await add()
    expect(screen.getByRole('dialog', { name: t(`${S}.createTitle`) })).toBeInTheDocument()
    expect(textbox('Nom')).toHaveFocus()
    expect(textbox(t(`${S}.minAge`))).toHaveAccessibleDescription(t(`${S}.minAgeHelp`))
    expect(textbox(t(`${S}.maxAge`))).toHaveAccessibleDescription(t(`${S}.maxAgeHelp`))
    expect(textbox(t(`${S}.minAge`))).toHaveAttribute('inputmode', 'numeric')
    await userEvent.type(textbox('Nom'), 'Préadolescents')
    await userEvent.type(textbox(t(`${S}.minAge`)), '10')
    await userEvent.type(textbox(t(`${S}.maxAge`)), '12')
    await submit(t(`${LIST}.dialog.create`))
    await waitFor(() => expect(screen.queryByRole('dialog')).not.toBeInTheDocument())
    expect(mocks.api.saveReference).toHaveBeenCalledWith('clienteles', { id: null, name: 'Préadolescents', minAge: 10, maxAge: 12 })
  })

  it('adds a clientèle without ages: both bounds sent as null', async () => {
    await renderPage()
    mocks.api.saveReference.mockResolvedValue(NEW_ID)
    await add()
    await userEvent.type(textbox('Nom'), 'Fratries')
    await submit(t(`${LIST}.dialog.create`))
    await waitFor(() => expect(mocks.api.saveReference).toHaveBeenCalledWith('clienteles', { id: null, name: 'Fratries', minAge: null, maxAge: null }))
  })

  it.each([
    ['130', '', `${V}.ages`, 'minAge'],
    ['1a', '', `${V}.ages`, 'minAge'],
    ['', '12', `${V}.maxAgeNeedsMin`, 'maxAge'],
    ['18', '12', `${V}.maxAgeBelowMin`, 'maxAge'],
  ] as const)('refuses ages %s–%s before any request (%s)', async (min, max, message, field) => {
    await renderPage()
    await add()
    await userEvent.type(textbox('Nom'), 'Essai')
    if (min) await userEvent.type(textbox(t(`${S}.minAge`)), min)
    if (max) await userEvent.type(textbox(t(`${S}.maxAge`)), max)
    await submit(t(`${LIST}.dialog.create`))
    const input = textbox(t(`${S}.${field}`))
    await waitFor(() => expect(input).toHaveAccessibleDescription(expect.stringContaining(t(message))))
    expect(input).toHaveAttribute('aria-invalid', 'true')
    expect(mocks.api.saveReference).not.toHaveBeenCalled()
  })

  it('a system age group keeps a minimum age (as the database requires)', async () => {
    await renderPage()
    await chooseAction('Enfants', 'edit')
    expect(screen.getByRole('dialog', { name: t(`${S}.editTitle`) })).toBeInTheDocument()
    const min = textbox(t(`${S}.minAge`))
    expect(min).toHaveValue('0')
    expect(min).toHaveAccessibleDescription(t(`${S}.systemAgeGroup`))
    expect(textbox(t(`${S}.maxAge`))).toHaveValue('12')
    await userEvent.clear(min)
    await userEvent.clear(textbox(t(`${S}.maxAge`)))
    await submit(t('common.save'))
    await waitFor(() => expect(min).toHaveAccessibleDescription(expect.stringContaining(t(`${V}.clienteleKind`))))
    expect(mocks.api.saveReference).not.toHaveBeenCalled()
  })

  it('a system age group’s bounds can change: Enfants 0–12 → 0–11 is saved', async () => {
    await renderPage()
    mocks.api.saveReference.mockResolvedValue(IDS.children)
    await chooseAction('Enfants', 'edit')
    const max = textbox(t(`${S}.maxAge`))
    expect(max).not.toHaveAttribute('readonly')
    await userEvent.clear(max)
    await userEvent.type(max, '11')
    await submit(t('common.save'))
    await waitFor(() => expect(mocks.api.saveReference).toHaveBeenCalledWith('clienteles', { id: IDS.children, name: 'Enfants', minAge: 0, maxAge: 11 }))
  })

  it('a system clientèle without ages keeps none: its ages are read-only', async () => {
    await renderPage()
    mocks.api.saveReference.mockResolvedValue(IDS.couples)
    await chooseAction('Couples', 'edit')
    const min = textbox(t(`${S}.minAge`))
    expect(min).toHaveAttribute('readonly')
    expect(min).toHaveAccessibleDescription(t(`${S}.systemNoAges`))
    expect(textbox(t(`${S}.maxAge`))).toHaveAttribute('readonly')
    // One help line under both locked fields, read with each.
    expect(textbox(t(`${S}.maxAge`))).toHaveAccessibleDescription(t(`${S}.systemNoAges`))
    expect(within(dialog()).getAllByText(t(`${S}.systemNoAges`))).toHaveLength(1)
    expect(textbox('Nom')).toHaveFocus()
    await userEvent.clear(textbox('Nom'))
    await userEvent.type(textbox('Nom'), 'Couples et partenaires')
    await submit(t('common.save'))
    await waitFor(() =>
      expect(mocks.api.saveReference).toHaveBeenCalledWith('clienteles', { id: IDS.couples, name: 'Couples et partenaires', minAge: null, maxAge: null }),
    )
  })

  it('the database decides: its refusal shows in the dialog', async () => {
    await renderPage()
    mocks.api.saveReference.mockRejectedValue({ code: 'P0001', message: 'Une clientèle porte déjà ce nom (elle est peut-être archivée).' })
    await chooseAction('Jeunes adultes', 'edit')
    await userEvent.clear(textbox(t(`${S}.maxAge`)))
    await userEvent.type(textbox(t(`${S}.maxAge`)), '29')
    await submit(t('common.save'))
    expect(await within(dialog()).findByRole('alert')).toHaveTextContent('Une clientèle porte déjà ce nom')
    expect(mocks.api.saveReference).toHaveBeenCalledWith('clienteles', { id: YOUNG_ADULTS, name: 'Jeunes adultes', minAge: 18, maxAge: 29 })
  })

  it('reorders the clientèles, sending the whole list', async () => {
    await renderPage()
    mocks.api.reorderReference.mockResolvedValue(undefined)
    await userEvent.click(within(card()).getByRole('button', { name: t(`${LIST}.actions.moveUp`, { name: 'Jeunes adultes' }) }))
    await waitFor(() =>
      expect(mocks.api.reorderReference).toHaveBeenCalledWith('clienteles', [IDS.children, IDS.seniors, YOUNG_ADULTS, IDS.couples]),
    )
  })

  it('at phone width a reorderable list keeps its « … » menu in view (secondary text wraps, no reorder, no « Utilisé par »)', async () => {
    await renderPage()
    const list = card()
    expect(within(list).getByRole('columnheader', { name: t(`${LIST}.columns.usage`) })).toHaveClass('max-sm:hidden')
    // The table is `whitespace-nowrap`; the list's own columns wrap.
    expect(within(list).getByRole('table')).toHaveClass('whitespace-nowrap')
    expect(within(rowOf('Aînés')).getAllByRole('cell')[0]).toHaveClass('whitespace-normal')
    for (const name of [t(`${LIST}.actions.moveUp`, { name: 'Aînés' }), t(`${LIST}.actions.moveDown`, { name: 'Aînés' })]) {
      expect(within(list).getByRole('button', { name })).toHaveClass('max-md:hidden')
    }
    const menu = within(list).getByRole('button', { name: t(`${LIST}.actions.menu`, { name: 'Aînés' }) })
    expect(menu).not.toHaveClass('max-sm:hidden')
    expect(menu).not.toHaveClass('max-md:hidden')
    // The actions cell is as narrow as its buttons.
    expect(menu.closest('td')).toHaveClass('w-0', 'pl-1', 'pr-2')
  })

  it('every row active: « Archivés » says none is (A10.5)', async () => {
    await renderPage()
    await filter(/^Archivés/)
    expect(within(card()).getByText(t(`${LIST}.empty.noArchived`))).toBeInTheDocument()
    expect(within(card()).getByText(t(`${LIST}.empty.noArchivedBody`))).toBeInTheDocument()
  })

  it('read-only for the adjointe: the notice once, the ages, no « Ajouter », no actions', async () => {
    await renderPage({ readOnly: true })
    expect(screen.getAllByText(t('common.readOnlyNotice.title'))).toHaveLength(1)
    expect(screen.queryByRole('button', { name: /^Ajouter/ })).not.toBeInTheDocument()
    expect(screen.queryByRole('button', { name: /^Actions pour/ })).not.toBeInTheDocument()
    expect(screen.queryByRole('button', { name: /^(Monter|Descendre)/ })).not.toBeInTheDocument()
    expect(cells('Enfants')).toEqual(['0 à 12 ans', '1 professionnel'])
  })
})
