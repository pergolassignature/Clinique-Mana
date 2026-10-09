import { useRef, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { t } from '@/i18n'
import { moduleErrorMessage } from '@/core/modules/errors'
import { ignoreWhenInactive, softDisabledClasses } from '@/shared/components/soft-disabled'
import { cn } from '@/shared/lib/utils'
import { Button } from '@/shared/ui/button'
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from '@/shared/ui/dialog'
import { useStartMyProfileUpdate } from '../../hooks/use-my-profile'
import { QUESTIONNAIRE_PATH } from '../../lib/my-profile'
import { DialogRefusal } from '../record/StatusDialogParts'
import { SectionChecklist } from '../SectionChecklist'
import { useSectionChoice } from '../use-section-choice'

const U = 'modules.professionals.myProfile.update'

/**
 * « Mettre mon profil à jour » (Task 4b.5, P4-275): the sections to revise, at least one; « Commencer
 * la mise à jour » opens an update submission and goes to the questionnaire. Nothing on the file
 * changes before the clinic's review, and the dialog says so. A refusal (one already open, the file
 * inactive) stays here.
 */
export function UpdateProfileDialog({ onClose, onCloseAutoFocus }: { onClose: () => void; onCloseAutoFocus?: (event: Event) => void }) {
  const choice = useSectionChoice()
  const start = useStartMyProfileUpdate()
  const navigate = useNavigate()
  const [refusal, setRefusal] = useState<string | null>(null)
  const first = useRef<HTMLButtonElement>(null)
  const calling = useRef(false)
  const pending = start.isPending

  const submit = () => {
    setRefusal(null)
    const sections = choice.sections()
    if (!sections) {
      first.current?.focus()
      return
    }
    if (calling.current) return
    calling.current = true
    start.mutate(sections, {
      onSuccess: () => navigate(QUESTIONNAIRE_PATH),
      onError: (error) => setRefusal(moduleErrorMessage(error, t(`${U}.failed`), 'professionals')),
      onSettled: () => {
        calling.current = false
      },
    })
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
          <DialogTitle>{t(`${U}.title`)}</DialogTitle>
          <DialogDescription>{t(`${U}.body`)}</DialogDescription>
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
          <Button type="button" aria-disabled={pending || undefined} onClick={ignoreWhenInactive(pending, submit)} className={cn(softDisabledClasses, 'aria-disabled:hover:bg-primary')}>
            {pending ? t(`${U}.starting`) : t(`${U}.confirm`)}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}
