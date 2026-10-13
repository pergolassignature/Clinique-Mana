import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { t } from '@/i18n'
import { moduleErrorMessage } from '@/core/modules/errors'
import { toast } from '@/shared/ui/sonner'
import {
  archiveTemplateVersion,
  createTemplateVersion,
  fetchTemplateVersions,
  listModuleTemplates,
  publishTemplateVersion,
  updateTemplateVersion,
  type DraftContent,
} from './api'

const T = 'signing.templates.toasts'

/**
 * Query keys of the shared template editor (CC-12). Every write refetches `all` (the module's list
 * and the versions); a module that shows something else built from its templates (Professionnels'
 * signing cards, Clients' consents) refreshes it through `onChanged`.
 */
export const documentTemplateKeys = {
  all: ['document-templates'] as const,
  list: (moduleKey: string) => [...documentTemplateKeys.all, 'list', moduleKey] as const,
  versions: (templateId: string) => [...documentTemplateKeys.all, 'versions', templateId] as const,
}

/** A module's templates. `load` lets a module keep its own reader (its tests mock it). */
export function useModuleTemplates(moduleKey: string, load: () => ReturnType<typeof listModuleTemplates> = () => listModuleTemplates(moduleKey)) {
  return useQuery({ queryKey: documentTemplateKeys.list(moduleKey), queryFn: load })
}

/** A template's versions; not refetched on focus while a draft may be in the editor. */
export function useTemplateVersions(templateId: string | null) {
  return useQuery({
    queryKey: documentTemplateKeys.versions(templateId ?? ''),
    queryFn: () => fetchTemplateVersions(templateId as string),
    enabled: templateId !== null,
    refetchOnWindowFocus: false,
  })
}

/** What the editor wrote: a new draft, a saved draft, a publication, a retired version. */
export type TemplateWrite = 'create' | 'save' | 'publish' | 'archive'

export interface TemplateMutationHandlers {
  /** Shows a failure where the user acted; by default the database's French refusal, or a generic line. */
  onError?: (error: unknown, show: (message: string) => void) => void
  onErrorMessage?: (message: string) => void
  /**
   * After each write, success or not (the module refreshes what it builds from its templates:
   * Professionnels' signing cards after a publication, Clients' consent texts after any write).
   */
  onChanged?: (write: TemplateWrite) => void
}

/** The editor's writes: « Nouvelle version », « Enregistrer le brouillon », « Publier », « Supprimer le brouillon ». */
export function useTemplateMutations({ onError, onErrorMessage, onChanged }: TemplateMutationHandlers = {}) {
  const queryClient = useQueryClient()
  const refresh = (write: TemplateWrite) => {
    const done = queryClient.invalidateQueries({ queryKey: documentTemplateKeys.all })
    onChanged?.(write)
    return done
  }
  const show = (message: string) => (onErrorMessage ? onErrorMessage(message) : toast.error(message))
  const handleError = (error: unknown) =>
    onError ? onError(error, show) : show(moduleErrorMessage(error, t('signing.templates.editor.saveError'), 'settings'))
  const create = useMutation({
    mutationFn: createTemplateVersion,
    onSuccess: () => toast.success(t(`${T}.versionCreated`)),
    onError: handleError,
    onSettled: () => refresh('create'),
  })
  const save = useMutation({
    mutationFn: ({ versionId, content }: { versionId: string; content: DraftContent }) => updateTemplateVersion(versionId, content),
    onSuccess: () => toast.success(t(`${T}.draftSaved`)),
    onError: handleError,
    onSettled: () => refresh('save'),
  })
  const publish = useMutation({
    mutationFn: publishTemplateVersion,
    onSuccess: () => toast.success(t(`${T}.published`)),
    onError: handleError,
    onSettled: () => refresh('publish'),
  })
  const archive = useMutation({
    mutationFn: archiveTemplateVersion,
    onSuccess: () => toast.success(t(`${T}.archived`)),
    onError: handleError,
    onSettled: () => refresh('archive'),
  })
  return { create, save, publish, archive }
}
