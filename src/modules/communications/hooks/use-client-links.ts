import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { t } from '@/i18n'
import { toast } from '@/shared/ui/sonner'
import { FILE_SEARCH_MIN_CHARS, getMailThreadLink, linkMailThread, searchFiles, unlinkMailThread } from '../api/client-links'
import { communicationsErrorMessage } from '../api/errors'
import { mailKeys } from './keys'

/** The thread's file (CM2b), read only when the person may see files (`clients.view`). */
export function useMailThreadLink(threadId: string, enabled: boolean) {
  return useQuery({
    queryKey: mailKeys.threadLink(threadId),
    queryFn: () => getMailThreadLink(threadId),
    enabled,
  })
}

/** The files matching what is typed (two characters at least), the previous request cancelled. */
export function useFileSearch(query: string) {
  const trimmed = query.trim()
  return useQuery({
    queryKey: mailKeys.fileSearch(trimmed),
    queryFn: ({ signal }) => searchFiles(trimmed, signal),
    enabled: trimmed.length >= FILE_SEARCH_MIN_CHARS,
    staleTime: 30_000,
  })
}

/** « Rattacher » (a file id) or « Détacher » (null); then the link and the lists are read again. */
export function useSetThreadLink(threadId: string) {
  const queryClient = useQueryClient()
  return useMutation({
    mutationFn: (clientId: string | null) => (clientId ? linkMailThread(threadId, clientId) : unlinkMailThread(threadId)),
    onSuccess: (_data, clientId) => {
      toast.success(clientId ? t('modules.communications.inbox.link.linkedToast') : t('modules.communications.inbox.link.unlinkedToast'))
    },
    onError: (error) => toast.error(communicationsErrorMessage(error)),
    onSettled: () =>
      Promise.all([
        queryClient.invalidateQueries({ queryKey: mailKeys.threadLink(threadId) }),
        queryClient.invalidateQueries({ queryKey: mailKeys.threadLists() }),
      ]),
  })
}
