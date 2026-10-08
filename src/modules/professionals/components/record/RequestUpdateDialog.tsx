import { useId, useRef, useState } from 'react'
import { t } from '@/i18n'
import { ignoreWhenInactive, softDisabledClasses } from '@/shared/components/soft-disabled'
import { cn } from '@/shared/lib/utils'
import { Button } from '@/shared/ui/button'
import { Checkbox } from '@/shared/ui/checkbox'
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from '@/shared/ui/dialog'
import { Label } from '@/shared/ui/label'
import { useRequestUpdate } from '../../hooks/use-invitations'
import { SUBMISSION_SECTIONS, type SubmissionSection } from '../../lib/constants'
import { fullName } from '../../lib/display'
import { sectionLabel } from '../../lib/onboarding'
import { useRecordData } from './record-context'
import type { StatusDialogProps } from './status-dialog'
import { DialogRefusal } from './StatusDialogParts'

const U = 'modules.professionals.onboarding.requestUpdate'

/**
 * « Demander une mise à jour » (Task 4b.3, P4-44): the sections the professional is asked to
 * review, at least one, in the questionnaire's order; « Envoyer la demande » opens an update
 * submission and emails the professional (no link: the questionnaire is behind their sign-in).
 * Nothing in the record changes before the review. Ticking a box changes the draft only
 * (decision #36). A refusal (an account removed, a submission opened meanwhile) stays here, the
 * record refetched.
 */
export function RequestUpdateDialog({ onClose, onCloseAutoFocus }: StatusDialogProps) {
  const { record } = useRecordData()
  const { professional } = record
  const [chosen, setChosen] = useState<ReadonlySet<SubmissionSection>>(new Set())
  const [missing, setMissing] = useState(false)
  const [refusal, setRefusal] = useState<string | null>(null)
  const mutation = useRequestUpdate({ onErrorMessage: (message) => setRefusal(message) })
  const pending = mutation.isPending
  const first = useRef<HTMLButtonElement>(null)
  const errorId = useId()

  const toggle = (section: SubmissionSection, checked: boolean) => {
    const next = new Set(chosen)
    if (checked) next.add(section)
    else next.delete(section)
    setChosen(next)
    if (next.size > 0) setMissing(false)
  }

  const submit = () => {
    setRefusal(null)
    if (chosen.size === 0) {
      setMissing(true)
      first.current?.focus()
      return
    }
    // The questionnaire's order, whatever the order of the clicks.
    const sections = SUBMISSION_SECTIONS.filter((section) => chosen.has(section))
    mutation.mutate({ id: professional.id, sections, email: professional.email, firstName: professional.firstName }, { onSuccess: onClose })
  }

  return (
    <Dialog open onOpenChange={(open) => !open && !pending && onClose()}>
      <DialogContent
        aria-busy={pending || undefined}
        onOpenAutoFocus={(event) => {
          event.preventDefault()
          first.current?.focus()
        }}
        onCloseAutoFocus={onCloseAutoFocus}
      >
        <DialogHeader>
          <DialogTitle>{t(`${U}.title`, { name: fullName(professional) })}</DialogTitle>
          <DialogDescription>{t(`${U}.body`, { firstName: professional.firstName, email: professional.email })}</DialogDescription>
        </DialogHeader>
        <fieldset disabled={pending} aria-describedby={missing ? errorId : undefined} className="min-w-0">
          <legend className="mb-2 text-sm font-medium text-foreground">{t(`${U}.legend`)}</legend>
          <ul className="grid gap-x-4 gap-y-2.5 sm:grid-cols-2">
            {SUBMISSION_SECTIONS.map((section, index) => (
              <li key={section} className="flex items-center gap-2.5">
                <Checkbox
                  ref={index === 0 ? first : undefined}
                  id={`${errorId}-${section}`}
                  checked={chosen.has(section)}
                  onCheckedChange={(value) => toggle(section, value === true)}
                  aria-invalid={missing || undefined}
                />
                <Label htmlFor={`${errorId}-${section}`} className="font-normal">
                  {sectionLabel(section)}
                </Label>
              </li>
            ))}
          </ul>
          {missing && (
            <p id={errorId} role="alert" className="mt-2 text-xs text-destructive">
              {t(`${U}.required`)}
            </p>
          )}
        </fieldset>
        <DialogRefusal message={refusal ?? undefined} />
        <DialogFooter>
          <Button
            type="button"
            variant="outline"
            aria-disabled={pending || undefined}
            onClick={ignoreWhenInactive(pending, onClose)}
            className={cn(softDisabledClasses, 'aria-disabled:hover:border-border aria-disabled:hover:bg-card')}
          >
            {t('common.cancel')}
          </Button>
          <Button
            type="button"
            aria-disabled={pending || undefined}
            onClick={ignoreWhenInactive(pending, submit)}
            className={cn(softDisabledClasses, 'aria-disabled:hover:bg-primary')}
          >
            {pending ? t(`${U}.sending`) : t(`${U}.confirm`)}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}
