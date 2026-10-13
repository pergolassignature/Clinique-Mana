import { t } from '@/i18n'
import { Button } from '@/shared/ui/button'

/** Shown while a dirty form's request was changed by someone else (realtime): keep or reload. */
export function StaleNotice({ onReload }: { onReload: () => void }) {
  return (
    <div role="status" className="flex flex-wrap items-center gap-2 rounded-md border border-warning/40 bg-warning/10 px-3 py-2 text-sm">
      <span>{t('modules.demandes.record.stale')}</span>
      <Button type="button" variant="outline" size="sm" onClick={onReload} className="max-sm:h-11">
        {t('modules.demandes.record.reload')}
      </Button>
    </div>
  )
}
