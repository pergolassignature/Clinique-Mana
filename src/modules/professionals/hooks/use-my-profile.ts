import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { fetchMyProfessionalRecord, startMyProfileUpdate } from '../api/self'
import type { SubmissionSection } from '../lib/constants'
import { professionalKeys } from './keys'

/** « Mon profil »: the signed-in professional's own record (null: no file linked to the account). */
export function useMyProfessionalRecord() {
  return useQuery({ queryKey: professionalKeys.myRecord(), queryFn: fetchMyProfessionalRecord })
}

/**
 * « Mettre mon profil à jour »: opens an update submission for the sections chosen; the page then
 * goes to the questionnaire. Done or refused, the open submission is read again (a refusal usually
 * means one is already open, or the file became inactive).
 */
export function useStartMyProfileUpdate() {
  const queryClient = useQueryClient()
  return useMutation({
    mutationFn: (sections: readonly SubmissionSection[]) => startMyProfileUpdate(sections),
    onSettled: () =>
      Promise.all([
        queryClient.invalidateQueries({ queryKey: professionalKeys.mySubmission() }),
        queryClient.invalidateQueries({ queryKey: professionalKeys.myRecord() }),
      ]),
  })
}
