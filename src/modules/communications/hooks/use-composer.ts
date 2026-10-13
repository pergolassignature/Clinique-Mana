import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import {
  deleteDraft,
  deleteTemplate,
  getComposeContext,
  getDraft,
  listClientThreads,
  listDrafts,
  listTemplates,
  saveDraft,
  saveTemplate,
  sendMail,
  type DraftContent,
} from '../api/composer'
import { mailKeys } from './keys'

/** The caller's drafts (« Brouillons »). */
export function useDrafts(enabled = true) {
  return useQuery({ queryKey: mailKeys.drafts(), queryFn: listDrafts, enabled })
}

/** One draft, read once when the composer opens it (then the composer holds it). */
export function useDraft(id: string | null) {
  return useQuery({
    queryKey: mailKeys.draft(id ?? ''),
    queryFn: () => getDraft(id!),
    enabled: id !== null,
    staleTime: Infinity,
    gcTime: 0,
  })
}

/** The autosave: one save at a time (a mutation scope), the list read again after. */
export function useSaveDraft() {
  const queryClient = useQueryClient()
  return useMutation({
    scope: { id: 'communications-draft-save' },
    mutationFn: ({ id, content }: { id: string | null; content: DraftContent }) => saveDraft(id, content),
    onSettled: () => queryClient.invalidateQueries({ queryKey: mailKeys.drafts(), exact: true }),
  })
}

export function useDeleteDraft() {
  const queryClient = useQueryClient()
  return useMutation({
    mutationFn: deleteDraft,
    onSettled: () => queryClient.invalidateQueries({ queryKey: mailKeys.drafts(), exact: true }),
  })
}

/** The clinic's templates and the caller's own. */
export function useTemplates(enabled = true) {
  return useQuery({ queryKey: mailKeys.templates(), queryFn: listTemplates, enabled, staleTime: 5 * 60_000 })
}

export function useSaveTemplate() {
  const queryClient = useQueryClient()
  return useMutation({
    mutationFn: ({ id, name, subject, bodyHtml }: { id: string | null; name: string; subject: string; bodyHtml: string }) =>
      saveTemplate(id, name, subject, bodyHtml),
    onSettled: () => queryClient.invalidateQueries({ queryKey: mailKeys.templates() }),
  })
}

export function useDeleteTemplate() {
  const queryClient = useQueryClient()
  return useMutation({
    mutationFn: deleteTemplate,
    onSettled: () => queryClient.invalidateQueries({ queryKey: mailKeys.templates() }),
  })
}

/** « Écrire un courriel » from a record: the file and its addresses. */
export function useComposeContext(clientId: string | null) {
  return useQuery({
    queryKey: mailKeys.composeContext(clientId ?? ''),
    queryFn: () => getComposeContext(clientId!),
    enabled: clientId !== null,
  })
}

/** The threads linked to a file (its record's « Courriels »). */
export function useClientThreads(clientId: string) {
  return useQuery({ queryKey: mailKeys.clientThreadList(clientId), queryFn: () => listClientThreads(clientId) })
}

/** The send (after the countdown). Then the lists, the thread, the drafts and the record read again. */
export function useSendMail() {
  const queryClient = useQueryClient()
  return useMutation({
    mutationFn: ({ sendKey, draftId, content }: { sendKey: string; draftId: string | null; content: DraftContent }) =>
      sendMail(sendKey, draftId, content),
    onSettled: () =>
      Promise.all([
        queryClient.invalidateQueries({ queryKey: mailKeys.threads() }),
        queryClient.invalidateQueries({ queryKey: mailKeys.drafts() }),
        queryClient.invalidateQueries({ queryKey: mailKeys.clientThreads() }),
        queryClient.invalidateQueries({ queryKey: mailKeys.connections() }),
      ]),
  })
}
