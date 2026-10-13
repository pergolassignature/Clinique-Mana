import { useInfiniteQuery, useMutation, useQuery, useQueryClient, type InfiniteData } from '@tanstack/react-query'
import { t } from '@/i18n'
import { toast } from '@/shared/ui/sonner'
import {
  getMailThread,
  listMailLabels,
  listMailThreads,
  modifyMailThreads,
  THREAD_PAGE_SIZE,
  type MailAction,
  type MailThread,
  type MailThreadRow,
  type ThreadCursor,
  type ThreadListQuery,
} from '../api/inbox'
import { communicationsErrorMessage } from '../api/errors'
import { mailKeys } from './keys'

/** The threads of one view, page by page, newest first (keyset on last_message_at, id). */
export function useMailThreads(query: ThreadListQuery | null) {
  return useInfiniteQuery({
    queryKey: query ? mailKeys.threadList(query) : [...mailKeys.threadLists(), 'none'],
    queryFn: ({ pageParam }) => listMailThreads(query!, pageParam),
    initialPageParam: null as ThreadCursor | null,
    getNextPageParam: (lastPage): ThreadCursor | undefined => {
      const last = lastPage[lastPage.length - 1]
      return lastPage.length === THREAD_PAGE_SIZE && last ? { before: last.last_message_at, beforeId: last.id } : undefined
    },
    enabled: query !== null,
    // New mail arrives through the sync: a return to the page reads the list again.
    staleTime: 30_000,
  })
}

/** One thread with its messages. */
export function useMailThread(threadId: string | null) {
  return useQuery({
    queryKey: mailKeys.thread(threadId ?? ''),
    queryFn: () => getMailThread(threadId!),
    enabled: threadId !== null,
  })
}

/** The mailbox's user labels (the left pane). */
export function useMailLabels(connectionId: string | null) {
  return useQuery({
    queryKey: mailKeys.labels(connectionId ?? ''),
    queryFn: () => listMailLabels(connectionId!),
    enabled: connectionId !== null,
    staleTime: 5 * 60_000,
  })
}

/** The labels a thread carries once `action` applied (what the list and the thread show at once). */
export function labelsAfter(labels: readonly string[], action: MailAction): string[] {
  const set = new Set(labels)
  switch (action.kind) {
    case 'read':
      set.delete('UNREAD')
      break
    case 'unread':
      set.add('UNREAD')
      break
    case 'archive':
      set.delete('INBOX')
      break
    case 'inbox':
      set.add('INBOX')
      break
    case 'star':
      set.add('STARRED')
      break
    case 'unstar':
      set.delete('STARRED')
      break
    case 'label':
      set.add(action.label_id)
      break
    case 'unlabel':
      set.delete(action.label_id)
      break
  }
  return [...set]
}

function applyToRow(row: MailThreadRow, action: MailAction): MailThreadRow {
  const unread = action.kind === 'read' ? 0 : action.kind === 'unread' ? Math.max(row.unread_count, 1) : row.unread_count
  return { ...row, label_ids: labelsAfter(row.label_ids, action), unread_count: unread }
}

function applyToThread(thread: MailThread, action: MailAction): MailThread {
  const last = thread.messages.length - 1
  return {
    ...thread,
    label_ids: labelsAfter(thread.label_ids, action),
    unread_count: action.kind === 'read' ? 0 : action.kind === 'unread' ? Math.max(thread.unread_count, 1) : thread.unread_count,
    messages: thread.messages.map((m, i) =>
      action.kind === 'read'
        ? { ...m, is_unread: false }
        : action.kind === 'unread' && i === last
          ? { ...m, is_unread: true }
          : m,
    ),
  }
}

/**
 * An action on threads (`gmail-modify`), optimistic: the lists and the open thread show the
 * result at once and roll back if Gmail refuses (a French toast says why). Once settled, the
 * lists, the threads and the mailboxes' unread counts are read again: that is when an archived
 * thread leaves « Boîte de réception », and when threads named in a partial answer's `failed`
 * show their real state again. Actions run one after the other (one mutation scope), so a
 * rollback never undoes a later action and Gmail receives them in order.
 */
export function useMailAction({ silent = false }: { silent?: boolean } = {}) {
  const queryClient = useQueryClient()
  return useMutation({
    scope: { id: 'communications-mail-action' },
    mutationFn: ({ threadIds, action }: { threadIds: string[]; action: MailAction }) => modifyMailThreads(threadIds, action),
    onMutate: async ({ threadIds, action }) => {
      // Only what the action rewrites: a list page still loading elsewhere keeps loading.
      await Promise.all([
        queryClient.cancelQueries({ queryKey: mailKeys.threadLists() }),
        ...threadIds.map((id) => queryClient.cancelQueries({ queryKey: mailKeys.thread(id) })),
      ])
      const lists = queryClient.getQueriesData<InfiniteData<MailThreadRow[]>>({ queryKey: mailKeys.threadLists() })
      const threads = threadIds.map((id) => [id, queryClient.getQueryData<MailThread | null>(mailKeys.thread(id))] as const)
      const ids = new Set(threadIds)
      queryClient.setQueriesData<InfiniteData<MailThreadRow[]>>({ queryKey: mailKeys.threadLists() }, (data) =>
        data ? { ...data, pages: data.pages.map((page) => page.map((row) => (ids.has(row.id) ? applyToRow(row, action) : row))) } : data,
      )
      for (const [id, thread] of threads) {
        if (thread) queryClient.setQueryData(mailKeys.thread(id), applyToThread(thread, action))
      }
      return { lists, threads }
    },
    onSuccess: ({ failed }) => {
      if (silent || failed.length === 0) return
      toast.error(
        failed.length === 1
          ? t('modules.communications.inbox.actionPartialOne')
          : t('modules.communications.inbox.actionPartialOther', { count: String(failed.length) }),
      )
    },
    onError: (error, _vars, context) => {
      for (const [key, data] of context?.lists ?? []) queryClient.setQueryData(key, data)
      for (const [id, thread] of context?.threads ?? []) queryClient.setQueryData(mailKeys.thread(id), thread)
      if (!silent) toast.error(communicationsErrorMessage(error))
    },
    onSettled: (_data, _error, { threadIds }) =>
      Promise.all([
        queryClient.invalidateQueries({ queryKey: mailKeys.threadLists() }),
        queryClient.invalidateQueries({ queryKey: mailKeys.connections() }),
        ...threadIds.map((id) => queryClient.invalidateQueries({ queryKey: mailKeys.thread(id) })),
      ]),
  })
}
