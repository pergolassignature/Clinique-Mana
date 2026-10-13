import { useEffect, useMemo, useState, type FormEvent } from 'react'
import { t } from '@/i18n'
import { useAccess } from '@/core/access/access-context'
import { SegmentedToggle } from '@/shared/components/SegmentedToggle'
import { SettingsCard } from '@/shared/components/SettingsCard'
import { formatClinicDateTime, formatClinicTime, formatInClinicTimezone, getClinicDateString, shiftCalendarDay } from '@/shared/lib/timezone'
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from '@/shared/ui/alert-dialog'
import { Button } from '@/shared/ui/button'
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from '@/shared/ui/dialog'
import { FormField } from '@/shared/ui/form-field'
import { Select } from '@/shared/ui/select'
import { toast } from '@/shared/ui/sonner'
import { StatusDot, type StatusTone } from '@/shared/ui/status-dot'
import type { OpenSlot, Proposition } from '../../api/propositions'
import { useOpenSlots, usePropose, usePropositions, usePropositionServices, useWithdrawProposition } from '../../hooks/use-propositions'
import { useWaitlistLists } from '../../hooks/use-waitlist'
import { demandesError, proposeErrorMessage } from '../../lib/errors'
import { useDemandeRecord } from './record-context'

const P = 'modules.demandes.propositions'
const MAX_SLOTS = 3
const DAYS = 14

function responseText(p: Proposition): { label: string; tone: StatusTone } {
  switch (p.response) {
    case 'pending':
      return { label: t(`${P}.response.pending`, { date: p.expires_at ? formatClinicDateTime(p.expires_at) : '' }), tone: 'info' }
    case 'accepted':
      return { label: t(`${P}.response.accepted`, { date: p.accepted_starts_at ? formatClinicDateTime(p.accepted_starts_at) : '' }), tone: 'success' }
    case 'declined':
      return {
        label: p.decline_reason ? t(`${P}.response.declinedBecause`, { reason: t(`${P}.reasons.${p.decline_reason}`) }) : t(`${P}.response.declined`),
        tone: 'warning',
      }
    case 'expired':
    case 'no_answer':
      return { label: t(`${P}.response.expired`), tone: 'warning' }
    case 'withdrawn':
      return { label: t(`${P}.response.withdrawn`), tone: 'neutral' }
  }
}

/**
 * « Propositions » in Suivi (D3b, D-22): the professionals proposed to the person, their slots held
 * 48 h (Rendez-vous R1b) and the answer — accepted (the first appointment booked, the request
 * matched), declined with its reason, unanswered, withdrawn. « Proposer un professionnel » while the
 * request is « Acceptée » or on the waiting list and nothing is pending (demandes.manage; the slots need Rendez-vous:
 * appointments.view); « Retirer la proposition » frees the slots.
 */
export function PropositionsCard() {
  const { id, bundle, canEdit } = useDemandeRecord()
  const { can } = useAccess()
  const propositions = usePropositions(id)
  const withdraw = useWithdrawProposition(id)
  const [proposing, setProposing] = useState(false)
  const [withdrawing, setWithdrawing] = useState<Proposition | null>(null)
  const rows = propositions.data ?? []
  const pending = rows.some((p) => p.response === 'pending')
  // From « Acceptée », the waiting list, or « Proposée » once its proposal ended (the database says the same).
  const open = ['accepted', 'waitlist', 'proposed'].includes(bundle.demande.state)
  const canPropose = canEdit && open && !pending && can('appointments.view')

  return (
    <SettingsCard as="section" layout="section" title={t(`${P}.title`)} description={t(`${P}.description`)}>
      {propositions.isError && !propositions.data ? (
        <p role="alert" className="text-sm text-destructive">
          {t(`${P}.loadError`)}
        </p>
      ) : rows.length === 0 ? (
        <p className="text-sm text-muted-foreground">{propositions.data ? t(`${P}.none`) : t('common.loading')}</p>
      ) : (
        <ul aria-label={t(`${P}.title`)} className="divide-y divide-border-light">
          {rows.map((p) => {
            const response = responseText(p)
            return (
              <li key={p.id} className="flex flex-wrap items-start justify-between gap-2 py-2">
                <div className="min-w-0 space-y-0.5 text-sm">
                  <p className="font-medium">
                    {p.professional_name}
                    {p.service_name && <span className="font-normal text-muted-foreground"> · {p.service_name}</span>}
                    {p.mode && <span className="font-normal text-muted-foreground"> · {t(`${P}.mode.${p.mode as 'video' | 'phone'}`)}</span>}
                  </p>
                  <p className="inline-flex items-center gap-1.5 text-xs">
                    <StatusDot tone={response.tone} />
                    {response.label}
                  </p>
                  {p.response === 'pending' && p.slots.length > 0 && (
                    <p className="text-xs text-muted-foreground">
                      {t(`${P}.slots`, { slots: p.slots.map((s) => formatClinicDateTime(s.starts_at)).join(' · ') })}
                    </p>
                  )}
                  <p className="text-xs text-muted-foreground">
                    {t(`${P}.by`, { date: formatClinicDateTime(p.proposed_at), name: p.proposed_by_name ?? '' })}
                  </p>
                </div>
                {canEdit && p.response === 'pending' && (
                  <Button type="button" variant="outline" size="sm" onClick={() => setWithdrawing(p)} className="max-sm:h-11">
                    {t(`${P}.withdraw`)}
                  </Button>
                )}
              </li>
            )
          })}
        </ul>
      )}
      {canEdit && open && !pending && !can('appointments.view') && <p className="text-sm text-muted-foreground">{t(`${P}.needsAgenda`)}</p>}
      {canPropose && (
        <div>
          <Button type="button" variant="outline" size="sm" onClick={() => setProposing(true)} className="max-sm:h-11">
            {t(`${P}.open`)}
          </Button>
        </div>
      )}
      <Dialog open={proposing} onOpenChange={setProposing}>
        {proposing && <ProposeForm onDone={() => setProposing(false)} />}
      </Dialog>
      <AlertDialog open={withdrawing !== null} onOpenChange={(next) => !next && setWithdrawing(null)}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>{t(`${P}.withdrawTitle`)}</AlertDialogTitle>
            <AlertDialogDescription>{t(`${P}.withdrawBody`)}</AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>{t('common.cancel')}</AlertDialogCancel>
            <AlertDialogAction
              onClick={() =>
                withdrawing &&
                !withdraw.isPending &&
                withdraw.mutate(withdrawing.id, {
                  onSuccess: () => toast.success(t(`${P}.withdrawn`)),
                  onError: (error) => toast.error(demandesError(error)),
                })
              }
            >
              {t(`${P}.withdraw`)}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </SettingsCard>
  )
}

function ProposeForm({ onDone }: { onDone: () => void }) {
  const { id, bundle } = useDemandeRecord()
  const lists = useWaitlistLists()
  const professionals = (lists.data ?? []).filter((l) => l.target_kind === 'professional').sort((a, b) => a.name.localeCompare(b.name, 'fr'))
  const [professionalId, setProfessionalId] = useState('')
  const [serviceId, setServiceId] = useState('')
  const [mode, setMode] = useState<'video' | 'phone'>(bundle.demande.modality === 'phone' ? 'phone' : 'video')
  const [chosen, setChosen] = useState<string[]>([])
  const [error, setError] = useState<string | null>(null)
  const services = usePropositionServices(professionalId || null)
  const [from] = useState(() => getClinicDateString(new Date()))
  const to = shiftCalendarDay(from, DAYS - 1)
  const slots = useOpenSlots(professionalId || null, serviceId || null, from, to)
  const proposeMutation = usePropose()
  // The previous professional's or service's slots while the new ones load: never offered.
  const fresh = slots.isPlaceholderData ? undefined : slots.data
  useEffect(() => {
    if (fresh) setChosen((current) => current.filter((s) => fresh.some((slot) => slot.starts_at === s)))
  }, [fresh])
  const byDay = useMemo(() => {
    const days = new Map<string, OpenSlot[]>()
    for (const slot of fresh ?? []) {
      const day = getClinicDateString(slot.starts_at)
      days.set(day, [...(days.get(day) ?? []), slot])
    }
    return [...days.entries()]
  }, [fresh])

  const toggle = (startsAt: string) =>
    setChosen((current) => (current.includes(startsAt) ? current.filter((s) => s !== startsAt) : current.length < MAX_SLOTS ? [...current, startsAt] : current))

  const submit = (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault()
    if (proposeMutation.isPending) return
    if (!professionalId || !serviceId || chosen.length === 0) {
      setError(t(`${P}.form.incomplete`))
      return
    }
    setError(null)
    proposeMutation.mutate(
      { demandeId: id, professionalId, serviceId, startsAt: chosen, mode },
      {
        onSuccess: (result) => {
          if (result.emailed) toast.success(t(`${P}.sent`))
          else toast.error(t(`${P}.notEmailed`))
          onDone()
        },
        onError: (failure) => {
          setError(proposeErrorMessage(failure))
          // A slot taken meanwhile: the list is read again.
          void slots.refetch()
        },
      },
    )
  }

  return (
    <DialogContent className="sm:max-w-xl">
      <DialogHeader>
        <DialogTitle>{t(`${P}.form.title`)}</DialogTitle>
        <DialogDescription>{t(`${P}.form.description`)}</DialogDescription>
      </DialogHeader>
      <form onSubmit={submit} noValidate className="space-y-3">
        <FormField label={t(`${P}.form.professional`)}>
          {(field) => (
            <Select
              {...field}
              value={professionalId}
              onChange={(e) => {
                setProfessionalId(e.target.value)
                setServiceId('')
                setChosen([])
              }}
            >
              <option value="">{t(`${P}.form.choose`)}</option>
              {professionals.map((p) => (
                <option key={p.target_id} value={p.target_id}>
                  {p.name}
                </option>
              ))}
            </Select>
          )}
        </FormField>
        <FormField label={t(`${P}.form.service`)}>
          {(field) => (
            <Select
              {...field}
              value={serviceId}
              onChange={(e) => {
                setServiceId(e.target.value)
                setChosen([])
              }}
            >
              <option value="">{t(`${P}.form.choose`)}</option>
              {(services.data ?? []).map((s) => (
                <option key={s.id} value={s.id}>
                  {s.name}
                </option>
              ))}
            </Select>
          )}
        </FormField>
        <div className="space-y-1.5">
          <p className="text-sm font-medium text-foreground">{t(`${P}.form.mode`)}</p>
          <SegmentedToggle
            label={t(`${P}.form.mode`)}
            value={mode}
            onChange={setMode}
            options={[
              { value: 'video', label: t(`${P}.mode.video`) },
              { value: 'phone', label: t(`${P}.mode.phone`) },
            ]}
          />
        </div>
        {professionalId && serviceId && (
          <fieldset className="space-y-2">
            <legend className="text-sm font-medium text-foreground">{t(`${P}.form.slots`, { max: String(MAX_SLOTS), days: String(DAYS) })}</legend>
            {slots.isError ? (
              <p role="alert" className="text-sm text-destructive">
                {t(`${P}.form.slotsError`)}
              </p>
            ) : !fresh ? (
              <p role="status" className="text-sm text-muted-foreground">
                {t('common.loading')}
              </p>
            ) : byDay.length === 0 ? (
              <p className="text-sm text-muted-foreground">{t(`${P}.form.noSlot`)}</p>
            ) : (
              <div className="max-h-72 space-y-2 overflow-y-auto">
                {byDay.map(([day, list]) => (
                  <div key={day} className="space-y-1">
                    <p className="text-xs font-medium text-muted-foreground first-letter:uppercase">
                      {formatInClinicTimezone(list[0]!.starts_at, 'EEEE d MMMM')}
                    </p>
                    <div className="flex flex-wrap gap-2">
                      {list.map((slot) => {
                        const on = chosen.includes(slot.starts_at)
                        const full = !on && chosen.length >= MAX_SLOTS
                        return (
                          <label key={slot.starts_at} className="inline-flex items-center gap-1.5 rounded-md border border-border px-2 py-1 text-sm">
                            <input type="checkbox" checked={on} disabled={full} onChange={() => toggle(slot.starts_at)} className="size-4" />
                            <span className="tabular">{formatClinicTime(slot.starts_at)}</span>
                          </label>
                        )
                      })}
                    </div>
                  </div>
                ))}
              </div>
            )}
          </fieldset>
        )}
        {error && (
          <p role="alert" className="text-sm text-destructive">
            {error}
          </p>
        )}
        <DialogFooter>
          <Button type="submit" aria-disabled={proposeMutation.isPending || undefined}>
            {proposeMutation.isPending ? t(`${P}.form.sending`) : t(`${P}.form.send`, { count: String(chosen.length) })}
          </Button>
        </DialogFooter>
      </form>
    </DialogContent>
  )
}
