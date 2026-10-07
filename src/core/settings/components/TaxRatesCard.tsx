import { useRef, useState } from 'react'
import { CircleAlert, Trash2 } from 'lucide-react'
import { t } from '@/i18n'
import { moduleErrorMessage } from '@/core/modules/errors'
import { useSettingsSection } from '@/core/settings/section-context'
import type { Tax, TaxRate } from '@/core/settings/tax/api'
import { useDeleteTaxRate, useTaxRates } from '@/core/settings/tax/hooks'
import { canDeleteTaxRate, lastDayOf, taxRateStatus, type TaxRateStatus } from '@/core/settings/tax/rates'
import { EmptyState } from '@/shared/components/EmptyState'
import { SettingsCard } from '@/shared/components/SettingsCard'
import { ignoreWhenInactive, softDisabledClasses } from '@/shared/components/soft-disabled'
import { formatRate } from '@/shared/lib/format'
import { formatDateOnlyShort, getClinicDateString } from '@/shared/lib/timezone'
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
import { Badge, type BadgeProps } from '@/shared/ui/badge'
import { Button } from '@/shared/ui/button'
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/shared/ui/table'
import { NewTaxRateDialog } from './NewTaxRateDialog'

/** Phone: 8 px cell padding, none at the edges (the columns line up with the card title). */
const PHONE_TABLE = 'max-sm:[&_td]:px-2 max-sm:[&_th]:px-2 max-sm:[&_td:first-child]:pl-0 max-sm:[&_th:first-child]:pl-0 max-sm:[&_td:last-child]:pr-0 max-sm:[&_th:last-child]:pr-0'

const STATUS_BADGE: Record<TaxRateStatus, BadgeProps['variant']> = {
  current: 'success',
  upcoming: 'info',
  ended: 'secondary',
}

/**
 * One tax (TPS or TVQ): its dated rates as a table, newest first, with « Nouveau taux » and, on the
 * one row the database will let go, « Supprimer » behind a confirmation. Not a form: read-only
 * hides both buttons (buttons do not inherit read-only). Statuses are computed against the
 * clinic's date; the dates are date-only and shown without any timezone conversion.
 */
export function TaxRatesCard({ tax }: { tax: Tax }) {
  const { readOnly } = useSettingsSection()
  const { data, isPending, isError, isFetching, refetch } = useTaxRates()
  const remove = useDeleteTaxRate()
  const [toDelete, setToDelete] = useState<TaxRate | null>(null)
  // The row's « Supprimer » that opened the confirmation, and « Nouveau taux »: where focus returns.
  const deleteTriggerRef = useRef<HTMLButtonElement | null>(null)
  const addButtonRef = useRef<HTMLButtonElement>(null)

  const title = t(`settings.tax.taxes.${tax}.title`)
  const today = getClinicDateString(new Date())
  const now = Date.now()
  const rates = data?.filter((rate) => rate.tax === tax) ?? []
  const deletable = new Set(readOnly || !data ? [] : rates.filter((rate) => canDeleteTaxRate(rate, data, today, now)).map((rate) => rate.id))

  const closeConfirm = (open: boolean) => {
    if (open || remove.isPending) return
    remove.reset()
    setToDelete(null)
  }

  let content
  if (isPending) {
    content = (
      <p role="status" className="text-sm text-muted-foreground">
        {t('common.loading')}
      </p>
    )
  } else if (isError && !data) {
    content = (
      <div role="alert" className="flex flex-wrap items-center gap-3">
        <p className="text-sm text-muted-foreground">{t('settings.tax.rates.loadError')}</p>
        <Button variant="outline" size="sm" disabled={isFetching} onClick={() => void refetch()}>
          {t('common.retry')}
        </Button>
      </div>
    )
  } else if (rates.length === 0) {
    content = <EmptyState title={t('settings.tax.rates.empty')} />
  } else {
    content = (
      // On a phone the table fits the card: tighter cells, the end date under the start date (its
      // column hidden), an icon for « Supprimer ». It still scrolls sideways if a value is wider.
      <Table scrollLabel={t('settings.tax.rates.scrollLabel', { tax: title })} className={PHONE_TABLE}>
        <TableHeader>
          {/* Headers on one line: on a phone the table scrolls sideways rather than wrapping them. */}
          <TableRow className="[&>th]:whitespace-nowrap">
            <TableHead>{t('settings.tax.rates.rate')}</TableHead>
            <TableHead>{t('settings.tax.rates.from')}</TableHead>
            <TableHead className="max-sm:hidden">{t('settings.tax.rates.to')}</TableHead>
            <TableHead>{t('settings.tax.rates.status')}</TableHead>
            {deletable.size > 0 && (
              <TableHead>
                <span className="sr-only">{t('settings.tax.rates.actions')}</span>
              </TableHead>
            )}
          </TableRow>
        </TableHeader>
        <TableBody>
          {rates.map((rate) => {
            const status = taxRateStatus(rate, today)
            const lastDay = lastDayOf(rate.effective_to)
            return (
              <TableRow key={rate.id}>
                <TableCell className="whitespace-nowrap font-medium">{formatRate(rate.rate)}</TableCell>
                <TableCell className="whitespace-nowrap">
                  {formatDateOnlyShort(rate.effective_from)}
                  {lastDay !== null && (
                    <span className="block text-xs text-muted-foreground sm:hidden">
                      {t('settings.tax.rates.until', { date: formatDateOnlyShort(lastDay) })}
                    </span>
                  )}
                </TableCell>
                <TableCell className="whitespace-nowrap max-sm:hidden">{lastDay === null ? '—' : formatDateOnlyShort(lastDay)}</TableCell>
                <TableCell>
                  <Badge variant={STATUS_BADGE[status]}>{t(`settings.tax.rates.statuses.${status}`)}</Badge>
                </TableCell>
                {deletable.size > 0 && (
                  <TableCell className="py-1 text-right">
                    {deletable.has(rate.id) && (
                      <Button
                        type="button"
                        variant="ghost"
                        size="sm"
                        className="max-sm:w-7 max-sm:px-0"
                        aria-label={t('settings.tax.rates.deleteLabel', {
                          rate: formatRate(rate.rate),
                          date: formatDateOnlyShort(rate.effective_from),
                        })}
                        onClick={(event) => {
                          deleteTriggerRef.current = event.currentTarget
                          setToDelete(rate)
                        }}
                      >
                        <Trash2 aria-hidden className="sm:hidden" />
                        <span className="max-sm:sr-only">{t('settings.tax.rates.delete')}</span>
                      </Button>
                    )}
                  </TableCell>
                )}
              </TableRow>
            )
          })}
        </TableBody>
      </Table>
    )
  }

  return (
    <SettingsCard
      as="section"
      title={title}
      description={t(`settings.tax.taxes.${tax}.description`)}
      footer={readOnly ? undefined : <NewTaxRateDialog ref={addButtonRef} tax={tax} taxLabel={title} />}
    >
      {content}
      <AlertDialog open={toDelete !== null} onOpenChange={closeConfirm}>
        <AlertDialogContent
          onCloseAutoFocus={(event) => {
            // Back to the row's « Supprimer » when it is still there (cancelled), else to « Nouveau taux ».
            event.preventDefault()
            const trigger = deleteTriggerRef.current
            ;(trigger?.isConnected ? trigger : addButtonRef.current)?.focus()
          }}
        >
          {toDelete && (
            <>
              <AlertDialogHeader>
                <AlertDialogTitle>{t('settings.tax.rates.confirmTitle')}</AlertDialogTitle>
                <AlertDialogDescription>
                  {t('settings.tax.rates.confirmBody', {
                    rate: formatRate(toDelete.rate),
                    date: formatDateOnlyShort(toDelete.effective_from),
                  })}
                </AlertDialogDescription>
              </AlertDialogHeader>
              {remove.isError && (
                <Alert variant="destructive" role="alert">
                  <CircleAlert aria-hidden />
                  <AlertDescription className="text-foreground">
                    {moduleErrorMessage(remove.error, t('common.errors.generic'), 'settings')}
                  </AlertDescription>
                </Alert>
              )}
              <AlertDialogFooter>
                {/* Radix focuses Cancel first: keeping the rate is the safe default. */}
                <AlertDialogCancel>{t('common.cancel')}</AlertDialogCancel>
                <Button
                  type="button"
                  variant="destructive"
                  aria-disabled={remove.isPending || undefined}
                  onClick={ignoreWhenInactive(remove.isPending, () =>
                    remove.mutate(toDelete.id, {
                      onSuccess: () => {
                        remove.reset()
                        setToDelete(null)
                      },
                    }),
                  )}
                  className={cn(softDisabledClasses, 'aria-disabled:hover:bg-destructive')}
                >
                  {remove.isPending ? t('settings.tax.rates.deleting') : t('settings.tax.rates.delete')}
                </Button>
              </AlertDialogFooter>
            </>
          )}
        </AlertDialogContent>
      </AlertDialog>
    </SettingsCard>
  )
}
