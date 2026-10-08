import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { render, screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { t } from '@/i18n'
import type { Access } from '@/core/access/access'
import { FunctionCallError } from '@/core/supabase/functions'
import { formatClinicDateShort } from '@/shared/lib/timezone'
import { renderWithContexts } from '@/test/contexts'
import { accessForRole, ROLE_PERMISSIONS } from '@/test/role-fixtures'
import { customRole, testRoleDefaults, testRoles } from '@/test/users-fixtures'
import { userKeys } from '../hooks'
import { InviteDialog } from './InviteDialog'

const mocks = vi.hoisted(() => ({
  fetchOrgRoles: vi.fn(),
  fetchRoleDefaults: vi.fn(),
  inviteStaff: vi.fn(),
  toast: { success: vi.fn(), error: vi.fn(), warning: vi.fn() },
}))
vi.mock('../api', () => ({ fetchRoleDefaults: mocks.fetchRoleDefaults, inviteStaff: mocks.inviteStaff }))
vi.mock('@/core/access/api', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@/core/access/api')>()),
  fetchOrgRoles: mocks.fetchOrgRoles,
}))
vi.mock('@/shared/ui/sonner', () => ({ toast: mocks.toast }))
vi.mock('@sentry/react', () => ({ captureException: vi.fn() }))

const adminCaller = accessForRole('admin', { user_id: 'u-admin' })
/** A non-admin manager: the adjointe given users.view + users.manage on top of her defaults. */
const managerCaller = accessForRole('admin_assistant', {
  user_id: 'u-adjointe',
  permissions: [...ROLE_PERMISSIONS.admin_assistant, 'users.view', 'users.manage'],
})

function renderDialog(caller: Access = adminCaller) {
  const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false }, mutations: { retry: false } } })
  render(
    <QueryClientProvider client={queryClient}>{renderWithContexts(<InviteDialog />, { access: { access: caller } })}</QueryClientProvider>,
  )
  return { queryClient }
}

const L = {
  name: new RegExp(`^${t('settings.users.invite.name')}`),
  email: new RegExp(`^${t('settings.users.invite.email')}`),
  role: new RegExp(`^${t('settings.users.invite.role')}`),
  submit: t('settings.users.invite.submit'),
}

async function open() {
  await userEvent.click(screen.getByRole('button', { name: t('settings.users.invite.button') }))
  return screen.findByRole('dialog', { name: t('settings.users.invite.title') })
}

async function fill({ name = 'Nouvelle Personne', email = '  Nouvelle@Mana.test ', role = 'counselor' } = {}) {
  const dialog = await open()
  await userEvent.type(within(dialog).getByLabelText(L.name), name)
  await userEvent.type(within(dialog).getByLabelText(L.email), email)
  const select = within(dialog).getByLabelText(L.role)
  await waitFor(() => expect(within(select).getAllByRole('option').length).toBeGreaterThan(1))
  await userEvent.selectOptions(select, role)
  return dialog
}

beforeEach(() => {
  mocks.fetchOrgRoles.mockResolvedValue([...testRoles, customRole])
  mocks.fetchRoleDefaults.mockResolvedValue(testRoleDefaults)
  mocks.inviteStaff.mockResolvedValue({ invitationId: 'i1', expiresAt: null, emailProblem: null })
})
afterEach(() => vi.clearAllMocks())

describe('InviteDialog', () => {
  it('checks the name, the address and the role before sending anything', async () => {
    renderDialog()
    const dialog = await open()
    await userEvent.type(within(dialog).getByLabelText(L.email), 'pas-un-courriel')
    await userEvent.click(within(dialog).getByRole('button', { name: L.submit }))
    expect(await within(dialog).findByText(t('settings.users.invite.validation.nameRequired'))).toBeInTheDocument()
    expect(within(dialog).getByText(t('settings.users.invite.validation.emailInvalid'))).toBeInTheDocument()
    expect(within(dialog).getByText(t('settings.users.invite.validation.roleRequired'))).toBeInTheDocument()
    await userEvent.type(within(dialog).getByLabelText(L.name), 'x'.repeat(81))
    await userEvent.click(within(dialog).getByRole('button', { name: L.submit }))
    expect(await within(dialog).findByText(t('settings.users.invite.validation.nameTooLong'))).toBeInTheDocument()
    expect(mocks.inviteStaff).not.toHaveBeenCalled()
  })

  it('an admin may invite to every role but Professionnel, custom roles included (no role defaults fetched)', async () => {
    renderDialog()
    const dialog = await open()
    const select = within(dialog).getByLabelText(L.role)
    await waitFor(() => expect(within(select).getAllByRole('option').length).toBeGreaterThan(1))
    expect(mocks.fetchRoleDefaults).not.toHaveBeenCalled()
    expect(within(select).getAllByRole('option').map((o) => o.textContent)).toEqual([
      t('settings.users.invite.rolePlaceholder'),
      t('roles.admin'),
      t('roles.counselor'),
      t('roles.admin_assistant'),
      customRole.name,
    ])
  })

  it('a non-admin manager is offered only the roles whose permissions she holds, never admin', async () => {
    renderDialog(managerCaller)
    const dialog = await open()
    const select = within(dialog).getByLabelText(L.role)
    await waitFor(() => expect(within(select).getAllByRole('option').length).toBeGreaterThan(1))
    expect(within(select).getAllByRole('option').map((o) => o.textContent)).toEqual([
      t('settings.users.invite.rolePlaceholder'),
      t('roles.counselor'),
      t('roles.admin_assistant'),
      customRole.name,
    ])
    expect(within(dialog).getByText(t('settings.users.invite.roleManagerLimit'))).toBeInTheDocument()
    expect(mocks.fetchRoleDefaults).toHaveBeenCalled()
  })

  it("says when the new link expires (the function's expires_at), never a fixed number of days", async () => {
    mocks.inviteStaff.mockResolvedValue({ invitationId: 'i1', expiresAt: '2026-10-15T16:00:00+00:00', emailProblem: null })
    renderDialog()
    const dialog = await fill()
    expect(dialog).not.toHaveTextContent(/\d+ jours/)
    await userEvent.click(within(dialog).getByRole('button', { name: L.submit }))
    await waitFor(() =>
      expect(mocks.toast.success).toHaveBeenCalledWith(
        t('settings.users.invite.sentExpires', { email: 'nouvelle@mana.test', date: formatClinicDateShort('2026-10-15T16:00:00+00:00') }),
      ),
    )
  })

  it('sends the invitation (trimmed, lowercase address), toasts and closes; the invitations are refetched', async () => {
    const { queryClient } = renderDialog()
    const invalidate = vi.spyOn(queryClient, 'invalidateQueries')
    const dialog = await fill()
    await userEvent.click(within(dialog).getByRole('button', { name: L.submit }))
    await waitFor(() => expect(screen.queryByRole('dialog')).not.toBeInTheDocument())
    expect(mocks.inviteStaff).toHaveBeenCalledExactlyOnceWith({ email: 'nouvelle@mana.test', displayName: 'Nouvelle Personne', role: 'counselor' })
    expect(mocks.toast.success).toHaveBeenCalledWith(t('settings.users.invite.sent', { email: 'nouvelle@mana.test' }))
    expect(invalidate).toHaveBeenCalledWith({ queryKey: userKeys.invitations() })
    // Focus goes back to « Inviter ».
    await waitFor(() => expect(screen.getByRole('button', { name: t('settings.users.invite.button') })).toHaveFocus())
  })

  it('choosing Administrateur asks for confirmation first', async () => {
    renderDialog()
    const dialog = await fill({ role: 'admin' })
    await userEvent.click(within(dialog).getByRole('button', { name: L.submit }))
    const confirm = await screen.findByRole('alertdialog', { name: t('settings.users.invite.adminConfirm.title') })
    expect(confirm).toHaveAccessibleDescription(t('settings.users.invite.adminConfirm.body'))
    await userEvent.click(within(confirm).getByRole('button', { name: t('common.cancel') }))
    expect(mocks.inviteStaff).not.toHaveBeenCalled()
    expect(screen.getByRole('dialog', { name: t('settings.users.invite.title') })).toBeInTheDocument()

    await userEvent.click(within(dialog).getByRole('button', { name: L.submit }))
    await userEvent.click(within(await screen.findByRole('alertdialog')).getByRole('button', { name: t('settings.users.invite.adminConfirm.confirm') }))
    await waitFor(() => expect(mocks.inviteStaff).toHaveBeenCalledWith(expect.objectContaining({ role: 'admin' })))
  })

  it.each([
    // « Renvoyer » cannot help: no advice to use it.
    ['not_configured', null, t('settings.users.invite.emailProblems.not_configured')],
    ['invalid_request', null, t('settings.users.invite.emailProblems.invalid_request')],
    // It can: when to retry.
    ['provider_error', null, `${t('settings.users.invite.emailProblems.provider_error')} ${t('settings.users.invite.emailAdvice')}`],
    ['module_disabled', null, `${t('settings.users.invite.emailProblems.other')} ${t('settings.users.invite.emailAdvice')}`],
    ['rate_limited', 2700, `${t('settings.users.invite.emailProblems.rate_limited')} Réessayez dans environ 45 minutes.`],
  ])('the invitation exists but its email failed (%s): a warning with what to do, and the dialog closes', async (code, retryAfter, description) => {
    mocks.inviteStaff.mockResolvedValue({ invitationId: 'i1', expiresAt: null, emailProblem: { code, retryAfter } })
    renderDialog()
    const dialog = await fill()
    await userEvent.click(within(dialog).getByRole('button', { name: L.submit }))
    await waitFor(() => expect(mocks.toast.warning).toHaveBeenCalledWith(t('settings.users.invite.createdNotSent'), { description }))
    if (code === 'not_configured' || code === 'invalid_request') expect(description).not.toContain('Renvoyer')
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument()
    expect(mocks.toast.success).not.toHaveBeenCalled()
  })

  it('shows a refusal (P0001) in the dialog, which stays open', async () => {
    mocks.inviteStaff.mockRejectedValue({ code: 'P0001', message: 'Une invitation est déjà en attente pour cette adresse. Utilisez « Renvoyer ».' })
    renderDialog()
    const dialog = await fill()
    await userEvent.click(within(dialog).getByRole('button', { name: L.submit }))
    expect(await within(dialog).findByRole('alert')).toHaveTextContent('Une invitation est déjà en attente pour cette adresse. Utilisez « Renvoyer ».')
    expect(mocks.toast.success).not.toHaveBeenCalled()
  })

  it("an address the function's mailbox rule refuses (field: email) shows on the email field", async () => {
    mocks.inviteStaff.mockRejectedValue(new FunctionCallError('invalid_request', 400, 'Invalid request body', { field: 'email' }))
    renderDialog()
    const dialog = await fill({ email: 'a@b.c' })
    await userEvent.click(within(dialog).getByRole('button', { name: L.submit }))
    await waitFor(() => expect(within(dialog).getByLabelText(L.email)).toHaveAccessibleDescription(t('settings.users.invite.validation.emailInvalid')))
    expect(within(dialog).getByLabelText(L.email)).toHaveFocus()
  })

  it('a refused name (field: display_name) shows on the name field; a 400 naming no field is not put on a field', async () => {
    mocks.inviteStaff.mockRejectedValueOnce(new FunctionCallError('invalid_request', 400, 'Invalid request body', { field: 'display_name' }))
    renderDialog()
    const dialog = await fill()
    await userEvent.click(within(dialog).getByRole('button', { name: L.submit }))
    await waitFor(() => expect(within(dialog).getByLabelText(L.name)).toHaveAccessibleDescription(t('settings.users.invite.validation.nameInvalid')))

    mocks.inviteStaff.mockRejectedValueOnce(new FunctionCallError('invalid_request', 400, 'Invalid request body'))
    await userEvent.type(within(dialog).getByLabelText(L.name), 'x')
    await userEvent.click(within(dialog).getByRole('button', { name: L.submit }))
    expect(await within(dialog).findByRole('alert')).toHaveTextContent(t('common.errors.generic'))
    expect(within(dialog).getByLabelText(L.email)).not.toHaveAccessibleDescription(t('settings.users.invite.validation.emailInvalid'))
  })

  it("the caller's invitation limit has its own text, with roughly how long to wait (Retry-After)", async () => {
    mocks.inviteStaff.mockRejectedValue(new FunctionCallError('rate_limited', 429, 'Too many attempts', {}, 2700))
    renderDialog()
    const dialog = await fill()
    await userEvent.click(within(dialog).getByRole('button', { name: L.submit }))
    expect(await within(dialog).findByRole('alert')).toHaveTextContent(`${t('settings.users.invite.errors.rateLimited')} Réessayez dans environ 45 minutes.`)
  })
})
