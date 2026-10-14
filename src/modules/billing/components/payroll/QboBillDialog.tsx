import { useState } from 'react'
import { t } from '@/i18n'
import { RefusalAlert } from '@/shared/components/RefusalAlert'
import { Button } from '@/shared/ui/button'
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from '@/shared/ui/dialog'
import { qboBillErrorMessage } from '../../api/payroll-errors'
import { useCheckQboBillVoided } from '../../hooks/use-payroll'

const P = 'modules.billing.payroll.period'

interface QboBillDialogProps {
  periodId: string
  billId: string
  /** `billing.settings` too: may force the removal without asking QuickBooks (BI-27). */
  canForce: boolean
  onCleared: () => void
  onForce: () => void
  onClose: () => void
}

/**
 * « Bill annulé dans QuickBooks » (BI-27): once the Bill is deleted in QuickBooks, « Vérifier dans
 * QuickBooks » asks it (`qbo-bill-check`) and the clinic forgets the Bill only when QuickBooks no
 * longer has it. Whoever also manages QuickBooks may force the removal (`onForce`) when QuickBooks
 * cannot be reached.
 */
export function QboBillDialog({ periodId, billId, canForce, onCleared, onForce, onClose }: QboBillDialogProps) {
  const check = useCheckQboBillVoided()
  const [error, setError] = useState<string | null>(null)
  const busy = check.isPending

  const verify = async () => {
    if (busy) return
    setError(null)
    try {
      await check.mutateAsync(periodId)
      onCleared()
    } catch (failure) {
      setError(qboBillErrorMessage(failure))
    }
  }

  return (
    <Dialog open onOpenChange={(open) => !open && !busy && onClose()}>
      <DialogContent aria-busy={busy || undefined}>
        <DialogHeader>
          <DialogTitle>{t(`${P}.billDialog.title`)}</DialogTitle>
          <DialogDescription>{t(`${P}.billDialog.description`, { bill: billId })}</DialogDescription>
        </DialogHeader>
        {error && <RefusalAlert message={error} />}
        {canForce && (
          <p className="text-sm text-muted-foreground">
            {t(`${P}.billDialog.forceIntro`)}{' '}
            <Button type="button" variant="link" className="h-auto p-0" aria-disabled={busy || undefined} onClick={() => !busy && onForce()}>
              {t(`${P}.billDialog.force`)}
            </Button>
          </p>
        )}
        <DialogFooter>
          <Button type="button" variant="outline" aria-disabled={busy || undefined} onClick={() => !busy && onClose()}>
            {t('common.cancel')}
          </Button>
          <Button type="button" aria-disabled={busy || undefined} onClick={() => void verify()}>
            {busy ? t(`${P}.billDialog.verifying`) : t(`${P}.billDialog.verify`)}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}
