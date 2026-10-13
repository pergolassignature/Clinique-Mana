import { useEffect, useMemo, useRef } from 'react'
import { useQueryClient } from '@tanstack/react-query'
import { t } from '@/i18n'
import { moduleErrorMessage } from '@/core/modules/errors'
import { DocumentTemplateEditor, type TemplateEditorOptions } from '@/core/signing/templates/DocumentTemplateEditor'
import { useModuleTemplates } from '@/core/signing/templates/hooks'
import { LoadError, Loading } from '@/shared/components/LoadState'
import { Button } from '@/shared/ui/button'
import { PLACEHOLDER_MARK } from '../../api/consents'
import { consentKeys } from '../../hooks/keys'

const E = 'modules.clients.consents.settings.editor'

/** Where the consent PDF prints the client's answers (`clients-consent-sign` fills it with one table). */
const CLAUSES_PLACEHOLDER = '{{consent.clauses}}'

/**
 * Clients' words for the shared editor (CC-12): the answers' table (required: without it the PDF
 * would not show what the client answered, R-46), the « Texte provisoire » line (CC-11: « Publier »
 * stays hidden in « Textes » while a draft carries it), and no « Publier » here: a consent text is
 * published from « Textes », where the clinic chooses who must sign again (R-49).
 */
function consentEditorOptions(): Omit<TemplateEditorOptions, 'handlers'> {
  const missing = t(`${E}.clausesMissing`, { placeholder: CLAUSES_PLACEHOLDER })
  const notice = t(`${E}.bannerNotice`, { banner: PLACEHOLDER_MARK })
  return {
    initials: null,
    block: {
      placeholder: CLAUSES_PLACEHOLDER,
      required: true,
      note: t(`${E}.clausesNote`),
      missing,
      blocked: missing,
      sample: {
        caption: t(`${E}.sample.caption`),
        columns: [t(`${E}.sample.clause`), t(`${E}.sample.answer`)],
        rows: [
          [t(`${E}.sample.first`), t(`${E}.sample.yes`)],
          [t(`${E}.sample.second`), t(`${E}.sample.no`)],
        ],
      },
    },
    banner: { text: PLACEHOLDER_MARK, notice, blocked: notice },
    canPublish: false,
  }
}

/**
 * « Modifier le texte » of Paramètres → Consentements: one consent text (one language) in core's
 * shared editor. Every write refreshes « Textes » (a saved draft may stop being the placeholder,
 * which shows « Publier » there). Read-only without `clients.manage` (the template's edit
 * permission). Its title takes the focus when it opens, so the keyboard lands on it.
 */
export function ConsentTextEditor({ templateId, name, readOnly, onClose }: { templateId: string; name: string; readOnly: boolean; onClose: () => void }) {
  const queryClient = useQueryClient()
  const templates = useModuleTemplates('clients')
  const heading = useRef<HTMLHeadingElement>(null)
  const options = useMemo(consentEditorOptions, [])
  const handlers = useMemo<TemplateEditorOptions['handlers']>(
    () => ({ onChanged: () => void queryClient.invalidateQueries({ queryKey: consentKeys.templates() }) }),
    [queryClient],
  )
  const template = templates.data?.find((tpl) => tpl.id === templateId) ?? null
  const titleId = `consent-editor-${templateId}`

  useEffect(() => {
    heading.current?.scrollIntoView?.({ block: 'start' })
    heading.current?.focus({ preventScroll: true })
  }, [templateId])

  return (
    <section aria-labelledby={titleId} className="max-w-form space-y-4">
      <div className="flex flex-wrap items-start justify-between gap-2">
        <div className="min-w-0 space-y-1">
          <h2 id={titleId} ref={heading} tabIndex={-1} className="text-base font-semibold text-foreground outline-none">
            {t(`${E}.title`, { name })}
          </h2>
          <p className="text-sm text-muted-foreground">{t(readOnly ? `${E}.readOnlyHelp` : `${E}.help`)}</p>
        </div>
        <Button type="button" variant="outline" size="sm" onClick={onClose}>
          {t(`${E}.close`)}
        </Button>
      </div>
      {templates.isPending ? (
        <Loading />
      ) : template === null ? (
        <LoadError
          message={moduleErrorMessage(templates.error, t(`${E}.loadError`), 'settings')}
          retrying={templates.isFetching}
          onRetry={() => void templates.refetch()}
        />
      ) : (
        <DocumentTemplateEditor template={template} readOnly={readOnly || !template.canEdit} options={{ ...options, handlers }} />
      )}
    </section>
  )
}
