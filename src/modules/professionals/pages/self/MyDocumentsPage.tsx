import { useRef } from 'react'
import { CircleAlert, Info, TriangleAlert } from 'lucide-react'
import { t } from '@/i18n'
import { moduleErrorMessage } from '@/core/modules/errors'
import { EmptyState } from '@/shared/components/EmptyState'
import { LoadError, Loading } from '@/shared/components/LoadState'
import { PageHeader } from '@/shared/components/PageHeader'
import { formatDateOnly } from '@/shared/lib/timezone'
import { usePageTitle } from '@/shared/lib/use-page-title'
import { Alert, AlertDescription, AlertTitle } from '@/shared/ui/alert'
import type { ProfessionalDocuments } from '../../api/documents'
import { DocumentsPanel } from '../../components/record/DocumentsPanel'
import { ConsentSigning } from '../../components/self/ConsentSigning'
import { useProfessionalsCatalog } from '../../hooks/use-catalog'
import { useMyDocuments } from '../../hooks/use-documents'
import { useMyProfessionalRecord } from '../../hooks/use-my-profile'
import type { CatalogView } from '../../lib/catalog-view'
import { insuranceBanner } from '../../lib/documents'
import { fullName } from '../../lib/display'

const M = 'modules.professionals.myDocuments'

/**
 * « Mes documents » (`/mes-documents`, `professionals.self`, Task 4c.6): the professional's own
 * documents, in the tab's words (`DocumentsPanel`, viewer `self`): her required documents with
 * their state and end date, « Téléverser » on each but the image consent, which she fills in and
 * signs online (« Remplir et signer », `ConsentSigning`, P4-489) (`professional_self_document`, attached to her
 * own record only, always waiting for the clinic's review, P4-401), and her other documents,
 * read-only. Above, the insurance's banner (P4-454): expiring (within the insurance's reminder
 * window) or expired, unless a new proof already waits for review (uploaded, or sent with her
 * questionnaire) or sits in her questionnaire not sent yet, which is said instead (P4-495). Three
 * requests in one tick: her documents, her record (her name) and the catalogue (the types).
 * An inactive file may still upload (P4-11).
 */
export function MyDocumentsPage() {
  usePageTitle(t(`${M}.pageTitle`))
  const documents = useMyDocuments()
  const record = useMyProfessionalRecord()
  const catalog = useProfessionalsCatalog()
  const heading = useRef<HTMLHeadingElement>(null)
  const queries = [documents, record, catalog]
  if (queries.some((q) => q.isPending)) return <Loading />
  const failed = queries.filter((q) => q.isError && q.data === undefined)
  if (failed.length > 0) {
    return (
      <LoadError
        message={moduleErrorMessage(failed[0]?.error, t(`${M}.loadError`), 'professionals')}
        retrying={failed.some((q) => q.isFetching)}
        onRetry={() => failed.forEach((q) => void q.refetch())}
      />
    )
  }
  if (!documents.data || !record.data) {
    return (
      <div className="w-full max-w-form space-y-2">
        <PageHeader level={1} title={t(`${M}.pageTitle`)} />
        <EmptyState title={t(`${M}.noFile.title`)} body={t(`${M}.noFile.body`)} />
      </div>
    )
  }
  const { professional } = record.data
  return (
    <div className="w-full max-w-form space-y-5">
      <div ref={heading} tabIndex={-1} className="outline-none">
        <PageHeader level={1} title={t(`${M}.pageTitle`)} description={t(`${M}.description`)} />
      </div>
      <InsuranceBanner data={documents.data} catalog={catalog.data as CatalogView} />
      <DocumentsPanel
        data={documents.data}
        types={(catalog.data as CatalogView).documentTypes}
        viewer="self"
        owner={{ id: documents.data.professionalId, firstName: professional.firstName, name: fullName(professional) }}
        can={SELF_PERMISSIONS}
        verifiedAtOnce={false}
        focusFallback={() => heading.current?.focus()}
        typeExtra={(type) => (type.key === 'image_consent' ? <ConsentSigning back={{ returnTo: 'documents' }} variant="documents" /> : null)}
      />
    </div>
  )
}

/** The professional uploads her own documents; the review and the deletion are the clinic's. */
const SELF_PERMISSIONS = { upload: true, review: false, delete: false } as const

function InsuranceBanner({ data, catalog }: { data: ProfessionalDocuments; catalog: CatalogView }) {
  const banner = insuranceBanner(catalog.documentTypes, data)
  if (!banner) return null
  if (banner.kind === 'renewal_pending' || banner.kind === 'in_questionnaire') {
    return (
      <Alert>
        <Info aria-hidden />
        <AlertDescription className="text-foreground">
          {t(banner.kind === 'renewal_pending' ? `${M}.banners.renewalPending` : `${M}.banners.inQuestionnaire`)}
        </AlertDescription>
      </Alert>
    )
  }
  const expired = banner.kind === 'expired'
  return (
    // No live role: it shows on load, and a screen reader would announce it at every visit.
    <Alert variant={expired ? 'destructive' : 'warning'}>
      {expired ? <CircleAlert aria-hidden /> : <TriangleAlert aria-hidden />}
      <AlertTitle>{t(expired ? `${M}.banners.expiredTitle` : `${M}.banners.expiringTitle`)}</AlertTitle>
      <AlertDescription className="text-foreground">
        {expired ? t(`${M}.banners.expired`) : t(`${M}.banners.expiring`, { date: formatDateOnly(banner.until) })}
      </AlertDescription>
    </Alert>
  )
}
