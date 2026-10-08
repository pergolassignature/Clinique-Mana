import type { Ref } from 'react'
import { t } from '@/i18n'
import { cn } from '@/shared/lib/utils'
import { Button } from '@/shared/ui/button'

/** « Chargement… », announced politely. */
export function Loading({ className }: { className?: string }) {
  return (
    <p role="status" className={cn('text-sm text-muted-foreground', className)}>
      {t('common.loading')}
    </p>
  )
}

interface LoadErrorProps {
  message: string
  onRetry: () => void
  /** The retry is running: « Réessayer » is inactive meanwhile. */
  retrying: boolean
  /** « Réessayer », for a page that returns focus to it. */
  retryRef?: Ref<HTMLButtonElement>
  className?: string
}

/** A failed load, with « Réessayer » (inactive while the retry runs). */
export function LoadError({ message, onRetry, retrying, retryRef, className }: LoadErrorProps) {
  return (
    <div role="alert" className={cn('flex flex-wrap items-center gap-3', className)}>
      <p className="text-sm text-muted-foreground">{message}</p>
      <Button ref={retryRef} variant="outline" size="sm" disabled={retrying} onClick={onRetry}>
        {t('common.retry')}
      </Button>
    </div>
  )
}
