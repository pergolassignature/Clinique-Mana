import { useState } from 'react'
import { Link, useParams } from 'react-router-dom'
import { CreditCard } from 'lucide-react'
import { t } from '@/i18n'
import { useAccess } from '@/core/access/access-context'
import { LoadError, Loading } from '@/shared/components/LoadState'
import { RefusalAlert } from '@/shared/components/RefusalAlert'
import { formatClinicDateShort } from '@/shared/lib/timezone'
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from '@/shared/ui/alert-dialog'
import { Badge } from '@/shared/ui/badge'
import { Button } from '@/shared/ui/button'
import { toast } from '@/shared/ui/sonner'
import type { StripeCharge, StripePayer } from '../api/stripe'
import { stripeErrorMessage } from '../api/stripe-errors'
import { useChargeNow, useClientStripe, useRemoveCard, useSendCardLink } from '../hooks/use-stripe'
import { cardLabel, chargeStatusLabel, chargeStatusVariant, failureLabel } from '../lib/stripe'
import { formatPay } from '../lib/payroll'

const S = 'modules.billing.stripe.panel'

/**
 * « Carte au dossier » in Clients' « Visites et paiements » (slot `client.visits`, FS): for the
 * client and her default payer, the card on file (brand, last four digits, expiry, the date of the
 * consent; never the number), « Envoyer le lien pour enregistrer une carte », « Retirer la carte »,
 * and the last charges, with « Prélever maintenant » after a refusal. Actions need billing.manage.
 */
export function ClientCardPanel() {
  const { id = '' } = useParams()
  const { can } = useAccess()
  const stripe = useClientStripe(id)
  const [refusal, setRefusal] = useState<string | null>(null)
  if (stripe.isError && !stripe.data) {
    return <LoadError message={t(`${S}.loadError`)} onRetry={() => void stripe.refetch()} retrying={stripe.isFetching} />
  }
  if (!stripe.data) return <Loading />
  const manage = can('billing.manage')
  return (
    <section className="space-y-3" aria-label={t(`${S}.title`)}>
      <h2 className="flex items-center gap-2 text-base font-semibold">
        <CreditCard aria-hidden className="h-4 w-4" />
        {t(`${S}.title`)}
      </h2>
      {!stripe.data.configured ? (
        <p className="text-sm text-muted-foreground">{t(`${S}.notConfigured`)}</p>
      ) : (
        <>
          {refusal && <RefusalAlert message={refusal} />}
          <ul className="space-y-3">
            {stripe.data.payers.map((payer) => (
              <PayerRow key={payer.payer_client_id} payer={payer} manage={manage} onError={setRefusal} />
            ))}
          </ul>
        </>
      )}
    </section>
  )
}

function PayerRow({ payer, manage, onError }: { payer: StripePayer; manage: boolean; onError: (message: string | null) => void }) {
  const send = useSendCardLink()
  const remove = useRemoveCard()
  const [confirmRemove, setConfirmRemove] = useState(false)
  const busy = send.isPending || remove.isPending

  const sendLink = () => {
    if (busy) return
    onError(null)
    send.mutateAsync(payer.payer_client_id).then(
      () => toast.success(t(`${S}.linkSent`, { name: payer.name })),
      (failure: unknown) => onError(stripeErrorMessage(failure)),
    )
  }
  const removeIt = () => {
    onError(null)
    remove.mutateAsync(payer.payer_client_id).then(
      () => toast.success(t(`${S}.removed`, { name: payer.name })),
      (failure: unknown) => onError(stripeErrorMessage(failure)),
    )
  }

  return (
    <li className="rounded-md border border-border p-3">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div className="min-w-0 space-y-1">
          <p className="text-sm font-medium">
            {payer.name}
            <span className="ml-2 text-xs font-normal text-muted-foreground">{t(payer.is_self ? `${S}.self` : `${S}.payer`)}</span>
          </p>
          {payer.card ? (
            <p className="text-sm">
              <Badge variant="success">{cardLabel(payer.card)}</Badge>
              {payer.card.consent_at && (
                <span className="ml-2 text-xs text-muted-foreground">
                  {t(`${S}.consentOn`, { date: formatClinicDateShort(payer.card.consent_at) })}
                </span>
              )}
            </p>
          ) : (
            <p className="text-sm text-muted-foreground">
              {payer.link_sent_at ? t(`${S}.linkPending`, { date: formatClinicDateShort(payer.link_sent_at) }) : t(`${S}.noCard`)}
            </p>
          )}
        </div>
        {manage && (
          <div className="flex flex-wrap gap-2">
            {!payer.card && (
              <Button type="button" variant="outline" aria-disabled={busy || undefined} onClick={sendLink}>
                {t(payer.link_sent_at ? `${S}.sendAgain` : `${S}.send`)}
              </Button>
            )}
            {payer.card && (
              <Button type="button" variant="outline" aria-disabled={busy || undefined} onClick={() => !busy && setConfirmRemove(true)}>
                {t(`${S}.remove`)}
              </Button>
            )}
          </div>
        )}
      </div>
      {payer.charges.length > 0 && <Charges charges={payer.charges} manage={manage && payer.card !== null} onError={onError} />}
      {confirmRemove && (
        <AlertDialog open onOpenChange={(open) => !open && setConfirmRemove(false)}>
          <AlertDialogContent>
            <AlertDialogHeader>
              <AlertDialogTitle>{t(`${S}.removeTitle`)}</AlertDialogTitle>
              <AlertDialogDescription>{t(`${S}.removeBody`, { name: payer.name })}</AlertDialogDescription>
            </AlertDialogHeader>
            <AlertDialogFooter>
              <AlertDialogCancel>{t('common.cancel')}</AlertDialogCancel>
              <AlertDialogAction onClick={removeIt}>{t(`${S}.remove`)}</AlertDialogAction>
            </AlertDialogFooter>
          </AlertDialogContent>
        </AlertDialog>
      )}
    </li>
  )
}

function Charges({ charges, manage, onError }: { charges: readonly StripeCharge[]; manage: boolean; onError: (message: string | null) => void }) {
  const charge = useChargeNow()
  const retry = (c: StripeCharge) => {
    if (charge.isPending) return
    onError(null)
    charge.mutateAsync(c.invoice_id).then(
      (result) =>
        result.status === 'succeeded'
          ? toast.success(t(`${S}.charged`))
          : result.status === 'pending'
            ? toast.success(t(`${S}.chargePending`))
            : onError(t(`${S}.chargeRefused`, { reason: failureLabel(result.failure_code) })),
      (failure: unknown) => onError(stripeErrorMessage(failure)),
    )
  }
  // « Prélever maintenant » only on an invoice's latest charge, refused, never after a success
  // (charges come newest first).
  const retryable = new Set(
    [...new Set(charges.map((c) => c.invoice_id))].flatMap((invoiceId) => {
      const own = charges.filter((c) => c.invoice_id === invoiceId)
      const latest = own[0]
      return latest && latest.status === 'failed' && !own.some((c) => c.status === 'succeeded') ? [latest.id] : []
    }),
  )
  return (
    <ul className="mt-3 space-y-1 border-t border-border-light pt-2" aria-label={t(`${S}.charges`)}>
      {charges.map((c) => (
        <li key={c.id} className="flex flex-wrap items-center gap-x-3 gap-y-1 text-sm">
          <span className="text-muted-foreground">{formatClinicDateShort(c.created_at)}</span>
          <Link to={`/facturation/factures/${c.invoice_id}`} className="underline-offset-2 hover:underline">
            {t(`${S}.invoice`, { number: c.invoice_number ?? '' })}
          </Link>
          <span className="tabular">{formatPay(c.amount_cents)}</span>
          <Badge variant={chargeStatusVariant(c.status)}>{chargeStatusLabel(c.status)}</Badge>
          {c.status === 'failed' && <span className="text-xs text-muted-foreground">{failureLabel(c.failure_code)}</span>}
          {manage && retryable.has(c.id) && (
            <Button type="button" variant="link" aria-disabled={charge.isPending || undefined} onClick={() => retry(c)}>
              {t(`${S}.chargeNow`)}
            </Button>
          )}
        </li>
      ))}
    </ul>
  )
}
