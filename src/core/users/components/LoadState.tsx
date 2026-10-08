import { t } from '@/i18n'
import { Button } from '@/shared/ui/button'

/** « Chargement… », announced politely. */
export function Loading() {
  return (
    <p role="status" className="text-sm text-muted-foreground">
      {t('common.loading')}
    </p>
  )
}

/** A failed load, with « Réessayer » (inactive while the retry runs). */
export function LoadError({ message, onRetry, retrying }: { message: string; onRetry: () => void; retrying: boolean }) {
  return (
    <div role="alert" className="flex flex-wrap items-center gap-3">
      <p className="text-sm text-muted-foreground">{message}</p>
      <Button variant="outline" size="sm" disabled={retrying} onClick={onRetry}>
        {t('common.retry')}
      </Button>
    </div>
  )
}
