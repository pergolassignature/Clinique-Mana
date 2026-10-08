import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { render, screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { t } from '@/i18n'
import type { Access } from '@/core/access/access'
import { accessKeys } from '@/core/access/access-context'
import { FunctionCallError } from '@/core/supabase/functions'
import { userKeys } from '../hooks'
import { renderWithContexts } from '@/test/contexts'
import { accessForRole, ROLE_PERMISSIONS } from '@/test/role-fixtures'
import { customRole, testCatalog, testRoleDefaults, testRoles, testUsers } from '@/test/users-fixtures'
import type { OrgUser } from '../api'
import { UserSheet } from './UserSheet'

const mocks = vi.hoisted(() => ({
  fetchPermissionCatalog: vi.fn(),
  fetchOrgRoles: vi.fn(),
  fetchRoleDefaults: vi.fn(),
  fetchUserOverrides: vi.fn(),
  setUserRole: vi.fn(),
  setUserStatus: vi.fn(),
  setPermissionOverride: vi.fn(),
  clearPermissionOverride: vi.fn(),
  clearPermissionOverrides: vi.fn(),
  toast: { success: vi.fn(), error: vi.fn(), warning: vi.fn() },
}))
vi.mock('../api', () => ({
  fetchOrgUsers: vi.fn(),
  fetchRoleDefaults: mocks.fetchRoleDefaults,
  fetchUserOverrides: mocks.fetchUserOverrides,
  setUserRole: mocks.setUserRole,
  setUserStatus: mocks.setUserStatus,
  setPermissionOverride: mocks.setPermissionOverride,
  clearPermissionOverride: mocks.clearPermissionOverride,
  clearPermissionOverrides: mocks.clearPermissionOverrides,
}))
// The clinic's roles come from the access module (shared with the shell and the audit log).
vi.mock('@/core/access/api', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@/core/access/api')>()),
  fetchOrgRoles: mocks.fetchOrgRoles,
  fetchPermissionCatalog: mocks.fetchPermissionCatalog,
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
  permissions: [...ROLE_PERMISSIONS.admin_assistant, 'users.view', 'users.manage'],
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
  /** Any « Exception · rôle : … » marker. */
  exception: /^Exception · rôle/,
  exceptionRoleYes: t('settings.users.sheet.permissions.exception', { value: t('settings.users.sheet.permissions.yes') }),
  exceptionRoleNo: t('settings.users.sheet.permissions.exception', { value: t('settings.users.sheet.permissions.no') }),
  lacked: t('settings.users.sheet.permissions.lackedHint'),
  reset: t('settings.users.sheet.permissions.reset.label'),
  resetCount: (count: number) => t('settings.users.sheet.permissions.reset.labelCount', { count: String(count) }),
  resetTitle: t('settings.users.sheet.permissions.reset.title'),
  resetConfirm: t('settings.users.sheet.permissions.reset.confirm'),
}
/** The toast of a switch: `role` when the exception is cleared, `exception` when one is set; `on` is the new value. */
const savedToast = (permission: string, kind: 'role' | 'exception', on: boolean) =>
  t(`settings.users.sheet.permissions.saved.${kind}`, {
    permission,
    value: t(on ? 'settings.users.sheet.permissions.values.on' : 'settings.users.sheet.permissions.values.off'),
  })
/** The reset confirmation: the exceptions removed, then the role sentence. */
const resetBody = (removed: string, role: string) => `${removed} ${t('settings.users.sheet.permissions.reset.body.role', { role })}`
const LAST_ADMIN = 'La clinique doit garder au moins un administrateur actif.'

function renderSheet(user: OrgUser, caller: Access = adminCaller) {
  const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false }, mutations: { retry: false } } })
  const onClose = vi.fn()
  render(
    renderWithContexts(
      <QueryClientProvider client={queryClient}>
        <UserSheet user={user} onClose={onClose} />
      </QueryClientProvider>,
      { access: { access: caller } },
    ),
  )
  return { queryClient, onClose }
}

/** The switch of one permission, by its description. */
const permission = (description: string) => screen.getByRole('switch', { name: description })
/** The descriptions of the permission switches, in order (the status switch left out). */
const permissionOrder = () =>
  screen
    .getAllByRole('switch')
    .map((s) => document.querySelector(`label[for="${s.id}"]`)?.textContent)
    .filter((name) => name !== L.active)
const roleSelect = () => screen.getByRole('combobox', { name: L.role })

beforeEach(() => {
  mocks.fetchPermissionCatalog.mockResolvedValue(testCatalog)
  mocks.fetchOrgRoles.mockResolvedValue(testRoles)
  mocks.fetchRoleDefaults.mockResolvedValue(testRoleDefaults)
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

    it('closing the sheet with an unsaved role asks first; « Rester » keeps the draft', async () => {
      const { onClose } = renderSheet(conseillere)
      await userEvent.selectOptions(await screen.findByRole('combobox', { name: L.role }), 'admin_assistant')
      await userEvent.keyboard('{Escape}')
      const ask = await screen.findByRole('alertdialog', { name: t('common.unsaved.title') })
      expect(ask).toHaveAccessibleDescription(t('common.unsaved.body'))
      expect(onClose).not.toHaveBeenCalled()

      await userEvent.click(within(ask).getByRole('button', { name: t('common.unsaved.stay') }))
      expect(screen.queryByRole('alertdialog')).not.toBeInTheDocument()
      expect(roleSelect()).toHaveValue('admin_assistant')
      await waitFor(() => expect(roleSelect()).toHaveFocus())
      expect(onClose).not.toHaveBeenCalled()

      await userEvent.click(screen.getByRole('button', { name: t('common.close') }))
      await userEvent.click(within(await screen.findByRole('alertdialog')).getByRole('button', { name: t('common.unsaved.leave') }))
      expect(onClose).toHaveBeenCalledTimes(1)
      expect(mocks.setUserRole).not.toHaveBeenCalled()
    })

    it('closing without a draft (or after « Annuler ») does not ask', async () => {
      const { onClose } = renderSheet(conseillere)
      await userEvent.selectOptions(await screen.findByRole('combobox', { name: L.role }), 'admin_assistant')
      await userEvent.click(screen.getByRole('button', { name: L.cancel }))
      await userEvent.keyboard('{Escape}')
      expect(onClose).toHaveBeenCalledTimes(1)
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
      mocks.setUserStatus.mockResolvedValue({ signinBlocked: true })
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
      mocks.setUserStatus.mockResolvedValue({ signinBlocked: true })
      renderSheet(pro)
      const active = await screen.findByRole('switch', { name: L.active })
      expect(active).not.toBeChecked()
      await userEvent.click(active)
      await waitFor(() => expect(mocks.toast.success).toHaveBeenCalledWith(t('settings.users.sheet.status.enabledSaved')))
      expect(mocks.setUserStatus).toHaveBeenCalledWith('u-pro', 'active')
    })

    it('disabling when sign-in could not be blocked: a warning that stays, whose « Réessayer » disables again', async () => {
      mocks.setUserStatus.mockResolvedValueOnce({ signinBlocked: false }).mockResolvedValueOnce({ signinBlocked: true })
      renderSheet(conseillere)
      await userEvent.click(await screen.findByRole('switch', { name: L.active }))
      await userEvent.click(within(await screen.findByRole('alertdialog')).getByRole('button', { name: t('settings.users.sheet.status.confirm') }))
      await waitFor(() =>
        expect(mocks.toast.warning).toHaveBeenCalledWith(t('settings.users.sheet.status.signinNotBlocked'), {
          duration: Infinity,
          action: { label: t('common.retry'), onClick: expect.any(Function) },
        }),
      )
      expect(mocks.toast.success).not.toHaveBeenCalled()

      // « Réessayer »: the same disable again (idempotent), which applies the ban this time.
      const [, options] = mocks.toast.warning.mock.calls[0] as [string, { action: { onClick: () => void } }]
      options.action.onClick()
      await waitFor(() => expect(mocks.toast.success).toHaveBeenCalledWith(t('settings.users.sheet.status.disabledSaved')))
      expect(mocks.setUserStatus).toHaveBeenNthCalledWith(2, 'u-conseillere', 'disabled')
    })

    it('a failed re-enable (Auth kept the ban) says to retry, and refetches the user', async () => {
      mocks.setUserStatus.mockRejectedValue(new FunctionCallError('provider_error', 502, 'Account could not be re-enabled'))
      const { queryClient } = renderSheet(pro)
      const invalidate = vi.spyOn(queryClient, 'invalidateQueries')
      await userEvent.click(await screen.findByRole('switch', { name: L.active }))
      await waitFor(() => expect(mocks.toast.error).toHaveBeenCalledWith(t('settings.users.sheet.status.reenableFailed')))
      expect(invalidate).toHaveBeenCalledWith({ queryKey: userKeys.list() })
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
    it('one switch per permission, grouped by module (core first, view before manage, enabled modules only), showing the role default', async () => {
      renderSheet(conseillere)
      expect(await screen.findByRole('heading', { name: t('settings.users.sheet.permissions.coreGroup') })).toBeInTheDocument()
      expect(screen.getByRole('heading', { name: 'Professionnels' })).toBeInTheDocument()
      expect(screen.queryByText('Voir la facturation')).not.toBeInTheDocument()
      expect(permissionOrder().slice(0, 4)).toEqual([P.audit, P.settings, 'Voir les utilisateurs', 'Activer ou désactiver des modules'])
      // counselor: professionals.view by default, audit.view not; no exception either way.
      expect(permission(P.professionals)).toBeChecked()
      expect(permission(P.audit)).not.toBeChecked()
      expect(permission(P.audit)).not.toHaveAttribute('aria-describedby')
      expect(screen.queryByText(L.exception)).not.toBeInTheDocument()
    })

    it('an override shows its value and the « Exception · rôle : Oui/Non » marker (also its description)', async () => {
      mocks.fetchUserOverrides.mockResolvedValue([
        { permission_key: 'audit.view', granted: true },
        { permission_key: 'professionals.view', granted: false },
      ])
      renderSheet(conseillere)
      await waitFor(() => expect(permission(P.audit)).toBeChecked())
      expect(permission(P.audit)).toHaveAccessibleDescription(L.exceptionRoleNo)
      expect(permission(P.professionals)).not.toBeChecked()
      expect(permission(P.professionals)).toHaveAccessibleDescription(L.exceptionRoleYes)
      // Visible, not screen-reader only (getByText turns U+00A0 into a space).
      expect(screen.getByText(L.exceptionRoleNo.replace(/\s+/g, ' '))).not.toHaveClass('sr-only')
      expect(screen.getByText(L.exceptionRoleYes.replace(/\s+/g, ' '))).not.toHaveClass('sr-only')
      // One text per marker: no screen-reader duplicate.
      expect(screen.getAllByText(/rôle\s: (Oui|Non)/)).toHaveLength(2)
      expect(screen.getAllByText(L.exception)).toHaveLength(2)
      expect(L.exceptionRoleNo).toBe('Exception · rôle\u00a0: Non')
      expect(mocks.fetchUserOverrides).toHaveBeenCalledWith('u-conseillere')
    })

    it('toggling away from the role value sets an exception; back to it clears it; each with a toast naming the permission', async () => {
      mocks.setPermissionOverride.mockResolvedValue(undefined)
      mocks.clearPermissionOverride.mockResolvedValue(undefined)
      // adjointe: settings.view and professionals.view by role; audit.view granted as an exception.
      mocks.fetchUserOverrides.mockResolvedValue([{ permission_key: 'audit.view', granted: true }])
      renderSheet(adjointe)
      await waitFor(() => expect(permission(P.audit)).toBeChecked())

      await userEvent.click(permission(P.settings))
      await waitFor(() => expect(mocks.setPermissionOverride).toHaveBeenCalledWith('u-adjointe', 'settings.view', false))
      await waitFor(() => expect(mocks.toast.success).toHaveBeenCalledWith(savedToast(P.settings, 'exception', false)))

      await userEvent.click(permission('Voir les utilisateurs'))
      await waitFor(() => expect(mocks.setPermissionOverride).toHaveBeenCalledWith('u-adjointe', 'users.view', true))
      await waitFor(() => expect(mocks.toast.success).toHaveBeenCalledWith(savedToast('Voir les utilisateurs', 'exception', true)))

      await userEvent.click(permission(P.audit))
      await waitFor(() => expect(mocks.clearPermissionOverride).toHaveBeenCalledWith('u-adjointe', 'audit.view'))
      await waitFor(() => expect(mocks.toast.success).toHaveBeenCalledWith(savedToast(P.audit, 'role', false)))
      expect(mocks.setPermissionOverride).toHaveBeenCalledTimes(2)
      expect(mocks.toast.error).not.toHaveBeenCalled()
      expect(savedToast(P.audit, 'exception', true)).toBe("Consulter le journal d'audit\u00a0: activée (exception).")
      expect(savedToast(P.audit, 'role', false)).toBe("Consulter le journal d'audit\u00a0: selon le rôle (désactivée).")
    })

    it('the marker follows the switch: on as an exception, then off again', async () => {
      mocks.setPermissionOverride.mockResolvedValue(undefined)
      mocks.clearPermissionOverride.mockResolvedValue(undefined)
      renderSheet(conseillere)
      await screen.findByRole('switch', { name: P.audit })
      mocks.fetchUserOverrides.mockResolvedValue([{ permission_key: 'audit.view', granted: true }])
      await userEvent.click(permission(P.audit))
      await waitFor(() => expect(permission(P.audit)).toHaveAccessibleDescription(L.exceptionRoleNo))
      expect(permission(P.audit)).toBeChecked()

      mocks.fetchUserOverrides.mockResolvedValue([])
      await userEvent.click(permission(P.audit))
      await waitFor(() => expect(mocks.clearPermissionOverride).toHaveBeenCalledWith('u-conseillere', 'audit.view'))
      await waitFor(() => expect(screen.queryByText(L.exception)).not.toBeInTheDocument())
      expect(permission(P.audit)).not.toBeChecked()
    })

    it('the arrow keys do nothing; Space and Enter toggle (a Radix button)', async () => {
      mocks.setPermissionOverride.mockResolvedValue(undefined)
      mocks.clearPermissionOverride.mockResolvedValue(undefined)
      renderSheet(conseillere)
      await screen.findByRole('switch', { name: P.audit })
      permission(P.audit).focus()
      await userEvent.keyboard('{ArrowRight}{ArrowLeft}{ArrowDown}{ArrowUp}')
      expect(permission(P.audit)).toHaveFocus()
      expect(permission(P.audit)).not.toBeChecked()
      expect(mocks.setPermissionOverride).not.toHaveBeenCalled()
      expect(mocks.clearPermissionOverride).not.toHaveBeenCalled()

      mocks.fetchUserOverrides.mockResolvedValue([{ permission_key: 'audit.view', granted: true }])
      await userEvent.keyboard(' ')
      await waitFor(() => expect(mocks.setPermissionOverride).toHaveBeenCalledWith('u-conseillere', 'audit.view', true))
      expect(mocks.setPermissionOverride).toHaveBeenCalledTimes(1)
      await waitFor(() => expect(permission(P.audit)).not.toHaveAttribute('aria-disabled'))
      expect(permission(P.audit)).toBeChecked()
      expect(permission(P.audit)).toHaveFocus()

      await userEvent.keyboard('{Enter}')
      await waitFor(() => expect(mocks.clearPermissionOverride).toHaveBeenCalledWith('u-conseillere', 'audit.view'))
    })

    it('shows the new state at once and ignores other toggles while saving', async () => {
      mocks.setPermissionOverride.mockReturnValue(new Promise(() => {}))
      renderSheet(conseillere)
      await screen.findByRole('switch', { name: P.audit })
      await userEvent.click(permission(P.audit))
      await waitFor(() => expect(permission(P.audit)).toBeChecked())
      expect(permission(P.audit)).toHaveAttribute('aria-disabled', 'true')
      await userEvent.click(permission(P.audit))
      expect(mocks.setPermissionOverride).toHaveBeenCalledTimes(1)
      expect(mocks.clearPermissionOverride).not.toHaveBeenCalled()
      expect(permission(P.audit)).toBeChecked()
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
      await screen.findByRole('switch', { name: P.audit })
      await userEvent.click(permission(P.audit))
      await userEvent.click(permission(P.settings))
      expect(permission(P.audit)).toBeChecked()
      expect(permission(P.settings)).toBeChecked()
      expect(permission(P.audit)).toHaveAttribute('aria-disabled', 'true')
      expect(permission(P.settings)).toHaveAttribute('aria-disabled', 'true')

      // The server now has the settings grant only.
      mocks.fetchUserOverrides.mockResolvedValue([{ permission_key: 'settings.view', granted: true }])
      rejectAudit({ code: 'P0001', message: "Vous ne pouvez pas accorder une permission que vous n'avez pas." })
      await waitFor(() => expect(permission(P.audit)).not.toBeChecked())
      expect(permission(P.settings)).toBeChecked()
      // No refetch while the settings change is still in flight.
      expect(mocks.fetchUserOverrides).toHaveBeenCalledTimes(1)

      resolveSettings()
      await waitFor(() => expect(mocks.fetchUserOverrides).toHaveBeenCalledTimes(2))
      expect(permission(P.settings)).toBeChecked()
      expect(permission(P.audit)).not.toBeChecked()
      expect(mocks.toast.error).toHaveBeenCalledWith("Vous ne pouvez pas accorder une permission que vous n'avez pas.")
      expect(mocks.toast.success).toHaveBeenCalledWith(savedToast(P.settings, 'exception', true))
    })

    it('refetches the users list (override_count) once the last of two overlapping saves settles', async () => {
      const resolvers: (() => void)[] = []
      mocks.setPermissionOverride.mockImplementation(() => new Promise<void>((resolve) => resolvers.push(resolve)))
      const { queryClient } = renderSheet(conseillere)
      await screen.findByRole('switch', { name: P.audit })
      await userEvent.click(permission(P.audit))
      await userEvent.click(permission(P.settings))
      await waitFor(() => expect(resolvers).toHaveLength(2))
      const invalidate = vi.spyOn(queryClient, 'invalidateQueries')
      // Both answer in the same tick.
      for (const resolve of resolvers) resolve()
      await waitFor(() => expect(mocks.toast.success).toHaveBeenCalledTimes(2))
      await waitFor(() => expect(invalidate).toHaveBeenCalledWith({ queryKey: userKeys.list() }))
      expect(invalidate.mock.calls.filter(([filters]) => JSON.stringify(filters?.queryKey) === JSON.stringify(userKeys.list())).length).toBe(2)
    })

    it('a 42501 on a toggle also refreshes the caller\'s access', async () => {
      mocks.setPermissionOverride.mockRejectedValue({ code: '42501', message: 'Permission refusée : users.manage' })
      const { queryClient } = renderSheet(conseillere)
      await screen.findByRole('switch', { name: P.audit })
      const invalidate = vi.spyOn(queryClient, 'invalidateQueries')
      await userEvent.click(permission(P.audit))
      await waitFor(() => expect(mocks.toast.error).toHaveBeenCalledWith(t('common.errors.forbidden')))
      expect(invalidate).toHaveBeenCalledWith({ queryKey: accessKeys.all })
      await waitFor(() => expect(permission(P.audit)).not.toBeChecked())
    })

    it('an admin has no permission switches nor reset, only the note', async () => {
      renderSheet(otherAdmin)
      expect(await screen.findByText(t('settings.users.sheet.permissions.admin'))).toBeInTheDocument()
      expect(screen.getAllByRole('switch')).toHaveLength(1)
      expect(screen.queryByRole('button', { name: new RegExp(L.reset) })).not.toBeInTheDocument()
      expect(mocks.fetchUserOverrides).not.toHaveBeenCalled()
    })
  })

  describe('« Rétablir les permissions du rôle »', () => {
    it('is disabled when the person has no exception', async () => {
      renderSheet(conseillere)
      await screen.findByRole('switch', { name: P.audit })
      expect(screen.getByRole('button', { name: L.reset })).toHaveAttribute('aria-disabled', 'true')
      await userEvent.click(screen.getByRole('button', { name: L.reset }))
      expect(screen.queryByRole('alertdialog')).not.toBeInTheDocument()
    })

    it('waits while a switch is saving', async () => {
      mocks.setPermissionOverride.mockReturnValue(new Promise(() => {}))
      mocks.fetchUserOverrides.mockResolvedValue([{ permission_key: 'audit.view', granted: true }])
      renderSheet(conseillere)
      await userEvent.click(await screen.findByRole('switch', { name: P.settings }))
      const reset = screen.getByRole('button', { name: L.resetCount(2) })
      expect(reset).toHaveAttribute('aria-disabled', 'true')
      await userEvent.click(reset)
      expect(screen.queryByRole('alertdialog')).not.toBeInTheDocument()
    })

    it('shows the count, asks first, then removes every exception with a toast', async () => {
      mocks.clearPermissionOverrides.mockResolvedValue(2)
      mocks.fetchUserOverrides.mockResolvedValue([
        { permission_key: 'audit.view', granted: true },
        { permission_key: 'professionals.view', granted: false },
      ])
      renderSheet(conseillere)
      const reset = await screen.findByRole('button', { name: L.resetCount(2) })
      expect(reset).not.toHaveAttribute('aria-disabled')

      await userEvent.click(reset)
      const dialog = await screen.findByRole('alertdialog', { name: L.resetTitle })
      expect(dialog).toHaveAccessibleDescription(
        'Les 2 exceptions de Conseillère Locale seront supprimées. Ses permissions seront celles du rôle Conseillère.',
      )
      await userEvent.click(within(dialog).getByRole('button', { name: L.cancel }))
      expect(mocks.clearPermissionOverrides).not.toHaveBeenCalled()
      await waitFor(() => expect(screen.getByRole('button', { name: L.resetCount(2) })).toHaveFocus())

      mocks.fetchUserOverrides.mockResolvedValue([])
      await userEvent.click(screen.getByRole('button', { name: L.resetCount(2) }))
      await userEvent.click(within(await screen.findByRole('alertdialog')).getByRole('button', { name: L.resetConfirm }))
      await waitFor(() => expect(mocks.toast.success).toHaveBeenCalledWith(t('settings.users.sheet.permissions.reset.saved')))
      expect(mocks.clearPermissionOverrides).toHaveBeenCalledWith('u-conseillere')
      await waitFor(() => expect(screen.getByRole('button', { name: L.reset })).toHaveAttribute('aria-disabled', 'true'))
      expect(screen.queryByText(L.exception)).not.toBeInTheDocument()
      expect(permission(P.audit)).not.toBeChecked()
      expect(permission(P.professionals)).toBeChecked()
    })

    it('names a single exception in the singular', async () => {
      mocks.fetchUserOverrides.mockResolvedValue([{ permission_key: 'audit.view', granted: true }])
      renderSheet(conseillere)
      await userEvent.click(await screen.findByRole('button', { name: L.resetCount(1) }))
      expect(await screen.findByRole('alertdialog')).toHaveAccessibleDescription(
        resetBody(t('settings.users.sheet.permissions.reset.body.one', { name: conseillere.display_name }), t('roles.counselor')),
      )
    })

    it('shows the database message when refused, and keeps the exceptions', async () => {
      const refused = "Vous ne pouvez pas accorder une permission que vous n'avez pas."
      mocks.clearPermissionOverrides.mockRejectedValue({ code: 'P0001', message: refused })
      mocks.fetchUserOverrides.mockResolvedValue([{ permission_key: 'audit.view', granted: true }])
      const { queryClient } = renderSheet(conseillere)
      await userEvent.click(await screen.findByRole('button', { name: L.resetCount(1) }))
      const invalidate = vi.spyOn(queryClient, 'invalidateQueries')
      await userEvent.click(within(await screen.findByRole('alertdialog')).getByRole('button', { name: L.resetConfirm }))
      await waitFor(() => expect(mocks.toast.error).toHaveBeenCalledWith(refused))
      // What the sheet decided from may be stale: the overrides are refetched.
      expect(invalidate).toHaveBeenCalledWith({ queryKey: userKeys.overrides('u-conseillere') })
      await waitFor(() => expect(mocks.fetchUserOverrides).toHaveBeenCalledTimes(2))
      expect(mocks.toast.success).not.toHaveBeenCalled()
      expect(permission(P.audit)).toBeChecked()
      expect(screen.getByRole('button', { name: L.resetCount(1) })).not.toHaveAttribute('aria-disabled')
    })

    it('counts the exceptions of disabled modules too (no row), and says so in the confirmation', async () => {
      // billing is disabled for the caller: billing.view has no row.
      mocks.fetchUserOverrides.mockResolvedValue([
        { permission_key: 'audit.view', granted: true },
        { permission_key: 'billing.view', granted: true },
      ])
      renderSheet(conseillere)
      await userEvent.click(await screen.findByRole('button', { name: L.resetCount(2) }))
      expect(screen.queryByRole('switch', { name: 'Voir la facturation' })).not.toBeInTheDocument()
      expect(await screen.findByRole('alertdialog')).toHaveAccessibleDescription(
        resetBody('Les 2 exceptions de Conseillère Locale, dont une sur un module désactivé, seront supprimées.', t('roles.counselor')),
      )
    })

    it.each([
      [
        'one exception, on a disabled module',
        [{ permission_key: 'billing.view', granted: true }],
        "L'exception de Conseillère Locale, sur un module désactivé, sera supprimée.",
      ],
      [
        'two of three on disabled modules',
        [
          { permission_key: 'audit.view', granted: true },
          { permission_key: 'billing.view', granted: true },
          { permission_key: 'billing.manage', granted: false },
        ],
        'Les 3 exceptions de Conseillère Locale, dont 2 sur des modules désactivés, seront supprimées.',
      ],
      [
        'all on disabled modules',
        [
          { permission_key: 'billing.view', granted: true },
          { permission_key: 'billing.manage', granted: false },
        ],
        'Les 2 exceptions de Conseillère Locale, toutes sur des modules désactivés, seront supprimées.',
      ],
    ])('the confirmation with %s', async (_case, overrides, removed) => {
      mocks.fetchPermissionCatalog.mockResolvedValue({
        ...testCatalog,
        permissions: [...testCatalog.permissions, { key: 'billing.manage', module_key: 'billing', description: 'Gérer la facturation' }],
      })
      mocks.fetchUserOverrides.mockResolvedValue(overrides)
      renderSheet(conseillere)
      await userEvent.click(await screen.findByRole('button', { name: L.resetCount(overrides.length) }))
      expect(await screen.findByRole('alertdialog')).toHaveAccessibleDescription(resetBody(removed, t('roles.counselor')))
    })

    it('for a person without a role, says they will have no permission left', async () => {
      mocks.fetchUserOverrides.mockResolvedValue([{ permission_key: 'audit.view', granted: true }])
      renderSheet({ ...conseillere, role: null, role_name: null })
      await userEvent.click(await screen.findByRole('button', { name: L.resetCount(1) }))
      expect(await screen.findByRole('alertdialog')).toHaveAccessibleDescription(
        "L'exception de Conseillère Locale sera supprimée. Cette personne n'a pas de rôle\u00a0: elle n'aura plus aucune permission.",
      )
    })

    it('the switches ignore toggles while the reset saves', async () => {
      mocks.clearPermissionOverrides.mockReturnValue(new Promise(() => {}))
      mocks.fetchUserOverrides.mockResolvedValue([{ permission_key: 'audit.view', granted: true }])
      renderSheet(conseillere)
      await userEvent.click(await screen.findByRole('button', { name: L.resetCount(1) }))
      await userEvent.click(within(await screen.findByRole('alertdialog')).getByRole('button', { name: L.resetConfirm }))
      await waitFor(() => expect(mocks.clearPermissionOverrides).toHaveBeenCalledWith('u-conseillere'))
      const settings = permission(P.settings)
      await waitFor(() => expect(settings).toHaveAttribute('aria-disabled', 'true'))
      await userEvent.click(settings)
      settings.focus()
      await userEvent.keyboard(' ')
      expect(settings).not.toBeChecked()
      expect(mocks.setPermissionOverride).not.toHaveBeenCalled()
      expect(mocks.clearPermissionOverride).not.toHaveBeenCalled()
    })

    it('focus returns to the reset button after « Rétablir »', async () => {
      mocks.clearPermissionOverrides.mockResolvedValue(1)
      mocks.fetchUserOverrides.mockResolvedValue([{ permission_key: 'audit.view', granted: true }])
      renderSheet(conseillere)
      await userEvent.click(await screen.findByRole('button', { name: L.resetCount(1) }))
      mocks.fetchUserOverrides.mockResolvedValue([])
      await userEvent.click(within(await screen.findByRole('alertdialog')).getByRole('button', { name: L.resetConfirm }))
      await waitFor(() => expect(screen.queryByRole('alertdialog')).not.toBeInTheDocument())
      await waitFor(() => expect(screen.getByRole('button', { name: new RegExp(L.reset) })).toHaveFocus())
      await waitFor(() => expect(mocks.toast.success).toHaveBeenCalledWith(t('settings.users.sheet.permissions.reset.saved')))
      expect(screen.getByRole('button', { name: L.reset })).toHaveFocus()
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

  it("the caller's own permissions are read-only, without the reset", async () => {
    mocks.fetchUserOverrides.mockResolvedValue([{ permission_key: 'users.manage', granted: true }])
    renderSheet(adjointe, managerCaller)
    await waitFor(() => expect(permission('Inviter et gérer les utilisateurs')).toBeChecked())
    for (const name of [P.audit, P.settings]) {
      expect(permission(name)).toHaveAttribute('aria-readonly', 'true')
      expect(permission(name)).not.toHaveAccessibleDescription(L.lacked)
    }
    await userEvent.click(permission(P.settings))
    expect(permission(P.settings)).toBeChecked()
    expect(mocks.setPermissionOverride).not.toHaveBeenCalled()
    expect(screen.queryByRole('button', { name: new RegExp(L.reset) })).not.toBeInTheDocument()
  })

  it("a provider's role is read-only, managed in Professionnels; status and permissions stay editable", async () => {
    renderSheet(pro)
    const role = await screen.findByRole('textbox', { name: L.role })
    expect(role).toHaveValue(t('roles.provider'))
    expect(role).toHaveAccessibleDescription(t('settings.users.sheet.role.provider'))
    expect(screen.getByRole('switch', { name: L.active })).not.toHaveAttribute('aria-readonly')
    expect(await screen.findByRole('switch', { name: P.audit })).not.toHaveAttribute('aria-readonly')
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

    it("waits for the clinic's role defaults before offering roles, and shows their failure with a retry", async () => {
      mocks.fetchRoleDefaults.mockRejectedValueOnce(new Error('boom')).mockResolvedValue(testRoleDefaults)
      renderSheet(conseillere, managerCaller)
      const role = await screen.findByRole('combobox', { name: L.role })
      expect(within(role).getByRole('option', { name: t('roles.admin_assistant') })).toBeDisabled()
      expect(await screen.findByText(t('settings.users.sheet.role.loadError'))).toBeInTheDocument()
      expect(screen.getByText(t('settings.users.sheet.permissions.loadError'))).toBeInTheDocument()

      await userEvent.click(screen.getAllByRole('button', { name: t('common.retry') })[0] as HTMLElement)
      await waitFor(() => expect(within(roleSelect()).getByRole('option', { name: t('roles.admin_assistant') })).toBeEnabled())
      expect(screen.queryByText(t('settings.users.sheet.role.loadError'))).not.toBeInTheDocument()
      expect(await screen.findByRole('switch', { name: P.audit })).toBeInTheDocument()
    })

    it('shows a loading line while the role defaults load', async () => {
      mocks.fetchRoleDefaults.mockReturnValue(new Promise(() => {}))
      renderSheet(conseillere, managerCaller)
      await screen.findByRole('combobox', { name: L.role })
      expect(screen.getAllByRole('status').map((s) => s.textContent)).toContain(t('common.loading'))
      expect(within(roleSelect()).getByRole('option', { name: t('roles.admin_assistant') })).toBeDisabled()
    })

    it('may turn on only what they hold; turning off is always allowed; told why when read-only', async () => {
      mocks.setPermissionOverride.mockResolvedValue(undefined)
      mocks.clearPermissionOverride.mockResolvedValue(undefined)
      // settings.manage granted by an admin (the manager lacks it); audit.view revoked.
      mocks.fetchUserOverrides.mockResolvedValue([
        { permission_key: 'settings.manage', granted: true },
        { permission_key: 'audit.view', granted: false },
      ])
      renderSheet(conseillere, managerCaller)
      await waitFor(() => expect(permission('Modifier les paramètres de la clinique')).toBeChecked())

      // Off, and the manager lacks it: read-only, with the hint.
      const audit = permission(P.audit)
      expect(audit).toHaveAttribute('aria-readonly', 'true')
      expect(audit).toHaveAccessibleDescription(`${L.exceptionRoleNo} ${L.lacked}`)
      const modules = permission('Activer ou désactiver des modules')
      expect(modules).toHaveAttribute('aria-readonly', 'true')
      expect(modules).toHaveAccessibleDescription(L.lacked)
      // The reason is in each read-only switch's description only; the note above says it once.
      for (const hint of screen.getAllByText(L.lacked)) expect(hint).toHaveClass('sr-only')
      expect(screen.getByText(new RegExp(t('settings.users.sheet.permissions.managerLimit')))).not.toHaveClass('sr-only')
      await userEvent.click(modules)
      expect(modules).not.toBeChecked()
      expect(mocks.setPermissionOverride).not.toHaveBeenCalled()

      // Off, held (settings.view): may turn on, no hint.
      expect(permission(P.settings)).not.toHaveAttribute('aria-readonly')
      expect(permission(P.settings)).not.toHaveAttribute('aria-describedby')
      // On by role, held: may turn off.
      await userEvent.click(permission(P.professionals))
      await waitFor(() => expect(mocks.setPermissionOverride).toHaveBeenCalledWith('u-conseillere', 'professionals.view', false))
      // On by an exception she lacks: may still turn it off (clears the grant).
      const manage = permission('Modifier les paramètres de la clinique')
      expect(manage).not.toHaveAttribute('aria-readonly')
      await userEvent.click(manage)
      await waitFor(() => expect(mocks.clearPermissionOverride).toHaveBeenCalledWith('u-conseillere', 'settings.manage'))
    })

    it('may reset unless a revoke is on a permission they lack, and is told why', async () => {
      mocks.clearPermissionOverrides.mockResolvedValue(1)
      mocks.fetchUserOverrides.mockResolvedValue([{ permission_key: 'audit.view', granted: false }])
      renderSheet(conseillere, managerCaller)
      const blocked = await screen.findByRole('button', { name: L.resetCount(1) })
      expect(blocked).toHaveAttribute('aria-disabled', 'true')
      expect(blocked).toHaveAccessibleDescription(t('settings.users.sheet.permissions.reset.blocked'))
    })

    it('when the blocking revoke has no row (disabled module), the hint names the module', async () => {
      mocks.fetchUserOverrides.mockResolvedValue([
        { permission_key: 'audit.view', granted: true },
        { permission_key: 'billing.view', granted: false },
      ])
      renderSheet(conseillere, managerCaller)
      const blocked = await screen.findByRole('button', { name: L.resetCount(2) })
      expect(blocked).toHaveAttribute('aria-disabled', 'true')
      const hint = t('settings.users.sheet.permissions.reset.blockedHidden', { module: 'Facturation' })
      expect(blocked).toHaveAccessibleDescription(hint)
      expect(hint).toBe(
        "Une exception sur le module Facturation (désactivé) retire une permission que vous n'avez pas\u00a0: seule une personne qui l'a peut rétablir le rôle.",
      )
      await userEvent.click(blocked)
      expect(screen.queryByRole('alertdialog')).not.toBeInTheDocument()
    })

    it('may reset when the revokes are on permissions they hold', async () => {
      mocks.clearPermissionOverrides.mockResolvedValue(2)
      mocks.fetchUserOverrides.mockResolvedValue([
        { permission_key: 'settings.manage', granted: true },
        { permission_key: 'professionals.view', granted: false },
      ])
      renderSheet(conseillere, managerCaller)
      const reset = await screen.findByRole('button', { name: L.resetCount(2) })
      expect(reset).not.toHaveAttribute('aria-disabled')
      expect(reset).not.toHaveAttribute('aria-describedby')
      await userEvent.click(reset)
      await userEvent.click(within(await screen.findByRole('alertdialog')).getByRole('button', { name: L.resetConfirm }))
      await waitFor(() => expect(mocks.clearPermissionOverrides).toHaveBeenCalledWith('u-conseillere'))
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

  describe("the clinic's roles (decision #40)", () => {
    it('offers the custom roles after the base ones (never provider) and saves one', async () => {
      mocks.fetchOrgRoles.mockResolvedValue([customRole, ...testRoles])
      mocks.setUserRole.mockResolvedValue(undefined)
      renderSheet(conseillere)
      const role = await screen.findByRole('combobox', { name: L.role })
      await waitFor(() => expect(within(role).getAllByRole('option')).toHaveLength(4))
      expect(within(role).getAllByRole('option').map((o) => o.textContent)).toEqual([
        t('roles.admin'),
        t('roles.counselor'),
        t('roles.admin_assistant'),
        customRole.name,
      ])
      expect(within(role).getByRole('option', { name: customRole.name })).toBeEnabled()
      await userEvent.selectOptions(role, customRole.key)
      await userEvent.click(screen.getByRole('button', { name: L.save }))
      await waitFor(() => expect(mocks.setUserRole).toHaveBeenCalledWith('u-conseillere', customRole.key))
    })

    it('a role deleted meanwhile: the message, and the roles refetched so it leaves the choices', async () => {
      mocks.fetchOrgRoles.mockResolvedValue([...testRoles, customRole])
      mocks.setUserRole.mockRejectedValue({ code: 'P0001', message: "Ce rôle n'existe plus.", details: '', hint: 'role_missing' })
      renderSheet(conseillere)
      const role = await screen.findByRole('combobox', { name: L.role })
      await waitFor(() => expect(within(role).getByRole('option', { name: customRole.name })).toBeInTheDocument())
      await userEvent.selectOptions(role, customRole.key)
      mocks.fetchOrgRoles.mockResolvedValue(testRoles)
      await userEvent.click(screen.getByRole('button', { name: L.save }))
      await waitFor(() => expect(mocks.toast.error).toHaveBeenCalledWith("Ce rôle n'existe plus."))
      await waitFor(() => expect(within(role).queryByRole('option', { name: customRole.name })).not.toBeInTheDocument())
      expect(mocks.fetchOrgRoles).toHaveBeenCalledTimes(2)
    })

    it("shows a person's custom role by its name", async () => {
      mocks.fetchOrgRoles.mockResolvedValue([...testRoles, customRole])
      renderSheet({ ...conseillere, role: customRole.key, role_name: customRole.name })
      const role = await screen.findByRole('combobox', { name: L.role })
      expect(role).toHaveValue(customRole.key)
      expect(within(role).getByRole('option', { name: customRole.name })).toBeInTheDocument()
    })

    it('a non-admin manager may assign a custom role only if she holds its defaults', async () => {
      const reception = { ...customRole, key: 'custom_00000001', name: 'Réception' }
      const billing = { ...customRole, key: 'custom_00000002', name: 'Comptabilité' }
      mocks.fetchOrgRoles.mockResolvedValue([...testRoles, reception, billing])
      mocks.fetchRoleDefaults.mockResolvedValue([
        ...testRoleDefaults,
        { role: reception.key, permission_key: 'professionals.view' },
        { role: billing.key, permission_key: 'audit.view' },
      ])
      renderSheet(conseillere, managerCaller)
      const role = await screen.findByRole('combobox', { name: L.role })
      await waitFor(() => expect(within(role).getByRole('option', { name: 'Réception' })).toBeEnabled())
      expect(within(role).getByRole('option', { name: 'Comptabilité' })).toBeDisabled()
    })

    it("shows the switches from the clinic's defaults, not the template", async () => {
      mocks.setPermissionOverride.mockResolvedValue(undefined)
      // This clinic gave audit.view to its counselors and took professionals.view away.
      mocks.fetchRoleDefaults.mockResolvedValue([
        ...testRoleDefaults.filter((d) => !(d.role === 'counselor' && d.permission_key === 'professionals.view')),
        { role: 'counselor', permission_key: 'audit.view' },
      ])
      renderSheet(conseillere)
      const audit = await screen.findByRole('switch', { name: P.audit })
      expect(mocks.fetchRoleDefaults).toHaveBeenCalledWith('o1')
      expect(audit).toBeChecked()
      expect(permission(P.professionals)).not.toBeChecked()
      expect(screen.queryByText(L.exception)).not.toBeInTheDocument()
      // Off is now away from the role value: an exception (a revoke), not a cleared one.
      await userEvent.click(audit)
      await waitFor(() => expect(mocks.setPermissionOverride).toHaveBeenCalledWith('u-conseillere', 'audit.view', false))
      expect(mocks.clearPermissionOverride).not.toHaveBeenCalled()
    })
  })
})
