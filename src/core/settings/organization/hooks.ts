import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { t } from '@/i18n'
import { accessKeys } from '@/core/access/access-context'
import { moduleErrorMessage } from '@/core/modules/errors'
import { toast } from '@/shared/ui/sonner'
import { fetchOrganization, updateOrganization, type Organization, type OrganizationUpdate } from './api'

export const organizationKeys = {
  all: ['organization'] as const,
  current: () => [...organizationKeys.all, 'current'] as const,
}

/**
 * Whether timestamp `a` is a later instant than `b`. Parsed, so differing UTC offsets compare by
 * instant (millisecond precision); the strings are compared only when either does not parse.
 */
function newer(a: string, b: string): boolean {
  const ta = Date.parse(a)
  const tb = Date.parse(b)
  return Number.isNaN(ta) || Number.isNaN(tb) ? a > b : ta > tb
}

export function useOrganization() {
  // Fresh for a minute: a background refetch (window focus, another card mounting) must not
  // re-sync the cards' `values` while someone is typing.
  return useQuery({ queryKey: organizationKeys.current(), queryFn: fetchOrganization, staleTime: 60_000 })
}

/**
 * Saves one settings card and resolves with the saved organization.
 *
 * Invalidates the organization and, when the patch touches `name` or `timezone`, the access
 * payload too: the shell shows the name and the clinic timezone comes from `get_my_access`.
 * The toasts live in the mutation options so the outcome shows even if the page unmounts first.
 */
export function useUpdateOrganization(successMessage: string) {
  const queryClient = useQueryClient()
  return useMutation({
    mutationFn: ({ id, patch }: { id: string; patch: OrganizationUpdate }) => updateOrganization(id, patch),
    onSuccess: async (saved, { patch }) => {
      // The saved row is the truth: cache it at once, unless a later save already answered (two
      // cards saved in turn, the first answering last). The organization queries are only marked
      // stale (no second request); the access payload derived from name/timezone is refetched.
      queryClient.setQueryData<Organization>(organizationKeys.current(), (cached) =>
        cached && newer(cached.updated_at, saved.updated_at) ? cached : saved,
      )
      const invalidations = [queryClient.invalidateQueries({ queryKey: organizationKeys.all, refetchType: 'none' })]
      if (patch.name !== undefined || patch.timezone !== undefined) {
        invalidations.push(queryClient.invalidateQueries({ queryKey: accessKeys.all }))
      }
      // Awaited: the mutation stays pending until the fresh values are in the cache. A failed
      // refetch does not reject (invalidateQueries swallows it), so the save is still confirmed.
      await Promise.all(invalidations)
      toast.success(successMessage)
    },
    onError: (error) => {
      toast.error(moduleErrorMessage(error, t('common.errors.generic'), 'settings'))
    },
  })
}
