import { useState, type FormEvent } from 'react'
import { PhoneCall } from 'lucide-react'
import { t } from '@/i18n'
import { demandesError } from '../lib/errors'
import { clinicTimeToUTC, getClinicDateString, shiftCalendarDay } from '@/shared/lib/timezone'
import { Button } from '@/shared/ui/button'
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle, DialogTrigger } from '@/shared/ui/dialog'
import { FormField, FormRow } from '@/shared/ui/form-field'
import { Select } from '@/shared/ui/select'
import { toast } from '@/shared/ui/sonner'
import { DateField } from '@/shared/ui/date-field'
import { TimeField } from '@/shared/ui/time-field'
import { CONTACT_CHANNELS, CONTACT_OUTCOMES, type ContactChannel, type ContactOutcome } from '../api/demandes'
import { useLogContact } from '../hooks/use-demandes'
import { optionLabel } from '../lib/display'

const L = 'modules.demandes.contact'

/**
 * « Noter un appel » (the quick log): how, what came of it, and when to try again when the person
 * was not reached (the next day at 10 h by default). From the inbox's row or the record.
 */
export function LogContactDialog({ demandeId, person, compact = false }: { demandeId: string; person: string; compact?: boolean }) {
  const [open, setOpen] = useState(false)
  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger asChild>
        <Button type="button" variant="outline" size="sm" aria-label={compact ? t(`${L}.openFor`, { person }) : undefined} className="max-sm:h-11">
          <PhoneCall aria-hidden className="size-3.5" />
          {compact ? <span className="max-md:sr-only">{t(`${L}.open`)}</span> : t(`${L}.open`)}
        </Button>
      </DialogTrigger>
      {open && <LogContactForm demandeId={demandeId} person={person} onDone={() => setOpen(false)} />}
    </Dialog>
  )
}

function LogContactForm({ demandeId, person, onDone }: { demandeId: string; person: string; onDone: () => void }) {
  const log = useLogContact()
  const [channel, setChannel] = useState<ContactChannel>('phone')
  const [outcome, setOutcome] = useState<ContactOutcome>('no_answer')
  const [date, setDate] = useState(() => shiftCalendarDay(getClinicDateString(new Date()), 1))
  const [time, setTime] = useState('10:00')
  const [error, setError] = useState<string | null>(null)
  const retry = outcome !== 'reached'

  const submit = (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault()
    if (log.isPending) return
    setError(null)
    const next = retry && date && time ? clinicTimeToUTC(date, time) : null
    log.mutate(
      { id: demandeId, channel, outcome, nextContactAt: next },
      {
        onSuccess: () => {
          toast.success(t(`${L}.saved`))
          onDone()
        },
        onError: (failure) => setError(demandesError(failure)),
      },
    )
  }

  return (
    <DialogContent>
      <DialogHeader>
        <DialogTitle>{t(`${L}.title`, { person })}</DialogTitle>
        <DialogDescription>{t(`${L}.description`)}</DialogDescription>
      </DialogHeader>
      <form onSubmit={submit} noValidate className="space-y-3">
        <FormRow>
          <FormField label={t(`${L}.channel`)}>
            {(field) => (
              <Select {...field} value={channel} onChange={(e) => setChannel(e.target.value as ContactChannel)}>
                {CONTACT_CHANNELS.map((c) => (
                  <option key={c} value={c}>
                    {optionLabel('contactChannel', c)}
                  </option>
                ))}
              </Select>
            )}
          </FormField>
          <FormField label={t(`${L}.outcome`)}>
            {(field) => (
              <Select {...field} value={outcome} onChange={(e) => setOutcome(e.target.value as ContactOutcome)}>
                {CONTACT_OUTCOMES.map((o) => (
                  <option key={o} value={o}>
                    {optionLabel('outcome', o)}
                  </option>
                ))}
              </Select>
            )}
          </FormField>
        </FormRow>
        {retry && (
          <FormRow>
            <FormField label={t(`${L}.nextDate`)} help={t(`${L}.nextHelp`)}>
              {(field) => <DateField {...field} value={date} onChange={setDate} />}
            </FormField>
            <FormField label={t(`${L}.nextTime`)}>{(field) => <TimeField {...field} value={time} onChange={setTime} />}</FormField>
          </FormRow>
        )}
        {error && (
          <p role="alert" className="text-sm text-destructive">
            {error}
          </p>
        )}
        <DialogFooter>
          <Button type="submit" aria-disabled={log.isPending || undefined}>
            {log.isPending ? t(`${L}.saving`) : t(`${L}.save`)}
          </Button>
        </DialogFooter>
      </form>
    </DialogContent>
  )
}
