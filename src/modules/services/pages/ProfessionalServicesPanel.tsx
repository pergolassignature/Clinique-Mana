import { useState, type FormEvent, type ReactNode } from 'react'
import { useParams } from 'react-router-dom'
import { useQuery } from '@tanstack/react-query'
import { useAccess } from '@/core/access/access-context'
import { t } from '@/i18n'
import { FormActions } from '@/shared/components/FormActions'
import { LoadError, Loading } from '@/shared/components/LoadState'
import { RefusalAlert } from '@/shared/components/RefusalAlert'
import { SettingsCard } from '@/shared/components/SettingsCard'
import { useClinicDate } from '@/shared/lib/use-clinic-date'
import { useUnsavedChanges } from '@/shared/lib/unsaved-changes-context'
import { cn } from '@/shared/lib/utils'
import { Badge } from '@/shared/ui/badge'
import { Checkbox } from '@/shared/ui/checkbox'
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/shared/ui/table'
import { fetchOfferedServices } from '../api/offered'
import { serviceKeys } from '../hooks/keys'
import { useSetServiceExclusions } from '../hooks/use-services'
import { durationLabel, priceSourceLabel, taxRuleLabel } from '../lib/display'
import { formatCents } from '../lib/format'
import type { OfferedService } from '../lib/offered'

const O = 'modules.services.offered'

/** Her price today in words: the amount, « Gratuit », « Saisi à la facture » or « À confirmer » (no grid in force). */
function priceText(s: OfferedService): string {
  if (s.priceSource === 'free') return priceSourceLabel('free')
  if (s.priceSource === 'entered') return priceSourceLabel('entered')
  return s.priceCents === null ? t(`${O}.toConfirm`) : formatCents(s.priceCents)
}

const excludedOf = (rows: readonly OfferedService[]) =>
  rows
    .filter((s) => !s.offered)
    .map((s) => s.id)
    .sort()

/**
 * « Services offerts » (L26, R-83) on a professional's record (slot `professional.services`, tab
 * « Jumelage »): the services her title(s) allow, by code, each with its duration (and pause) and
 * her price today (her primary title's grid, or the fixed price). Some professionals do not offer
 * every service of their title (a couple session, for example): with professionals.manage a box
 * per service, all checked by default, says which she offers (`set_professional_service_exclusions`);
 * read-only otherwise, « Non offert » on the others. Booking, « Mon agenda », availability windows
 * and Demandes' proposals then leave the unchecked ones out.
 */
export function ProfessionalServicesPanel() {
  const { id = '' } = useParams()
  const today = useClinicDate()
  const canEdit = useAccess().can('professionals.manage')
  const offered = useQuery({ queryKey: serviceKeys.offered(id, today), queryFn: () => fetchOfferedServices(id, today), enabled: id !== '' })

  if (offered.isError && !offered.data) {
    return (
      <Frame>
        <LoadError message={t(`${O}.loadError`)} onRetry={() => void offered.refetch()} retrying={offered.isFetching} />
      </Frame>
    )
  }
  if (offered.data === undefined) {
    return (
      <Frame>
        <Loading />
      </Frame>
    )
  }
  if (offered.data === null || offered.data.length === 0) {
    return (
      <Frame>
        <p className="text-sm text-muted-foreground">{t(`${O}.empty`)}</p>
      </Frame>
    )
  }
  // Keyed on what is saved: a save (or another person's) starts the form again from it.
  return <ServicesForm key={excludedOf(offered.data).join(',')} professionalId={id} rows={offered.data} canEdit={canEdit} />
}

function Frame({ children }: { children: ReactNode }) {
  return (
    <SettingsCard as="section" title={t(`${O}.title`)} description={t(`${O}.description`)}>
      {children}
    </SettingsCard>
  )
}

function ServicesForm({ professionalId, rows, canEdit }: { professionalId: string; rows: readonly OfferedService[]; canEdit: boolean }) {
  const saved = excludedOf(rows)
  const [excluded, setExcluded] = useState<string[]>(saved)
  const [refusal, setRefusal] = useState<string | null>(null)
  const save = useSetServiceExclusions({ onErrorMessage: (message) => setRefusal(message) })
  const dirty = canEdit && [...excluded].sort().join(',') !== saved.join(',')
  useUnsavedChanges(dirty)

  const submit = (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault()
    if (!dirty || save.isPending) return
    setRefusal(null)
    save.mutate({ professionalId, serviceIds: excluded })
  }
  const toggle = (serviceId: string, offered: boolean) =>
    setExcluded((list) => (offered ? list.filter((x) => x !== serviceId) : list.includes(serviceId) ? list : [...list, serviceId]))
  const notOffered = excluded.length

  const table = (
    <Table aria-label={t(`${O}.title`)} className="max-sm:[&_td]:px-2 max-sm:[&_th]:px-2">
      <TableHeader>
        <TableRow className="[&>th]:whitespace-nowrap">
          {canEdit && <TableHead className="w-10">{t(`${O}.columns.offered`)}</TableHead>}
          <TableHead>{t(`${O}.columns.service`)}</TableHead>
          <TableHead className="max-sm:hidden">{t(`${O}.columns.duration`)}</TableHead>
          <TableHead align="right">{t(`${O}.columns.price`)}</TableHead>
        </TableRow>
      </TableHeader>
      <TableBody>
        {rows.map((s) => {
          const isOffered = !excluded.includes(s.id)
          return (
            <TableRow key={s.id} className={cn(!isOffered && 'text-muted-foreground')}>
              {canEdit && (
                <TableCell>
                  <Checkbox
                    checked={isOffered}
                    onCheckedChange={(value) => toggle(s.id, value === true)}
                    aria-label={t(`${O}.offerLabel`, { service: `${s.code} ${s.name}` })}
                  />
                </TableCell>
              )}
              <TableCell>
                <span className="tabular text-muted-foreground">{s.code}</span> {s.name}
                {s.forTwo && <span className="block text-xs text-muted-foreground">{t(`${O}.forTwo`)}</span>}
                <span className="block text-xs text-muted-foreground sm:hidden">{durationLabel(s)}</span>
                {!isOffered && (
                  <Badge variant="secondary" className="mt-0.5 flex">
                    {t(`${O}.notOffered`)}
                  </Badge>
                )}
              </TableCell>
              <TableCell className="whitespace-nowrap max-sm:hidden">{durationLabel(s)}</TableCell>
              <TableCell align="right" className="whitespace-nowrap tabular">
                {priceText(s)}
                <span className="block text-xs text-muted-foreground">{taxRuleLabel(s.taxRule)}</span>
              </TableCell>
            </TableRow>
          )
        })}
      </TableBody>
    </Table>
  )

  if (!canEdit) return <Frame>{table}</Frame>
  return (
    <SettingsCard
      title={t(`${O}.title`)}
      description={t(`${O}.editDescription`)}
      dirty={dirty}
      pending={save.isPending}
      onSubmit={submit}
      footer={
        <FormActions
          dirty={dirty}
          pending={save.isPending}
          onCancel={() => {
            setExcluded(saved)
            setRefusal(null)
          }}
        />
      }
    >
      {table}
      <p className="text-xs text-muted-foreground" aria-live="polite">
        {notOffered === 0 ? t(`${O}.allOffered`) : t(notOffered === 1 ? `${O}.someNotOffered.one` : `${O}.someNotOffered.other`, { count: String(notOffered) })}
      </p>
      {refusal && <RefusalAlert message={refusal} />}
    </SettingsCard>
  )
}
