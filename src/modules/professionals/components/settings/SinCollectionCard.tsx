import { useId, useRef, useState } from 'react'
import { t } from '@/i18n'
import { LoadError } from '@/shared/components/LoadState'
import { SettingsCard } from '@/shared/components/SettingsCard'
import { ignoreWhenInactive, softDisabledClasses } from '@/shared/components/soft-disabled'
import { cn } from '@/shared/lib/utils'
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
import { Label } from '@/shared/ui/label'
import { Switch } from '@/shared/ui/switch'
import { useProfessionalsSettings, useSaveProfessionalsSettings } from '../../hooks/use-professionals-settings'
import { RefusalAlert } from '../compensation/DatedRowParts'

const N = 'modules.professionals.settings.compensation.sin'

/**
 * « Renseignements fiscaux » (`professionals.private` and `professionals.settings`): the switch
 * « Recueillir le NAS » (P4-7), saved at once. Turning it on asks first (only on the accountant's
 * word); turning it off needs no confirmation: nothing is erased (a stored SIN stays readable and
 * removable). Space or a click toggles it, never an arrow key. A failed read shows « Réessayer »,
 * never a switch that would read « off » without knowing.
 */
export function SinCollectionCard() {
  const settings = useProfessionalsSettings()
  const [confirming, setConfirming] = useState(false)
  const [refusal, setRefusal] = useState<string | null>(null)
  const save = useSaveProfessionalsSettings({ onErrorMessage: (message) => setRefusal(message) })
  const switchRef = useRef<HTMLButtonElement>(null)
  const id = useId()
  const collect = settings.data?.collectSin ?? false
  const pending = save.isPending

  const apply = (next: boolean, onDone?: () => void) => {
    setRefusal(null)
    save.mutate({ collectSin: next }, { onSuccess: onDone })
  }

  return (
    <SettingsCard as="section" title={t(`${N}.title`)} description={t(`${N}.description`)}>
      {settings.isError && !settings.data ? (
        <LoadError message={t(`${N}.loadError`)} retrying={settings.isFetching} onRetry={() => void settings.refetch()} />
      ) : (
        <div className="flex items-start justify-between gap-4">
          <div className="min-w-0 space-y-0.5">
            <Label htmlFor={`${id}-switch`}>{t(`${N}.collect`)}</Label>
            <p id={`${id}-help`} className="text-xs text-muted-foreground">
              {t(`${N}.collectHelp`)}
            </p>
          </div>
          <Switch
            ref={switchRef}
            id={`${id}-switch`}
            checked={pending && save.variables ? Boolean(save.variables.collectSin) : collect}
            aria-describedby={`${id}-help`}
            aria-disabled={pending || settings.isPending || undefined}
            className={cn('mt-0.5', pending && 'cursor-progress')}
            onCheckedChange={(checked) => {
              if (pending || settings.isPending) return
              if (checked) setConfirming(true)
              else apply(false)
            }}
          />
        </div>
      )}
      {!confirming && refusal && <RefusalAlert message={refusal} />}
      <AlertDialog open={confirming} onOpenChange={(next) => !pending && !next && setConfirming(false)}>
        <AlertDialogContent
          onCloseAutoFocus={(event) => {
            event.preventDefault()
            switchRef.current?.focus()
          }}
        >
          <AlertDialogHeader>
            <AlertDialogTitle>{t(`${N}.confirmTitle`)}</AlertDialogTitle>
            <AlertDialogDescription>{t(`${N}.confirmBody`)}</AlertDialogDescription>
          </AlertDialogHeader>
          {refusal && <RefusalAlert message={refusal} />}
          <AlertDialogFooter>
            <AlertDialogCancel
              aria-disabled={pending || undefined}
              onClick={ignoreWhenInactive(pending, () => setRefusal(null))}
              className={cn(softDisabledClasses, 'aria-disabled:hover:border-border aria-disabled:hover:bg-card')}
            >
              {t('common.cancel')}
            </AlertDialogCancel>
            <Button
              type="button"
              aria-disabled={pending || undefined}
              onClick={ignoreWhenInactive(pending, () => apply(true, () => setConfirming(false)))}
              className={cn(softDisabledClasses, 'aria-disabled:hover:bg-primary')}
            >
              {pending ? t(`${N}.confirming`) : t(`${N}.confirm`)}
            </Button>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </SettingsCard>
  )
}
