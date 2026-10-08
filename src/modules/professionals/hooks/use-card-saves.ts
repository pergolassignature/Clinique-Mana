import type { ProfessionalPatch, PublicProfilePatch } from '../api/record'
import type { MutationFeedback } from './mutation-feedback'
import { useSetPayerNumber, useUpdateProfessional, useUpdatePublicProfile } from './use-professional-mutations'

/** What a record card needs from its mutation: write the card's output, then call `onSaved`. */
export interface CardSave<TOut> {
  save: (data: TOut, onSaved: () => void) => void
  pending: boolean
}

/**
 * A record card's save: one mutation hook of `use-professional-mutations`, adapted to the card's
 * schema output. Defined at module level, so a card calls the same hook on every render. The
 * feedback is the card's: a refusal its HINT ties to a field goes under that field.
 */
export type UseCardSave<TOut> = (id: string, feedback: MutationFeedback) => CardSave<TOut>

// `mutate` with a per-call onSuccess (not `mutateAsync`): the hook's callbacks show the toasts,
// and a failed save never becomes an unhandled rejection.

/** Identité, Coordonnées, Expérience: column-granted fields of `professionals`. */
export const useSaveProfessionalFields: UseCardSave<ProfessionalPatch> = (id, feedback) => {
  const mutation = useUpdateProfessional(feedback)
  return { save: (patch, onSaved) => mutation.mutate({ id, patch }, { onSuccess: onSaved }), pending: mutation.isPending }
}

/** Portrait and Coordonnées publiques. */
export const useSavePublicProfile: UseCardSave<PublicProfilePatch> = (id, feedback) => {
  const mutation = useUpdatePublicProfile(feedback)
  return { save: (patch, onSaved) => mutation.mutate({ id, patch }, { onSuccess: onSaved }), pending: mutation.isPending }
}

/** Numéros de payeurs: the IVAC number; null deletes it. */
export const useSaveIvac: UseCardSave<{ ivac: string | null }> = (id, feedback) => {
  const mutation = useSetPayerNumber(feedback)
  return {
    save: ({ ivac }, onSaved) => mutation.mutate({ id, type: 'ivac', number: ivac }, { onSuccess: onSaved }),
    pending: mutation.isPending,
  }
}
