import { t } from '@/i18n'
import { useAccess } from '@/core/access/access-context'
import { LoadError, Loading } from '@/shared/components/LoadState'
import { PageHeader } from '@/shared/components/PageHeader'
import { OtherRatesCard } from '../../components/settings/CompensationTermsCards'
import { RetentionGridsCard } from '../../components/settings/RetentionGridsCard'
import { SinCollectionCard } from '../../components/settings/SinCollectionCard'
import { useProfessionalsCatalog } from '../../hooks/use-catalog'
import { useCompensationKinds, useCompensationTerms } from '../../hooks/use-compensation'

const S = 'modules.professionals.settings.compensation'

/**
 * Paramètres → Rémunération (`professionals.compensation`, which both sees and edits it: no
 * read-only mode): the retention grids per profession (P4-185), the other kinds' rates (P4-181),
 * and, for whoever also holds `professionals.private` and `professionals.settings`, « Recueillir
 * le NAS ». The titles (catalogue), the kinds and the terms load together; every change is a
 * dated row, never an edit in place.
 */
export function CompensationSettingsPage() {
  const { can } = useAccess()
  const catalog = useProfessionalsCatalog()
  const kinds = useCompensationKinds()
  const terms = useCompensationTerms()
  const queries = [catalog, kinds, terms]

  let content
  if (catalog.data && kinds.data && terms.data) {
    content = (
      <>
        <RetentionGridsCard titles={catalog.data.titles} grids={terms.data.grids} />
        <OtherRatesCard kinds={kinds.data} rows={terms.data.rates} />
      </>
    )
  } else if (queries.some((query) => query.isError && !query.data)) {
    content = (
      <LoadError
        message={t(`${S}.loadError`)}
        retrying={queries.some((query) => query.isFetching)}
        onRetry={() => {
          for (const query of queries) if (query.isError) void query.refetch()
        }}
      />
    )
  } else {
    content = <Loading />
  }

  return (
    <div className="max-w-form space-y-5">
      <PageHeader title={t(`${S}.title`)} description={t(`${S}.description`)} />
      {content}
      {can('professionals.private') && can('professionals.settings') && <SinCollectionCard />}
    </div>
  )
}
