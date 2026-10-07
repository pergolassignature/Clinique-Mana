import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { t } from '@/i18n'
import { accessKeys } from '@/core/access/access-context'
import { moduleErrorMessage } from '@/core/modules/errors'
import { toast } from '@/shared/ui/sonner'
import { fetchOrganization, updateOrganization, type OrganizationUpdate } from './api'

export const organizationKeys = {
  all: ['organization'] as const,
  current: () => [...organizationKeys.all, 'current'] as const,
}

export function useOrganization() {
  return useQuery({ queryKey: organizationKeys.current(), queryFn: fetchOrganization })
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
    onSuccess: async (_saved, { patch }) => {
      const touchesAccess = patch.name !== undefined || patch.timezone !== undefined
      // Awaited: the mutation stays pending until the fresh values are in the cache.
      await Promise.all([
        queryClient.invalidateQueries({ queryKey: organizationKeys.all }),
        touchesAccess && queryClient.invalidateQueries({ queryKey: accessKeys.all }),
      ])
      toast.success(successMessage)
    },
    onError: (error) => {
      toast.error(moduleErrorMessage(error, t('common.errors.generic'), 'settings'))
    },
  })
}
