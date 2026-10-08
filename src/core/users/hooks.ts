import { hashKey, useIsMutating, useMutation, useMutationState, useQuery, useQueryClient, type QueryClient } from '@tanstack/react-query'
import { t } from '@/i18n'
import { accessKeys, useAccess } from '@/core/access/access-context'
import { roleKeys, useOrgId } from '@/core/access/org-roles'
import { moduleErrorMessage, rpcErrorCode, rpcErrorHint } from '@/core/modules/errors'
import { FunctionCallError } from '@/core/supabase/functions'
import { toast } from '@/shared/ui/sonner'
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
  type UserStatus,
} from './api'
import { overrideStateOf, type OverrideState, type PermissionOverride, type RolePermission } from './permissions'

export const userKeys = {
  all: ['users'] as const,
  list: () => [...userKeys.all, 'list'] as const,
  overrides: (userId: string) => [...userKeys.all, 'overrides', userId] as const,
  invitations: () => [...userKeys.all, 'invitations'] as const,
}

/** Always fresh on mount: another manager may have changed someone meanwhile. */
export function useOrgUsers() {
  return useQuery({ queryKey: userKeys.list(), queryFn: fetchOrgUsers, staleTime: 0 })
}

/** The key of the role matrix's cell saves (useSetRolePermission). */
const setRolePermissionKey = (orgId: string) => [...roleKeys.defaults(orgId), 'set'] as const

/**
 * What each role gives by default in the clinic. Refetched on each mount (cached data shows
 * meanwhile): another manager may have changed a role, and the sheet's switches decide from these
 * defaults whether a change creates or removes an exception. Also refetched when the window
 * regains focus, except while a matrix cell is saving: that refetch could land before the save
 * and show the cell's old value until the next one.
 */
export function useRoleDefaults() {
  const orgId = useOrgId()
  const queryClient = useQueryClient()
  return useQuery({
    queryKey: roleKeys.defaults(orgId),
    queryFn: () => fetchRoleDefaults(orgId),
    enabled: orgId !== '',
    staleTime: 0,
    refetchOnWindowFocus: () => queryClient.isMutating({ mutationKey: setRolePermissionKey(orgId) }) === 0,
  })
}

/**
 * « Ce rôle n'existe plus. » (P0001, HINT role_missing): the role was deleted meanwhile (by another
 * manager), or is another clinic's. Whatever showed it is out of date: the roles are refetched.
 */
export function isRoleMissing(error: unknown): boolean {
  return rpcErrorCode(error) === 'P0001' && rpcErrorHint(error) === 'role_missing'
}

/** The roles and their defaults, refetched (a role went missing). */
function refetchRoles(queryClient: QueryClient, orgId: string) {
  return Promise.all([
    queryClient.invalidateQueries({ queryKey: roleKeys.list(orgId) }),
    queryClient.invalidateQueries({ queryKey: roleKeys.defaults(orgId) }),
  ])
}

/**
 * A `42501` means the caller's own rights changed elsewhere (e.g. their users.manage or
 * roles.manage was revoked): their access payload is refetched.
 */
function refreshAccessOnRefusal(queryClient: QueryClient, error: unknown) {
  if (rpcErrorCode(error) === '42501') void queryClient.invalidateQueries({ queryKey: accessKeys.all })
}

/** Refetched each time a sheet opens. */
export function useUserOverrides(userId: string | undefined) {
  return useQuery({
    queryKey: userKeys.overrides(userId ?? ''),
    queryFn: () => fetchUserOverrides(userId ?? ''),
    enabled: userId !== undefined,
    staleTime: 0,
    refetchOnMount: 'always',
  })
}

/** The user's list row and overrides, plus the access payload if the target is the caller (the guards refuse that). */
function invalidateUser(queryClient: QueryClient, userId: string, callerId: string | undefined) {
  const invalidations = [
    queryClient.invalidateQueries({ queryKey: userKeys.list() }),
    queryClient.invalidateQueries({ queryKey: userKeys.overrides(userId) }),
  ]
  if (userId === callerId) invalidations.push(queryClient.invalidateQueries({ queryKey: accessKeys.all }))
  return Promise.all(invalidations)
}

/**
 * The French text of a failed user-admin change. The functions' own refusals (`staff-invite`'s
 * per-caller limit, an unreachable function) have their text; RPC refusals, including those the
 * functions pass on (`asRpcRefusal`), go through `moduleErrorMessage`.
 */
export function userAdminErrorMessage(error: unknown): string {
  if (error instanceof FunctionCallError) {
    if (error.code === 'rate_limited') return t('settings.users.invite.errors.rateLimited')
    if (error.code === 'network') return t('settings.users.invite.errors.network')
  }
  return moduleErrorMessage(error, t('common.errors.generic'), 'settings')
}

/** The toast for a failed user-admin change, and the caller's access after a `42501`. */
function onUserMutationError(queryClient: QueryClient, error: unknown) {
  refreshAccessOnRefusal(queryClient, error)
  toast.error(userAdminErrorMessage(error))
}

/**
 * A role or status change: invalidates the user (awaited, so the mutation stays pending until the
 * fresh state is cached). Toasts live in the mutation options so the outcome shows even if the
 * sheet closes first.
 */
function useUserMutation<V extends { userId: string }>(
  mutationFn: (variables: V) => Promise<void>,
  successMessage: (variables: V) => string,
  onError?: (error: unknown) => void,
) {
  const queryClient = useQueryClient()
  const { access } = useAccess()
  return useMutation({
    mutationFn,
    onSuccess: async (_data, variables) => {
      await invalidateUser(queryClient, variables.userId, access?.user_id)
      toast.success(successMessage(variables))
    },
    onError: (error) => {
      onError?.(error)
      onUserMutationError(queryClient, error)
    },
  })
}

/** A role deleted meanwhile (« Ce rôle n'existe plus. »): the roles are refetched, so the choice goes. */
export function useSetUserRole() {
  const queryClient = useQueryClient()
  const orgId = useOrgId()
  return useUserMutation(
    ({ userId, role }: { userId: string; role: string }) => setUserRole(userId, role),
    () => t('settings.users.sheet.role.saved'),
    (error) => {
      if (isRoleMissing(error)) void refetchRoles(queryClient, orgId)
    },
  )
}

/**
 * « Compte actif » through `users-set-status` (P3-9): disabling also ends the open sessions. When
 * that part failed (`sessionsEnded: false`), the toast warns that they close within the hour. A
 * failed re-enable leaves the account disabled (« Réessayez »); the user is refetched.
 */
export function useSetUserStatus() {
  const queryClient = useQueryClient()
  const { access } = useAccess()
  return useMutation({
    mutationFn: ({ userId, status }: { userId: string; status: UserStatus }) => setUserStatus(userId, status),
    onSuccess: async ({ sessionsEnded }, { userId, status }) => {
      await invalidateUser(queryClient, userId, access?.user_id)
      if (status === 'active') toast.success(t('settings.users.sheet.status.enabledSaved'))
      else if (sessionsEnded) toast.success(t('settings.users.sheet.status.disabledSaved'))
      else toast.warning(t('settings.users.sheet.status.sessionsNotEnded'))
    },
    onError: (error, { userId }) => {
      if (error instanceof FunctionCallError && error.code === 'provider_error') {
        void invalidateUser(queryClient, userId, access?.user_id)
        toast.error(t('settings.users.sheet.status.reenableFailed'))
      } else {
        onUserMutationError(queryClient, error)
      }
    },
  })
}

/**
 * « Rétablir les permissions du rôle »: removes all of the user's overrides (one atomic RPC). A
 * refusal refetches the overrides too: the sheet decided from what it had, which may be stale
 * (another manager may have added a revoke meanwhile).
 */
export function useResetPermissions() {
  const queryClient = useQueryClient()
  const { access } = useAccess()
  return useMutation({
    mutationFn: async ({ userId }: { userId: string }) => {
      await clearPermissionOverrides(userId)
    },
    onSuccess: async (_data, { userId }) => {
      await invalidateUser(queryClient, userId, access?.user_id)
      toast.success(t('settings.users.sheet.permissions.reset.saved'))
    },
    onError: (error, { userId }) => {
      void queryClient.invalidateQueries({ queryKey: userKeys.overrides(userId) })
      onUserMutationError(queryClient, error)
    },
  })
}

/** The key of one user's permission switch saves (useSetPermissionState). */
const permissionStateKey = (userId: string) => [...userKeys.overrides(userId), 'set'] as const

/** Whether a permission switch of this user is still saving (the reset waits for it). */
export function useIsSavingPermission(userId: string) {
  return useIsMutating({ mutationKey: permissionStateKey(userId) }) > 0
}

/** The overrides with `key` set to `state` (removed for `role`). */
function withState(overrides: PermissionOverride[], key: string, state: OverrideState): PermissionOverride[] {
  const others = overrides.filter((o) => o.permission_key !== key)
  return state === 'role' ? others : [...others, { permission_key: key, granted: state === 'granted' }]
}

interface PermissionStateVariables {
  key: string
  state: OverrideState
  /** The effective permission once saved (the role default when `state` is `role`), named in the toast. */
  on: boolean
  /** The permission's description, named in the toast. */
  label: string
}

/**
 * Sets one permission's state: back to the role default (clears the override), granted or revoked.
 * Optimistic: the overrides cache shows the new state at once; on failure only this permission
 * goes back (another row may be saving too).
 *
 * After each change settles, the users list is refetched (its `override_count`): every settle
 * comes after its own write, so the last one to settle always refetches after all of them, even
 * when two settle in the same tick. The overrides are refetched only when no other change for the
 * user is running (a refetch must not overwrite an optimistic state still in flight); if two
 * settle together and both skip it, the cache already holds what they wrote.
 */
export function useSetPermissionState(userId: string) {
  const queryClient = useQueryClient()
  const { access } = useAccess()
  const mutationKey = permissionStateKey(userId)
  return useMutation({
    mutationKey,
    mutationFn: ({ key, state }: PermissionStateVariables) =>
      state === 'role' ? clearPermissionOverride(userId, key) : setPermissionOverride(userId, key, state === 'granted'),
    onMutate: async ({ key, state }) => {
      await queryClient.cancelQueries({ queryKey: userKeys.overrides(userId) })
      const previous = overrideStateOf(key, queryClient.getQueryData<PermissionOverride[]>(userKeys.overrides(userId)) ?? [])
      queryClient.setQueryData<PermissionOverride[]>(userKeys.overrides(userId), (cached) => withState(cached ?? [], key, state))
      return { previous }
    },
    onSuccess: (_data, { label, state, on }) => {
      const value = t(on ? 'settings.users.sheet.permissions.values.on' : 'settings.users.sheet.permissions.values.off')
      toast.success(t(state === 'role' ? 'settings.users.sheet.permissions.saved.role' : 'settings.users.sheet.permissions.saved.exception', { permission: label, value }))
    },
    onError: (error, { key }, context) => {
      if (context) queryClient.setQueryData<PermissionOverride[]>(userKeys.overrides(userId), (cached) => withState(cached ?? [], key, context.previous))
      onUserMutationError(queryClient, error)
    },
    onSettled: async () => {
      const invalidations = [queryClient.invalidateQueries({ queryKey: userKeys.list() })]
      // This mutation still counts as running here, hence `<= 1`.
      if (queryClient.isMutating({ mutationKey }) <= 1) invalidations.push(queryClient.invalidateQueries({ queryKey: userKeys.overrides(userId) }))
      if (userId === access?.user_id) invalidations.push(queryClient.invalidateQueries({ queryKey: accessKeys.all }))
      await Promise.all(invalidations)
    },
  })
}

// ── Roles (decision #40) ────────────────────────────────────────────────────────────────────────

/** The defaults with `role` given `permissionKey` (`granted`) or not. */
function withDefault(defaults: RolePermission[], role: string, permissionKey: string, granted: boolean): RolePermission[] {
  const others = defaults.filter((d) => d.role !== role || d.permission_key !== permissionKey)
  return granted ? [...others, { role, permission_key: permissionKey }] : others
}

export interface RolePermissionVariables {
  role: string
  permissionKey: string
  granted: boolean
  /** The role's label and the permission's description, named in the toast. */
  roleName: string
  permissionLabel: string
}

/** The cells still saving, as `role:permission` (each ignores further toggles until it settles). */
export function usePendingRolePermissions(): Set<string> {
  const orgId = useOrgId()
  const pending = useMutationState({
    filters: { mutationKey: setRolePermissionKey(orgId), status: 'pending' },
    select: (mutation) => mutation.state.variables as RolePermissionVariables | undefined,
  })
  return new Set(pending.flatMap((v) => (v ? [`${v.role}:${v.permissionKey}`] : [])))
}

/**
 * One cell of the role matrix: gives or removes a role's default. Optimistic: the defaults cache
 * shows it at once; on failure only this cell goes back (another may be saving too), with the
 * error toast.
 *
 * Once settled, the defaults are refetched only when no other cell is still saving (a refetch must
 * not overwrite an optimistic state in flight; the last one to settle refetches after all of
 * them). They are what the user sheets read, so the people with this role show their new
 * effective permissions. When the role is the caller's own, their access (`get_my_access`) is
 * refetched too: what they may do has changed. A role deleted meanwhile (« Ce rôle n'existe
 * plus. ») refetches the roles at once, so its column goes; its defaults follow with the others.
 */
export function useSetRolePermission() {
  const queryClient = useQueryClient()
  const { access } = useAccess()
  const orgId = useOrgId()
  const defaultsKey = roleKeys.defaults(orgId)
  const mutationKey = setRolePermissionKey(orgId)
  return useMutation({
    mutationKey,
    mutationFn: ({ role, permissionKey, granted }: RolePermissionVariables) => setRolePermission(role, permissionKey, granted),
    onMutate: async ({ role, permissionKey, granted }) => {
      await queryClient.cancelQueries({ queryKey: defaultsKey })
      const cached = queryClient.getQueryData<RolePermission[]>(defaultsKey) ?? []
      const previous = cached.some((d) => d.role === role && d.permission_key === permissionKey)
      queryClient.setQueryData<RolePermission[]>(defaultsKey, withDefault(cached, role, permissionKey, granted))
      return { previous }
    },
    onSuccess: (_data, { granted, roleName, permissionLabel }) => {
      const value = t(granted ? 'settings.users.sheet.permissions.values.on' : 'settings.users.sheet.permissions.values.off')
      toast.success(t('settings.users.matrix.saved', { permission: permissionLabel, value, role: roleName }))
    },
    onError: (error, { role, permissionKey }, context) => {
      if (context) queryClient.setQueryData<RolePermission[]>(defaultsKey, (cached) => withDefault(cached ?? [], role, permissionKey, context.previous))
      if (isRoleMissing(error)) void queryClient.invalidateQueries({ queryKey: roleKeys.list(orgId) })
      // The toast, and the caller's access after a 42501 (their roles.manage revoked elsewhere).
      onUserMutationError(queryClient, error)
    },
    onSettled: async (_data, _error, { role }) => {
      const invalidations: Promise<void>[] = []
      // This mutation still counts as running here, hence `<= 1`.
      if (queryClient.isMutating({ mutationKey }) <= 1) invalidations.push(queryClient.invalidateQueries({ queryKey: defaultsKey }))
      if (role === access?.role) invalidations.push(queryClient.invalidateQueries({ queryKey: accessKeys.all }))
      await Promise.all(invalidations)
    },
  })
}

/**
 * Creating, renaming and deleting a role. The refusal is shown by the dialog that asked (it stays
 * open while the mutation runs); success is a toast. Whatever the outcome, the touched queries are
 * refetched before the mutation settles, so the dialog closes onto the updated table (a refusal
 * often means another manager changed the roles meanwhile); « Ce rôle n'existe plus. » refetches
 * the roles and their defaults. A `42501` refreshes the caller's access as well.
 */
function useRoleMutation<TVariables, TData>(
  mutationFn: (variables: TVariables) => Promise<TData>,
  {
    touches,
    successMessage,
  }: { touches: (orgId: string, variables: TVariables) => (readonly unknown[])[]; successMessage: (variables: TVariables) => string },
) {
  const queryClient = useQueryClient()
  const orgId = useOrgId()
  return useMutation({
    mutationFn,
    onSuccess: (_data, variables) => {
      toast.success(successMessage(variables))
    },
    onError: (error) => refreshAccessOnRefusal(queryClient, error),
    onSettled: (_data, error, variables) => {
      const queryKeys = touches(orgId, variables)
      if (isRoleMissing(error)) queryKeys.push(roleKeys.list(orgId), roleKeys.defaults(orgId))
      // Each once: a second invalidation of the same query would cancel and restart its refetch.
      const unique = new Map(queryKeys.map((queryKey) => [hashKey(queryKey), queryKey]))
      return Promise.all([...unique.values()].map((queryKey) => queryClient.invalidateQueries({ queryKey })))
    },
  })
}

/** A new custom role (its key is returned): the roles, and the defaults when it copies another role. */
export function useCreateRole() {
  return useRoleMutation(({ name, copyFrom }: { name: string; copyFrom: string | null }) => createRole(name, copyFrom), {
    touches: (orgId, { copyFrom }) => (copyFrom === null ? [roleKeys.list(orgId)] : [roleKeys.list(orgId), roleKeys.defaults(orgId)]),
    successMessage: ({ name }) => t('settings.users.roleDialog.created', { name }),
  })
}

/** A new name: the roles, and the users list (its `role_name`). */
export function useRenameRole() {
  return useRoleMutation(({ role, name }: { role: string; name: string }) => renameRole(role, name), {
    touches: (orgId) => [roleKeys.list(orgId), userKeys.list()],
    successMessage: ({ name }) => t('settings.users.roleDialog.renamed', { name }),
  })
}

/** A deleted custom role (nobody had it): the roles, and the defaults (deleted with it). */
export function useDeleteRole() {
  return useRoleMutation(({ role }: { role: string; name: string }) => deleteRole(role), {
    touches: (orgId) => [roleKeys.list(orgId), roleKeys.defaults(orgId)],
    successMessage: ({ name }) => t('settings.users.roleDelete.deleted', { name }),
  })
}


// ── Staff invitations (Task 3.22) ───────────────────────────────────────────────────────────────

/** The pending invitations (users.view); always fresh on mount, like the users. */
export function useStaffInvitations() {
  return useQuery({ queryKey: userKeys.invitations(), queryFn: listStaffInvitations, staleTime: 0 })
}

const EMAIL_PROBLEMS = ['not_configured', 'rate_limited', 'provider_error', 'invalid_request'] as const
const isKnownEmailProblem = (code: string): code is (typeof EMAIL_PROBLEMS)[number] => (EMAIL_PROBLEMS as readonly string[]).includes(code)

/** Why an invitation's email did not leave (`InvitationSendResult.emailProblem`). */
export function emailProblemText(code: string): string {
  return t(`settings.users.invite.emailProblems.${isKnownEmailProblem(code) ? code : 'other'}`)
}

/**
 * The invitations are refetched once an invitation change settles; after a refusal the users too
 * (« Cette personne a déjà un accès. », « … n'est plus en attente. »: someone accepted meanwhile).
 */
function refetchInvitations(queryClient: QueryClient, error: unknown) {
  const invalidations = [queryClient.invalidateQueries({ queryKey: userKeys.invitations() })]
  if (error) invalidations.push(queryClient.invalidateQueries({ queryKey: userKeys.list() }))
  return Promise.all(invalidations)
}

/**
 * « Inviter ». The dialog shows a refusal (it stays open); success is a toast, a warning when the
 * invitation was created but its email failed (« Renvoyer » then sends it).
 */
export function useInviteStaff() {
  const queryClient = useQueryClient()
  return useMutation({
    mutationFn: (input: { email: string; displayName: string; role: string }) => inviteStaff(input),
    onSuccess: ({ emailProblem }, { email }) => {
      if (emailProblem === null) toast.success(t('settings.users.invite.sent', { email }))
      else toast.warning(t('settings.users.invite.createdNotSent'), { description: emailProblemText(emailProblem) })
    },
    onError: (error) => refreshAccessOnRefusal(queryClient, error),
    onSettled: (_data, error) => refetchInvitations(queryClient, error),
  })
}

/**
 * « Renvoyer »: a new link, by email. The previous link stops working either way, so a failed
 * email is an error toast that says so.
 */
export function useResendInvitation() {
  const queryClient = useQueryClient()
  return useMutation({
    mutationFn: ({ id }: { id: string; email: string }) => resendInvitation(id),
    onSuccess: ({ emailProblem }, { email }) => {
      if (emailProblem === null) toast.success(t('settings.users.invitations.resent', { email }))
      else toast.error(t('settings.users.invitations.resendNotSent'), { description: emailProblemText(emailProblem) })
    },
    onError: (error) => onUserMutationError(queryClient, error),
    onSettled: (_data, error) => refetchInvitations(queryClient, error),
  })
}

/** « Révoquer » (after its confirmation): the invitation and its link. */
export function useRevokeInvitation() {
  const queryClient = useQueryClient()
  return useMutation({
    mutationFn: ({ id }: { id: string }) => revokeInvitation(id),
    onSuccess: () => {
      toast.success(t('settings.users.invitations.revoked'))
    },
    onError: (error) => onUserMutationError(queryClient, error),
    onSettled: (_data, error) => refetchInvitations(queryClient, error),
  })
}
