import { useRef, useState } from 'react'
import { t } from '@/i18n'
import { ignoreWhenInactive, softDisabledClasses } from '@/shared/components/soft-disabled'
import { cn } from '@/shared/lib/utils'
import { Button } from '@/shared/ui/button'
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from '@/shared/ui/dialog'
import { useRequestUpdate } from '../../hooks/use-invitations'
import { fullName } from '../../lib/display'
import { SectionChecklist } from '../SectionChecklist'
import { useSectionChoice } from '../use-section-choice'
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
  const choice = useSectionChoice()
  const [refusal, setRefusal] = useState<string | null>(null)
  const mutation = useRequestUpdate({ onErrorMessage: (message) => setRefusal(message) })
  const pending = mutation.isPending
  const first = useRef<HTMLButtonElement>(null)
  // One call at a time: a second press before the first renders as pending is ignored.
  const calling = useRef(false)

  const submit = () => {
    setRefusal(null)
    const sections = choice.sections()
    if (!sections) {
      first.current?.focus()
      return
    }
    if (calling.current) return
    calling.current = true
    mutation.mutate(
      { id: professional.id, sections, email: professional.email, firstName: professional.firstName },
      {
        onSuccess: onClose,
        onSettled: () => {
          calling.current = false
        },
      },
    )
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
        <SectionChecklist choice={choice} legend={t(`${U}.legend`)} requiredMessage={t(`${U}.required`)} disabled={pending} firstRef={first} />
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
