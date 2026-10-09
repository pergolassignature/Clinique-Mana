import { useEffect, useRef } from 'react'
import { useInfiniteQuery, useMutation, useMutationState, useQuery, useQueryClient } from '@tanstack/react-query'
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
  /** Mutation key of « Exécuter maintenant » (see useRunningScheduledJobs). */
  run: () => [...jobKeys.all, 'run'] as const,
}

/**
 * After a run starts, the list and the runs reload once more after this delay: a function job runs
 * asynchronously (pg_net → Edge Function), so its run row may not exist yet at the first reload.
 */
const RUN_REFRESH_DELAY_MS = 4000

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

/**
 * « Exécuter maintenant »: then the list (last run) and the runs reload, and again after
 * RUN_REFRESH_DELAY_MS while the page is mounted (the timers are cleared on unmount).
 */
export function useRunScheduledJobNow() {
  const queryClient = useQueryClient()
  const mounted = useRef(false)
  const timers = useRef(new Set<ReturnType<typeof setTimeout>>())
  useEffect(() => {
    mounted.current = true
    const pending = timers.current
    return () => {
      mounted.current = false
      for (const timer of pending) clearTimeout(timer)
      pending.clear()
    }
  }, [])
  return useMutation({
    mutationKey: jobKeys.run(),
    mutationFn: (key: string) => runScheduledJobNow(key),
    onSuccess: () => {
      toast.success(t('settings.jobs.started'))
      void queryClient.invalidateQueries({ queryKey: jobKeys.all })
      // A run that ends after the page has gone schedules nothing.
      if (!mounted.current) return
      const timer = setTimeout(() => {
        timers.current.delete(timer)
        void queryClient.invalidateQueries({ queryKey: jobKeys.all })
      }, RUN_REFRESH_DELAY_MS)
      timers.current.add(timer)
    },
    onError: (error) => {
      toast.error(moduleErrorMessage(error, t('settings.jobs.runError'), 'settings'))
    },
  })
}

/**
 * The keys of the jobs whose « Exécuter maintenant » is still pending, all of them: starting job B
 * while A is pending keeps A inactive (a single mutation's `variables` would only hold B).
 */
export function useRunningScheduledJobs(): ReadonlySet<string> {
  const keys = useMutationState({
    filters: { mutationKey: jobKeys.run(), status: 'pending' },
    select: (mutation) => mutation.state.variables as string,
  })
  return new Set(keys)
}
