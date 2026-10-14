import { useState, type FormEvent } from 'react'
import { CircleAlert } from 'lucide-react'
import { t } from '@/i18n'
import { CheckboxField } from '@/shared/components/CheckboxField'
import { SaveButton } from '@/shared/components/SaveButton'
import { clinicTimeToUTC } from '@/shared/lib/timezone'
import { Alert, AlertDescription } from '@/shared/ui/alert'
import { Button } from '@/shared/ui/button'
import { Dialog, DialogClose, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from '@/shared/ui/dialog'
import { FormField, FormRow } from '@/shared/ui/form-field'
import { Input } from '@/shared/ui/input'
import { DateField } from '@/shared/ui/date-field'
import { TimeField } from '@/shared/ui/time-field'
import { useBookPersonal } from '../hooks/use-agenda'
import { hhmm, minutesOf } from '../lib/time'

const P = 'modules.appointments.personal'

/**
 * « Rendez-vous personnel » in « Mon agenda » (R3's RPC, R5's screen; AP-17): the professional
 * blocks her own time (a label, the day, the start and the end; « Rendez-vous de travail »). Any
 * time, never over another appointment; the staff see it as « Occupé ».
 */
export function PersonalDialog({
  day: initialDay,
  time,
  onClose,
  onClient,
}: {
  day: string
  time: string
  onClose: () => void
  /** « Plutôt un rendez-vous avec un client » (R-82): the client booking at the same moment. */
  onClient?: () => void
}) {
  const [label, setLabel] = useState('')
  const [day, setDay] = useState(initialDay)
  const [start, setStart] = useState(time)
  const [end, setEnd] = useState(hhmm(Math.min(minutesOf(time) + 60, 23 * 60 + 55)))
  const [work, setWork] = useState(false)
  const [refusal, setRefusal] = useState<string | null>(null)
  const book = useBookPersonal({ onErrorMessage: (m) => setRefusal(m) })

  const submit = (event: FormEvent) => {
    event.preventDefault()
    if (book.isPending || !day || !start || !end) return
    setRefusal(null)
    book.mutate(
      { startsAt: clinicTimeToUTC(day, start), endsAt: clinicTimeToUTC(day, end), label: label.trim() || null, isWork: work },
      { onSuccess: onClose },
    )
  }

  return (
    <Dialog open onOpenChange={(open) => !open && onClose()}>
      <DialogContent className="sm:max-w-lg">
        <DialogHeader>
          <DialogTitle>{t(`${P}.title`)}</DialogTitle>
          <DialogDescription>{t(`${P}.description`)}</DialogDescription>
        </DialogHeader>
        <form noValidate onSubmit={submit} className="grid gap-4">
          <FormField label={t(`${P}.label`)} width="full" help={t(`${P}.labelHelp`)}>
            {(field) => <Input {...field} value={label} onChange={(e) => setLabel(e.target.value)} maxLength={120} />}
          </FormField>
          <FormRow>
            <FormField label={t(`${P}.day`)} width="sm" required>
              {(field) => <DateField {...field} value={day} onChange={setDay} />}
            </FormField>
            <FormField label={t(`${P}.start`)} width="xs" required>
              {(field) => <TimeField {...field} value={start} onChange={setStart} />}
            </FormField>
            <FormField label={t(`${P}.end`)} width="xs" required>
              {(field) => <TimeField {...field} value={end} onChange={setEnd} />}
            </FormField>
          </FormRow>
          <CheckboxField label={t(`${P}.work`)} help={t(`${P}.workHelp`)} checked={work} onCheckedChange={setWork} />
          {refusal && (
            <Alert variant="destructive" role="alert">
              <CircleAlert aria-hidden />
              <AlertDescription className="text-foreground">{refusal}</AlertDescription>
            </Alert>
          )}
          <DialogFooter>
            {onClient && (
              <Button type="button" variant="ghost" className="sm:mr-auto" onClick={onClient}>
                {t(`${P}.withClient`)}
              </Button>
            )}
            <DialogClose asChild>
              <Button type="button" variant="outline">
                {t('common.cancel')}
              </Button>
            </DialogClose>
            <SaveButton pending={book.isPending} label={t(`${P}.save`)} />
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  )
}
