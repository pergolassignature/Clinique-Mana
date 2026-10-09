import { useMutation, useQueryClient } from '@tanstack/react-query'
import { t } from '@/i18n'
import { toast } from '@/shared/ui/sonner'
import { reorderedCatalog, reorderReference, saveReference, setReferenceActive, type ReferenceInput, type ReferenceKind } from '../api/catalog'
import type { ProfessionalsCatalog } from '../api/parse'
import { professionalCatalogKeys, professionalKeys } from './keys'
import { showMutationError, type MutationFeedback } from './mutation-feedback'

/**
 * The settings lists' changes (`professionals.settings`). Records and list rows hold ids only, so a
 * rename refreshes the catalogue alone; what changes readiness (a title's order, a motif's
 * restriction, archiving) also refreshes every professional query (see `keys.ts`).
 */

/**
 * Lists whose saved rules feed readiness: a title's order (licence), a motif's restriction, a
 * document type's « Requis » and expiry rule (« Documents requis », 4c.3).
 */
const READINESS_KINDS: ReadonlySet<ReferenceKind> = new Set(['profession_titles', 'motifs', 'document_types'])

/** Variables of `useSaveReference`: a kind and its input, kept together for type safety. */
export type SaveReferenceVariables = { [K in ReferenceKind]: { kind: K; input: ReferenceInput<K> } }[ReferenceKind]

/** Creates or updates a row; resolves with its id. The dialog shows refusals (`onErrorMessage`). */
export function useSaveReference(feedback?: MutationFeedback) {
  const queryClient = useQueryClient()
  return useMutation({
    mutationFn: ({ kind, input }: SaveReferenceVariables) => saveReference(kind, input as ReferenceInput<typeof kind>),
    onSuccess: async (_, { kind }) => {
      await Promise.all([
        queryClient.invalidateQueries({ queryKey: professionalCatalogKeys.all }),
        READINESS_KINDS.has(kind) && queryClient.invalidateQueries({ queryKey: professionalKeys.all }),
      ])
      toast.success(t('modules.professionals.toasts.saved'))
    },
    onError: (error) => showMutationError(queryClient, error, feedback),
  })
}

/** Archives (`active` false) or restores a row. */
export function useSetReferenceActive(feedback?: MutationFeedback) {
  const queryClient = useQueryClient()
  return useMutation({
    mutationFn: ({ kind, id, active }: { kind: ReferenceKind; id: string; active: boolean }) => setReferenceActive(kind, id, active),
    onSuccess: async (_, { active }) => {
      await Promise.all([
        queryClient.invalidateQueries({ queryKey: professionalCatalogKeys.all }),
        queryClient.invalidateQueries({ queryKey: professionalKeys.all }),
      ])
      toast.success(t(active ? 'modules.professionals.toasts.restored' : 'modules.professionals.toasts.archived'))
    },
    onError: (error) => showMutationError(queryClient, error, feedback),
  })
}

/**
 * Saves a list's order (`ids`: every row, archived ones included). Optimistic: the cached
 * catalogue takes the new order at once (the « Monter / Descendre » buttons answer instantly) and
 * is rolled back if the save fails; either way the catalogue is refetched. No success toast.
 */
export function useReorderReference(feedback?: MutationFeedback) {
  const queryClient = useQueryClient()
  const key = professionalCatalogKeys.catalog()
  return useMutation({
    mutationFn: ({ kind, ids }: { kind: ReferenceKind; ids: string[] }) => reorderReference(kind, ids),
    onMutate: async ({ kind, ids }) => {
      // A refetch landing after the optimistic write would show the old order for a moment.
      await queryClient.cancelQueries({ queryKey: key })
      const previous = queryClient.getQueryData<ProfessionalsCatalog>(key)
      if (previous) queryClient.setQueryData(key, reorderedCatalog(previous, kind, ids))
      return { previous }
    },
    onError: (error, _, context) => {
      if (context?.previous) queryClient.setQueryData(key, context.previous)
      showMutationError(queryClient, error, feedback)
    },
    onSettled: () => queryClient.invalidateQueries({ queryKey: key }),
  })
}
