import { Eye } from 'lucide-react'
import { t } from '@/i18n'
import { useAccess } from '@/core/access/access-context'
import { LoadError, Loading } from '@/shared/components/LoadState'
import { SectionSurface } from '@/shared/components/SettingsCard'
import { formatClinicDateTime } from '@/shared/lib/timezone'
import { useProfessionalCompensation } from '../../../hooks/use-compensation'
import { useProfessionalPrivate } from '../../../hooks/use-private'
import { useProfessionalsSettings } from '../../../hooks/use-professionals-settings'
import { BankCard } from '../BankCard'
import { useRecordData } from '../record-context'
import { RetentionCard } from '../RetentionCard'
import { SinCard } from '../SinCard'
import { TaxNumbersCard } from '../TaxNumbersCard'

const C = 'modules.professionals.record.compensation'

/**
 * « Rémunération et fiscalité » (Task 4a.18), seen with `professionals.compensation` or
 * `professionals.private`; each card follows its own permission. Compensation: « Rétention »
 * (P4-180…). Private data: « Fiscalité », « NAS », « Banque », sections of one surface (audit
 * 2026-10-09 §2.4), each saved on its own (P4-148), 32 px below the compensation. Its requests start together at mount (no waterfall), or earlier on the tab's
 * hover; a revealed value is never cached.
 */
export function CompensationTab() {
  const { record } = useRecordData()
  const { can } = useAccess()
  const id = record.professional.id
  const canCompensation = can('professionals.compensation')
  const canPrivate = can('professionals.private')
  const compensation = useProfessionalCompensation(id, canCompensation)
  const privateData = useProfessionalPrivate(id, canPrivate)
  const settings = useProfessionalsSettings(canPrivate)

  let compensationContent = null
  if (canCompensation) {
    if (compensation.isPending) compensationContent = <Loading />
    else if (!compensation.data)
      compensationContent = <LoadError message={t(`${C}.loadError`)} retrying={compensation.isFetching} onRetry={() => void compensation.refetch()} />
    else compensationContent = <RetentionCard professionalId={id} data={compensation.data} />
  }

  let privateContent = null
  if (canPrivate) {
    if (privateData.isPending || settings.isPending) privateContent = <Loading />
    else if (!privateData.data || !settings.data) {
      const retry = () => void Promise.all([!privateData.data && privateData.refetch(), !settings.data && settings.refetch()])
      privateContent = <LoadError message={t(`${C}.privateLoadError`)} retrying={privateData.isFetching || settings.isFetching} onRetry={retry} />
    } else {
      const data = privateData.data
      privateContent = (
        <>
          <div className="space-y-0.5 text-xs text-muted-foreground">
            <p className="flex items-center gap-1.5">
              <Eye aria-hidden className="size-3.5 shrink-0" />
              {t(`${C}.privacyNote`)}
            </p>
            {data.updatedAt && (
              <p>
                {data.updatedByName
                  ? t(`${C}.updated`, { date: formatClinicDateTime(data.updatedAt), name: data.updatedByName })
                  : t(`${C}.updatedNoName`, { date: formatClinicDateTime(data.updatedAt) })}
              </p>
            )}
          </div>
          <SectionSurface>
            <TaxNumbersCard professionalId={id} data={data} />
            <SinCard professionalId={id} data={data} collect={settings.data.collectSin} />
            <BankCard professionalId={id} data={data} />
          </SectionSurface>
        </>
      )
    }
  }

  return (
    <div className="space-y-8">
      {compensationContent}
      {privateContent && <div className="space-y-3">{privateContent}</div>}
    </div>
  )
}
