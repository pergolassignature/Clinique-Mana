import { t } from '@/i18n'
import { useAccess } from '@/core/access/access-context'
import { LoadError, Loading } from '@/shared/components/LoadState'
import { PageHeader } from '@/shared/components/PageHeader'
import { DefaultRangesCard, RecognitionRulesCard } from '../../components/settings/CompensationTermsCards'
import { SinCollectionCard } from '../../components/settings/SinCollectionCard'
import { useCompensationKinds, useCompensationTerms } from '../../hooks/use-compensation'

const S = 'modules.professionals.settings.compensation'

/**
 * Paramètres → Rémunération (`professionals.compensation`, which both sees and edits it: no
 * read-only mode): the clinic's dated default margins and recognition rules (4a.17), and, for
 * whoever also holds `professionals.private` and `professionals.settings`, « Recueillir le NAS ».
 * The kinds and the terms load together; each card's changes are dated rows, never edits in place.
 */
export function CompensationSettingsPage() {
  const { can } = useAccess()
  const kinds = useCompensationKinds()
  const terms = useCompensationTerms()

  let content
  if (kinds.data && terms.data) {
    content = (
      <>
        <DefaultRangesCard kinds={kinds.data} rows={terms.data.defaults} />
        <RecognitionRulesCard rows={terms.data.rules} />
      </>
    )
  } else if ((kinds.isError && !kinds.data) || (terms.isError && !terms.data)) {
    content = (
      <LoadError
        message={t(`${S}.loadError`)}
        retrying={kinds.isFetching || terms.isFetching}
        onRetry={() => {
          if (kinds.isError) void kinds.refetch()
          if (terms.isError) void terms.refetch()
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
