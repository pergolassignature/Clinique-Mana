import { useEffect, useLayoutEffect, useState, type ReactNode } from 'react'
import * as Sentry from '@sentry/react'
import { useQuery } from '@tanstack/react-query'
import { useLocation } from 'react-router-dom'
import { CircleAlert, CircleCheck } from 'lucide-react'
import logoUrl from '@/assets/logo-header.svg'
import { t } from '@/i18n'
import { FunctionCallError } from '@/core/supabase/functions'
import { Loading } from '@/shared/components/LoadState'
import { formatDateOnly } from '@/shared/lib/timezone'
import { useNoIndex, usePageTitle } from '@/shared/lib/use-page-title'
import { Button } from '@/shared/ui/button'
import { openCheckout, resolveCardLink, resolvePayLink, type CardLinkDisplay, type PayLinkDisplay } from '../../api/stripe'
import { leaveFor } from '../../lib/leave-for'
import { formatPay } from '../../lib/payroll'

const P = 'modules.billing.stripe.public'
const TOKEN_SHAPE = /^[A-Za-z0-9_-]{43}$/
const GONE = ['link_invalid', 'link_expired', 'link_used']

/** Each opening is its own query: the key never holds the token. */
let openings = 0

function report(error: unknown) {
  const code = error instanceof FunctionCallError ? error.code : 'internal'
  if (code === 'network' || GONE.includes(code)) return
  const failure = new Error(error instanceof FunctionCallError ? error.message : 'Error')
  failure.name = `FunctionCallError ${code}`
  Sentry.captureException(failure, { tags: { area: 'billing', code } })
}

function Frame({ title, children }: { title: string; children: ReactNode }) {
  return (
    <main className="flex min-h-screen justify-center bg-background px-4 py-10">
      <div className="h-fit w-full max-w-2xl rounded-lg border border-border bg-card p-6 sm:p-7">
        <img src={logoUrl} alt={t('app.name')} width={99} height={44} className="mb-5 block h-11 w-auto" />
        <h1 tabIndex={-1} className="text-lg font-semibold text-foreground outline-none">
          {title}
        </h1>
        <div className="mt-5">{children}</div>
      </div>
    </main>
  )
}

function Notice({ title, text, done = false }: { title: string; text: string; done?: boolean }) {
  return (
    <Frame title={title}>
      <p role={done ? undefined : 'alert'} className="flex items-start gap-2 text-sm text-foreground">
        {done ? (
          <CircleCheck aria-hidden className="mt-0.5 size-4 shrink-0 text-success" />
        ) : (
          <CircleAlert aria-hidden className="mt-0.5 size-4 shrink-0 text-warning-strong" />
        )}
        {text}
      </p>
    </Frame>
  )
}

/** The token of `#t=`, read once; the address bar loses it before any request. */
function useLinkToken(): string | null {
  const { hash } = useLocation()
  const [token] = useState(() => {
    const value = new URLSearchParams(hash.slice(1)).get('t')
    return value !== null && TOKEN_SHAPE.test(value) ? value : null
  })
  useLayoutEffect(() => {
    if (window.location.hash) window.history.replaceState(window.history.state, '', window.location.pathname + window.location.search)
  }, [])
  return token
}

/** Back from Stripe: `?etat=merci` or `?etat=annule`. */
function useReturnState(): 'merci' | 'annule' | null {
  const { search } = useLocation()
  const value = new URLSearchParams(search).get('etat')
  return value === 'merci' || value === 'annule' ? value : null
}

type Kind = 'card' | 'pay'

/** Leaves for Stripe Checkout from the link (one use of it); `paid` when the invoice is paid meanwhile. */
function useCheckout(token: string) {
  const [state, setState] = useState<'idle' | 'pending' | 'paid' | 'gone' | 'error'>('idle')
  const go = async () => {
    if (state === 'pending') return
    setState('pending')
    try {
      const answer = await openCheckout(token)
      if (answer.state === 'paid') {
        setState('paid')
        return
      }
      leaveFor(answer.url)
    } catch (error) {
      report(error)
      setState(error instanceof FunctionCallError && GONE.includes(error.code) ? 'gone' : 'error')
    }
  }
  return { state, go }
}

/**
 * `/carte#t=…` (FS): « Enregistrer ma carte », from the card email. The page says what the clinic
 * will do with the card (the authorization the payer gives), then leaves for Stripe Checkout,
 * which collects the card (the clinic never sees its number). Back with `?etat=merci` (the card
 * arrives by Stripe's webhook) or `?etat=annule`. Never indexed.
 */
export function CardSetupPage() {
  return <StripeLinkPage kind="card" />
}

/**
 * `/payer#t=…` (FS-4): « Payer en ligne », from an invoice email: the invoice's number and balance
 * of the moment, then Stripe Checkout. Back with `?etat=merci` (the payment and its receipt follow
 * by Stripe's webhook) or `?etat=annule`. Never indexed.
 */
export function PayPage() {
  return <StripeLinkPage kind="pay" />
}

function StripeLinkPage({ kind }: { kind: Kind }) {
  useNoIndex()
  const K = kind === 'card' ? (`${P}.card` as const) : (`${P}.pay` as const)
  const title = t(`${K}.title`)
  usePageTitle(title)
  const back = useReturnState()
  const token = useLinkToken()
  const [opening] = useState(() => ++openings)
  const link = useQuery({
    queryKey: ['public-billing-link', kind, opening],
    queryFn: (): Promise<CardLinkDisplay | PayLinkDisplay> => (kind === 'card' ? resolveCardLink(token ?? '') : resolvePayLink(token ?? '')),
    enabled: token !== null && back === null,
    retry: false,
    staleTime: Infinity,
    gcTime: 0,
    refetchOnWindowFocus: false,
  })
  useEffect(() => {
    if (link.error) report(link.error)
  }, [link.error])
  const checkout = useCheckout(token ?? '')

  if (back === 'merci') return <Notice title={title} text={t(`${K}.thanks`)} done />
  if (back === 'annule') return <Notice title={title} text={t(`${K}.cancelled`)} />
  if (token === null || checkout.state === 'gone') return <Notice title={title} text={t(`${P}.invalid`)} />
  if (checkout.state === 'paid') return <Notice title={title} text={t(`${P}.pay.alreadyPaid`)} done />
  if (link.isPending) {
    return (
      <Frame title={title}>
        <Loading />
      </Frame>
    )
  }
  if (link.isError) {
    return <Notice title={title} text={link.error instanceof FunctionCallError && GONE.includes(link.error.code) ? t(`${P}.invalid`) : t(`${P}.error`)} />
  }
  const d = link.data
  let body: ReactNode
  if ('first_name' in d) {
    if (d.has_card) return <Notice title={title} text={t(`${P}.card.already`)} done />
    body = (
      <>
        <p className="text-sm text-foreground">{t(`${P}.card.intro`, { name: d.first_name, clinic: d.clinic_name })}</p>
        <p className="rounded-md bg-muted p-3 text-sm text-foreground">{t(`${P}.card.authorization`, { clinic: d.clinic_name })}</p>
        <p className="text-sm text-muted-foreground">{t(`${P}.card.stripe`)}</p>
      </>
    )
  } else {
    if (d.balance_cents <= 0) return <Notice title={title} text={t(`${P}.pay.alreadyPaid`)} done />
    if (!d.available) return <Notice title={title} text={t(`${P}.unavailable`)} />
    body = (
      <>
        <p className="text-sm text-foreground">
          {t(`${P}.pay.intro`, { number: d.invoice_number ?? '', date: d.issued_on ? formatDateOnly(d.issued_on) : '', clinic: d.clinic_name })}
        </p>
        <p className="text-base font-semibold">{t(`${P}.pay.balance`, { amount: formatPay(d.balance_cents) })}</p>
        <p className="text-sm text-muted-foreground">{t(`${P}.pay.stripe`)}</p>
      </>
    )
  }
  return (
    <Frame title={title}>
      <div className="space-y-4">
        {body}
        {checkout.state === 'error' && (
          <p role="alert" className="text-sm text-destructive">
            {t(`${P}.error`)}
          </p>
        )}
        <Button type="button" onClick={() => void checkout.go()} aria-disabled={checkout.state === 'pending' || undefined}>
          {checkout.state === 'pending' ? t(`${P}.opening`) : t(`${K}.button`)}
        </Button>
      </div>
    </Frame>
  )
}
