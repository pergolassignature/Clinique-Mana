import { useEffect, useLayoutEffect, useState } from 'react'
import * as Sentry from '@sentry/react'
import { useQuery } from '@tanstack/react-query'
import { useLocation } from 'react-router-dom'
import { CircleAlert, CircleCheck } from 'lucide-react'
import { t } from '@/i18n'
import { FunctionCallError } from '@/core/supabase/functions'
import { Loading } from '@/shared/components/LoadState'
import { Button } from '@/shared/ui/button'
import { asPublicLanguage, usePageLanguage, type PublicLanguage } from '@/shared/lib/public-language'
import { useNoIndex, usePageTitle } from '@/shared/lib/use-page-title'
import { answerFollowup, resolveFollowupLink } from '../../api/waitlist'
import { PublicFrame } from './PublicFrame'

/** The page's text in the person's language (the demande's). */
const TEXT = (lang: PublicLanguage) => (lang === 'en' ? 'modules.demandes.waitlist.answerEn' : 'modules.demandes.waitlist.answer') as 'modules.demandes.waitlist.answer'
const TOKEN_SHAPE = /^[A-Za-z0-9_-]{43}$/
const GONE = ['link_invalid', 'link_expired', 'link_used']

/** Each opening is its own query: the key never holds the token. */
let openings = 0

function report(error: unknown) {
  const code = error instanceof FunctionCallError ? error.code : 'internal'
  if (code === 'network' || GONE.includes(code)) return
  const failure = new Error(error instanceof FunctionCallError ? error.message : 'Error')
  failure.name = `FunctionCallError ${code}`
  Sentry.captureException(failure, { tags: { area: 'demandes', code } })
}

/**
 * `/liste-attente/reponse#t=…` (Demandes D3, D-17): the « Souhaitez-vous rester sur la liste
 * d'attente ? » email's link. The token leaves the address bar before any request (never in a log,
 * the history or a query key); `resolve-link` shows the clinic and the list; « Oui, je reste » or
 * « Non, retirez-moi » answers once (`demandes-waitlist-answer`). In the person's language (French or
 * English). Never indexed.
 */
export function WaitlistAnswerPage() {
  useNoIndex()
  const { hash } = useLocation()
  const [token] = useState(() => {
    const value = new URLSearchParams(hash.slice(1)).get('t')
    return value !== null && TOKEN_SHAPE.test(value) ? value : null
  })
  useLayoutEffect(() => {
    if (window.location.hash) window.history.replaceState(window.history.state, '', window.location.pathname + window.location.search)
  }, [])
  const [opening] = useState(() => ++openings)
  const link = useQuery({
    queryKey: ['public-waitlist-answer', opening],
    queryFn: () => resolveFollowupLink(token!),
    enabled: token !== null,
    retry: false,
    staleTime: Infinity,
    gcTime: 0,
    refetchOnWindowFocus: false,
  })
  useEffect(() => {
    if (link.error) report(link.error)
  }, [link.error])
  const lang = asPublicLanguage(link.data?.language)
  const A = TEXT(lang)
  usePageTitle(t(`${A}.title`))
  usePageLanguage(lang)
  const [state, setState] = useState<'idle' | 'pending' | 'stay' | 'leave' | 'error' | 'gone'>('idle')

  const notice = (title: string, text: string, done = false) => (
    <PublicFrame title={title}>
      <p role={done ? undefined : 'alert'} className="flex items-start gap-2 text-sm text-foreground">
        {done ? (
          <CircleCheck aria-hidden className="mt-0.5 size-4 shrink-0 text-success" />
        ) : (
          <CircleAlert aria-hidden className="mt-0.5 size-4 shrink-0 text-warning-strong" />
        )}
        {text}
      </p>
    </PublicFrame>
  )
  if (state === 'stay') return notice(t(`${A}.stayTitle`), t(`${A}.stayBody`), true)
  if (state === 'leave') return notice(t(`${A}.leaveTitle`), t(`${A}.leaveBody`), true)
  if (token === null || state === 'gone') return notice(t(`${A}.title`), t(`${A}.invalid`))
  if (link.isPending) {
    return (
      <PublicFrame title={t(`${A}.title`)}>
        <Loading />
      </PublicFrame>
    )
  }
  if (link.isError) {
    return notice(t(`${A}.title`), link.error instanceof FunctionCallError && GONE.includes(link.error.code) ? t(`${A}.invalid`) : t(`${A}.error`))
  }

  const answer = async (choice: 'stay' | 'leave') => {
    if (state === 'pending') return
    setState('pending')
    try {
      await answerFollowup(token, choice)
      setState(choice)
    } catch (error) {
      report(error)
      setState(error instanceof FunctionCallError && GONE.includes(error.code) ? 'gone' : 'error')
    }
  }
  return (
    <PublicFrame title={t(`${A}.title`)}>
      <div className="space-y-4">
        <p className="text-sm text-foreground">
          {link.data.list_name
            ? t(`${A}.body`, { clinic: link.data.clinic_name, list: link.data.list_name })
            : t(`${A}.bodyNoList`, { clinic: link.data.clinic_name })}
        </p>
        {state === 'error' && (
          <p role="alert" className="text-sm text-destructive">
            {t(`${A}.error`)}
          </p>
        )}
        <div className="flex flex-wrap gap-2">
          <Button type="button" onClick={() => void answer('stay')} aria-disabled={state === 'pending' || undefined}>
            {t(`${A}.stay`)}
          </Button>
          <Button type="button" variant="outline" onClick={() => void answer('leave')} aria-disabled={state === 'pending' || undefined}>
            {t(`${A}.leave`)}
          </Button>
        </div>
      </div>
    </PublicFrame>
  )
}
