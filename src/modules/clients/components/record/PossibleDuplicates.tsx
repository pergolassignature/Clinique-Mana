import { useMemo, useState } from 'react'
import { Link } from 'react-router-dom'
import { TriangleAlert } from 'lucide-react'
import { t } from '@/i18n'
import { useAccess } from '@/core/access/access-context'
import { formatDateOnlyShort } from '@/shared/lib/timezone'
import { Alert, AlertDescription } from '@/shared/ui/alert'
import { Button } from '@/shared/ui/button'
import { useClientDuplicates } from '../../hooks/use-clients'
import { clientPath } from '../../lib/constants'
import { clientNumberLabel, duplicateReasonLabel, phoneLabel } from '../../lib/display'
import { MergeDialog } from './MergeDialog'
import { useClientRecordData } from './record-context'

const D = 'modules.clients.record.duplicates'

/**
 * « Doublons possibles » on « Aperçu » (plan C4.1): the other files of the clinic the duplicate
 * rules match with this one (I-5, CL-12), with their reasons, « Ouvrir » and « Fusionner »
 * (clients.merge). Nothing while there is none, nor on a merged or anonymised file.
 */
export function PossibleDuplicates() {
  const { can } = useAccess()
  const { summary } = useClientRecordData()
  const c = summary.client
  const closed = c.mergedIntoId !== null || c.anonymizedAt !== null
  const query = useMemo(
    () =>
      closed
        ? null
        : { firstName: c.firstName, lastName: c.lastName, email: c.email, phones: [c.mobile, c.home].filter((p): p is string => p !== null), birthday: c.birthday, exclude: c.id },
    [closed, c.firstName, c.lastName, c.email, c.mobile, c.home, c.birthday, c.id],
  )
  const duplicates = useClientDuplicates(query)
  const [merging, setMerging] = useState<string | null>(null)
  const found = duplicates.data ?? []
  if (closed || found.length === 0) return null
  return (
    <>
      <Alert variant="warning">
        <TriangleAlert aria-hidden />
        <AlertDescription className="space-y-2 text-foreground">
          <p className="font-medium">{t(`${D}.title`)}</p>
          <ul className="space-y-1.5">
            {found.map((d) => (
              <li key={d.clientId} className="flex flex-wrap items-baseline justify-between gap-x-3 gap-y-1 text-sm">
                <span>
                  <span className="font-medium">{d.displayName}</span> · <span className="tabular">{clientNumberLabel(d.clientNumber)}</span>
                  {d.birthday && <> · {formatDateOnlyShort(d.birthday)}</>}
                  {(d.email || d.mobile) && <span className="block text-xs text-muted-foreground">{[d.email, phoneLabel(d.mobile)].filter(Boolean).join(' · ')}</span>}
                  <span className="block text-xs text-muted-foreground">{d.reasons.map(duplicateReasonLabel).filter(Boolean).join(', ')}</span>
                </span>
                <span className="flex items-center gap-2">
                  <Link to={clientPath(d.clientId)} className="text-link text-sm underline-offset-2 hover:underline">
                    {t(`${D}.open`)}
                  </Link>
                  {can('clients.merge') && (
                    <Button type="button" variant="outline" size="sm" onClick={() => setMerging(d.clientId)}>
                      {t(`${D}.merge`)}
                    </Button>
                  )}
                </span>
              </li>
            ))}
          </ul>
        </AlertDescription>
      </Alert>
      {merging && <MergeDialog current={summary} otherId={merging} onClose={() => setMerging(null)} />}
    </>
  )
}
