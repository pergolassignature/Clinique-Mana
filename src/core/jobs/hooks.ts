import { useEffect } from 'react'
import { useInfiniteQuery, useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { t } from '@/i18n'
import { moduleErrorMessage } from '@/core/modules/errors'
import { toast } from '@/shared/ui/sonner'
import {
  JOB_RUNS_PAGE_SIZE,
  listScheduledJobRuns,
  listScheduledJobs,
  runScheduledJobNow,
  setScheduledJobEnabled,
  type JobRunsCursor,
} from './api'

export const jobKeys = {
  all: ['scheduled-jobs'] as const,
  list: () => [...jobKeys.all, 'list'] as const,
  runs: () => [...jobKeys.all, 'runs'] as const,
}

/** The org's jobs. Always stale: a run may have finished since the page was last open. */
export function useScheduledJobs() {
  return useQuery({ queryKey: jobKeys.list(), queryFn: listScheduledJobs, staleTime: 0 })
}

/**
 * « Dernières exécutions », page by page, newest first (keyset on `started_at`, `id`). A full page
 * means there may be more. Like the audit journal: always stale, removed on unmount so a return
 * loads one fresh page, no refetch on window focus (it would reload every page loaded).
 */
export function useScheduledJobRuns() {
  const queryClient = useQueryClient()
  useEffect(() => () => queryClient.removeQueries({ queryKey: jobKeys.runs() }), [queryClient])
  return useInfiniteQuery({
    queryKey: jobKeys.runs(),
    queryFn: ({ pageParam }) => listScheduledJobRuns(pageParam),
    initialPageParam: null as JobRunsCursor | null,
    getNextPageParam: (lastPage): JobRunsCursor | undefined => {
      const last = lastPage[lastPage.length - 1]
      return lastPage.length === JOB_RUNS_PAGE_SIZE && last ? { before: last.started_at, beforeId: last.id } : undefined
    },
    staleTime: 0,
    gcTime: 0,
    refetchOnWindowFocus: false,
  })
}

/**
 * Switches a business job. The toasts live in the mutation options, so the outcome shows even if
 * the page unmounts before the server answers.
 */
export function useSetScheduledJobEnabled() {
  const queryClient = useQueryClient()
  return useMutation({
    mutationFn: ({ key, enabled }: { key: string; enabled: boolean }) => setScheduledJobEnabled(key, enabled),
    onSuccess: async (_data, { enabled }) => {
      // Awaited: the switch stays inactive until the saved state is in the cache.
      await queryClient.invalidateQueries({ queryKey: jobKeys.list() })
      toast.success(enabled ? t('settings.jobs.enabledToast') : t('settings.jobs.disabledToast'))
    },
    onError: (error) => {
      toast.error(moduleErrorMessage(error, t('settings.jobs.toggleError'), 'settings'))
    },
  })
}

/** « Exécuter maintenant »: then the list (last run) and the runs reload. */
export function useRunScheduledJobNow() {
  const queryClient = useQueryClient()
  return useMutation({
    mutationFn: (key: string) => runScheduledJobNow(key),
    onSuccess: () => {
      toast.success(t('settings.jobs.started'))
      void queryClient.invalidateQueries({ queryKey: jobKeys.all })
    },
    onError: (error) => {
      toast.error(moduleErrorMessage(error, t('settings.jobs.runError'), 'settings'))
    },
  })
}
