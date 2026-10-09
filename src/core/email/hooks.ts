import { useEffect } from 'react'
import { keepPreviousData, useInfiniteQuery, useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { t } from '@/i18n'
import { useReadyAccess } from '@/core/access/access-context'
import { moduleErrorMessage } from '@/core/modules/errors'
import { useDebouncedValue } from '@/shared/lib/use-debounced-value'
import { toast } from '@/shared/ui/sonner'
import {
  EMAIL_LOG_PAGE_SIZE,
  fetchEmailSender,
  lastWebhookEventAt,
  listEmailLog,
  listEmailTemplates,
  previewEmail,
  resetEmailTemplate,
  saveEmailTemplate,
  sendTestEmail,
  setEmailSender,
  setEmailSendingDomain,
  type EmailLogCursor,
  type EmailLogFilters,
  type EmailSenderUpdate,
  type EmailTemplateDraft,
} from './api'
import { emailErrorMessage } from './errors'

/**
 * The email settings' reads. Saves invalidate `all` (CLAUDE.md §8): the sender, the templates,
 * the log and the last event are cheap reads.
 */
export const emailKeys = {
  all: ['email'] as const,
  sender: () => [...emailKeys.all, 'sender'] as const,
  templates: () => [...emailKeys.all, 'templates'] as const,
  logs: () => [...emailKeys.all, 'log'] as const,
  log: (filters: EmailLogFilters) => [...emailKeys.logs(), filters] as const,
  lastEvent: () => [...emailKeys.all, 'last-event', 'resend'] as const,
}

/**
 * The previews have their own root, like the permission catalogue: no save touches them, so a save
 * never re-renders the open editor's preview through `email-preview` (one render call each). A
 * draft's preview is keyed by its text: an edit asks for a new one anyway.
 */
export const emailPreviewKeys = {
  all: ['email-preview'] as const,
  /** A draft's preview, by template and a hash of the draft. */
  draft: (key: string, draftHash: string) => [...emailPreviewKeys.all, key, draftHash] as const,
}

/** The preview waits this long after the last keystroke (one call per pause, not per key). */
const PREVIEW_DEBOUNCE_MS = 400

/** cyrb53: a 53-bit string hash, so a 10 000-character draft is not kept whole in the query key. */
function hash(text: string): string {
  let h1 = 0xdeadbeef
  let h2 = 0x41c6ce57
  for (let i = 0; i < text.length; i++) {
    const c = text.charCodeAt(i)
    h1 = Math.imul(h1 ^ c, 2654435761)
    h2 = Math.imul(h2 ^ c, 1597334677)
  }
  h1 = Math.imul(h1 ^ (h1 >>> 16), 2246822507) ^ Math.imul(h2 ^ (h2 >>> 13), 3266489909)
  h2 = Math.imul(h2 ^ (h2 >>> 16), 2246822507) ^ Math.imul(h1 ^ (h1 >>> 13), 3266489909)
  return (4294967296 * (2097151 & h2) + (h1 >>> 0)).toString(36)
}

/** The sender of the caller's org. Fresh for a minute, so a refetch does not re-sync a card being typed in. */
export function useEmailSender() {
  return useQuery({ queryKey: emailKeys.sender(), queryFn: fetchEmailSender, staleTime: 60_000 })
}

/** Saves the sender; resolves once the fresh sender is in the cache. */
export function useSetEmailSender() {
  const queryClient = useQueryClient()
  return useMutation({
    mutationFn: (sender: EmailSenderUpdate) => setEmailSender(sender),
    onSuccess: async () => {
      await queryClient.invalidateQueries({ queryKey: emailKeys.all })
      toast.success(t('settings.email.sender.saved'))
    },
    onError: (error) => {
      toast.error(moduleErrorMessage(error, t('common.errors.generic'), 'settings'))
    },
  })
}

/** Changes the sending domain (and with it the from address). */
export function useSetEmailSendingDomain() {
  const queryClient = useQueryClient()
  return useMutation({
    mutationFn: (domain: string) => setEmailSendingDomain(domain),
    onSuccess: async () => {
      await queryClient.invalidateQueries({ queryKey: emailKeys.all })
      toast.success(t('settings.email.keys.domain.saved'))
    },
    onError: (error) => {
      toast.error(moduleErrorMessage(error, t('common.errors.generic'), 'settings'))
    },
  })
}

/** The effective templates of the caller's org. */
export function useEmailTemplates() {
  return useQuery({ queryKey: emailKeys.templates(), queryFn: listEmailTemplates })
}

/**
 * Saves a template's text. A refusal is shown under the editor's form (its P0001 text), not in a
 * toast: the caller reads `error`.
 */
export function useSaveEmailTemplate() {
  const queryClient = useQueryClient()
  return useMutation({
    mutationFn: ({ key, draft }: { key: string; draft: EmailTemplateDraft }) => saveEmailTemplate(key, draft),
    onSuccess: async () => {
      await queryClient.invalidateQueries({ queryKey: emailKeys.all })
      toast.success(t('settings.email.editor.saved'))
    },
  })
}

/** « Rétablir le texte par défaut ». */
export function useResetEmailTemplate() {
  const queryClient = useQueryClient()
  return useMutation({
    mutationFn: (key: string) => resetEmailTemplate(key),
    onSuccess: async () => {
      await queryClient.invalidateQueries({ queryKey: emailKeys.all })
      toast.success(t('settings.email.editor.resetDone'))
    },
    onError: (error) => {
      toast.error(moduleErrorMessage(error, t('common.errors.generic'), 'settings'))
    },
  })
}

/**
 * The live preview of a draft: rendered by `email-preview` once typing pauses for
 * PREVIEW_DEBOUNCE_MS. `draft` is null while it is invalid: nothing is asked, and the last
 * preview stays on screen (`keepPreviousData`), as it does while the next one loads.
 */
export function useEmailPreview(key: string, draft: EmailTemplateDraft | null) {
  const serialized = useDebouncedValue(draft === null ? null : JSON.stringify(draft), PREVIEW_DEBOUNCE_MS)
  return useQuery({
    queryKey: emailPreviewKeys.draft(key, serialized === null ? 'invalid' : hash(serialized)),
    queryFn: ({ signal }) => previewEmail(key, JSON.parse(serialized!) as EmailTemplateDraft, signal),
    enabled: serialized !== null,
    placeholderData: keepPreviousData,
    // A draft renders the same until the clinic's settings change; a refused draft stays refused.
    staleTime: 5 * 60_000,
    gcTime: 60_000,
    retry: false,
  })
}

/** « M'envoyer un test »: toasts here, so the outcome shows even if the editor closes first. */
export function useSendTestEmail() {
  const { email } = useReadyAccess()
  return useMutation({
    mutationFn: ({ key, draft }: { key: string; draft: EmailTemplateDraft }) => sendTestEmail(key, draft),
    onSuccess: () => {
      toast.success(t('settings.email.editor.testSent', { email }))
    },
    onError: (error) => {
      toast.error(emailErrorMessage(error))
    },
  })
}

/**
 * « Historique d'envoi », page by page, newest first (keyset on `created_at`, `id`). Like the audit
 * journal: always stale, removed on unmount, no refetch on window focus (it would reload every page).
 */
export function useEmailLog(filters: EmailLogFilters) {
  const queryClient = useQueryClient()
  useEffect(() => () => queryClient.removeQueries({ queryKey: emailKeys.logs() }), [queryClient])
  return useInfiniteQuery({
    queryKey: emailKeys.log(filters),
    queryFn: ({ pageParam }) => listEmailLog(filters, pageParam),
    initialPageParam: null as EmailLogCursor | null,
    getNextPageParam: (lastPage): EmailLogCursor | undefined => {
      const last = lastPage[lastPage.length - 1]
      return lastPage.length === EMAIL_LOG_PAGE_SIZE && last ? { before: last.created_at, beforeId: last.id } : undefined
    },
    staleTime: 0,
    gcTime: 0,
    refetchOnWindowFocus: false,
  })
}

/** When the clinic last received a Resend event (null: never). */
export function useLastWebhookEvent() {
  return useQuery({ queryKey: emailKeys.lastEvent(), queryFn: () => lastWebhookEventAt('resend'), staleTime: 0 })
}
