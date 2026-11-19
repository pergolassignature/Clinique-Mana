import { useMemo } from 'react'
import type { ComposerTemplates } from '@pergolas-signature/email-ui/composer'
import { t } from '@/i18n'
import { toast } from '@/shared/ui/sonner'
import { COMPOSE_PLACEHOLDERS, type ComposeTemplate } from '../../api/composer'
import { communicationsErrorMessage } from '../../api/errors'
import { useSaveTemplate, useTemplates } from '../../hooks/use-composer'
import { htmlToText, textToHtml } from '../../lib/compose'

const C = 'modules.communications.composer'

/** A template's body as the editor takes it: a text one becomes paragraphs. */
const templateHtml = (template: ComposeTemplate) => (template.format === 'text' ? textToHtml(template.body) : template.body)

/**
 * MANA's templates in PS Hub's template picker (`TemplatePill`, email-ui 0.8.1, CM-26): the clinic's
 * (read only) and one's own (kept, edited, deleted). The placeholders stay as written: the server
 * fills them at the send (CM-15). A deletion asks first, through the composer's own dialog
 * (`confirmDelete`).
 */
export function useManaComposerTemplates({ confirmDelete }: { confirmDelete: (template: ComposeTemplate) => void }): ComposerTemplates {
  const { data, isLoading } = useTemplates()
  const save = useSaveTemplate()
  const saveTemplate = save.mutate
  return useMemo<ComposerTemplates>(() => {
    const rows = data ?? []
    const find = (id: string) => rows.find((row) => row.id === id)
    return {
      list: rows.map((row) => ({ id: row.id, name: row.name, subject: row.subject, editable: row.kind === 'personal' })),
      isLoading,
      apply: (id) => {
        const row = find(id)
        if (!row) return null
        const html = templateHtml(row)
        return { subject: row.subject, body: { html, text: htmlToText(html) } }
      },
      read: (id) => {
        const row = find(id)
        if (!row) return null
        const html = templateHtml(row)
        return { name: row.name, subject: row.subject, bodyHtml: html, bodyText: htmlToText(html) }
      },
      save: (id, draft) =>
        new Promise<void>((resolve, reject) =>
          saveTemplate(
            { id, name: draft.name, subject: draft.subject, bodyHtml: draft.bodyHtml },
            {
              onSuccess: () => {
                toast.success(t(`${C}.templateSaved`, { name: draft.name }))
                resolve()
              },
              onError: (error) => {
                toast.error(communicationsErrorMessage(error))
                reject(error)
              },
            },
          ),
        ),
      remove: async (id) => {
        const row = find(id)
        if (row) confirmDelete(row)
      },
      isSaving: save.isPending,
      placeholders: COMPOSE_PLACEHOLDERS.map((placeholder) => `{{${placeholder}}}`),
      // A reply's template keeps the reply's subject.
      requireSubject: false,
      notify: (title) => toast.error(title),
    }
  }, [data, isLoading, saveTemplate, save.isPending, confirmDelete])
}
