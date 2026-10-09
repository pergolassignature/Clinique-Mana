import { useId } from 'react'
import { t } from '@/i18n'
import { useAccess, useReadyAccess } from '@/core/access/access-context'
import { moduleErrorMessage } from '@/core/modules/errors'
import { Loading, LoadError } from '@/shared/components/LoadState'
import { useProfessionalDocuments } from '../../../hooks/use-documents'
import { fullName } from '../../../lib/display'
import { DocumentsPanel } from '../DocumentsPanel'
import { useRecordData } from '../record-context'
import { ContractCard } from '../ContractCard'
import { ImageConsentSigning } from '../ImageConsentSigning'
import { SubmissionsCard } from '../SubmissionsCard'

const D = 'modules.professionals.documents'

/**
 * « Documents » (P4-13, Tasks 4b.5, 4c.3, 4d.3): « Contrat de service » first (`ContractCard`, A5.1),
 * the image consent's Documenso signing inside its required card (`ImageConsentSigning`, P4-485;
 * its own card when the clinic made the type optional),
 * then « Questionnaire et mises à jour » (where a submission is reviewed, `REVIEW_TAB`), then the
 * documents themselves (`get_professional_documents`, one read): « Documents requis » and « Autres
 * documents » (`DocumentsPanel`). Actions by permission: Téléverser (`professionals.manage`),
 * Vérifier / Refuser / Modifier l'échéance (`professionals.documents.review`), Supprimer
 * (`professionals.documents.delete`); the review and the deletion are not offered on one's own
 * record (P4-401: the database refuses them, HINT `document`), which says so. A required document
 * the questionnaire to review holds links up to its card (« Voir le questionnaire à réviser », P4-495).
 */
export function DocumentsTab() {
  const { record, catalog, focusHeading } = useRecordData()
  const { can } = useAccess()
  const { user_id } = useReadyAccess()
  const { professional } = record
  const documents = useProfessionalDocuments(professional.id)
  const submissionsId = useId()
  const showReview = () => {
    const card = document.getElementById(submissionsId)
    card?.scrollIntoView?.({ block: 'start' })
    card?.focus({ preventScroll: true })
  }
  const ownFile = professional.profileId !== null && professional.profileId === user_id
  const consentRequired = catalog.documentTypes.some((type) => type.key === 'image_consent' && type.isActive && type.required)
  const permissions = {
    upload: can('professionals.manage'),
    review: can('professionals.documents.review') && !ownFile,
    delete: can('professionals.documents.delete') && !ownFile,
  }

  return (
    <div className="max-w-form space-y-5">
      <ContractCard />
      <SubmissionsCard id={submissionsId} />
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
            typeExtra={(type) => (type.key === 'image_consent' ? <ImageConsentSigning /> : null)}
            onShowReview={showReview}
          />
          {!consentRequired && <ImageConsentSigning standalone />}
        </>
      )}
    </div>
  )
}
