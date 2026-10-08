import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { render, screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { t } from '@/i18n'
import type { Access } from '@/core/access/access'
import { accessKeys } from '@/core/access/access-context'
import { renderWithContexts } from '@/test/contexts'
import { accessForRole } from '@/test/role-fixtures'
import { testCatalog, testUsers } from '@/test/users-fixtures'
import type { OrgUser } from '../api'
import { UserSheet } from './UserSheet'

const mocks = vi.hoisted(() => ({
  fetchPermissionCatalog: vi.fn(),
  fetchUserOverrides: vi.fn(),
  setUserRole: vi.fn(),
  setUserStatus: vi.fn(),
  setPermissionOverride: vi.fn(),
  clearPermissionOverride: vi.fn(),
  toast: { success: vi.fn(), error: vi.fn() },
}))
vi.mock('../api', () => ({
  fetchOrgUsers: vi.fn(),
  fetchPermissionCatalog: mocks.fetchPermissionCatalog,
  fetchUserOverrides: mocks.fetchUserOverrides,
  setUserRole: mocks.setUserRole,
  setUserStatus: mocks.setUserStatus,
  setPermissionOverride: mocks.setPermissionOverride,
  clearPermissionOverride: mocks.clearPermissionOverride,
}))
vi.mock('@/shared/ui/sonner', () => ({ toast: mocks.toast }))
vi.mock('@sentry/react', () => ({ captureException: vi.fn() }))

const [admin, adjointe, conseillere, pro] = testUsers as [OrgUser, OrgUser, OrgUser, OrgUser]
const otherAdmin: OrgUser = { ...conseillere, user_id: 'u-other-admin', display_name: 'Autre Admin', role: 'admin', role_name: 'Administrateur', override_count: 0 }
const adminCaller = accessForRole('admin', { user_id: admin.user_id, modules: ['professionals'] })
/** A non-admin manager: the adjointe given users.view + users.manage. */
const managerCaller = accessForRole('admin_assistant', {
  user_id: adjointe.user_id,
  modules: ['professionals'],
  permissions: ['settings.view', 'professionals.view', 'users.view', 'users.manage'],
})

const P = {
  audit: "Consulter le journal d'audit",
  settings: 'Voir les paramètres',
  professionals: 'Voir les professionnels',
}
const L = {
  role: t('settings.users.sheet.role.label'),
  active: t('settings.users.sheet.status.label'),
  save: t('common.save'),
  cancel: t('common.cancel'),
  granted: t('settings.users.sheet.permissions.granted'),
  revoked: t('settings.users.sheet.permissions.revoked'),
  byRoleYes: t('settings.users.sheet.permissions.byRole', { value: t('settings.users.sheet.permissions.yes') }),
  byRoleNo: t('settings.users.sheet.permissions.byRole', { value: t('settings.users.sheet.permissions.no') }),
}
const savedToast = (permission: string, state: 'role' | 'granted' | 'revoked') =>
  t('settings.users.sheet.permissions.saved', { permission, state: t(`settings.users.sheet.permissions.states.${state}`) })
const LAST_ADMIN = 'La clinique doit garder au moins un administrateur actif.'

function renderSheet(user: OrgUser, caller: Access = adminCaller) {
  const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false }, mutations: { retry: false } } })
  render(
    renderWithContexts(
      <QueryClientProvider client={queryClient}>
        <UserSheet user={user} onClose={vi.fn()} />
      </QueryClientProvider>,
      { access: { access: caller } },
    ),
  )
  return { queryClient }
}

/** The toggle group of one permission, by its description. */
const permission = (description: string) => screen.getByRole('group', { name: description })
const choice = (description: string, name: string) => within(permission(description)).getByRole('button', { name })
const roleSelect = () => screen.getByRole('combobox', { name: L.role })

beforeEach(() => {
  mocks.fetchPermissionCatalog.mockResolvedValue(testCatalog)
  mocks.fetchUserOverrides.mockResolvedValue([])
})
afterEach(() => vi.clearAllMocks())

describe('UserSheet', () => {
  it('shows the name, email, status and last sign-in (« Jamais » when never)', async () => {
    renderSheet(adjointe)
    const dialog = await screen.findByRole('dialog', { name: adjointe.display_name })
    expect(dialog).toHaveAccessibleDescription(adjointe.email)
    expect(within(dialog).getByText(t('settings.users.status.active'))).toBeInTheDocument()
    // getByText normalizes the DOM text (U+00A0 becomes a space) but not the expected string.
    const lastSignIn = t('settings.users.sheet.lastSignIn', { date: t('settings.users.never') })
    expect(within(dialog).getByText(lastSignIn.replace(/\s+/g, ' '))).toBeInTheDocument()
  })

  describe('role', () => {
    it('changing the select alone saves nothing; « Enregistrer » saves and toasts', async () => {
      mocks.setUserRole.mockResolvedValue(undefined)
      renderSheet(conseillere)
      const role = await screen.findByRole('combobox', { name: L.role })
      expect(role).toHaveValue('counselor')
      await userEvent.selectOptions(role, 'admin_assistant')
      expect(mocks.setUserRole).not.toHaveBeenCalled()
      await userEvent.click(screen.getByRole('button', { name: L.save }))
      await waitFor(() => expect(mocks.toast.success).toHaveBeenCalledWith(t('settings.users.sheet.role.saved')))
      expect(mocks.setUserRole).toHaveBeenCalledWith('u-conseillere', 'admin_assistant')
      expect(screen.queryByRole('alertdialog')).not.toBeInTheDocument()
    })

    it('« Annuler » puts the saved role back and focuses the select', async () => {
      renderSheet(conseillere)
      await userEvent.selectOptions(await screen.findByRole('combobox', { name: L.role }), 'admin_assistant')
      await userEvent.click(screen.getByRole('button', { name: L.cancel }))
      expect(roleSelect()).toHaveValue('counselor')
      await waitFor(() => expect(roleSelect()).toHaveFocus())
      expect(mocks.setUserRole).not.toHaveBeenCalled()
    })

    it('snaps back to the saved role and shows the database message when refused', async () => {
      mocks.setUserRole.mockRejectedValue({ code: 'P0001', message: LAST_ADMIN })
      renderSheet(conseillere)
      await userEvent.selectOptions(await screen.findByRole('combobox', { name: L.role }), 'admin_assistant')
      await userEvent.click(screen.getByRole('button', { name: L.save }))
      await waitFor(() => expect(mocks.toast.error).toHaveBeenCalledWith(LAST_ADMIN))
      await waitFor(() => expect(roleSelect()).toHaveValue('counselor'))
      expect(mocks.toast.success).not.toHaveBeenCalled()
    })

    it('making someone admin asks first, naming their exceptions', async () => {
      mocks.setUserRole.mockResolvedValue(undefined)
      renderSheet({ ...conseillere, override_count: 3 })
      await userEvent.selectOptions(await screen.findByRole('combobox', { name: L.role }), 'admin')
      await userEvent.click(screen.getByRole('button', { name: L.save }))
      const dialog = await screen.findByRole('alertdialog', { name: t('settings.users.sheet.role.promote.title', { name: conseillere.display_name }) })
      expect(dialog).toHaveAccessibleDescription(
        `${t('settings.users.sheet.role.promote.body')} ${t('settings.users.sheet.role.promote.overridesOther', { count: '3' })}`,
      )
      expect(mocks.setUserRole).not.toHaveBeenCalled()

      await userEvent.click(within(dialog).getByRole('button', { name: L.cancel }))
      expect(mocks.setUserRole).not.toHaveBeenCalled()
      await waitFor(() => expect(roleSelect()).toHaveFocus())

      await userEvent.click(screen.getByRole('button', { name: L.save }))
      await userEvent.click(within(await screen.findByRole('alertdialog')).getByRole('button', { name: t('settings.users.sheet.role.promote.confirm') }))
      await waitFor(() => expect(mocks.setUserRole).toHaveBeenCalledWith('u-conseillere', 'admin'))
    })

    it.each([
      [0, t('settings.users.sheet.role.promote.body')],
      [1, `${t('settings.users.sheet.role.promote.body')} ${t('settings.users.sheet.role.promote.overridesOne')}`],
    ])('the promotion dialog with %i exception(s)', async (count, description) => {
      renderSheet({ ...conseillere, override_count: count })
      await userEvent.selectOptions(await screen.findByRole('combobox', { name: L.role }), 'admin')
      await userEvent.click(screen.getByRole('button', { name: L.save }))
      expect(await screen.findByRole('alertdialog')).toHaveAccessibleDescription(description)
    })

    it('removing the admin role asks first, naming the new role', async () => {
      mocks.setUserRole.mockResolvedValue(undefined)
      renderSheet(otherAdmin)
      await userEvent.selectOptions(await screen.findByRole('combobox', { name: L.role }), 'counselor')
      await userEvent.click(screen.getByRole('button', { name: L.save }))
      const dialog = await screen.findByRole('alertdialog', { name: t('settings.users.sheet.role.demote.title') })
      expect(dialog).toHaveAccessibleDescription(t('settings.users.sheet.role.demote.body', { name: otherAdmin.display_name, role: t('roles.counselor') }))
      await userEvent.click(within(dialog).getByRole('button', { name: t('settings.users.sheet.role.demote.confirm') }))
      await waitFor(() => expect(mocks.setUserRole).toHaveBeenCalledWith('u-other-admin', 'counselor'))
    })
  })

  describe('status', () => {
    it('disabling asks for confirmation first; focus returns to the switch', async () => {
      mocks.setUserStatus.mockResolvedValue(undefined)
      renderSheet(conseillere)
      const active = await screen.findByRole('switch', { name: L.active })
      expect(active).toBeChecked()

      await userEvent.click(active)
      const confirm = await screen.findByRole('alertdialog', { name: t('settings.users.sheet.status.confirmTitle') })
      expect(confirm).toHaveAccessibleDescription(t('settings.users.sheet.status.confirmBody', { name: conseillere.display_name }))
      await userEvent.click(within(confirm).getByRole('button', { name: L.cancel }))
      expect(screen.queryByRole('alertdialog')).not.toBeInTheDocument()
      expect(mocks.setUserStatus).not.toHaveBeenCalled()
      await waitFor(() => expect(screen.getByRole('switch', { name: L.active })).toHaveFocus())

      await userEvent.click(screen.getByRole('switch', { name: L.active }))
      await userEvent.click(within(await screen.findByRole('alertdialog')).getByRole('button', { name: t('settings.users.sheet.status.confirm') }))
      await waitFor(() => expect(mocks.toast.success).toHaveBeenCalledWith(t('settings.users.sheet.status.disabledSaved')))
      expect(mocks.setUserStatus).toHaveBeenCalledWith('u-conseillere', 'disabled')
      expect(screen.getByRole('switch', { name: L.active })).toHaveFocus()
    })

    it('an admin re-enables a disabled account at once', async () => {
      mocks.setUserStatus.mockResolvedValue(undefined)
      renderSheet(pro)
      const active = await screen.findByRole('switch', { name: L.active })
      expect(active).not.toBeChecked()
      await userEvent.click(active)
      await waitFor(() => expect(mocks.toast.success).toHaveBeenCalledWith(t('settings.users.sheet.status.enabledSaved')))
      expect(mocks.setUserStatus).toHaveBeenCalledWith('u-pro', 'active')
    })

    it('the last-admin guard shows its message in a toast', async () => {
      mocks.setUserStatus.mockRejectedValue({ code: 'P0001', message: LAST_ADMIN })
      renderSheet(conseillere)
      await userEvent.click(await screen.findByRole('switch', { name: L.active }))
      await userEvent.click(within(await screen.findByRole('alertdialog')).getByRole('button', { name: t('settings.users.sheet.status.confirm') }))
      await waitFor(() => expect(mocks.toast.error).toHaveBeenCalledWith(LAST_ADMIN))
    })

    it('a 42501 (the caller lost their rights elsewhere) also refreshes their access', async () => {
      mocks.setUserStatus.mockRejectedValue({ code: '42501', message: 'Permission refusée : users.manage' })
      const { queryClient } = renderSheet(pro)
      const invalidate = vi.spyOn(queryClient, 'invalidateQueries')
      await userEvent.click(await screen.findByRole('switch', { name: L.active }))
      await waitFor(() => expect(mocks.toast.error).toHaveBeenCalledWith(t('common.errors.forbidden')))
      expect(invalidate).toHaveBeenCalledWith({ queryKey: accessKeys.all })
    })
  })

  describe('permissions', () => {
    it('one group per module (core first, view before manage, enabled modules only), the role default in the first option', async () => {
      renderSheet(conseillere)
      expect(await screen.findByRole('heading', { name: t('settings.users.sheet.permissions.coreGroup') })).toBeInTheDocument()
      expect(screen.getByRole('heading', { name: 'Professionnels' })).toBeInTheDocument()
      expect(screen.queryByText('Voir la facturation')).not.toBeInTheDocument()
      const core = screen.getAllByRole('group').map((g) => g.getAttribute('aria-labelledby') && document.getElementById(g.getAttribute('aria-labelledby') ?? '')?.textContent)
      expect(core.slice(0, 4)).toEqual([P.audit, P.settings, 'Voir les utilisateurs', 'Activer ou désactiver des modules'])
      // counselor: professionals.view by default, audit.view not.
      expect(choice(P.professionals, L.byRoleYes)).toHaveAttribute('aria-pressed', 'true')
      expect(choice(P.audit, L.byRoleNo)).toHaveAttribute('aria-pressed', 'true')
    })

    it('reflects the overrides', async () => {
      mocks.fetchUserOverrides.mockResolvedValue([
        { permission_key: 'audit.view', granted: true },
        { permission_key: 'professionals.view', granted: false },
      ])
      renderSheet(conseillere)
      await waitFor(() => expect(choice(P.audit, L.granted)).toHaveAttribute('aria-pressed', 'true'))
      expect(choice(P.professionals, L.revoked)).toHaveAttribute('aria-pressed', 'true')
      expect(mocks.fetchUserOverrides).toHaveBeenCalledWith('u-conseillere')
    })

    it('grants, revokes and clears, each with a toast naming the permission', async () => {
      mocks.setPermissionOverride.mockResolvedValue(undefined)
      mocks.clearPermissionOverride.mockResolvedValue(undefined)
      mocks.fetchUserOverrides.mockResolvedValue([{ permission_key: 'professionals.view', granted: false }])
      renderSheet(conseillere)
      await screen.findByRole('group', { name: P.audit })

      await userEvent.click(choice(P.audit, L.granted))
      await waitFor(() => expect(mocks.setPermissionOverride).toHaveBeenCalledWith('u-conseillere', 'audit.view', true))
      await waitFor(() => expect(mocks.toast.success).toHaveBeenCalledWith(savedToast(P.audit, 'granted')))

      await userEvent.click(choice(P.settings, L.revoked))
      await waitFor(() => expect(mocks.setPermissionOverride).toHaveBeenCalledWith('u-conseillere', 'settings.view', false))
      await waitFor(() => expect(mocks.toast.success).toHaveBeenCalledWith(savedToast(P.settings, 'revoked')))

      await userEvent.click(choice(P.professionals, L.byRoleYes))
      await waitFor(() => expect(mocks.clearPermissionOverride).toHaveBeenCalledWith('u-conseillere', 'professionals.view'))
      await waitFor(() => expect(mocks.toast.success).toHaveBeenCalledWith(savedToast(P.professionals, 'role')))
      expect(mocks.toast.error).not.toHaveBeenCalled()
      expect(savedToast(P.audit, 'granted')).toBe("Consulter le journal d'audit : accordée.")
    })

    it('the arrow keys save nothing; Enter or Space chooses', async () => {
      mocks.setPermissionOverride.mockResolvedValue(undefined)
      renderSheet(conseillere)
      await screen.findByRole('group', { name: P.audit })
      choice(P.audit, L.byRoleNo).focus()
      await userEvent.keyboard('{ArrowRight}{ArrowRight}{ArrowLeft}{ArrowRight}')
      expect(choice(P.audit, L.revoked)).toHaveFocus()
      expect(mocks.setPermissionOverride).not.toHaveBeenCalled()
      expect(mocks.clearPermissionOverride).not.toHaveBeenCalled()

      await userEvent.keyboard('{ArrowLeft}{Enter}')
      await waitFor(() => expect(mocks.setPermissionOverride).toHaveBeenCalledWith('u-conseillere', 'audit.view', true))
      choice(P.settings, L.byRoleNo).focus()
      await userEvent.keyboard('{ArrowLeft} ')
      await waitFor(() => expect(mocks.setPermissionOverride).toHaveBeenCalledWith('u-conseillere', 'settings.view', false))
      expect(mocks.setPermissionOverride).toHaveBeenCalledTimes(2)
    })

    it('shows the new state at once and ignores other choices while saving', async () => {
      mocks.setPermissionOverride.mockReturnValue(new Promise(() => {}))
      renderSheet(conseillere)
      await screen.findByRole('group', { name: P.audit })
      await userEvent.click(choice(P.audit, L.granted))
      await waitFor(() => expect(choice(P.audit, L.granted)).toHaveAttribute('aria-pressed', 'true'))
      expect(permission(P.audit)).toHaveAttribute('aria-busy', 'true')
      expect(choice(P.audit, L.revoked)).toHaveAttribute('aria-disabled', 'true')
      await userEvent.click(choice(P.audit, L.revoked))
      expect(mocks.setPermissionOverride).toHaveBeenCalledTimes(1)
      expect(choice(P.audit, L.granted)).toHaveAttribute('aria-pressed', 'true')
    })

    it('two rows save at once; a failure puts back only its own row', async () => {
      let rejectAudit: (error: unknown) => void = () => {}
      let resolveSettings: () => void = () => {}
      mocks.setPermissionOverride.mockImplementation((_user: string, key: string) =>
        key === 'audit.view'
          ? new Promise((_resolve, reject) => {
              rejectAudit = reject
            })
          : new Promise<void>((resolve) => {
              resolveSettings = resolve
            }),
      )
      renderSheet(conseillere)
      await screen.findByRole('group', { name: P.audit })
      await userEvent.click(choice(P.audit, L.granted))
      await userEvent.click(choice(P.settings, L.revoked))
      expect(choice(P.audit, L.granted)).toHaveAttribute('aria-pressed', 'true')
      expect(choice(P.settings, L.revoked)).toHaveAttribute('aria-pressed', 'true')
      expect(permission(P.audit)).toHaveAttribute('aria-busy', 'true')
      expect(permission(P.settings)).toHaveAttribute('aria-busy', 'true')

      // The server now has the settings revoke only.
      mocks.fetchUserOverrides.mockResolvedValue([{ permission_key: 'settings.view', granted: false }])
      rejectAudit({ code: 'P0001', message: "Vous ne pouvez pas accorder une permission que vous n'avez pas." })
      await waitFor(() => expect(choice(P.audit, L.byRoleNo)).toHaveAttribute('aria-pressed', 'true'))
      expect(choice(P.settings, L.revoked)).toHaveAttribute('aria-pressed', 'true')
      // No refetch while the settings change is still in flight.
      expect(mocks.fetchUserOverrides).toHaveBeenCalledTimes(1)

      resolveSettings()
      await waitFor(() => expect(mocks.fetchUserOverrides).toHaveBeenCalledTimes(2))
      expect(choice(P.settings, L.revoked)).toHaveAttribute('aria-pressed', 'true')
      expect(choice(P.audit, L.byRoleNo)).toHaveAttribute('aria-pressed', 'true')
      expect(mocks.toast.error).toHaveBeenCalledWith("Vous ne pouvez pas accorder une permission que vous n'avez pas.")
      expect(mocks.toast.success).toHaveBeenCalledWith(savedToast(P.settings, 'revoked'))
    })

    it('an admin has no permission controls, only the note', async () => {
      renderSheet(otherAdmin)
      expect(await screen.findByText(t('settings.users.sheet.permissions.admin'))).toBeInTheDocument()
      expect(screen.queryByRole('group')).not.toBeInTheDocument()
      expect(mocks.fetchUserOverrides).not.toHaveBeenCalled()
    })
  })

  it("the caller's own account: read-only, with a link to « Mon compte »", async () => {
    renderSheet(admin)
    const link = await screen.findByRole('link', { name: t('settings.users.sheet.selfLink') })
    expect(link).toHaveAttribute('href', '/mon-compte')
    expect(screen.getByRole('textbox', { name: L.role })).toHaveAttribute('readonly')
    expect(screen.queryByRole('button', { name: L.save })).not.toBeInTheDocument()
    const active = screen.getByRole('switch', { name: L.active })
    expect(active).toHaveAttribute('aria-readonly', 'true')
    await userEvent.click(active)
    expect(screen.queryByRole('alertdialog')).not.toBeInTheDocument()
    expect(mocks.setUserStatus).not.toHaveBeenCalled()
  })

  it("a provider's role is read-only, managed in Professionnels; status and permissions stay editable", async () => {
    renderSheet(pro)
    const role = await screen.findByRole('textbox', { name: L.role })
    expect(role).toHaveValue(t('roles.provider'))
    expect(role).toHaveAccessibleDescription(t('settings.users.sheet.role.provider'))
    expect(screen.getByRole('switch', { name: L.active })).not.toHaveAttribute('aria-readonly')
    expect(await screen.findByRole('group', { name: P.audit })).toBeInTheDocument()
    expect(choice(P.audit, L.granted)).toBeEnabled()
  })

  describe('as a non-admin manager', () => {
    it('cannot change an admin', async () => {
      renderSheet(otherAdmin, managerCaller)
      expect(await screen.findByText(t('settings.users.sheet.adminOnly'))).toBeInTheDocument()
      expect(screen.getByRole('textbox', { name: L.role })).toHaveAttribute('readonly')
      expect(screen.getByRole('switch', { name: L.active })).toHaveAttribute('aria-readonly', 'true')
    })

    it('may assign only the roles whose defaults they hold, never admin', async () => {
      renderSheet(conseillere, managerCaller)
      const role = await screen.findByRole('combobox', { name: L.role })
      await waitFor(() => expect(within(role).getByRole('option', { name: t('roles.admin_assistant') })).toBeEnabled())
      expect(within(role).getByRole('option', { name: t('roles.admin') })).toBeDisabled()
      expect(within(role).getByRole('option', { name: t('roles.counselor') })).toBeEnabled()
      expect(role).toHaveAccessibleDescription(t('settings.users.sheet.role.managerLimit'))
    })

    it('waits for the catalogue before offering roles, and shows its failure with a retry', async () => {
      mocks.fetchPermissionCatalog.mockRejectedValueOnce(new Error('boom')).mockResolvedValue(testCatalog)
      renderSheet(conseillere, managerCaller)
      const role = await screen.findByRole('combobox', { name: L.role })
      expect(within(role).getByRole('option', { name: t('roles.admin_assistant') })).toBeDisabled()
      expect(await screen.findByText(t('settings.users.sheet.role.loadError'))).toBeInTheDocument()
      expect(screen.getByText(t('settings.users.sheet.permissions.loadError'))).toBeInTheDocument()

      await userEvent.click(screen.getAllByRole('button', { name: t('common.retry') })[0] as HTMLElement)
      await waitFor(() => expect(within(roleSelect()).getByRole('option', { name: t('roles.admin_assistant') })).toBeEnabled())
      expect(screen.queryByText(t('settings.users.sheet.role.loadError'))).not.toBeInTheDocument()
      expect(await screen.findByRole('group', { name: P.audit })).toBeInTheDocument()
    })

    it('shows a loading line while the catalogue loads', async () => {
      mocks.fetchPermissionCatalog.mockReturnValue(new Promise(() => {}))
      renderSheet(conseillere, managerCaller)
      await screen.findByRole('combobox', { name: L.role })
      expect(screen.getAllByRole('status').map((s) => s.textContent)).toContain(t('common.loading'))
      expect(within(roleSelect()).getByRole('option', { name: t('roles.admin_assistant') })).toBeDisabled()
    })

    it('may not grant, nor clear a revoke of, a permission they lack, and is told why', async () => {
      mocks.fetchUserOverrides.mockResolvedValue([{ permission_key: 'audit.view', granted: false }])
      renderSheet(conseillere, managerCaller)
      await screen.findByRole('group', { name: P.audit })
      expect(choice(P.audit, L.granted)).toBeDisabled()
      expect(choice(P.audit, L.byRoleNo)).toBeDisabled()
      expect(choice(P.audit, L.revoked)).toHaveAttribute('aria-pressed', 'true')
      expect(permission(P.audit)).toHaveAccessibleDescription(t('settings.users.sheet.permissions.revokeHint'))
      // A permission the manager holds stays fully open, with no hint.
      expect(choice(P.settings, L.granted)).toBeEnabled()
      expect(permission(P.settings)).not.toHaveAttribute('aria-describedby')
    })

    it('may disable but not re-enable an account', async () => {
      renderSheet(pro, managerCaller)
      const active = await screen.findByRole('switch', { name: L.active })
      expect(active).toHaveAttribute('aria-readonly', 'true')
      expect(active).toHaveAccessibleDescription(t('settings.users.sheet.status.reenableAdminOnly'))
      await userEvent.click(active)
      expect(mocks.setUserStatus).not.toHaveBeenCalled()
    })
  })
})
