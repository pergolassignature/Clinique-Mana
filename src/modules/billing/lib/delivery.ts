import { t } from '@/i18n'
import { formatClinicDateTime } from '@/shared/lib/timezone'
import type { Delivery } from '../api/invoices'

const D = 'modules.billing.invoice.delivery'

/** What happened to a document's last delivery, in plain French (« il faut toujours être clair »). */
export function deliveryText(delivery: Delivery | undefined): string | null {
  if (!delivery) return null
  if (delivery.status === 'pending' || delivery.status === 'sending') return t(`${D}.pending`)
  if (delivery.status === 'failed') return t(`${D}.failed`)
  if (delivery.emailStatus === 'sent') return t(`${D}.sent`, { date: formatClinicDateTime(delivery.finishedAt ?? delivery.createdAt) })
  if (delivery.emailStatus === 'failed') return t(`${D}.emailFailed`)
  return t(`${D}.${delivery.skipReason ?? 'not_requested'}`)
}
