import { useId, useState } from 'react'
import { CircleAlert } from 'lucide-react'
import { t } from '@/i18n'
import { ignoreWhenInactive, softDisabledClasses } from '@/shared/components/soft-disabled'
import { cn } from '@/shared/lib/utils'
import { Alert, AlertDescription } from '@/shared/ui/alert'
import {
  AlertDialog,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from '@/shared/ui/alert-dialog'
import { Button } from '@/shared/ui/button'
import { Input } from '@/shared/ui/input'
import { Label } from '@/shared/ui/label'
import type { Client } from '../../api/parse'
import { useAnonymizeClient } from '../../hooks/use-clients'
import { clientNumberLabel, fullName } from '../../lib/display'

const A = 'modules.clients.privacy.anonymize'

/**
 * « Anonymiser le dossier » (plan C4.2, clients.privacy, CL-17): what goes and what stays, then
 * the file's number typed to confirm (a name could be typed by habit; a number is read). Never
 * undone. The record then shows the anonymised file, read-only.
 */
export function AnonymizeDialog({ client, onClose }: { client: Client; onClose: () => void }) {
  const number = clientNumberLabel(client.clientNumber)
  const [typed, setTyped] = useState('')
  const [refusal, setRefusal] = useState<string | null>(null)
  const anonymize = useAnonymizeClient({ onErrorMessage: (message) => setRefusal(message) })
  const inputId = useId()
  const matches = typed.trim().toUpperCase() === number
  const inactive = anonymize.isPending || !matches
  return (
    <AlertDialog open onOpenChange={(open) => !open && !anonymize.isPending && onClose()}>
      <AlertDialogContent>
        <AlertDialogHeader>
          <AlertDialogTitle>{t(`${A}.title`)}</AlertDialogTitle>
          <AlertDialogDescription>{t(`${A}.body`, { client: fullName(client), number })}</AlertDialogDescription>
        </AlertDialogHeader>
        <ul className="list-inside list-disc space-y-1 text-sm">
          <li>{t(`${A}.goes`)}</li>
          <li>{t(`${A}.stays`)}</li>
          <li className="font-medium">{t(`${A}.final`)}</li>
        </ul>
        <div className="space-y-1.5">
          <Label htmlFor={inputId}>{t(`${A}.confirmLabel`, { number })}</Label>
          <Input id={inputId} value={typed} onChange={(event) => setTyped(event.target.value)} autoComplete="off" spellCheck={false} />
        </div>
        {refusal && (
          <Alert variant="destructive" role="alert">
            <CircleAlert aria-hidden />
            <AlertDescription className="text-foreground">{refusal}</AlertDescription>
          </Alert>
        )}
        <AlertDialogFooter>
          <AlertDialogCancel>{t('common.cancel')}</AlertDialogCancel>
          <Button
            type="button"
            variant="destructive"
            aria-disabled={inactive || undefined}
            onClick={ignoreWhenInactive(inactive, () => {
              setRefusal(null)
              anonymize.mutate(client.id, { onSuccess: onClose })
            })}
            className={cn(softDisabledClasses, 'aria-disabled:hover:bg-destructive')}
          >
            {t(anonymize.isPending ? `${A}.submitting` : `${A}.submit`)}
          </Button>
        </AlertDialogFooter>
      </AlertDialogContent>
    </AlertDialog>
  )
}
