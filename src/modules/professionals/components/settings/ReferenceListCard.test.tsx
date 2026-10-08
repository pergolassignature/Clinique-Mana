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
import { ReferenceListCard } from './ReferenceListCard'

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

/** The card as a page uses it: rows from the cached catalogue. */
function Harness({ canEdit }: { canEdit: boolean }) {
  const { data } = useProfessionalsCatalog()
  if (!data) return null
  return (
    <ReferenceListCard
      kind="deactivation_reasons"
      title={TITLE}
      rows={data.deactivationReasons}
      usage={USAGE}
      canEdit={canEdit}
      reorderable
      columns={[{ id: 'note', header: 'Note requise', cell: (row) => (row.requiresNote ? 'Oui' : 'Non') }]}
    />
  )
}

function renderCard({ canEdit = true, rows = catalog }: { canEdit?: boolean; rows?: ProfessionalsCatalog } = {}) {
  const client = setupQueryClient()
  client.queryClient.setQueryData(professionalCatalogKeys.catalog(), rows)
  render(
    <QueryClientProvider client={client.queryClient}>
      <Harness canEdit={canEdit} />
    </QueryClientProvider>,
  )
  return client
}

const card = () => screen.getByRole('region', { name: TITLE })
const filter = (name: 'active' | 'archived' | 'all', count: number) =>
  within(card()).getByRole('button', {
    name: t('modules.professionals.settings.list.filter.option', { label: t(`modules.professionals.settings.list.filter.${name}`), count: String(count) }),
  })
/** The names in the table, in order. */
const names = () =>
  within(card())
    .getAllByRole('row')
    .slice(1)
    .map((row) => within(row).getAllByRole('cell')[0]?.querySelector('[data-name]')?.textContent)
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

  it('says « Aucun élément archivé » when every row is active', async () => {
    renderCard({ rows: CATALOG })
    await userEvent.click(filter('archived', 0))
    expect(within(card()).getByText(t('modules.professionals.settings.list.empty.noArchived'))).toBeInTheDocument()
  })
})

describe('ReferenceListCard: rows', () => {
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
    expect(dialog).toHaveTextContent(t('modules.professionals.settings.list.archive.bodyOther', { count: '3', name: 'Congé' }))
    await userEvent.click(within(dialog).getByRole('button', { name: t('modules.professionals.settings.list.archive.confirm') }))
    await waitFor(() => expect(screen.queryByRole('alertdialog')).not.toBeInTheDocument())
    expect(mocks.api.setReferenceActive).toHaveBeenCalledWith('deactivation_reasons', IDS.leave, false)
    expect(mocks.toast.success).toHaveBeenCalledWith(t('modules.professionals.toasts.archived'))
  })

  it('says nobody uses a row before archiving it', async () => {
    renderCard()
    await chooseAction('Fin de collaboration', 'archive')
    expect(await screen.findByRole('alertdialog')).toHaveTextContent(
      t('modules.professionals.settings.list.archive.bodyOne', { name: 'Fin de collaboration' }),
    )
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
    expect(dialog).toHaveTextContent(t('modules.professionals.settings.list.restore.body', { name: 'Retraite' }))
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
