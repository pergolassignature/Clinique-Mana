import { Link } from 'react-router-dom'
import { t } from '@/i18n'
import { useAccess } from '@/core/access/access-context'
import { LoadError, Loading } from '@/shared/components/LoadState'
import { SettingsCard } from '@/shared/components/SettingsCard'
import { cn } from '@/shared/lib/utils'
import { Badge } from '@/shared/ui/badge'
import { buttonVariants } from '@/shared/ui/button'
import { offerPath } from '../../api/waitlist-offers'
import { useWaitlistCompatible } from '../../hooks/use-waitlist'
import { demandePath } from '../../lib/display'
import { waitedLabel } from '../../lib/waitlist'

const O = 'modules.demandes.waitlist.offers'

/**
 * « Personnes compatibles » (D4 part 2, D-36): on a professional's list, the people she could be
 * offered — of her own list and of her professions' lists, « Active » or « À rappeler », no
 * proposal pending, whose criteria she meets — in list order (« Prioritaire » first, then the
 * oldest), with the match's warnings. « Offrir la plage » opens the request's « Jumelage » with
 * the proposal to her (D3b: 1 to 3 of her slots held 48 h). Shown with professionals.view.
 */
export function CompatibleCard({ professionalId, name }: { professionalId: string; name: string }) {
  const compatible = useWaitlistCompatible(professionalId, true)
  const { can } = useAccess()
  // The proposal needs the request's rights and the agenda's (D3b).
  const canOffer = can('demandes.manage') && can('appointments.view')
  return (
    <SettingsCard as="section" layout="section" title={t(`${O}.title`, { name })} description={t(`${O}.description`)}>
      {compatible.isError && !compatible.data ? (
        <LoadError message={t(`${O}.loadError`)} onRetry={() => void compatible.refetch()} retrying={compatible.isFetching} />
      ) : !compatible.data ? (
        <Loading />
      ) : compatible.data.length === 0 ? (
        <p className="text-sm text-muted-foreground">{t(`${O}.none`, { name })}</p>
      ) : (
        <ol aria-label={t(`${O}.title`, { name })} className="divide-y divide-border-light">
          {compatible.data.map((row) => (
            <li key={row.entry_id} className="flex flex-wrap items-start justify-between gap-2 py-2">
              <div className="min-w-0 space-y-0.5 text-sm">
                <p className="flex flex-wrap items-center gap-x-2 gap-y-1">
                  <span className="tabular text-xs text-muted-foreground">{row.order}.</span>
                  <Link to={demandePath(row.demande_id, 'suivi')} className="font-medium text-link underline-offset-2 hover:underline">
                    {row.person_name ?? row.reference}
                  </Link>
                  {row.priority === 'priority' && <Badge variant="warning">{t('modules.demandes.waitlist.priority.priority')}</Badge>}
                </p>
                <p className="text-xs text-muted-foreground">
                  {row.target_kind === 'professional' ? t(`${O}.herList`) : t(`${O}.titleList`, { name: row.target_name ?? '' })}
                  {' · '}
                  {waitedLabel(row.waited_days ?? 0)}
                </p>
                {row.warnings.filter((w) => w !== 'no_places').length > 0 && (
                  <p className="flex flex-wrap gap-1.5">
                    {row.warnings
                      .filter((w) => w !== 'no_places')
                      .map((w) => (
                        <Badge key={w} variant={w === 'insurance_expired' ? 'error' : 'warning'}>
                          {t(`${O}.warnings.${w}`)}
                        </Badge>
                      ))}
                  </p>
                )}
              </div>
              {canOffer && (
                <Link
                  to={offerPath(row.demande_id, professionalId)}
                  aria-label={t(`${O}.offerTo`, { name: row.person_name ?? row.reference })}
                  className={cn(buttonVariants({ variant: 'outline', size: 'sm' }), 'max-sm:h-11')}
                >
                  {t(`${O}.offer`)}
                </Link>
              )}
            </li>
          ))}
        </ol>
      )}
    </SettingsCard>
  )
}
