import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { t } from '@/i18n'
import { usageKey } from '../../api/catalog'
import type { ProfessionalsCatalog } from '../../api/parse'
import { CATALOG } from '../../test/fixtures-domain'
import { IDS } from '../../test/fixtures'
import { renderProfessionalsSettingsPage } from '../../test/settings-page'
import { SpecialtiesSettingsPage } from './SpecialtiesSettingsPage'

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

const S = 'modules.professionals.settings.specialties'
const LIST = 'modules.professionals.settings.list'
const V = 'modules.professionals.validation'

const YOUNG_ADULTS = '00000000-0000-4000-8000-0000000000d9'
const EMDR = '00000000-0000-4000-8000-0000000000e2'
const ARCHIVED_APPROACH = '00000000-0000-4000-8000-0000000000e9'
const NEW_ID = '00000000-0000-4000-8000-0000000000ea'

const USAGE = new Map([
  [usageKey('clienteles', IDS.couples), 2],
  [usageKey('clienteles', IDS.children), 1],
  [usageKey('specialties', IDS.cbt), 3],
])

/** The fixture plus a clinic's own clientèle (18–25, not system), a second approach and an archived one. */
function catalog(): ProfessionalsCatalog {
  const [clientele] = CATALOG.clienteles
  const [approach] = CATALOG.specialties
  if (!clientele || !approach) throw new Error('fixture')
  return {
    ...CATALOG,
    clienteles: [
      ...CATALOG.clienteles,
      { ...clientele, id: YOUNG_ADULTS, key: 'jeunes_adultes', name: 'Jeunes adultes', minAge: 18, maxAge: 25, isSystem: false, sortOrder: 80 },
    ],
    specialties: [
      ...CATALOG.specialties,
      { ...approach, id: EMDR, key: 'emdr', name: 'EMDR', sortOrder: 20 },
      { ...approach, id: ARCHIVED_APPROACH, key: 'ancienne', name: 'Ancienne approche', sortOrder: 30, isActive: false },
    ],
  }
}

beforeEach(() => {
  mocks.api.fetchProfessionalsCatalog.mockResolvedValue(catalog())
  mocks.api.fetchReferenceUsage.mockResolvedValue(USAGE)
})
afterEach(() => vi.clearAllMocks())

type List = 'clienteles' | 'approaches'

async function renderPage({ readOnly = false } = {}) {
  renderProfessionalsSettingsPage(<SpecialtiesSettingsPage />, { sectionId: 'specialties', readOnly })
  await screen.findByRole('region', { name: t(`${S}.approaches.title`) })
}

const card = (list: List) => screen.getByRole('region', { name: t(`${S}.${list}.title`) })
const dialog = () => screen.getByRole('dialog')
const rowOf = (list: List, name: string) => {
  const row = within(card(list))
    .getAllByRole('row')
    .find((r) => r.querySelector('[data-name]')?.textContent === name)
  if (!row) throw new Error(`no row ${name}`)
  return row
}
/** A row's cells after its header (the name). */
const cells = (list: List, name: string) =>
  within(rowOf(list, name))
    .getAllByRole('cell')
    .map((cell) => cell.textContent)
const textbox = (name: string) => within(dialog()).getByRole('textbox', { name: new RegExp(`^${name}`) })
const filter = (list: List, name: RegExp) => userEvent.click(within(card(list)).getByRole('button', { name }))

async function openMenu(name: string) {
  await userEvent.click(screen.getByRole('button', { name: t(`${LIST}.actions.menu`, { name }) }))
}
async function chooseAction(name: string, action: 'edit' | 'archive' | 'restore') {
  await openMenu(name)
  await userEvent.click(await screen.findByRole('menuitem', { name: t(`${LIST}.actions.${action}`) }))
}
const add = (list: List) => userEvent.click(within(card(list)).getByRole('button', { name: t(`${S}.${list}.add`) }))
const submit = (label: string) => userEvent.click(within(dialog()).getByRole('button', { name: label }))

describe('SpecialtiesSettingsPage', () => {
  it('stacks « Clientèles » and « Approches » under visible headings, each « Ajouter » outline', async () => {
    await renderPage()
    expect(screen.getByRole('heading', { level: 2, name: t(`${S}.title`) })).toBeInTheDocument()
    for (const list of ['clienteles', 'approaches'] as const) {
      const heading = within(card(list)).getByRole('heading', { level: 3, name: t(`${S}.${list}.title`) })
      expect(heading.parentElement).not.toHaveClass('sr-only')
      expect(within(card(list)).getByText(t(`${S}.${list}.description`))).toBeInTheDocument()
      expect(within(card(list)).getByRole('button', { name: t(`${S}.${list}.add`) })).not.toHaveClass('bg-primary')
    }
    expect(screen.getByText(t(`${S}.clienteles.description`))).toHaveTextContent(
      "Le jumelage filtre selon la clientèle : l'âge de la personne principale, ou couple, famille, groupe.",
    )
    expect(screen.getByText(t(`${S}.approaches.description`))).toHaveTextContent("Les approches orientent le jumelage sans l'exclure.")
  })

  it('shows each clientèle’s ages in words, and how many professionals it has', async () => {
    await renderPage()
    expect(within(card('clienteles')).getByRole('columnheader', { name: t(`${S}.clienteles.ages`) })).toBeInTheDocument()
    expect(cells('clienteles', 'Enfants')).toEqual(['0 à 12 ans', '1 professionnel', ''])
    expect(cells('clienteles', 'Aînés').slice(0, 1)).toEqual(['65 ans et plus'])
    // P4-52: « Sans âge », not « Sans limite d'âge » (which reads like « Tous les âges »); muted like the lists' « — ».
    expect(cells('clienteles', 'Couples').slice(0, 2)).toEqual(['Sans âge', '2 professionnels'])
    expect(within(rowOf('clienteles', 'Couples')).getByText('Sans âge')).toHaveClass('text-subtle')
    expect(within(rowOf('clienteles', 'Enfants')).getByText('0 à 12 ans')).not.toHaveClass('text-subtle')
    expect(cells('clienteles', 'Jeunes adultes').slice(0, 1)).toEqual(['18 à 25 ans'])
    expect(cells('approaches', 'Thérapie cognitivo-comportementale (TCC)')).toEqual(['3 professionnels', ''])
  })

  it('locks the system clientèles: a note, and no « Archiver »', async () => {
    await renderPage()
    expect(within(rowOf('clienteles', 'Couples')).getByRole('img', { name: t(`${S}.clienteles.system`) })).toBeInTheDocument()
    expect(within(rowOf('clienteles', 'Jeunes adultes')).queryByRole('img')).not.toBeInTheDocument()
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
    await add('clienteles')
    expect(screen.getByRole('dialog', { name: t(`${S}.clienteles.createTitle`) })).toBeInTheDocument()
    expect(textbox('Nom')).toHaveFocus()
    expect(textbox(t(`${S}.clienteles.minAge`))).toHaveAccessibleDescription(t(`${S}.clienteles.minAgeHelp`))
    expect(textbox(t(`${S}.clienteles.maxAge`))).toHaveAccessibleDescription(t(`${S}.clienteles.maxAgeHelp`))
    expect(textbox(t(`${S}.clienteles.minAge`))).toHaveAttribute('inputmode', 'numeric')
    await userEvent.type(textbox('Nom'), 'Préadolescents')
    await userEvent.type(textbox(t(`${S}.clienteles.minAge`)), '10')
    await userEvent.type(textbox(t(`${S}.clienteles.maxAge`)), '12')
    await submit(t(`${LIST}.dialog.create`))
    await waitFor(() => expect(screen.queryByRole('dialog')).not.toBeInTheDocument())
    expect(mocks.api.saveReference).toHaveBeenCalledWith('clienteles', { id: null, name: 'Préadolescents', minAge: 10, maxAge: 12 })
  })

  it('adds a clientèle without ages: both bounds sent as null', async () => {
    await renderPage()
    mocks.api.saveReference.mockResolvedValue(NEW_ID)
    await add('clienteles')
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
    await add('clienteles')
    await userEvent.type(textbox('Nom'), 'Essai')
    if (min) await userEvent.type(textbox(t(`${S}.clienteles.minAge`)), min)
    if (max) await userEvent.type(textbox(t(`${S}.clienteles.maxAge`)), max)
    await submit(t(`${LIST}.dialog.create`))
    const input = textbox(t(`${S}.clienteles.${field}`))
    await waitFor(() => expect(input).toHaveAccessibleDescription(expect.stringContaining(t(message))))
    expect(input).toHaveAttribute('aria-invalid', 'true')
    expect(mocks.api.saveReference).not.toHaveBeenCalled()
  })

  it('a system age group keeps a minimum age (as the database requires)', async () => {
    await renderPage()
    await chooseAction('Enfants', 'edit')
    expect(screen.getByRole('dialog', { name: t(`${S}.clienteles.editTitle`) })).toBeInTheDocument()
    const min = textbox(t(`${S}.clienteles.minAge`))
    expect(min).toHaveValue('0')
    expect(min).toHaveAccessibleDescription(t(`${S}.clienteles.systemAgeGroup`))
    expect(textbox(t(`${S}.clienteles.maxAge`))).toHaveValue('12')
    await userEvent.clear(min)
    await userEvent.clear(textbox(t(`${S}.clienteles.maxAge`)))
    await submit(t('common.save'))
    await waitFor(() => expect(min).toHaveAccessibleDescription(expect.stringContaining(t(`${V}.clienteleKind`))))
    expect(mocks.api.saveReference).not.toHaveBeenCalled()
  })

  it('a system age group’s bounds can change: Enfants 0–12 → 0–11 is saved', async () => {
    await renderPage()
    mocks.api.saveReference.mockResolvedValue(IDS.children)
    await chooseAction('Enfants', 'edit')
    const max = textbox(t(`${S}.clienteles.maxAge`))
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
    const min = textbox(t(`${S}.clienteles.minAge`))
    expect(min).toHaveAttribute('readonly')
    expect(min).toHaveAccessibleDescription(t(`${S}.clienteles.systemNoAges`))
    expect(textbox(t(`${S}.clienteles.maxAge`))).toHaveAttribute('readonly')
    // One help line under both locked fields, read with each.
    expect(textbox(t(`${S}.clienteles.maxAge`))).toHaveAccessibleDescription(t(`${S}.clienteles.systemNoAges`))
    expect(within(dialog()).getAllByText(t(`${S}.clienteles.systemNoAges`))).toHaveLength(1)
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
    await userEvent.clear(textbox(t(`${S}.clienteles.maxAge`)))
    await userEvent.type(textbox(t(`${S}.clienteles.maxAge`)), '29')
    await submit(t('common.save'))
    expect(await within(dialog()).findByRole('alert')).toHaveTextContent('Une clientèle porte déjà ce nom')
    expect(mocks.api.saveReference).toHaveBeenCalledWith('clienteles', { id: YOUNG_ADULTS, name: 'Jeunes adultes', minAge: 18, maxAge: 29 })
  })

  it('adds an approach (name only)', async () => {
    await renderPage()
    mocks.api.saveReference.mockResolvedValue(NEW_ID)
    await add('approaches')
    expect(screen.getByRole('dialog', { name: t(`${S}.approaches.createTitle`) })).toBeInTheDocument()
    expect(within(dialog()).getAllByRole('textbox')).toHaveLength(1)
    await userEvent.type(textbox('Nom'), 'Thérapie narrative')
    await submit(t(`${LIST}.dialog.create`))
    await waitFor(() => expect(mocks.api.saveReference).toHaveBeenCalledWith('specialties', { id: null, name: 'Thérapie narrative' }))
  })

  it('archives an approach after saying how many professionals keep it', async () => {
    await renderPage()
    mocks.api.setReferenceActive.mockResolvedValue(undefined)
    await chooseAction('Thérapie cognitivo-comportementale (TCC)', 'archive')
    const confirm = await screen.findByRole('alertdialog')
    expect(within(confirm).getByText(t(`${LIST}.archive.bodyOther`, { count: '3' }))).toBeInTheDocument()
    await userEvent.click(within(confirm).getByRole('button', { name: t(`${LIST}.archive.confirm`) }))
    await waitFor(() => expect(mocks.api.setReferenceActive).toHaveBeenCalledWith('specialties', IDS.cbt, false))
  })

  it('restores an archived approach', async () => {
    await renderPage()
    mocks.api.setReferenceActive.mockResolvedValue(undefined)
    await filter('approaches', /^Archivés/)
    await chooseAction('Ancienne approche', 'restore')
    const confirm = await screen.findByRole('alertdialog')
    await userEvent.click(within(confirm).getByRole('button', { name: t(`${LIST}.restore.confirm`) }))
    await waitFor(() => expect(mocks.api.setReferenceActive).toHaveBeenCalledWith('specialties', ARCHIVED_APPROACH, true))
  })

  it('reorders approaches and clientèles, sending each whole list (archived included)', async () => {
    await renderPage()
    mocks.api.reorderReference.mockResolvedValue(undefined)
    await userEvent.click(within(card('approaches')).getByRole('button', { name: t(`${LIST}.actions.moveDown`, { name: 'EMDR' }) }))
    // EMDR is the last active approach: it can still pass the archived one under « Tous » only.
    expect(mocks.api.reorderReference).not.toHaveBeenCalled()
    await userEvent.click(within(card('approaches')).getByRole('button', { name: t(`${LIST}.actions.moveUp`, { name: 'EMDR' }) }))
    await waitFor(() => expect(mocks.api.reorderReference).toHaveBeenCalledWith('specialties', [EMDR, IDS.cbt, ARCHIVED_APPROACH]))
    await userEvent.click(within(card('clienteles')).getByRole('button', { name: t(`${LIST}.actions.moveUp`, { name: 'Jeunes adultes' }) }))
    await waitFor(() =>
      expect(mocks.api.reorderReference).toHaveBeenCalledWith('clienteles', [IDS.children, IDS.seniors, YOUNG_ADULTS, IDS.couples]),
    )
  })

  it('at phone width a reorderable list keeps its « … » menu in view (secondary text wraps, no reorder, no « Utilisé par »)', async () => {
    await renderPage()
    const list = card('clienteles')
    expect(within(list).getByRole('columnheader', { name: t(`${LIST}.columns.usage`) })).toHaveClass('max-sm:hidden')
    // The table is `whitespace-nowrap`; the list's own columns wrap.
    expect(within(list).getByRole('table')).toHaveClass('whitespace-nowrap')
    expect(within(rowOf('clienteles', 'Aînés')).getAllByRole('cell')[0]).toHaveClass('whitespace-normal')
    for (const name of [t(`${LIST}.actions.moveUp`, { name: 'Aînés' }), t(`${LIST}.actions.moveDown`, { name: 'Aînés' })]) {
      expect(within(list).getByRole('button', { name })).toHaveClass('max-sm:hidden')
    }
    const menu = within(list).getByRole('button', { name: t(`${LIST}.actions.menu`, { name: 'Aînés' }) })
    expect(menu).not.toHaveClass('max-sm:hidden')
    // The actions cell is as narrow as its buttons.
    expect(menu.closest('td')).toHaveClass('w-0', 'pl-1', 'pr-2')
  })

  it('an empty list: « Archivés » and « Tous » show the empty state, nothing breaks (A10.5)', async () => {
    mocks.api.fetchProfessionalsCatalog.mockResolvedValue({ ...catalog(), specialties: [] })
    await renderPage()
    expect(within(card('approaches')).queryByRole('table')).not.toBeInTheDocument()
    expect(within(card('approaches')).getByText(t(`${LIST}.empty.title`))).toBeInTheDocument()
    await filter('approaches', /^Archivés/)
    expect(within(card('approaches')).getByText(t(`${LIST}.empty.title`))).toBeInTheDocument()
    await filter('approaches', /^Tous/)
    expect(within(card('approaches')).getByText(t(`${LIST}.empty.title`))).toBeInTheDocument()
    // The other card is untouched.
    expect(within(card('clienteles')).getByRole('table')).toBeInTheDocument()
  })

  it('every row archived: « Actifs » says where they are, « Archivés » lists them (A10.5)', async () => {
    const all = catalog()
    mocks.api.fetchProfessionalsCatalog.mockResolvedValue({ ...all, specialties: all.specialties.map((row) => ({ ...row, isActive: false })) })
    await renderPage()
    expect(within(card('approaches')).getByText(t(`${LIST}.empty.noActive`))).toBeInTheDocument()
    expect(within(card('approaches')).getByText(t(`${LIST}.empty.noActiveBody`))).toBeInTheDocument()
    await filter('approaches', /^Archivés/)
    expect(within(card('approaches')).getAllByText(t(`${LIST}.archived`))).toHaveLength(3)
    expect(rowOf('approaches', 'EMDR')).toBeInTheDocument()
  })

  it('every row active: « Archivés » says none is (A10.5)', async () => {
    await renderPage()
    await filter('clienteles', /^Archivés/)
    expect(within(card('clienteles')).getByText(t(`${LIST}.empty.noArchived`))).toBeInTheDocument()
    expect(within(card('clienteles')).getByText(t(`${LIST}.empty.noArchivedBody`))).toBeInTheDocument()
  })

  it('read-only for the adjointe: the notice once, the ages, no « Ajouter », no actions', async () => {
    await renderPage({ readOnly: true })
    expect(screen.getAllByText(t('common.readOnlyNotice.title'))).toHaveLength(1)
    expect(screen.queryByRole('button', { name: /^Ajouter/ })).not.toBeInTheDocument()
    expect(screen.queryByRole('button', { name: /^Actions pour/ })).not.toBeInTheDocument()
    expect(screen.queryByRole('button', { name: /^(Monter|Descendre)/ })).not.toBeInTheDocument()
    expect(cells('clienteles', 'Enfants')).toEqual(['0 à 12 ans', '1 professionnel'])
  })
})
