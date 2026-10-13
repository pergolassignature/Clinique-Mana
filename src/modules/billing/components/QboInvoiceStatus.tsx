import { t } from '@/i18n'
import { formatClinicDateTime } from '@/shared/lib/timezone'
import { StatusDot } from '@/shared/ui/status-dot'
import { useInvoicePushStatus } from '../hooks/use-quickbooks'
import { pushErrorText } from '../lib/qbo-push'

const P = 'modules.billing.qbo.push'

/**
 * An issued invoice's state in QuickBooks (FQ part 2), one line beside its badges: « Dans
 * QuickBooks depuis le … », « En attente d'envoi à QuickBooks » (paused, or not reached yet),
 * « Envoi à QuickBooks refusé : … ». Nothing when the clinic has no QuickBooks.
 */
export function QboInvoiceStatus({ invoiceId }: { invoiceId: string }) {
  const status = useInvoicePushStatus(invoiceId)
  if (!status.data || !status.data.connected) return null
  const own = status.data.pushes.find((p) => p.kind === 'invoice')
  let tone: 'success' | 'warning' | 'neutral' = 'neutral'
  let text: string
  if (own?.status === 'pushed') {
    tone = own.amount_mismatch ? 'warning' : 'success'
    text = own.amount_mismatch
      ? t(`${P}.invoiceMismatch`)
      : t(`${P}.invoicePushed`, { date: own.pushed_at ? formatClinicDateTime(own.pushed_at) : '' })
  } else if (own?.status === 'failed' || (own?.status === 'pending' && own.last_error_code)) {
    tone = 'warning'
    text = t(`${P}.invoiceRefused`, { why: pushErrorText(own.last_error_code) ?? '' })
  } else {
    text = status.data.paused ? t(`${P}.invoicePaused`) : t(`${P}.invoiceWaiting`)
  }
  return (
    <span className="inline-flex items-center gap-1.5 text-xs text-muted-foreground">
      <StatusDot tone={tone} />
      {text}
    </span>
  )
}
