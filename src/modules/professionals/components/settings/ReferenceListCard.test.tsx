import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { render, screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { QueryClientProvider } from '@tanstack/react-query'
import { t } from '@/i18n'
import { professionalCatalogKeys } from '../../hooks/keys'
import { useProfessionalsCatalog } from '../../hooks/use-catalog'
import { usageKey } from '../../api/catalog'
import type { DeactivationReason, ProfessionalsCatalog } from '../../api/parse'
import { CATALOG } from '../../test/fixtures-domain'
import { IDS } from '../../test/fixtures'
import { setupQueryClient } from '../../test/query-client'
import { ReferenceListCard, type ReferenceListCardProps } from './ReferenceListCard'

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

const RETIRED = '00000000-0000-4000-8000-000000000399'
const retired: DeactivationReason = {
  id: RETIRED,
  key: 'retired',
  name: 'Retraite',
  isSystem: false,
  sortOrder: 50,
  isActive: false,
  requiresNote: false,
  disablesAccount: true,
}
/** Congé (3 users), Fin de collaboration (1), Autre (system), then Retraite (archived). */
const catalog: ProfessionalsCatalog = { ...CATALOG, deactivationReasons: [...CATALOG.deactivationReasons, retired] }
const ORDER = [IDS.leave, IDS.ended, IDS.other, RETIRED]
const USAGE: ReadonlyMap<string, number> = new Map([
  [usageKey('deactivation_reasons', IDS.leave), 3],
  [usageKey('deactivation_reasons', IDS.ended), 1],
])
const TITLE = 'Raisons de désactivation'

/** What a refetch after a change returns (the database's state). */
let serverCatalog: ProfessionalsCatalog = catalog
afterEach(() => vi.clearAllMocks())
beforeEach(() => {
  serverCatalog = catalog
  mocks.api.fetchProfessionalsCatalog.mockImplementation(async () => serverCatalog)
})

type CardProps = Partial<Omit<ReferenceListCardProps<'deactivation_reasons'>, 'kind' | 'rows'>>

/** The card as a page uses it: rows from the cached catalogue. */
function Harness(props: CardProps) {
  const { data } = useProfessionalsCatalog()
  if (!data) return null
  return (
    <ReferenceListCard
      kind="deactivation_reasons"
      title={TITLE}
      rows={data.deactivationReasons}
      usage={USAGE}
      canEdit
      reorderable
      columns={[{ id: 'note', header: 'Note requise', cell: (row) => (row.requiresNote ? 'Oui' : 'Non') }]}
      {...props}
    />
  )
}

function renderCard({ rows = catalog, ...props }: CardProps & { rows?: ProfessionalsCatalog } = {}) {
  const client = setupQueryClient()
  client.queryClient.setQueryData(professionalCatalogKeys.catalog(), rows)
  render(
    <QueryClientProvider client={client.queryClient}>
      <Harness {...props} />
    </QueryClientProvider>,
  )
  return client
}

const card = () => screen.getByRole('region', { name: TITLE })
const filter = (name: 'active' | 'archived' | 'all', count: number) =>
  within(card()).getByRole('button', {
    name: t('common.listFilter.option', { label: t(`common.listFilter.${name}`), count: String(count) }),
  })
/** The names in the table, in order (each row's header). */
const names = () =>
  within(card())
    .getAllByRole('row')
    .flatMap((row) => {
      const name = row.querySelector('th[scope="row"] [data-name]')?.textContent
      return name === undefined || name === null ? [] : [name]
    })
const rowOf = (name: string) => {
  const row = within(card())
    .getAllByRole('row')
    .find((r) => r.querySelector('[data-name]')?.textContent === name)
  if (!row) throw new Error(`no row ${name}`)
  return row
}
const menuButton = (name: string) => screen.getByRole('button', { name: t('modules.professionals.settings.list.actions.menu', { name }) })
async function chooseAction(name: string, action: 'edit' | 'archive' | 'restore') {
  await userEvent.click(menuButton(name))
  await userEvent.click(await screen.findByRole('menuitem', { name: t(`modules.professionals.settings.list.actions.${action}`) }))
}
const addButton = () => screen.getByRole('button', { name: t('modules.professionals.settings.list.add') })
const nameField = () => within(screen.getByRole('dialog')).getByRole('textbox', { name: new RegExp(`^${t('modules.professionals.settings.list.dialog.name')}`) })

describe('ReferenceListCard: filters and search', () => {
  it('counts active, archived and all rows, and shows the active ones first', () => {
    renderCard()
    expect(filter('active', 3)).toHaveAttribute('aria-pressed', 'true')
    expect(filter('archived', 1)).toHaveAttribute('aria-pressed', 'false')
    expect(filter('all', 4)).toHaveAttribute('aria-pressed', 'false')
    expect(names()).toEqual(['Congé', 'Fin de collaboration', 'Autre'])
  })

  it('shows the archived rows muted with « Archivé », and every row under « Tous »', async () => {
    renderCard()
    await userEvent.click(filter('archived', 1))
    expect(names()).toEqual(['Retraite'])
    expect(within(rowOf('Retraite')).getByText(t('modules.professionals.settings.list.archived'))).toBeInTheDocument()
    await userEvent.click(filter('all', 4))
    expect(names()).toEqual(['Congé', 'Fin de collaboration', 'Autre', 'Retraite'])
  })

  it('moves between filters with the arrow keys and selects only with Enter or Space', async () => {
    renderCard()
    await userEvent.click(filter('active', 3))
    // One tab stop: the selected filter.
    expect(filter('archived', 1)).toHaveAttribute('tabindex', '-1')
    await userEvent.keyboard('{ArrowRight}')
    expect(filter('archived', 1)).toHaveFocus()
    expect(filter('archived', 1)).toHaveAttribute('aria-pressed', 'false')
    expect(names()).toEqual(['Congé', 'Fin de collaboration', 'Autre'])
    await userEvent.keyboard('{Enter}')
    expect(filter('archived', 1)).toHaveAttribute('aria-pressed', 'true')
    expect(names()).toEqual(['Retraite'])
    await userEvent.keyboard('{ArrowRight}{ }')
    expect(filter('all', 4)).toHaveAttribute('aria-pressed', 'true')
    // Wraps around.
    await userEvent.keyboard('{ArrowRight}')
    expect(filter('active', 3)).toHaveFocus()
  })

  it('searches without accents and highlights the match', async () => {
    renderCard()
    const search = within(card()).getByRole('searchbox', { name: t('modules.professionals.settings.list.search.label', { list: TITLE }) })
    await userEvent.type(search, 'conge')
    expect(names()).toEqual(['Congé'])
    const mark = rowOf('Congé').querySelector('mark')
    expect(mark?.textContent).toBe('Congé')
    await userEvent.clear(search)
    await userEvent.type(search, 'collab')
    expect(rowOf('Fin de collaboration').querySelector('mark')?.textContent).toBe('collab')
  })

  it('says when nothing matches the search', async () => {
    renderCard()
    await userEvent.type(within(card()).getByRole('searchbox'), 'xyz')
    expect(within(card()).queryByRole('table')).not.toBeInTheDocument()
    expect(within(card()).getByText(t('modules.professionals.settings.list.empty.noMatchTitle'))).toBeInTheDocument()
    expect(within(card()).getByText(t('modules.professionals.settings.list.empty.noMatchBody'))).toBeInTheDocument()
  })

  it('has an empty state for an empty list and for a filter with no row', async () => {
    renderCard({ rows: { ...catalog, deactivationReasons: [] } })
    expect(within(card()).getByText(t('modules.professionals.settings.list.empty.title'))).toBeInTheDocument()
    expect(within(card()).getByText(t('modules.professionals.settings.list.empty.body'))).toBeInTheDocument()
    await userEvent.click(filter('archived', 0))
    expect(within(card()).getByText(t('modules.professionals.settings.list.empty.title'))).toBeInTheDocument()
  })

  it('says « Aucun élément archivé » when every row is active, with a second line', async () => {
    renderCard({ rows: CATALOG })
    await userEvent.click(filter('archived', 0))
    expect(within(card()).getByText(t('modules.professionals.settings.list.empty.noArchived'))).toBeInTheDocument()
    expect(within(card()).getByText(t('modules.professionals.settings.list.empty.noArchivedBody'))).toBeInTheDocument()
  })

  it('says « Aucun élément actif » when every row is archived, and where they are', () => {
    renderCard({ rows: { ...catalog, deactivationReasons: [retired] } })
    expect(within(card()).getByText(t('modules.professionals.settings.list.empty.noActive'))).toBeInTheDocument()
    expect(within(card()).getByText(t('modules.professionals.settings.list.empty.noActiveBody'))).toBeInTheDocument()
  })

  it('read-only: an empty list says so without asking to add', () => {
    renderCard({ canEdit: false, rows: { ...catalog, deactivationReasons: [] } })
    expect(within(card()).getByText(t('modules.professionals.settings.list.empty.bodyReadOnly'))).toBeInTheDocument()
    expect(within(card()).queryByText(t('modules.professionals.settings.list.empty.body'))).not.toBeInTheDocument()
  })
})

describe('ReferenceListCard: slots', () => {
  it('shows the list’s toolbar in the header, after the search', () => {
    renderCard({ toolbar: <button type="button">Par catégorie</button> })
    const toolbar = within(card()).getByRole('button', { name: 'Par catégorie' })
    const search = within(card()).getByRole('searchbox')
    expect(search.compareDocumentPosition(toolbar) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy()
  })

  it('filterRow narrows the rows first: the counts are those of the rows it keeps, and reorder is hidden', async () => {
    // Keeps the reasons that close the account: Fin de collaboration (active), Retraite (archived).
    renderCard({ filterRow: (row) => row.disablesAccount })
    expect(filter('active', 1)).toHaveAttribute('aria-pressed', 'true')
    expect(filter('archived', 1)).toBeInTheDocument()
    expect(filter('all', 2)).toBeInTheDocument()
    expect(names()).toEqual(['Fin de collaboration'])
    expect(within(card()).queryByRole('button', { name: /^(Monter|Descendre)/ })).not.toBeInTheDocument()
    await userEvent.click(filter('all', 2))
    expect(names()).toEqual(['Fin de collaboration', 'Retraite'])
  })

  it('filterRow that keeps nothing: « Aucun résultat » and a hint about the filters', () => {
    renderCard({ filterRow: () => false })
    expect(filter('all', 0)).toBeInTheDocument()
    expect(within(card()).getByText(t('modules.professionals.settings.list.empty.noMatchTitle'))).toBeInTheDocument()
    expect(within(card()).getByText(t('modules.professionals.settings.list.empty.noMatchFilteredBody'))).toBeInTheDocument()
  })

  it('groupBy shows group header rows in order, « Autres » last, in one table', async () => {
    renderCard({
      groupBy: (row) =>
        row.isSystem
          ? { id: 'none', label: 'Autres', order: Infinity }
          : row.disablesAccount
            ? { id: 'closes', label: 'Ferme le compte', order: 1 }
            : { id: 'keeps', label: 'Garde le compte', order: 2 },
    })
    await userEvent.click(filter('all', 4))
    expect(within(card()).getAllByRole('table')).toHaveLength(1)
    const groupHeaders = within(card())
      .getAllByRole('rowheader')
      .filter((cell) => cell.getAttribute('scope') === 'rowgroup')
      .map((cell) => cell.textContent)
    expect(groupHeaders).toEqual(['Ferme le compte', 'Garde le compte', 'Autres'])
    expect(names()).toEqual(['Fin de collaboration', 'Retraite', 'Congé', 'Autre'])
    // Each group is a row group (<tbody>) that starts with its header.
    const closes = within(card()).getByRole('rowheader', { name: 'Ferme le compte' }).closest('tbody')
    expect(closes).toHaveTextContent('Fin de collaboration')
    expect(closes).toHaveTextContent('Retraite')
    expect(closes).not.toHaveTextContent('Congé')
  })

  it('groupBy with reorder: a row moves within its group only', async () => {
    renderCard({ groupBy: (row) => (row.isSystem ? { id: 'none', label: 'Autres', order: Infinity } : { id: 'all', label: 'Raisons', order: 1 }) })
    mocks.api.reorderReference.mockResolvedValue(undefined)
    // « Fin de collaboration » is the last of its group: « Autre » is in another one.
    expect(screen.getByRole('button', { name: t('modules.professionals.settings.list.actions.moveDown', { name: 'Fin de collaboration' }) })).toHaveAttribute(
      'aria-disabled',
      'true',
    )
    expect(screen.getByRole('button', { name: t('modules.professionals.settings.list.actions.moveUp', { name: 'Autre' }) })).toHaveAttribute('aria-disabled', 'true')
    await userEvent.click(screen.getByRole('button', { name: t('modules.professionals.settings.list.actions.moveUp', { name: 'Fin de collaboration' }) }))
    expect(mocks.api.reorderReference).toHaveBeenCalledWith('deactivation_reasons', [IDS.ended, IDS.leave, IDS.other, RETIRED])
    expect(screen.getByText(t('modules.professionals.settings.list.actions.moved', { name: 'Fin de collaboration', position: '1', count: '2' }))).toBeInTheDocument()
  })

  it('createDefaults seeds « Ajouter » (not « Modifier »)', async () => {
    renderCard({ createDefaults: { requiresNote: true } })
    mocks.api.saveReference.mockResolvedValue('00000000-0000-4000-8000-000000000398')
    await userEvent.click(addButton())
    await userEvent.type(nameField(), 'Retraite anticipée')
    await userEvent.click(within(screen.getByRole('dialog')).getByRole('button', { name: t('modules.professionals.settings.list.dialog.create') }))
    await waitFor(() =>
      expect(mocks.api.saveReference).toHaveBeenCalledWith('deactivation_reasons', {
        id: null,
        name: 'Retraite anticipée',
        requiresNote: true,
        disablesAccount: false,
      }),
    )
    await waitFor(() => expect(screen.queryByRole('dialog')).not.toBeInTheDocument())
    mocks.api.saveReference.mockResolvedValue(IDS.leave)
    await chooseAction('Congé', 'edit')
    await userEvent.type(nameField(), ' prolongé')
    await userEvent.click(within(screen.getByRole('dialog')).getByRole('button', { name: t('common.save') }))
    await waitFor(() => expect(mocks.api.saveReference).toHaveBeenLastCalledWith('deactivation_reasons', expect.objectContaining({ id: IDS.leave, requiresNote: false })))
  })
})

describe('ReferenceListCard: rows', () => {
  it('names the table by the list, and each row by its name (a row header)', () => {
    renderCard()
    const table = within(card()).getByRole('table', { name: TITLE })
    expect(within(table).getByRole('rowheader', { name: 'Congé' })).toHaveAttribute('scope', 'row')
    // The table fits (jsdom has no layout): its scroll wrapper adds no tab stop.
    expect(table.parentElement).not.toHaveAttribute('tabindex')
  })

  it('shows the usage counts, « — » when nobody uses a row', () => {
    renderCard()
    expect(within(rowOf('Congé')).getByText('3 professionnels')).toBeInTheDocument()
    expect(within(rowOf('Fin de collaboration')).getByText('1 professionnel')).toBeInTheDocument()
    expect(within(rowOf('Autre')).getByText('—')).toBeInTheDocument()
    expect(within(rowOf('Congé')).getByText('Non')).toBeInTheDocument()
  })

  it('locks a system row: a note, and no « Archiver » in its menu', async () => {
    renderCard()
    expect(within(rowOf('Autre')).getByRole('img', { name: t('modules.professionals.settings.list.system') })).toBeInTheDocument()
    await userEvent.click(menuButton('Autre'))
    expect(await screen.findByRole('menuitem', { name: t('modules.professionals.settings.list.actions.edit') })).toBeInTheDocument()
    expect(screen.queryByRole('menuitem', { name: t('modules.professionals.settings.list.actions.archive') })).not.toBeInTheDocument()
  })

  it('read-only: no « Ajouter », no menus, no reorder buttons', () => {
    renderCard({ canEdit: false })
    expect(screen.queryByRole('button', { name: t('modules.professionals.settings.list.add') })).not.toBeInTheDocument()
    expect(screen.queryByRole('button', { name: /^Actions pour/ })).not.toBeInTheDocument()
    expect(screen.queryByRole('button', { name: /^(Monter|Descendre)/ })).not.toBeInTheDocument()
    expect(within(card()).queryByRole('columnheader', { name: t('modules.professionals.settings.list.columns.actions') })).not.toBeInTheDocument()
    // The rows and the filters are still there.
    expect(names()).toEqual(['Congé', 'Fin de collaboration', 'Autre'])
  })
})

describe('ReferenceListCard: archive and restore', () => {
  it('confirms with the usage count, then archives', async () => {
    renderCard()
    mocks.api.setReferenceActive.mockResolvedValue(undefined)
    await chooseAction('Congé', 'archive')
    const dialog = await screen.findByRole('alertdialog')
    expect(dialog).toHaveTextContent(t('modules.professionals.settings.list.archive.bodyOther', { count: '3' }))
    await userEvent.click(within(dialog).getByRole('button', { name: t('modules.professionals.settings.list.archive.confirm') }))
    await waitFor(() => expect(screen.queryByRole('alertdialog')).not.toBeInTheDocument())
    expect(mocks.api.setReferenceActive).toHaveBeenCalledWith('deactivation_reasons', IDS.leave, false)
    expect(mocks.toast.success).toHaveBeenCalledWith(t('modules.professionals.toasts.archived'))
  })

  it('says one professional uses a row before archiving it', async () => {
    renderCard()
    await chooseAction('Fin de collaboration', 'archive')
    expect(await screen.findByRole('alertdialog')).toHaveTextContent(t('modules.professionals.settings.list.archive.bodyOne'))
  })

  it('says nobody uses a row before archiving it', async () => {
    renderCard({ usage: new Map() })
    await chooseAction('Congé', 'archive')
    expect(await screen.findByRole('alertdialog')).toHaveTextContent(t('modules.professionals.settings.list.archive.bodyNone'))
  })

  it('shows a refusal in the confirmation and keeps it open', async () => {
    renderCard()
    mocks.api.setReferenceActive.mockRejectedValue({ code: 'P0001', message: 'Cette raison ne peut pas être archivée.' })
    await chooseAction('Congé', 'archive')
    const dialog = await screen.findByRole('alertdialog')
    await userEvent.click(within(dialog).getByRole('button', { name: t('modules.professionals.settings.list.archive.confirm') }))
    expect(await within(dialog).findByRole('alert')).toHaveTextContent('Cette raison ne peut pas être archivée.')
    expect(mocks.toast.error).not.toHaveBeenCalled()
    // Cancel returns focus to the row's menu.
    await userEvent.click(within(dialog).getByRole('button', { name: t('common.cancel') }))
    await waitFor(() => expect(menuButton('Congé')).toHaveFocus())
  })

  it('restores an archived row after confirmation', async () => {
    renderCard()
    mocks.api.setReferenceActive.mockResolvedValue(undefined)
    await userEvent.click(filter('archived', 1))
    await chooseAction('Retraite', 'restore')
    const dialog = await screen.findByRole('alertdialog')
    expect(dialog).toHaveTextContent(t('modules.professionals.settings.list.restore.body'))
    await userEvent.click(within(dialog).getByRole('button', { name: t('modules.professionals.settings.list.restore.confirm') }))
    await waitFor(() => expect(mocks.api.setReferenceActive).toHaveBeenCalledWith('deactivation_reasons', RETIRED, true))
  })
})

describe('ReferenceListCard: reorder', () => {
  const moveDown = (name: string) => screen.getByRole('button', { name: t('modules.professionals.settings.list.actions.moveDown', { name }) })
  const moveUp = (name: string) => screen.getByRole('button', { name: t('modules.professionals.settings.list.actions.moveUp', { name }) })

  it('sends the whole list in its new order, archived rows included, and keeps focus on the button', async () => {
    const { queryClient } = renderCard()
    mocks.api.reorderReference.mockResolvedValue(undefined)
    const order = [IDS.ended, IDS.leave, IDS.other, RETIRED]
    serverCatalog = { ...catalog, deactivationReasons: order.map((id) => catalog.deactivationReasons.find((r) => r.id === id)!) }
    await userEvent.click(moveDown('Congé'))
    expect(mocks.api.reorderReference).toHaveBeenCalledWith('deactivation_reasons', [IDS.ended, IDS.leave, IDS.other, RETIRED])
    // Optimistic: the table shows the new order at once.
    expect(names()).toEqual(['Fin de collaboration', 'Congé', 'Autre'])
    await waitFor(() => expect(moveDown('Congé')).toHaveFocus())
    const cached = queryClient.getQueryData<ProfessionalsCatalog>(professionalCatalogKeys.catalog())
    expect(cached?.deactivationReasons.map((r) => r.id)).toEqual([IDS.ended, IDS.leave, IDS.other, RETIRED])
  })

  it('announces the new position politely', async () => {
    renderCard()
    mocks.api.reorderReference.mockResolvedValue(undefined)
    await userEvent.click(moveDown('Congé'))
    const announcement = screen.getByText(t('modules.professionals.settings.list.actions.moved', { name: 'Congé', position: '2', count: '3' }))
    expect(announcement).toHaveAttribute('aria-live', 'polite')
  })

  it('one move at a time: while it saves, the buttons are aria-disabled, the table busy, and a press does nothing', async () => {
    renderCard()
    let finish: () => void = () => {}
    mocks.api.reorderReference.mockReturnValue(new Promise<void>((resolve) => (finish = resolve)))
    await userEvent.click(moveDown('Congé'))
    await waitFor(() => expect(within(card()).getByRole('table')).toHaveAttribute('aria-busy', 'true'))
    expect(moveUp('Autre')).toHaveAttribute('aria-disabled', 'true')
    // Soft-disabled, so the button pressed keeps focus.
    expect(moveDown('Congé')).toHaveAttribute('aria-disabled', 'true')
    expect(moveDown('Congé')).toHaveFocus()
    await userEvent.click(moveUp('Autre'))
    expect(mocks.api.reorderReference).toHaveBeenCalledTimes(1)
    finish()
    await waitFor(() => expect(within(card()).getByRole('table')).not.toHaveAttribute('aria-busy'))
    expect(moveUp('Autre')).not.toHaveAttribute('aria-disabled')
  })

  it('shows the move buttons under « Actifs » and « Tous » only, and never during a search', async () => {
    renderCard()
    expect(moveDown('Congé')).toBeInTheDocument()
    await userEvent.click(filter('all', 4))
    expect(moveDown('Retraite')).toBeInTheDocument()
    await userEvent.click(filter('archived', 1))
    expect(within(card()).queryByRole('button', { name: /^(Monter|Descendre)/ })).not.toBeInTheDocument()
    await userEvent.click(filter('active', 3))
    await userEvent.type(within(card()).getByRole('searchbox'), 'con')
    expect(names()).toEqual(['Congé'])
    expect(within(card()).queryByRole('button', { name: /^(Monter|Descendre)/ })).not.toBeInTheDocument()
    // The row menu stays.
    expect(menuButton('Congé')).toBeInTheDocument()
  })

  it('cannot move the first row up or the last shown row down', async () => {
    renderCard()
    expect(moveUp('Congé')).toHaveAttribute('aria-disabled', 'true')
    expect(moveDown('Autre')).toHaveAttribute('aria-disabled', 'true')
    await userEvent.click(moveUp('Congé'))
    expect(mocks.api.reorderReference).not.toHaveBeenCalled()
  })

  it('rolls the order back when the save fails, with a toast', async () => {
    const { queryClient } = renderCard()
    // The refetch after the failure never lands: the order shown is the rolled-back cache.
    mocks.api.fetchProfessionalsCatalog.mockReturnValue(new Promise(() => {}))
    mocks.api.reorderReference.mockRejectedValue({ code: 'P0001', message: 'La liste a changé. Rechargez la page.' })
    await userEvent.click(moveUp('Autre'))
    await waitFor(() => expect(mocks.toast.error).toHaveBeenCalledWith('La liste a changé. Rechargez la page.'))
    expect(names()).toEqual(['Congé', 'Fin de collaboration', 'Autre'])
    expect(queryClient.getQueryData<ProfessionalsCatalog>(professionalCatalogKeys.catalog())?.deactivationReasons.map((r) => r.id)).toEqual(ORDER)
    expect(mocks.api.reorderReference).toHaveBeenCalledWith('deactivation_reasons', [IDS.leave, IDS.other, IDS.ended, RETIRED])
  })
})

describe('ReferenceListCard: add and edit', () => {
  it('opens « Ajouter » with focus on the name, the close button out of the tab order', async () => {
    renderCard()
    await userEvent.click(addButton())
    const dialog = screen.getByRole('dialog', { name: t('modules.professionals.settings.list.dialog.createTitle') })
    expect(nameField()).toHaveFocus()
    expect(within(dialog).getByRole('button', { name: t('common.close') })).toHaveAttribute('tabindex', '-1')
  })

  it('after « Ajouter », focus goes to the new row’s menu', async () => {
    renderCard()
    const NEW = '00000000-0000-4000-8000-000000000398'
    mocks.api.saveReference.mockResolvedValue(NEW)
    // The refetch after the save brings the new row.
    serverCatalog = { ...catalog, deactivationReasons: [...catalog.deactivationReasons, { ...retired, id: NEW, key: 'early', name: 'Retraite anticipée', isActive: true }] }
    await userEvent.click(addButton())
    await userEvent.type(nameField(), 'Retraite anticipée')
    await userEvent.click(within(screen.getByRole('dialog')).getByRole('button', { name: t('modules.professionals.settings.list.dialog.create') }))
    await waitFor(() => expect(screen.queryByRole('dialog')).not.toBeInTheDocument())
    await waitFor(() => expect(menuButton('Retraite anticipée')).toHaveFocus())
  })

  it('shows a refusal of the save in the dialog, which stays open', async () => {
    renderCard()
    mocks.api.saveReference.mockRejectedValue({ code: 'P0001', message: 'Cette raison existe déjà.' })
    await userEvent.click(addButton())
    await userEvent.type(nameField(), 'Retraite anticipée')
    await userEvent.click(within(screen.getByRole('dialog')).getByRole('button', { name: t('modules.professionals.settings.list.dialog.create') }))
    expect(await within(screen.getByRole('dialog')).findByRole('alert')).toHaveTextContent('Cette raison existe déjà.')
    expect(mocks.toast.error).not.toHaveBeenCalled()
  })

  it('refuses a name another row holds (archived included) before any request', async () => {
    renderCard()
    await userEvent.click(addButton())
    await userEvent.type(nameField(), 'retraite')
    await userEvent.click(within(screen.getByRole('dialog')).getByRole('button', { name: t('modules.professionals.settings.list.dialog.create') }))
    expect(await within(screen.getByRole('dialog')).findByText(t('modules.professionals.validation.nameTaken.deactivation_reasons'))).toBeInTheDocument()
    expect(mocks.api.saveReference).not.toHaveBeenCalled()
  })

  it('edits a row: its values, then the save with its id; focus back on its menu', async () => {
    renderCard()
    mocks.api.saveReference.mockResolvedValue(IDS.leave)
    await chooseAction('Congé', 'edit')
    const dialog = screen.getByRole('dialog', { name: t('modules.professionals.settings.list.dialog.editTitle') })
    expect(nameField()).toHaveValue('Congé')
    await userEvent.clear(nameField())
    await userEvent.type(nameField(), 'Congé prolongé')
    await userEvent.click(within(dialog).getByRole('button', { name: t('common.save') }))
    await waitFor(() => expect(screen.queryByRole('dialog')).not.toBeInTheDocument())
    expect(mocks.api.saveReference).toHaveBeenCalledWith('deactivation_reasons', {
      id: IDS.leave,
      name: 'Congé prolongé',
      requiresNote: false,
      disablesAccount: false,
    })
    await waitFor(() => expect(menuButton('Congé')).toHaveFocus())
  })
})
