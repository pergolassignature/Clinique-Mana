import { Eye, EyeOff } from 'lucide-react'
import { t } from '@/i18n'
import { ignoreWhenInactive, softDisabledClasses } from '@/shared/components/soft-disabled'
import { cn } from '@/shared/lib/utils'
import { Button } from '@/shared/ui/button'

interface RevealedValueProps {
  /** « •••286 », « ••••4567 ». */
  masked: string
  /** What a screen reader hears instead: « NAS masqué, se terminant par 286 ». */
  maskedLabel: string
  /** The revealed value (component state only), or null while masked. */
  value: string | null
  pending: boolean
  onReveal: () => void
  onHide: () => void
  labels: { show: string; showLabel: string; revealing: string; revealingLabel: string; hide: string; hideLabel: string }
}

/**
 * A masked value with one « Afficher / Masquer » button (Phase 2's bank pattern): the button
 * changes its label, so keyboard focus stays on it; the value is announced when it appears and
 * the masked words when it goes. Nothing here stores the value: the caller's state does.
 */
export function RevealedValue({ masked, maskedLabel, value, pending, onReveal, onHide, labels }: RevealedValueProps) {
  const revealed = value !== null
  return (
    <>
      <span className="flex flex-wrap items-center gap-x-2">
        <span aria-live="polite" translate="no" className="tabular">
          {revealed ? (
            value
          ) : (
            <>
              <span className="sr-only">{maskedLabel}</span>
              <span aria-hidden="true">{masked}</span>
            </>
          )}
        </span>
        <Button
          type="button"
          variant="link"
          size="sm"
          aria-label={revealed ? labels.hideLabel : pending ? labels.revealingLabel : labels.showLabel}
          aria-disabled={pending || undefined}
          onClick={ignoreWhenInactive(pending, revealed ? onHide : onReveal)}
          className={cn(softDisabledClasses, 'aria-disabled:hover:no-underline')}
        >
          {revealed ? <EyeOff aria-hidden /> : <Eye aria-hidden />}
          {revealed ? labels.hide : pending ? labels.revealing : labels.show}
        </Button>
      </span>
      {revealed && <span className="mt-0.5 block text-xs text-muted-foreground">{t('settings.bank.display.autoHide')}</span>}
    </>
  )
}
