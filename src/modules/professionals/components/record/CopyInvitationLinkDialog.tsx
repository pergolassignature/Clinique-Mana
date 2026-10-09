import { useId, useRef, useState } from 'react'
import { Copy } from 'lucide-react'
import { t } from '@/i18n'
import { rpcErrorHint } from '@/core/modules/errors'
import { ignoreWhenInactive, softDisabledClasses } from '@/shared/components/soft-disabled'
import { formatClinicDateShort } from '@/shared/lib/timezone'
import { cn } from '@/shared/lib/utils'
import { Alert, AlertDescription } from '@/shared/ui/alert'
import { AlertDialog, AlertDialogContent, AlertDialogDescription, AlertDialogFooter, AlertDialogHeader, AlertDialogTitle } from '@/shared/ui/alert-dialog'
import { Button } from '@/shared/ui/button'
import { Input } from '@/shared/ui/input'
import { Label } from '@/shared/ui/label'
import type { CopiedInvitationLink } from '../../api/invitations'
import { useCopyInvitationLink } from '../../hooks/use-invitations'
import { useProfessionalsSettings } from '../../hooks/use-professionals-settings'
import { fullName } from '../../lib/display'
import { isLiveInvitation, shortDate } from '../../lib/onboarding'
import { useRecordData } from './record-context'
import type { StatusDialogProps } from './status-dialog'
import { DialogCancel, DialogRefusal } from './StatusDialogParts'

const D = 'modules.professionals.onboarding.copyLink'

/** As InvitationDialog: after these refusals (by HINT) a retry cannot work; « Fermer » only. */
const FINAL_REFUSALS: ReadonlySet<string> = new Set(['account', 'status'])

/**
 * « Copier le lien d'invitation » (P4-491, Jonathan, 2026-10-09): for someone with
 * `professionals.invite` who must hand the link over another way (the email did not leave, a texto).
 * First the confirmation (a new link, the live one stops working, no email), then the link, once:
 * read-only with « Copier » and the warning (« Ne le transmettez qu'à cette personne. Il expire le
 * … »). The link lives in this component's state only: the mutation has `gcTime: 0` and is reset
 * as soon as the link is held, and closing the dialog unmounts it (the opener mounts it while open).
 */
export function CopyInvitationLinkDialog({ onClose, onCloseAutoFocus }: StatusDialogProps) {
  const { record, onboarding } = useRecordData()
  const { professional } = record
  const [link, setLink] = useState<CopiedInvitationLink | null>(null)
  const [refusal, setRefusal] = useState<string | null>(null)
  const [final, setFinal] = useState(false)
  const [copied, setCopied] = useState<'done' | 'failed' | null>(null)
  const calling = useRef(false)
  const field = useRef<HTMLInputElement>(null)
  const id = useId()
  const copy = useCopyInvitationLink({
    onErrorMessage: (message, error) => {
      setRefusal(message)
      const hint = rpcErrorHint(error)
      if (hint && FINAL_REFUSALS.has(hint)) setFinal(true)
    },
  })
  const settings = useProfessionalsSettings(link === null)
  const pending = copy.isPending
  const now = Date.now()
  const invitation = onboarding?.invitation ?? null
  const live = isLiveInvitation(invitation, now)
  const days = settings.data?.invitationExpiryDays
  const values = { name: fullName(professional), firstName: professional.firstName }

  const create = () => {
    if (calling.current || final) return
    calling.current = true
    setRefusal(null)
    copy.mutate(
      { id: professional.id },
      {
        onSuccess: (data) => {
          setLink(data)
          // Nothing but this component keeps the link.
          copy.reset()
        },
        onSettled: () => {
          calling.current = false
        },
      },
    )
  }

  const toClipboard = async () => {
    if (!link) return
    try {
      await navigator.clipboard.writeText(link.url)
      setCopied('done')
    } catch {
      setCopied('failed')
      field.current?.select()
    }
  }

  return (
    <AlertDialog open onOpenChange={(open) => !open && !pending && onClose()}>
      <AlertDialogContent aria-busy={pending || undefined} onCloseAutoFocus={onCloseAutoFocus}>
        {link === null ? (
          <>
            <AlertDialogHeader>
              <AlertDialogTitle>{t(`${D}.title`, values)}</AlertDialogTitle>
              <AlertDialogDescription>
                {t(`${D}.body`, values)}
                {live && invitation && ` ${t(`${D}.previous`, { sent: shortDate(invitation.sentAt, now) })}`}
                {days !== undefined &&
                  ` ${t(days > 1 ? 'modules.professionals.onboarding.dialog.validForOther' : 'modules.professionals.onboarding.dialog.validForOne', { count: String(days) })}`}
              </AlertDialogDescription>
            </AlertDialogHeader>
            <DialogRefusal message={refusal ?? undefined} />
            <AlertDialogFooter>
              <DialogCancel saving={pending} nothingToConfirm={final} />
              {!final && (
                <Button
                  type="button"
                  aria-disabled={pending || undefined}
                  onClick={ignoreWhenInactive(pending, create)}
                  className={cn(softDisabledClasses, 'aria-disabled:hover:bg-primary')}
                >
                  {pending ? t(`${D}.creating`) : t(`${D}.confirm`)}
                </Button>
              )}
            </AlertDialogFooter>
          </>
        ) : (
          <>
            <AlertDialogHeader>
              <AlertDialogTitle>{t(`${D}.readyTitle`, values)}</AlertDialogTitle>
              <AlertDialogDescription>{t(`${D}.warning`, { firstName: professional.firstName, date: formatClinicDateShort(link.expiresAt) })}</AlertDialogDescription>
            </AlertDialogHeader>
            <div className="space-y-1">
              <Label htmlFor={id}>{t(`${D}.label`)}</Label>
              <div className="flex min-w-0 items-center gap-2">
                <Input
                  ref={field}
                  id={id}
                  readOnly
                  value={link.url}
                  spellCheck={false}
                  autoComplete="off"
                  aria-describedby={`${id}-once`}
                  onFocus={(event) => event.currentTarget.select()}
                  className="min-w-0 flex-1"
                />
                <Button type="button" variant="outline" onClick={() => void toClipboard()} className="max-sm:h-11">
                  <Copy aria-hidden className="size-3.5" />
                  {t(`${D}.copy`)}
                </Button>
              </div>
              <p id={`${id}-once`} className="text-xs text-muted-foreground">
                {t(`${D}.once`)}
              </p>
              <p role="status" className="text-sm">
                {copied === 'done' && t(`${D}.copied`)}
              </p>
            </div>
            {copied === 'failed' && (
              <Alert role="alert">
                <AlertDescription>{t(`${D}.copyFailed`)}</AlertDescription>
              </Alert>
            )}
            <AlertDialogFooter>
              <DialogCancel saving={false} nothingToConfirm />
            </AlertDialogFooter>
          </>
        )}
      </AlertDialogContent>
    </AlertDialog>
  )
}
