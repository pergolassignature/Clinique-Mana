import { afterEach, describe, expect, it, vi } from 'vitest'
import { FunctionCallError } from '@/core/supabase/functions'
import {
  clearPermissionOverride,
  clearPermissionOverrides,
  createRole,
  deleteRole,
  fetchOrgUsers,
  fetchRoleDefaults,
  fetchUserOverrides,
  inviteStaff,
  listStaffInvitations,
  renameRole,
  resendInvitation,
  revokeInvitation,
  setPermissionOverride,
  setRolePermission,
  setUserRole,
  setUserStatus,
} from './api'

const mocks = vi.hoisted(() => {
  const rpc = vi.fn()
  // from(table).select(columns) resolves per table; .eq() narrows the overrides query.
  const results = new Map<string, unknown>()
  const eq = vi.fn()
  const select = vi.fn()
  const from = vi.fn((table: string) => ({
    select: (columns: string) => {
      select(table, columns)
      const result = Promise.resolve(results.get(table))
      return Object.assign(result, {
        eq: (column: string, value: string) => {
          eq(table, column, value)
          return Promise.resolve(results.get(table))
        },
      })
    },
  }))
  return { rpc, from, select, eq, results }
})
vi.mock('@/core/supabase/client', () => ({ supabase: { rpc: mocks.rpc, from: mocks.from } }))
const invokeFunction = vi.hoisted(() => vi.fn())
vi.mock('@/core/supabase/functions', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@/core/supabase/functions')>()),
  invokeFunction,
}))

afterEach(() => {
  vi.clearAllMocks()
  mocks.results.clear()
})

const failure = { code: 'P0001', message: 'La clinique doit garder au moins un administrateur actif.' }

describe('fetchOrgUsers', () => {
  it('lists the org users through list_org_users, keeping the nullable columns null', async () => {
    mocks.rpc.mockResolvedValue({
      data: [
        {
          user_id: 'u2',
          display_name: 'Conseillère Locale',
          email: 'conseillere@mana.test',
          status: 'active',
          role: 'counselor',
          role_name: 'Conseillère',
          last_sign_in_at: '2026-10-07T14:30:00+00:00',
          override_count: 1,
        },
        {
          user_id: 'u3',
          display_name: 'Sans Rôle',
          email: 'sans@mana.test',
          status: 'disabled',
          role: null,
          role_name: null,
          last_sign_in_at: null,
          override_count: 0,
        },
      ],
      error: null,
    })
    const users = await fetchOrgUsers()
    expect(mocks.rpc).toHaveBeenCalledWith('list_org_users')
    expect(users).toEqual([
      {
        user_id: 'u2',
        display_name: 'Conseillère Locale',
        email: 'conseillere@mana.test',
        status: 'active',
        role: 'counselor',
        role_name: 'Conseillère',
        last_sign_in_at: '2026-10-07T14:30:00+00:00',
        override_count: 1,
      },
      {
        user_id: 'u3',
        display_name: 'Sans Rôle',
        email: 'sans@mana.test',
        status: 'disabled',
        role: null,
        role_name: null,
        last_sign_in_at: null,
        override_count: 0,
      },
    ])
  })

  it('throws the RPC error', async () => {
    const error = { code: '42501', message: 'Permission refusée : users.view' }
    mocks.rpc.mockResolvedValue({ data: null, error })
    await expect(fetchOrgUsers()).rejects.toBe(error)
  })
})

describe('fetchRoleDefaults', () => {
  it("reads the clinic's role defaults (org_role_permissions), never the template", async () => {
    mocks.results.set('org_role_permissions', { data: [{ role: 'counselor', permission_key: 'professionals.view' }], error: null })
    await expect(fetchRoleDefaults('o1')).resolves.toEqual([{ role: 'counselor', permission_key: 'professionals.view' }])
    expect(mocks.select).toHaveBeenCalledWith('org_role_permissions', 'role, permission_key')
    expect(mocks.eq).toHaveBeenCalledWith('org_role_permissions', 'org_id', 'o1')
    expect(mocks.from).not.toHaveBeenCalledWith('role_permissions')
  })

  it('throws the query error', async () => {
    const error = { code: '42501', message: 'denied' }
    mocks.results.set('org_role_permissions', { data: null, error })
    await expect(fetchRoleDefaults('o1')).rejects.toBe(error)
  })
})

describe('fetchUserOverrides', () => {
  it("reads the user's overrides", async () => {
    mocks.results.set('user_permission_overrides', { data: [{ permission_key: 'audit.view', granted: true }], error: null })
    await expect(fetchUserOverrides('u2')).resolves.toEqual([{ permission_key: 'audit.view', granted: true }])
    expect(mocks.select).toHaveBeenCalledWith('user_permission_overrides', 'permission_key, granted')
    expect(mocks.eq).toHaveBeenCalledWith('user_permission_overrides', 'user_id', 'u2')
  })

  it('throws the query error', async () => {
    const error = { code: '42501', message: 'denied' }
    mocks.results.set('user_permission_overrides', { data: null, error })
    await expect(fetchUserOverrides('u2')).rejects.toBe(error)
  })
})

describe('write RPCs', () => {
  it.each([
    ['setUserRole', () => setUserRole('u2', 'admin_assistant'), 'set_user_role', { p_user_id: 'u2', p_role: 'admin_assistant' }],
    [
      'setPermissionOverride',
      () => setPermissionOverride('u2', 'audit.view', true),
      'set_permission_override',
      { p_user_id: 'u2', p_permission_key: 'audit.view', p_granted: true },
    ],
    [
      'clearPermissionOverride',
      () => clearPermissionOverride('u2', 'audit.view'),
      'clear_permission_override',
      { p_user_id: 'u2', p_permission_key: 'audit.view' },
    ],
    [
      'setRolePermission',
      () => setRolePermission('counselor', 'audit.view', false),
      'set_role_permission',
      { p_role: 'counselor', p_permission_key: 'audit.view', p_granted: false },
    ],
    ['renameRole', () => renameRole('custom_0a1b2c3d', 'Accueil'), 'rename_role', { p_role: 'custom_0a1b2c3d', p_name: 'Accueil' }],
    ['deleteRole', () => deleteRole('custom_0a1b2c3d'), 'delete_role', { p_role: 'custom_0a1b2c3d' }],
  ])('%s calls its RPC and throws its error', async (_name, call, rpc, args) => {
    mocks.rpc.mockResolvedValue({ data: null, error: null })
    await expect(call()).resolves.toBeUndefined()
    expect(mocks.rpc).toHaveBeenCalledWith(rpc, args)

    mocks.rpc.mockResolvedValue({ data: null, error: failure })
    await expect(call()).rejects.toBe(failure)
  })

  it('clearPermissionOverrides calls its RPC, returns the number removed and throws its error', async () => {
    mocks.rpc.mockResolvedValue({ data: 3, error: null })
    await expect(clearPermissionOverrides('u2')).resolves.toBe(3)
    expect(mocks.rpc).toHaveBeenCalledWith('clear_permission_overrides', { p_user_id: 'u2' })

    mocks.rpc.mockResolvedValue({ data: null, error: failure })
    await expect(clearPermissionOverrides('u2')).rejects.toBe(failure)
  })

  it('createRole sends the name, and the role to copy only when there is one; returns the new key', async () => {
    mocks.rpc.mockResolvedValue({ data: 'custom_0a1b2c3d', error: null })
    await expect(createRole('Réception', null)).resolves.toBe('custom_0a1b2c3d')
    expect(mocks.rpc).toHaveBeenLastCalledWith('create_role', { p_name: 'Réception' })
    await createRole('Réception', 'admin_assistant')
    expect(mocks.rpc).toHaveBeenLastCalledWith('create_role', { p_name: 'Réception', p_copy_from: 'admin_assistant' })

    mocks.rpc.mockResolvedValue({ data: null, error: failure })
    await expect(createRole('Réception', null)).rejects.toBe(failure)
  })
})

// ── Staff invitations and status (Task 3.22) ────────────────────────────────────────────────────

const INVITATION_ROW = {
  id: 'i1',
  email: 'nouvelle@mana.test',
  display_name: 'Nouvelle Personne',
  role: 'counselor',
  role_name: 'Conseillère',
  status: 'pending',
  expires_at: '2026-10-15T16:00:00+00:00',
  is_expired: false,
  invited_by_name: 'Admin Local',
  created_at: '2026-10-08T16:00:00+00:00',
  last_email_status: 'delivered',
  last_email_at: '2026-10-08T16:00:02+00:00',
}

describe('listStaffInvitations', () => {
  it('lists the pending invitations through list_staff_invitations, keeping the nullable columns null', async () => {
    const orphan = { ...INVITATION_ROW, id: 'i2', role_name: null, expires_at: null, is_expired: true, invited_by_name: null, last_email_status: null, last_email_at: null }
    mocks.rpc.mockResolvedValue({ data: [INVITATION_ROW, orphan], error: null })
    await expect(listStaffInvitations()).resolves.toEqual([
      {
        id: 'i1',
        email: 'nouvelle@mana.test',
        display_name: 'Nouvelle Personne',
        role: 'counselor',
        role_name: 'Conseillère',
        expires_at: '2026-10-15T16:00:00+00:00',
        is_expired: false,
        invited_by_name: 'Admin Local',
        last_email_status: 'delivered',
        last_email_error_code: null,
      },
      {
        id: 'i2',
        email: 'nouvelle@mana.test',
        display_name: 'Nouvelle Personne',
        role: 'counselor',
        role_name: null,
        expires_at: null,
        is_expired: true,
        invited_by_name: null,
        last_email_status: null,
        last_email_error_code: null,
      },
    ])
    expect(mocks.rpc).toHaveBeenCalledWith('list_staff_invitations')
  })

  it("reads the last email's error code (provider_unavailable reads « Résultat inconnu »)", async () => {
    mocks.rpc.mockResolvedValue({ data: [{ ...INVITATION_ROW, last_email_status: 'failed', last_email_error_code: 'provider_unavailable' }], error: null })
    await expect(listStaffInvitations()).resolves.toMatchObject([{ last_email_status: 'failed', last_email_error_code: 'provider_unavailable' }])
  })

  it('throws the RPC error', async () => {
    mocks.rpc.mockResolvedValue({ data: null, error: failure })
    await expect(listStaffInvitations()).rejects.toBe(failure)
  })
})

describe('inviteStaff and resendInvitation (the staff-invite function only)', () => {
  it("invites through staff-invite, never an RPC, and returns the invitation and its link's expiry", async () => {
    invokeFunction.mockResolvedValue({ invitation_id: 'i1', expires_at: '2026-10-15T16:00:00+00:00' })
    await expect(inviteStaff({ email: 'nouvelle@mana.test', displayName: 'Nouvelle Personne', role: 'counselor' })).resolves.toEqual({
      invitationId: 'i1',
      expiresAt: '2026-10-15T16:00:00+00:00',
      emailProblem: null,
    })
    expect(invokeFunction).toHaveBeenCalledExactlyOnceWith('staff-invite', { email: 'nouvelle@mana.test', display_name: 'Nouvelle Personne', role: 'counselor' })
    expect(mocks.rpc).not.toHaveBeenCalled()
  })

  it('« Renvoyer » sends the invitation id to staff-invite', async () => {
    invokeFunction.mockResolvedValue({ invitation_id: 'i1' })
    await expect(resendInvitation('i1')).resolves.toEqual({ invitationId: 'i1', expiresAt: null, emailProblem: null })
    expect(invokeFunction).toHaveBeenCalledExactlyOnceWith('staff-invite', { invitation_id: 'i1' })
    expect(mocks.rpc).not.toHaveBeenCalled()
  })

  it.each(['provider_error', 'not_configured', 'rate_limited', 'invalid_request'])(
    'an email failure after the invitation exists (%s) resolves with the invitation and the problem',
    async (code) => {
      const retryAfter = code === 'rate_limited' ? 900 : null
      invokeFunction.mockRejectedValue(new FunctionCallError(code, 502, 'Invitation created, email not sent', { invitation_id: 'i1' }, retryAfter))
      const result = { invitationId: 'i1', expiresAt: null, emailProblem: { code, retryAfter } }
      await expect(inviteStaff({ email: 'a@b.ca', displayName: 'A', role: 'counselor' })).resolves.toEqual(result)
      await expect(resendInvitation('i1')).resolves.toEqual(result)
    },
  )

  it('passes an RPC refusal on as that RPC error: P0001 with its French message, 42501', async () => {
    invokeFunction.mockRejectedValue(new FunctionCallError('invalid_request', 400, 'Cette personne a déjà un accès.', { refusal: true }))
    await expect(inviteStaff({ email: 'a@b.ca', displayName: 'A', role: 'counselor' })).rejects.toEqual({ code: 'P0001', message: 'Cette personne a déjà un accès.' })
    invokeFunction.mockRejectedValue(new FunctionCallError('forbidden', 403, 'Not allowed'))
    await expect(resendInvitation('i1')).rejects.toEqual({ code: '42501', message: 'Not allowed' })
  })

  it("keeps the function's own refusals as they are (a refused field, a refused body, a limit, the network)", async () => {
    for (const error of [
      // A French-looking message does not make a field refusal a P0001: the field decides.
      new FunctionCallError('invalid_request', 400, 'Courriel refusé', { field: 'email' }),
      new FunctionCallError('invalid_request', 400, 'Invalid request body'),
      // Nor does a French message without the function's refusal flag.
      new FunctionCallError('invalid_request', 400, 'Cette personne a déjà un accès.'),
      new FunctionCallError('rate_limited', 429, 'Too many attempts'),
      new FunctionCallError('network', 0, 'Function unreachable'),
    ]) {
      invokeFunction.mockRejectedValue(error)
      await expect(inviteStaff({ email: 'a@b.ca', displayName: 'A', role: 'counselor' })).rejects.toBe(error)
    }
  })
})

describe('revokeInvitation', () => {
  it('calls revoke_staff_invitation and throws its error', async () => {
    mocks.rpc.mockResolvedValue({ data: null, error: null })
    await revokeInvitation('i1')
    expect(mocks.rpc).toHaveBeenCalledWith('revoke_staff_invitation', { p_id: 'i1' })
    mocks.rpc.mockResolvedValue({ data: null, error: failure })
    await expect(revokeInvitation('i1')).rejects.toBe(failure)
  })
})

describe('setUserStatus (the users-set-status function)', () => {
  it('disables through users-set-status and says whether sign-in was blocked', async () => {
    invokeFunction.mockResolvedValue({ status: 'disabled', signin_blocked: true })
    await expect(setUserStatus('u2', 'disabled')).resolves.toEqual({ signinBlocked: true })
    expect(invokeFunction).toHaveBeenCalledExactlyOnceWith('users-set-status', { user_id: 'u2', status: 'disabled' })
    expect(mocks.rpc).not.toHaveBeenCalled()

    invokeFunction.mockResolvedValue({ status: 'disabled', signin_blocked: false })
    await expect(setUserStatus('u2', 'disabled')).resolves.toEqual({ signinBlocked: false })
  })

  it('re-enables (no ban to apply)', async () => {
    invokeFunction.mockResolvedValue({ status: 'active' })
    await expect(setUserStatus('u2', 'active')).resolves.toEqual({ signinBlocked: true })
  })

  it('passes the guards on as RPC errors; an unban failure stays a FunctionCallError', async () => {
    invokeFunction.mockRejectedValue(new FunctionCallError('invalid_request', 400, failure.message, { refusal: true }))
    await expect(setUserStatus('u2', 'disabled')).rejects.toEqual(failure)
    const unban = new FunctionCallError('provider_error', 502, 'Account could not be re-enabled')
    invokeFunction.mockRejectedValue(unban)
    await expect(setUserStatus('u2', 'active')).rejects.toBe(unban)
  })
})
