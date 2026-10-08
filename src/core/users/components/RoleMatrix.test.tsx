import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { render, screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { t } from '@/i18n'
import type { Access } from '@/core/access/access'
import { accessKeys } from '@/core/access/access-context'
import { renderWithContexts, testAccess } from '@/test/contexts'
import { accessForRole } from '@/test/role-fixtures'
import { customRole, testCatalog, testRoleDefaults, testRoles } from '@/test/users-fixtures'
import { RoleMatrix } from './RoleMatrix'

const mocks = vi.hoisted(() => ({
  fetchPermissionCatalog: vi.fn(),
  fetchOrgRoles: vi.fn(),
  fetchRoleDefaults: vi.fn(),
  setRolePermission: vi.fn(),
  createRole: vi.fn(),
  renameRole: vi.fn(),
  deleteRole: vi.fn(),
  toast: { success: vi.fn(), error: vi.fn() },
}))
vi.mock('../api', () => ({
  fetchPermissionCatalog: mocks.fetchPermissionCatalog,
  fetchOrgRoles: mocks.fetchOrgRoles,
  fetchRoleDefaults: mocks.fetchRoleDefaults,
  setRolePermission: mocks.setRolePermission,
  createRole: mocks.createRole,
  renameRole: mocks.renameRole,
  deleteRole: mocks.deleteRole,
}))
vi.mock('@/shared/ui/sonner', () => ({ toast: mocks.toast }))
vi.mock('@sentry/react', () => ({ captureException: vi.fn() }))

/** Read-only: the test access (adjointe, settings.view only). */
const viewer: Access = { ...testAccess, modules: ['professionals'] }
const adminCaller = accessForRole('admin', { modules: ['professionals'] })
/** A non-admin manager: the adjointe given roles.manage, and users.view (not a default of her role). */
const managerCaller = accessForRole('admin_assistant', {
  modules: ['professionals'],
  permissions: ['settings.view', 'professionals.view', 'users.view', 'roles.manage'],
})

const P = { settings: 'Voir les paramètres', professionals: 'Voir les professionnels', audit: "Consulter le journal d'audit", usersView: 'Voir les utilisateurs' }
const roleName = { admin: t('roles.admin'), counselor: t('roles.counselor'), assistant: t('roles.admin_assistant'), provider: t('roles.provider') }
/** The switch of one cell, by its accessible name « Rôle : Permission ». */
const cell = (role: string, permission: string) => screen.getByRole('switch', { name: t('settings.users.matrix.cellLabel', { role, permission }) })
const findCell = (role: string, permission: string) => screen.findByRole('switch', { name: t('settings.users.matrix.cellLabel', { role, permission }) })

function renderMatrix(access: Access = viewer) {
  const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false }, mutations: { retry: false } } })
  render(
    renderWithContexts(
      <QueryClientProvider client={queryClient}>
        <RoleMatrix />
      </QueryClientProvider>,
      { access: { access } },
    ),
  )
  return { queryClient }
}

/** What a permission's row says per role (the screen-reader word; the ✓ / — marks are hidden). */
function rowValues(description: string) {
  const row = screen.getByRole('rowheader', { name: description }).closest('tr')
  if (!row) throw new Error(`no row for ${description}`)
  return within(row)
    .getAllByRole('cell')
    .map((c) => c.querySelector('.sr-only')?.textContent)
}

/** A promise settled from the test, to see the optimistic state while the save runs. */
function deferred() {
  let resolve: () => void = () => {}
  let reject: (error: unknown) => void = () => {}
  const promise = new Promise<void>((res, rej) => {
    resolve = res
    reject = rej
  })
  return { promise, resolve, reject }
}

beforeEach(() => {
  mocks.fetchPermissionCatalog.mockResolvedValue(testCatalog)
  mocks.fetchOrgRoles.mockResolvedValue(testRoles)
  mocks.fetchRoleDefaults.mockResolvedValue(testRoleDefaults)
})
afterEach(() => vi.clearAllMocks())

describe('RoleMatrix — read-only', () => {
  it('shows the note and the roles as columns, in a fixed order', async () => {
    renderMatrix()
    expect(await screen.findByRole('table', { name: t('settings.users.matrix.tableLabel') })).toBeInTheDocument()
    expect(screen.getByText(t('settings.users.matrix.note'))).toBeInTheDocument()
    expect(screen.getAllByRole('columnheader').map((h) => h.textContent)).toEqual([
      t('settings.users.matrix.permission'),
      roleName.admin,
      roleName.counselor,
      roleName.assistant,
      roleName.provider,
    ])
  })

  it('marks settings.view for admin and admin_assistant only', async () => {
    renderMatrix()
    await screen.findByRole('rowheader', { name: P.settings })
    const yes = t('settings.users.matrix.yes')
    const no = t('settings.users.matrix.no')
    expect(rowValues(P.settings)).toEqual([yes, no, yes, no])
    expect(rowValues(P.professionals)).toEqual([yes, yes, yes, no])
  })

  it("shows the clinic's defaults (org_role_permissions) and its custom roles, by name", async () => {
    mocks.fetchOrgRoles.mockResolvedValue([...testRoles, customRole])
    mocks.fetchRoleDefaults.mockResolvedValue([...testRoleDefaults, { role: 'counselor', permission_key: 'audit.view' }, { role: customRole.key, permission_key: 'audit.view' }])
    renderMatrix()
    await screen.findByRole('rowheader', { name: P.audit })
    expect(mocks.fetchRoleDefaults).toHaveBeenCalledWith('o1')
    expect(screen.getAllByRole('columnheader').at(-1)).toHaveTextContent(customRole.name)
    const yes = t('settings.users.matrix.yes')
    const no = t('settings.users.matrix.no')
    expect(rowValues(P.audit)).toEqual([yes, yes, no, no, yes])
  })

  it('has no switch, no « Nouveau rôle » and no role menu without roles.manage', async () => {
    mocks.fetchOrgRoles.mockResolvedValue([...testRoles, customRole])
    renderMatrix()
    await screen.findByRole('rowheader', { name: P.settings })
    expect(screen.queryByRole('switch')).not.toBeInTheDocument()
    expect(screen.queryByRole('button', { name: t('settings.users.matrix.newRole') })).not.toBeInTheDocument()
    expect(screen.queryByRole('button', { name: t('settings.users.matrix.roleActions', { role: customRole.name }) })).not.toBeInTheDocument()
  })

  it('groups the rows by module, core first, view before manage, and leaves out disabled modules', async () => {
    renderMatrix()
    await screen.findByRole('rowheader', { name: P.settings })
    const bodies = screen.getAllByRole('rowgroup').slice(1)
    const firstCells = bodies.flatMap((body) =>
      within(body)
        .getAllByRole('row')
        .map((row) => row.querySelector('th')?.textContent),
    )
    expect(bodies).toHaveLength(2)
    expect(firstCells).toEqual([
      t('settings.users.sheet.permissions.coreGroup'),
      P.audit,
      P.settings,
      P.usersView,
      'Activer ou désactiver des modules',
      'Gérer les rôles',
      'Voir et modifier les coordonnées bancaires de la clinique',
      'Modifier les paramètres de la clinique',
      'Inviter et gérer les utilisateurs',
      'Professionnels',
      P.professionals,
    ])
    expect(screen.queryByText('Voir la facturation')).not.toBeInTheDocument()
  })

  it('fades the right edge while more role columns remain to scroll to', async () => {
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
    renderMatrix(adminCaller)
    expect(await screen.findByRole('rowheader', { name: P.settings })).toHaveClass('sticky', 'left-0', 'bg-card')
    expect(screen.getByRole('columnheader', { name: t('settings.users.matrix.permission') })).toHaveClass('sticky', 'left-0', 'bg-card')
  })

  it('shows a load error with a retry, and retries only what failed', async () => {
    mocks.fetchRoleDefaults.mockRejectedValueOnce(new Error('boom')).mockResolvedValue(testRoleDefaults)
    renderMatrix()
    expect(await screen.findByText(t('settings.users.matrix.loadError'))).toBeInTheDocument()
    await userEvent.click(screen.getByRole('button', { name: t('common.retry') }))
    expect(await screen.findByRole('rowheader', { name: P.settings })).toBeInTheDocument()
    expect(mocks.fetchPermissionCatalog).toHaveBeenCalledTimes(1)
    expect(mocks.fetchRoleDefaults).toHaveBeenCalledTimes(2)
  })
})

describe('RoleMatrix — editing a cell', () => {
  it('saves at once, optimistically, then toasts', async () => {
    const save = deferred()
    mocks.setRolePermission.mockReturnValue(save.promise)
    renderMatrix(adminCaller)
    const settings = await findCell(roleName.counselor, P.settings)
    expect(settings).not.toBeChecked()
    expect(screen.getByText(t('settings.users.matrix.noteManage'))).toBeInTheDocument()
    await userEvent.click(settings)
    expect(mocks.setRolePermission).toHaveBeenCalledWith('counselor', 'settings.view', true)
    expect(settings).toBeChecked()
    expect(settings).toHaveAttribute('aria-disabled', 'true')
    // A second toggle while it saves is ignored.
    await userEvent.click(settings)
    expect(mocks.setRolePermission).toHaveBeenCalledTimes(1)
    mocks.fetchRoleDefaults.mockResolvedValue([...testRoleDefaults, { role: 'counselor', permission_key: 'settings.view' }])
    save.resolve()
    await waitFor(() =>
      expect(mocks.toast.success).toHaveBeenCalledWith(
        t('settings.users.matrix.saved', { permission: P.settings, value: t('settings.users.sheet.permissions.values.on'), role: roleName.counselor }),
      ),
    )
    await waitFor(() => expect(mocks.fetchRoleDefaults).toHaveBeenCalledTimes(2))
    expect(cell(roleName.counselor, P.settings)).toBeChecked()
    expect(cell(roleName.counselor, P.settings)).not.toHaveAttribute('aria-disabled')
  })

  it('goes back on a refusal, with the database message', async () => {
    const save = deferred()
    mocks.setRolePermission.mockReturnValue(save.promise)
    renderMatrix(adminCaller)
    const professionals = await findCell(roleName.counselor, P.professionals)
    await userEvent.click(professionals)
    expect(mocks.setRolePermission).toHaveBeenCalledWith('counselor', 'professionals.view', false)
    expect(professionals).not.toBeChecked()
    save.reject({ code: 'P0001', message: 'Refusé par la base.' })
    await waitFor(() => expect(mocks.toast.error).toHaveBeenCalledWith('Refusé par la base.'))
    expect(cell(roleName.counselor, P.professionals)).toBeChecked()
  })

  it('toggles with Space or Enter; the arrow keys save nothing', async () => {
    mocks.setRolePermission.mockResolvedValue(undefined)
    renderMatrix(adminCaller)
    const settings = await findCell(roleName.counselor, P.settings)
    settings.focus()
    await userEvent.keyboard('{ArrowRight}{ArrowLeft}{ArrowDown}{ArrowUp}{Home}{End}')
    expect(mocks.setRolePermission).not.toHaveBeenCalled()
    expect(settings).not.toBeChecked()
    mocks.fetchRoleDefaults.mockResolvedValue([...testRoleDefaults, { role: 'counselor', permission_key: 'settings.view' }])
    await userEvent.keyboard(' ')
    expect(mocks.setRolePermission).toHaveBeenCalledWith('counselor', 'settings.view', true)
    await waitFor(() => expect(settings).not.toHaveAttribute('aria-disabled'))
    await userEvent.keyboard('{Enter}')
    expect(mocks.setRolePermission).toHaveBeenLastCalledWith('counselor', 'settings.view', false)
  })

  it("refreshes the caller's access when she changes her own role", async () => {
    mocks.setRolePermission.mockResolvedValue(undefined)
    const { queryClient } = renderMatrix(managerCaller)
    const invalidate = vi.spyOn(queryClient, 'invalidateQueries')
    await userEvent.click(await findCell(roleName.assistant, P.settings))
    await waitFor(() => expect(invalidate).toHaveBeenCalledWith({ queryKey: accessKeys.all }))
    invalidate.mockClear()
    await userEvent.click(cell(roleName.counselor, P.professionals))
    await waitFor(() => expect(mocks.setRolePermission).toHaveBeenCalledTimes(2))
    await waitFor(() => expect(mocks.fetchRoleDefaults).toHaveBeenCalledTimes(3))
    expect(invalidate).not.toHaveBeenCalledWith({ queryKey: accessKeys.all })
  })
})

describe('RoleMatrix — locked cells', () => {
  it('shows Administrateur checked and read-only, with its note', async () => {
    renderMatrix(adminCaller)
    await findCell(roleName.admin, P.settings)
    const note = screen.getByText(t('settings.users.matrix.adminNote'))
    for (const permission of [P.audit, P.settings, P.usersView, P.professionals, 'Gérer les rôles']) {
      const s = cell(roleName.admin, permission)
      expect(s).toBeChecked()
      expect(s).toHaveAttribute('aria-readonly', 'true')
      expect(s).toHaveAccessibleDescription(note.textContent ?? '')
      await userEvent.click(s)
      expect(s).toBeChecked()
    }
    expect(mocks.setRolePermission).not.toHaveBeenCalled()
  })

  it('shows Professionnel read-only, with its note', async () => {
    renderMatrix(adminCaller)
    const s = await findCell(roleName.provider, P.settings)
    expect(s).toHaveAttribute('aria-readonly', 'true')
    expect(s).toHaveAccessibleDescription(t('settings.users.matrix.providerNote'))
    await userEvent.click(s)
    expect(s).not.toBeChecked()
    expect(mocks.setRolePermission).not.toHaveBeenCalled()
  })

  it('a manager cannot turn on a permission she lacks, but may turn any off', async () => {
    mocks.setRolePermission.mockResolvedValue(undefined)
    renderMatrix(managerCaller)
    const audit = await findCell(roleName.counselor, P.audit)
    expect(audit).toHaveAttribute('aria-readonly', 'true')
    expect(audit).toHaveAccessibleDescription(t('settings.users.matrix.managerLimit'))
    await userEvent.click(audit)
    expect(mocks.setRolePermission).not.toHaveBeenCalled()
    // One she holds: on is allowed.
    expect(cell(roleName.counselor, P.settings)).not.toHaveAttribute('aria-readonly')
    // Turning a default off gives nothing: always allowed.
    await userEvent.click(cell(roleName.counselor, P.professionals))
    expect(mocks.setRolePermission).toHaveBeenCalledWith('counselor', 'professionals.view', false)
  })

  it('a manager cannot add to her own role, but may remove from it', async () => {
    mocks.setRolePermission.mockResolvedValue(undefined)
    renderMatrix(managerCaller)
    // users.view: she holds it (an exception), her role does not give it.
    const usersView = await findCell(roleName.assistant, P.usersView)
    expect(usersView).not.toBeChecked()
    expect(usersView).toHaveAttribute('aria-readonly', 'true')
    expect(usersView).toHaveAccessibleDescription(t('settings.users.matrix.ownRoleNote'))
    await userEvent.click(usersView)
    expect(mocks.setRolePermission).not.toHaveBeenCalled()
    // The same permission in another role is hers to give.
    expect(cell(roleName.counselor, P.usersView)).not.toHaveAttribute('aria-readonly')
    await userEvent.click(cell(roleName.assistant, P.settings))
    expect(mocks.setRolePermission).toHaveBeenCalledWith('admin_assistant', 'settings.view', false)
  })

  it('an admin sees neither the manager notes nor read-only custom cells', async () => {
    mocks.fetchOrgRoles.mockResolvedValue([...testRoles, customRole])
    renderMatrix(adminCaller)
    expect(await findCell(customRole.name, P.audit)).not.toHaveAttribute('aria-readonly')
    expect(screen.queryByText(t('settings.users.matrix.managerLimit'))).not.toBeInTheDocument()
    expect(screen.queryByText(t('settings.users.matrix.ownRoleNote'))).not.toBeInTheDocument()
  })
})

describe('RoleMatrix — custom roles', () => {
  const NAME = t('settings.users.roleDialog.name')
  const COPY = t('settings.users.roleDialog.copyFrom')
  const openMenu = async (name: string) => userEvent.click(await screen.findByRole('button', { name: t('settings.users.matrix.roleActions', { role: name }) }))

  it('creates a role copied from another, then shows it', async () => {
    mocks.createRole.mockResolvedValue(customRole.key)
    renderMatrix(adminCaller)
    await userEvent.click(await screen.findByRole('button', { name: t('settings.users.matrix.newRole') }))
    const dialog = await screen.findByRole('dialog', { name: t('settings.users.roleDialog.createTitle') })
    expect(within(dialog).getByRole('textbox', { name: new RegExp(NAME) })).toHaveFocus()
    await userEvent.type(within(dialog).getByRole('textbox', { name: new RegExp(NAME) }), '  Réception   du soir ')
    await userEvent.selectOptions(within(dialog).getByRole('combobox', { name: COPY }), 'admin_assistant')
    mocks.fetchOrgRoles.mockResolvedValue([...testRoles, { ...customRole, name: 'Réception du soir' }])
    await userEvent.click(within(dialog).getByRole('button', { name: t('settings.users.roleDialog.create') }))
    await waitFor(() => expect(screen.queryByRole('dialog')).not.toBeInTheDocument())
    expect(mocks.createRole).toHaveBeenCalledWith('Réception du soir', 'admin_assistant')
    expect(mocks.toast.success).toHaveBeenCalledWith(t('settings.users.roleDialog.created', { name: 'Réception du soir' }))
    expect(screen.getAllByRole('columnheader').at(-1)).toHaveTextContent('Réception du soir')
    // The copy gave it defaults: both queries were refetched.
    expect(mocks.fetchRoleDefaults).toHaveBeenCalledTimes(2)
    expect(screen.getByRole('button', { name: t('settings.users.matrix.newRole') })).toHaveFocus()
  })

  it('creates an empty role without refetching the defaults', async () => {
    mocks.createRole.mockResolvedValue(customRole.key)
    renderMatrix(adminCaller)
    await userEvent.click(await screen.findByRole('button', { name: t('settings.users.matrix.newRole') }))
    const dialog = await screen.findByRole('dialog')
    await userEvent.type(within(dialog).getByRole('textbox', { name: new RegExp(NAME) }), 'Réception')
    await userEvent.click(within(dialog).getByRole('button', { name: t('settings.users.roleDialog.create') }))
    await waitFor(() => expect(screen.queryByRole('dialog')).not.toBeInTheDocument())
    expect(mocks.createRole).toHaveBeenCalledWith('Réception', null)
    expect(mocks.fetchOrgRoles).toHaveBeenCalledTimes(2)
    expect(mocks.fetchRoleDefaults).toHaveBeenCalledTimes(1)
  })

  it('refuses an empty name or one already used, before any request', async () => {
    renderMatrix(adminCaller)
    await userEvent.click(await screen.findByRole('button', { name: t('settings.users.matrix.newRole') }))
    const dialog = await screen.findByRole('dialog')
    const name = within(dialog).getByRole('textbox', { name: new RegExp(NAME) })
    await userEvent.type(name, '   ')
    await userEvent.click(within(dialog).getByRole('button', { name: t('settings.users.roleDialog.create') }))
    expect(await within(dialog).findByText(t('settings.users.roleDialog.validation.nameRequired'))).toBeInTheDocument()
    await userEvent.clear(name)
    await userEvent.type(name, 'CONSEILLÈRE')
    await userEvent.click(within(dialog).getByRole('button', { name: t('settings.users.roleDialog.create') }))
    expect(await within(dialog).findByText(t('settings.users.roleDialog.validation.nameTaken'))).toBeInTheDocument()
    expect(name).toHaveAccessibleDescription(t('settings.users.roleDialog.validation.nameTaken'))
    expect(mocks.createRole).not.toHaveBeenCalled()
  })

  it("shows the database's refusals on their field, the others as an alert", async () => {
    renderMatrix(adminCaller)
    await userEvent.click(await screen.findByRole('button', { name: t('settings.users.matrix.newRole') }))
    const dialog = await screen.findByRole('dialog')
    const name = within(dialog).getByRole('textbox', { name: new RegExp(NAME) })
    const submit = within(dialog).getByRole('button', { name: t('settings.users.roleDialog.create') })
    await userEvent.type(name, 'Réception')

    mocks.createRole.mockRejectedValueOnce({ code: 'P0001', message: 'Le nom du rôle contient des caractères non permis.' })
    await userEvent.click(submit)
    expect(await within(dialog).findByText('Le nom du rôle contient des caractères non permis.')).toBeInTheDocument()
    expect(name).toHaveAccessibleDescription('Le nom du rôle contient des caractères non permis.')

    mocks.createRole.mockRejectedValueOnce({ code: 'P0001', message: t('settings.users.roleDialog.validation.copyRefused') })
    await userEvent.click(submit)
    expect(await within(dialog).findByRole('combobox', { name: COPY })).toHaveAccessibleDescription(
      expect.stringContaining(t('settings.users.roleDialog.validation.copyRefused')),
    )

    mocks.createRole.mockRejectedValueOnce({ code: '22023', message: 'Rôle inconnu : x' })
    await userEvent.click(submit)
    expect(await within(dialog).findByRole('alert')).toHaveTextContent(t('common.errors.generic'))
    expect(screen.getByRole('dialog')).toBeInTheDocument()
  })

  it('a manager may copy only a role whose defaults she holds', async () => {
    renderMatrix(managerCaller)
    await userEvent.click(await screen.findByRole('button', { name: t('settings.users.matrix.newRole') }))
    const copy = within(await screen.findByRole('dialog')).getByRole('combobox', { name: COPY })
    const option = (label: string) => within(copy).getByRole('option', { name: label })
    expect(option(roleName.admin)).toBeDisabled()
    expect(option(roleName.counselor)).toBeEnabled()
    expect(option(roleName.assistant)).toBeEnabled()
    expect(copy).toHaveAccessibleDescription(expect.stringContaining(t('settings.users.roleDialog.copyManagerLimit')))
  })

  it('renames a custom role from its menu', async () => {
    mocks.fetchOrgRoles.mockResolvedValue([...testRoles, customRole])
    mocks.renameRole.mockResolvedValue(undefined)
    renderMatrix(adminCaller)
    // Base roles have no menu.
    await openMenu(customRole.name)
    expect(screen.queryByRole('button', { name: t('settings.users.matrix.roleActions', { role: roleName.counselor }) })).not.toBeInTheDocument()
    await userEvent.click(await screen.findByRole('menuitem', { name: t('settings.users.matrix.rename') }))
    const dialog = await screen.findByRole('dialog', { name: t('settings.users.roleDialog.renameTitle') })
    const name = within(dialog).getByRole('textbox', { name: new RegExp(NAME) })
    expect(name).toHaveValue(customRole.name)
    expect(within(dialog).queryByRole('combobox')).not.toBeInTheDocument()
    await userEvent.clear(name)
    await userEvent.type(name, 'Accueil')
    mocks.fetchOrgRoles.mockResolvedValue([...testRoles, { ...customRole, name: 'Accueil' }])
    await userEvent.click(within(dialog).getByRole('button', { name: t('settings.users.roleDialog.rename') }))
    await waitFor(() => expect(screen.queryByRole('dialog')).not.toBeInTheDocument())
    expect(mocks.renameRole).toHaveBeenCalledWith(customRole.key, 'Accueil')
    expect(mocks.toast.success).toHaveBeenCalledWith(t('settings.users.roleDialog.renamed', { name: 'Accueil' }))
    expect(screen.getAllByRole('columnheader').at(-1)).toHaveTextContent('Accueil')
    expect(screen.getByRole('button', { name: t('settings.users.matrix.roleActions', { role: 'Accueil' }) })).toHaveFocus()
  })

  it('deletes a custom role after confirmation', async () => {
    mocks.fetchOrgRoles.mockResolvedValue([...testRoles, customRole])
    mocks.deleteRole.mockResolvedValue(undefined)
    renderMatrix(adminCaller)
    await openMenu(customRole.name)
    await userEvent.click(await screen.findByRole('menuitem', { name: t('settings.users.matrix.delete') }))
    const confirm = await screen.findByRole('alertdialog', { name: t('settings.users.roleDelete.title', { name: customRole.name }) })
    expect(mocks.deleteRole).not.toHaveBeenCalled()
    mocks.fetchOrgRoles.mockResolvedValue(testRoles)
    await userEvent.click(within(confirm).getByRole('button', { name: t('settings.users.roleDelete.confirm') }))
    await waitFor(() => expect(screen.queryByRole('alertdialog')).not.toBeInTheDocument())
    expect(mocks.deleteRole).toHaveBeenCalledWith(customRole.key)
    expect(mocks.toast.success).toHaveBeenCalledWith(t('settings.users.roleDelete.deleted', { name: customRole.name }))
    expect(screen.queryByRole('columnheader', { name: new RegExp(customRole.name) })).not.toBeInTheDocument()
    expect(screen.getByRole('button', { name: t('settings.users.matrix.newRole') })).toHaveFocus()
  })

  it('keeps the confirmation open with the database message when someone has the role', async () => {
    mocks.fetchOrgRoles.mockResolvedValue([...testRoles, customRole])
    mocks.deleteRole.mockRejectedValue({ code: 'P0001', message: 'Ce rôle est attribué à 2 personne(s).' })
    renderMatrix(adminCaller)
    await openMenu(customRole.name)
    await userEvent.click(await screen.findByRole('menuitem', { name: t('settings.users.matrix.delete') }))
    const confirm = await screen.findByRole('alertdialog')
    await userEvent.click(within(confirm).getByRole('button', { name: t('settings.users.roleDelete.confirm') }))
    expect(await within(confirm).findByRole('alert')).toHaveTextContent('Ce rôle est attribué à 2 personne(s).')
    expect(screen.getByRole('alertdialog')).toBeInTheDocument()
    expect(mocks.toast.success).not.toHaveBeenCalled()
  })
})
