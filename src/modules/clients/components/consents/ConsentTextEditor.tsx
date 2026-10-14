import { useCallback, useMemo, useState } from 'react'
import { useQueryClient } from '@tanstack/react-query'
import { t } from '@/i18n'
import { moduleErrorMessage } from '@/core/modules/errors'
import type { TemplateVersion } from '@/core/signing/templates/api'
import { DocumentTemplateEditor, type TemplateEditorOptions } from '@/core/signing/templates/DocumentTemplateEditor'
import { useModuleTemplates, useTemplateVersions } from '@/core/signing/templates/hooks'
import { LoadError, Loading } from '@/shared/components/LoadState'
import { PLACEHOLDER_MARK, type ConsentTemplate, type ConsentType, type VersionClause } from '../../api/consents'
import { consentKeys } from '../../hooks/keys'
import { useConsentClauses } from '../../hooks/use-consents'
import { ConsentClausesCard } from './ConsentClausesCard'
import { ConsentClientPreview } from './ConsentClientPreview'
import { PublishConsentDialog } from './PublishConsentDialog'

const E = 'modules.clients.consents.settings.editor'

/** Where the consent PDF prints the client's answers (`clients-consent-sign` fills it with one table). */
export const CLAUSES_PLACEHOLDER = '{{consent.clauses}}'

/**
 * Clients' words for the shared editor (CC-12, CC-21): the answers' table (required: without it the
 * PDF would not show what the client answered, R-46) shown with the questions being written, the
 * « Texte provisoire » line (CC-11: « Publier » waits until it is gone), and « Publier » opening
 * Clients' own confirmation (who must sign again, R-49).
 */
function consentEditorOptions(clauses: VersionClause[], language: 'fr' | 'en'): Omit<TemplateEditorOptions, 'handlers' | 'onPublish' | 'publishBlocked' | 'focused'> {
  const missing = t(`${E}.clausesMissing`, { placeholder: CLAUSES_PLACEHOLDER })
  const notice = t(`${E}.bannerNotice`, { banner: PLACEHOLDER_MARK })
  const yesNo = t(language === 'en' ? `${E}.sample.yesNoEn` : `${E}.sample.yesNo`)
  const rows = clauses.length > 0 ? clauses.map((c) => [c.text || t(`${E}.sample.untitled`), yesNo]) : [[t(`${E}.sample.none`), '']]
  return {
    initials: null,
    block: {
      placeholder: CLAUSES_PLACEHOLDER,
      required: true,
      note: t(`${E}.clausesNote`),
      missing,
      blocked: missing,
      sample: { caption: t(`${E}.sample.caption`), columns: [t(`${E}.sample.clause`), t(`${E}.sample.answer`)], rows },
    },
    banner: { text: PLACEHOLDER_MARK, notice, blocked: notice },
    canPublish: true,
  }
}

/**
 * One consent text (one language) in the shared editor, text first (CC-21): the body with its
 * toolbar (a text pasted from Word keeps its form), autosaved; the « Oui / Non » questions right
 * under it; « Aperçu comme le client le verra » beside it (the questions as typed, then the
 * document); « Comparer avec la version publiée »; « Enregistrer le brouillon », then « Publier »
 * (Clients' confirmation). Every write refreshes the consents' overview. Read-only without
 * `clients.manage` (the template's edit permission).
 */
export function ConsentTextEditor({ consent, text, readOnly }: { consent: ConsentType; text: ConsentTemplate; readOnly: boolean }) {
  const queryClient = useQueryClient()
  const templates = useModuleTemplates('clients')
  const template = templates.data?.find((tpl) => tpl.id === text.id) ?? null
  // The questions of the version the editor shows: the draft, else the one in force (CC-13).
  const versions = useTemplateVersions(text.id)
  const shown = versions.data?.find((v) => v.status === 'draft') ?? versions.data?.find((v) => v.status === 'published') ?? null
  const savedClauses = useConsentClauses(shown?.id ?? null)
  // The questions as typed, for the version they were typed in (a publication shows another one).
  const [typed, setTyped] = useState<{ versionId: string; clauses: VersionClause[] } | null>(null)
  const [clausesDirty, setClausesDirty] = useState(false)
  const [publishing, setPublishing] = useState<TemplateVersion | null>(null)
  const shownId = shown?.id ?? null
  const clauses = useMemo(
    () => (typed !== null && typed.versionId === shownId ? typed.clauses : null) ?? savedClauses.data?.clauses ?? [],
    [typed, shownId, savedClauses.data],
  )
  const name = text.language === 'en' ? consent.nameEn : consent.name

  const onChanged = useCallback(() => void queryClient.invalidateQueries({ queryKey: consentKeys.templates() }), [queryClient])
  const options = useMemo<TemplateEditorOptions>(
    () => ({
      ...consentEditorOptions(clauses, text.language),
      handlers: { onChanged },
      onPublish: setPublishing,
      publishBlocked: clausesDirty ? t(`${E}.clausesUnsaved`) : null,
      focused: {
        autosave: true,
        preview: (html, version) => <ConsentClientPreview html={html} consentName={name} language={text.language} clauses={clauses} variables={version.variables} />,
        afterText: (version) => (
          <ConsentClausesCard
            versionId={version.id}
            readOnly={readOnly || !template?.canEdit}
            onClausesChange={(next) => setTyped({ versionId: version.id, clauses: next })}
            onDirtyChange={setClausesDirty}
          />
        ),
      },
    }),
    [clauses, text.language, onChanged, clausesDirty, name, readOnly, template?.canEdit],
  )

  if (templates.isPending) return <Loading />
  if (template === null) {
    return <LoadError message={moduleErrorMessage(templates.error, t(`${E}.loadError`), 'settings')} retrying={templates.isFetching} onRetry={() => void templates.refetch()} />
  }
  return (
    <>
      <DocumentTemplateEditor template={template} readOnly={readOnly || !template.canEdit} options={options} />
      {publishing && (
        <PublishConsentDialog
          key={publishing.id}
          versionId={publishing.id}
          version={publishing.version}
          name={name}
          language={text.language}
          first={text.published === null}
          onClose={() => setPublishing(null)}
        />
      )}
    </>
  )
}
