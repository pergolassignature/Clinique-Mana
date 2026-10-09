import { t } from '@/i18n'
import { useAccess, useReadyAccess } from '@/core/access/access-context'
import { moduleErrorMessage } from '@/core/modules/errors'
import { Loading, LoadError } from '@/shared/components/LoadState'
import { useProfessionalDocuments } from '../../../hooks/use-documents'
import { fullName } from '../../../lib/display'
import { DocumentsPanel } from '../DocumentsPanel'
import { useRecordData } from '../record-context'
import { ContractCard } from '../ContractCard'
import { SubmissionsCard } from '../SubmissionsCard'

const D = 'modules.professionals.documents'

/**
 * « Documents » (P4-13, Tasks 4b.5, 4c.3, 4d.3): « Contrat de service » first (`ContractCard`, A5.1),
 * then « Questionnaire et mises à jour » (where a submission is reviewed, `REVIEW_TAB`), then the
 * documents themselves (`get_professional_documents`, one read): « Documents requis » and « Autres
 * documents » (`DocumentsPanel`). Actions by permission: Téléverser (`professionals.manage`),
 * Vérifier / Refuser / Modifier l'échéance (`professionals.documents.review`), Supprimer
 * (`professionals.documents.delete`); the review and the deletion are not offered on one's own
 * record (P4-401: the database refuses them, HINT `document`), which says so.
 */
export function DocumentsTab() {
  const { record, catalog, focusHeading } = useRecordData()
  const { can } = useAccess()
  const { user_id } = useReadyAccess()
  const { professional } = record
  const documents = useProfessionalDocuments(professional.id)
  const ownFile = professional.profileId !== null && professional.profileId === user_id
  const permissions = {
    upload: can('professionals.manage'),
    review: can('professionals.documents.review') && !ownFile,
    delete: can('professionals.documents.delete') && !ownFile,
  }

  return (
    <div className="max-w-form space-y-4">
      <ContractCard />
      <SubmissionsCard />
      {documents.isPending ? (
        <Loading />
      ) : !documents.data ? (
        <LoadError
          // Null (no longer readable) is not an error to report.
          message={documents.error ? moduleErrorMessage(documents.error, t(`${D}.loadError`), 'professionals') : t(`${D}.loadError`)}
          retrying={documents.isFetching}
          onRetry={() => void documents.refetch()}
        />
      ) : (
        <>
          {ownFile && (can('professionals.documents.review') || can('professionals.documents.delete')) && (
            <p className="text-sm text-muted-foreground">{t(`${D}.ownFile`)}</p>
          )}
          <DocumentsPanel
            data={documents.data}
            types={catalog.documentTypes}
            viewer="staff"
            owner={{ id: professional.id, firstName: professional.firstName, name: fullName(professional) }}
            can={permissions}
            verifiedAtOnce={can('professionals.documents.review') && !ownFile}
            focusFallback={focusHeading}
          />
        </>
      )}
    </div>
  )
}
