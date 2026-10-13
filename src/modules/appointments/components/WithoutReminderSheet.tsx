import { X } from 'lucide-react'
import { t } from '@/i18n'
import { EmptyState } from '@/shared/components/EmptyState'
import { LoadError, Loading } from '@/shared/components/LoadState'
import { formatClinicDateFull, formatClinicTime } from '@/shared/lib/timezone'
import { closeButtonClasses } from '@/shared/ui/overlay-classes'
import { Sheet, SheetBody, SheetContent, SheetDescription, SheetHeader, SheetTitle } from '@/shared/ui/sheet'
import { useWithoutReminder } from '../hooks/use-agenda'

const W = 'modules.appointments.withoutReminder'

/**
 * « Clients sans rappel » (plan R4, AP-21): the appointments of the next 7 days no recipient of
 * which can be reached (no email, no text with a consent in force), for the counselors to phone.
 */
export function WithoutReminderSheet({ professionalName, onClose }: { professionalName: (id: string) => string; onClose: () => void }) {
  const list = useWithoutReminder()
  return (
    <Sheet open onOpenChange={(open) => !open && onClose()}>
      <SheetContent hideClose className="max-w-[520px]">
        <button type="button" tabIndex={-1} onClick={onClose} className={closeButtonClasses}>
          <X aria-hidden className="h-4 w-4" />
          <span className="sr-only">{t('common.close')}</span>
        </button>
        <SheetHeader>
          <SheetTitle>{t(`${W}.title`)}</SheetTitle>
          <SheetDescription>{t(`${W}.description`)}</SheetDescription>
        </SheetHeader>
        <SheetBody>
          {list.isError ? (
            <LoadError message={t(`${W}.loadError`)} onRetry={() => void list.refetch()} retrying={list.isFetching} />
          ) : !list.data ? (
            <Loading />
          ) : list.data.length === 0 ? (
            <EmptyState title={t(`${W}.empty`)} />
          ) : (
            <ul className="divide-y divide-border rounded-md border border-border text-sm" aria-label={t(`${W}.title`)}>
              {list.data.map((a) => (
                <li key={a.id} className="space-y-0.5 px-3 py-2">
                  <p className="font-medium">{a.participants.map((p) => p.name).filter(Boolean).join(' et ')}</p>
                  <p className="text-muted-foreground">
                    {formatClinicDateFull(a.startsAt)}, {formatClinicTime(a.startsAt)} · {professionalName(a.professionalId)}
                  </p>
                </li>
              ))}
            </ul>
          )}
        </SheetBody>
      </SheetContent>
    </Sheet>
  )
}
