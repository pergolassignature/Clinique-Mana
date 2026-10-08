import { afterEach, describe, expect, it, vi } from 'vitest'
import { render, screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { t } from '@/i18n'
import { renderWithContexts, testAccess } from '@/test/contexts'
import { testCatalog } from '@/test/users-fixtures'
import { RoleMatrix } from './RoleMatrix'

const mocks = vi.hoisted(() => ({ fetchPermissionCatalog: vi.fn() }))
vi.mock('../api', () => ({ fetchPermissionCatalog: mocks.fetchPermissionCatalog }))
vi.mock('@sentry/react', () => ({ captureException: vi.fn() }))

function renderMatrix() {
  const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } })
  return render(
    renderWithContexts(
      <QueryClientProvider client={queryClient}>
        <RoleMatrix />
      </QueryClientProvider>,
      { access: { access: { ...testAccess, modules: ['professionals'] } } },
    ),
  )
}

/** What a permission's row says per role (the screen-reader word; the ✓ / — marks are hidden). */
function rowValues(description: string) {
  const row = screen.getByRole('rowheader', { name: description }).closest('tr')
  if (!row) throw new Error(`no row for ${description}`)
  return within(row)
    .getAllByRole('cell')
    .map((cell) => cell.querySelector('.sr-only')?.textContent)
}

afterEach(() => vi.clearAllMocks())

describe('RoleMatrix', () => {
  it('shows the note and the roles as columns, in a fixed order', async () => {
    mocks.fetchPermissionCatalog.mockResolvedValue(testCatalog)
    renderMatrix()
    expect(await screen.findByRole('table', { name: t('settings.users.matrix.tableLabel') })).toBeInTheDocument()
    expect(screen.getByText(t('settings.users.matrix.note'))).toBeInTheDocument()
    expect(screen.getAllByRole('columnheader').map((h) => h.textContent)).toEqual([
      t('settings.users.matrix.permission'),
      t('roles.admin'),
      t('roles.counselor'),
      t('roles.admin_assistant'),
      t('roles.provider'),
    ])
  })

  it('marks settings.view for admin and admin_assistant only', async () => {
    mocks.fetchPermissionCatalog.mockResolvedValue(testCatalog)
    renderMatrix()
    await screen.findByRole('rowheader', { name: 'Voir les paramètres' })
    const yes = t('settings.users.matrix.yes')
    const no = t('settings.users.matrix.no')
    expect(rowValues('Voir les paramètres')).toEqual([yes, no, yes, no])
    expect(rowValues('Voir les professionnels')).toEqual([yes, yes, yes, no])
  })

  it('groups the rows by module, core first, view before manage, and leaves out disabled modules', async () => {
    mocks.fetchPermissionCatalog.mockResolvedValue(testCatalog)
    renderMatrix()
    await screen.findByRole('rowheader', { name: 'Voir les paramètres' })
    const bodies = screen.getAllByRole('rowgroup').slice(1)
    const firstCells = bodies.flatMap((body) =>
      within(body)
        .getAllByRole('row')
        .map((row) => row.querySelector('th')?.textContent),
    )
    expect(bodies).toHaveLength(2)
    expect(firstCells).toEqual([
      t('settings.users.sheet.permissions.coreGroup'),
      "Consulter le journal d'audit",
      'Voir les paramètres',
      'Voir les utilisateurs',
      'Activer ou désactiver des modules',
      'Voir et modifier les coordonnées bancaires de la clinique',
      'Modifier les paramètres de la clinique',
      'Inviter et gérer les utilisateurs',
      'Professionnels',
      'Voir les professionnels',
    ])
    expect(screen.queryByText('Voir la facturation')).not.toBeInTheDocument()
  })

  it('fades the right edge while more role columns remain to scroll to', async () => {
    mocks.fetchPermissionCatalog.mockResolvedValue(testCatalog)
    renderMatrix()
    const region = await screen.findByRole('region', { name: t('settings.users.matrix.tableLabel') })
    expect(screen.queryByTestId('matrix-more')).not.toBeInTheDocument()
    // happy-dom has no layout: give the region a phone-sized box.
    Object.defineProperties(region, {
      clientWidth: { configurable: true, value: 343 },
      scrollWidth: { configurable: true, value: 500 },
      scrollLeft: { configurable: true, writable: true, value: 0 },
    })
    region.dispatchEvent(new Event('scroll'))
    expect(await screen.findByTestId('matrix-more')).toBeInTheDocument()
    region.scrollLeft = 157
    region.dispatchEvent(new Event('scroll'))
    await waitFor(() => expect(screen.queryByTestId('matrix-more')).not.toBeInTheDocument())
  })

  it('keeps the permission column in place while the roles scroll', async () => {
    mocks.fetchPermissionCatalog.mockResolvedValue(testCatalog)
    renderMatrix()
    expect(await screen.findByRole('rowheader', { name: 'Voir les paramètres' })).toHaveClass('sticky', 'left-0', 'bg-card')
    expect(screen.getByRole('columnheader', { name: t('settings.users.matrix.permission') })).toHaveClass('sticky', 'left-0', 'bg-card')
  })

  it('shows a load error with a retry', async () => {
    mocks.fetchPermissionCatalog.mockRejectedValueOnce(new Error('boom')).mockResolvedValue(testCatalog)
    renderMatrix()
    expect(await screen.findByText(t('settings.users.matrix.loadError'))).toBeInTheDocument()
    await userEvent.click(screen.getByRole('button', { name: t('common.retry') }))
    expect(await screen.findByRole('rowheader', { name: 'Voir les paramètres' })).toBeInTheDocument()
  })
})
