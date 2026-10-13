import { createElement, Suspense, useCallback, useMemo, useState } from 'react'
import { Link, Navigate, useNavigate, useParams } from 'react-router-dom'
import { t } from '@/i18n'
import { useAccess, useReadyAccess } from '@/core/access/access-context'
import { demandesError } from '../lib/errors'
import { FullPageMessage } from '@/shared/components/FullPageMessage'
import { LoadError, Loading } from '@/shared/components/LoadState'
import { RouteBoundary } from '@/shared/components/RouteBoundary'
import { ignoreWhenInactive, softDisabledClasses } from '@/shared/components/soft-disabled'
import { lazyPage } from '@/shared/lib/lazy-page'
import { formatClinicDateTime, formatClinicTime } from '@/shared/lib/timezone'
import { useGuardedTabs } from '@/shared/lib/unsaved-changes-context'
import { usePageTitle } from '@/shared/lib/use-page-title'
import { cn } from '@/shared/lib/utils'
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
import { Button, buttonVariants } from '@/shared/ui/button'
import { Label } from '@/shared/ui/label'
import { Select } from '@/shared/ui/select'
import { Skeleton } from '@/shared/ui/skeleton'
import { toast } from '@/shared/ui/sonner'
import { StatusDot } from '@/shared/ui/status-dot'
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/shared/ui/tabs'
import { CLOSED_REASONS, type ClosedReason, type DemandeBundle, type DemandeState } from '../api/demandes'
import { LogContactDialog } from '../components/LogContactDialog'
import { RegisterWaitlistDialog } from '../components/waitlist/RegisterWaitlistDialog'
import { DemandeRecordContext, type DemandeRecordData } from '../components/record/record-context'
import { useAssignDemande, useDemande, useDemandesRealtime, useDemandesReference, useSetDemandeState, useSetHandler } from '../hooks/use-demandes'
import { useDemandeWaitlist } from '../hooks/use-waitlist'
import { RECORD_TABS, demandePath, nextStates, optionLabel, personLabel, promiseText, stateLabel, stateTone, type RecordTab } from '../lib/display'

const R = 'modules.demandes.record'
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i

/** Each tab is its own chunk, read from the record's bundle (never a refetch). */
const PANELS: Record<RecordTab, ReturnType<typeof lazyPage>> = {
  accueil: lazyPage(() => import('../components/record/IntakeTab'), 'IntakeTab'),
  participants: lazyPage(() => import('../components/record/ParticipantsTab'), 'ParticipantsTab'),
  suivi: lazyPage(() => import('../components/record/FollowUpTab'), 'FollowUpTab'),
  jumelage: lazyPage(() => import('../components/record/MatchingTab'), 'MatchingTab'),
  historique: lazyPage(() => import('../components/record/HistoryTab'), 'HistoryTab'),
}

/**
 * A request's record (plan §10 D2): the header (who, the number, the state and its moves, the
 * promise, the counselor, « Je m'en occupe », « Noter un appel ») and the page-level tabs
 * (Accueil, Participants, Suivi, Historique: real Radix tabs, decision #35; the tab is the URL's
 * last segment). One request for the bundle; live: another counselor's change reads it again.
 */
export function DemandeRecordPage() {
  const { id = '', onglet } = useParams()
  return UUID.test(id) ? <RecordView key={id} id={id} onglet={onglet} /> : <NotFound />
}

function NotFound() {
  return (
    <FullPageMessage
      role="alert"
      title={t(`${R}.notFound.title`)}
      body={t(`${R}.notFound.body`)}
      action={
        <Link to="/demandes" className={buttonVariants({ variant: 'outline' })}>
          {t(`${R}.back`)}
        </Link>
      }
    />
  )
}

function RecordView({ id, onglet }: { id: string; onglet: string | undefined }) {
  const navigate = useNavigate()
  const record = useDemande(id)
  const reference = useDemandesReference()
  useDemandesRealtime(true)
  const bundle = record.data
  usePageTitle(bundle ? `${bundle.demande.reference} · ${personLabel(bundle.demande)}` : t('modules.demandes.name'), { crumb: Boolean(bundle) })
  const { can } = useAccess()
  const canMatch = can('professionals.view')
  const tabs = useMemo(() => RECORD_TABS.filter((tab) => tab !== 'jumelage' || canMatch), [canMatch])
  const current = tabs.find((tab) => tab === onglet)
  const isTab = useCallback((value: string): value is RecordTab => (tabs as readonly string[]).includes(value), [tabs])
  const { onValueChange, triggerProps } = useGuardedTabs(current ?? 'accueil', isTab, (tab) => navigate(demandePath(id, tab), { replace: true }))
  const value = useMemo<DemandeRecordData | null>(
    () =>
      bundle && reference.data ? { id, bundle, reference: reference.data, canEdit: bundle.can.manage && bundle.demande.state !== 'closed' } : null,
    [id, bundle, reference.data],
  )

  if (bundle === null) return <NotFound />
  if (!current) return <Navigate to={demandePath(id)} replace />
  const failed = [record, reference].filter((q) => q.isError && q.data === undefined)
  if (failed.length > 0) {
    return <LoadError message={t(`${R}.loadError`)} onRetry={() => failed.forEach((q) => void q.refetch())} retrying={failed.some((q) => q.isFetching)} />
  }
  if (!value) {
    return (
      <div role="status" aria-label={t('common.loading')} className="space-y-3">
        <Skeleton className="h-7 w-64" />
        <Skeleton className="h-4 w-96 max-w-full" />
        <Skeleton className="h-9 w-80 max-w-full" />
      </div>
    )
  }

  return (
    <DemandeRecordContext.Provider value={value}>
      <Tabs value={current} onValueChange={onValueChange}>
        <div className="space-y-4">
          <RecordHeader data={value} />
          <TabsList aria-label={t(`${R}.tabs.label`)}>
            {tabs.map((tab) => (
              <TabsTrigger key={tab} value={tab} {...triggerProps(tab)} onPointerEnter={() => void PANELS[tab].preload().catch(() => undefined)}>
                {t(`${R}.tabs.${tab}`)}
                {tab === 'suivi' && value.bundle.tasks.some((k) => k.state === 'open') && (
                  <span className="tabular ml-1.5 text-muted-foreground">{value.bundle.tasks.filter((k) => k.state === 'open').length}</span>
                )}
              </TabsTrigger>
            ))}
          </TabsList>
        </div>
        <TabsContent key={current} value={current} className="mt-5 min-w-0">
          <h2 className="sr-only">{t(`${R}.tabs.${current}`)}</h2>
          <RouteBoundary scope="demandes:record" compact>
            <Suspense fallback={<Loading />}>{createElement(PANELS[current])}</Suspense>
          </RouteBoundary>
        </TabsContent>
      </Tabs>
    </DemandeRecordContext.Provider>
  )
}

function RecordHeader({ data }: { data: DemandeRecordData }) {
  const { bundle } = data
  const d = bundle.demande
  const person = personLabel(d)
  const open = d.state !== 'matched' && d.state !== 'closed'
  const promise = promiseText(d.promise, d.waiting_hours)
  return (
    <header className="space-y-3">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div className="min-w-0 space-y-1">
          <h1 tabIndex={-1} className="text-xl font-semibold tracking-tight">
            {person}
          </h1>
          <p className="flex flex-wrap items-center gap-x-3 gap-y-1 text-sm text-muted-foreground">
            <span className="tabular">{d.reference}</span>
            <span>{t(`${R}.received`, { date: formatClinicDateTime(d.received_at), channel: optionLabel('channel', d.channel) })}</span>
            <span className="inline-flex items-center gap-1.5 text-foreground">
              <StatusDot tone={stateTone(d.state)} />
              {stateLabel(d.state)}
            </span>
            {d.is_urgent && <Badge variant="error">{t(`${R}.urgent`)}</Badge>}
            {open && (
              <span className="inline-flex items-center gap-1.5 text-foreground">
                <StatusDot tone={promise.tone} />
                {promise.label}
              </span>
            )}
          </p>
          {bundle.client ? (
            <p className="text-sm">
              <Link to={`/clients/${bundle.client.id}`} className="text-link underline-offset-2 hover:underline">
                {t(`${R}.openFile`, { number: String(bundle.client.client_number) })}
              </Link>
            </p>
          ) : (
            <p className="text-sm text-muted-foreground">{t(`${R}.noFile`)}</p>
          )}
          {d.state === 'closed' && d.closed_reason && (
            <p className="text-sm text-foreground">{t(`${R}.closedBecause`, { reason: optionLabel('closedReason', d.closed_reason) })}</p>
          )}
        </div>
        {bundle.can.manage && open && <LogContactDialog demandeId={data.id} person={person} />}
      </div>
      {bundle.can.manage && (
        <div className="flex flex-wrap items-end gap-3">
          <StateControl data={data} />
          <AssignControl data={data} />
          {open && <HandlerControl bundle={bundle} id={data.id} />}
        </div>
      )}
    </header>
  )
}

/**
 * « État » and its moves; closing asks for the reason; « Liste d'attente » registers the request
 * on a list (D-15) unless it already has an open entry (back from « Proposée » or « Acceptée »).
 */
function StateControl({ data }: { data: DemandeRecordData }) {
  const d = data.bundle.demande
  const { can } = useAccess()
  const setState = useSetDemandeState(data.id)
  const entries = useDemandeWaitlist(data.id)
  const [registering, setRegistering] = useState(false)
  const [closing, setClosing] = useState(false)
  const [reason, setReason] = useState<ClosedReason>('not_relevant')
  const move = (state: DemandeState, closedReason: ClosedReason | null) =>
    setState.mutate(
      { state, closedReason },
      {
        onSuccess: () => toast.success(t(`${R}.stateChanged`, { state: stateLabel(state) })),
        onError: (error) => toast.error(demandesError(error)),
      },
    )
  return (
    <div className="space-y-1">
      <Label htmlFor="demande-state">{t(`${R}.changeState`)}</Label>
      <Select
        id="demande-state"
        value=""
        disabled={setState.isPending}
        onChange={(event) => {
          const next = event.target.value as DemandeState
          if (!next) return
          if (next === 'closed') setClosing(true)
          // The entries not read yet: wait (never register a request that is already on a list).
          else if (next === 'waitlist' && !entries.data) toast.error(t('common.loading'))
          else if (next === 'waitlist' && !entries.data!.some((e) => e.state !== 'closed')) {
            if (can('demandes.waitlist')) setRegistering(true)
            else toast.error(t(`${R}.waitlistPermission`))
          } else move(next, null)
        }}
        className="w-56"
      >
        <option value="">{t(`${R}.chooseState`)}</option>
        {nextStates(d.state).map((s) => (
          <option key={s} value={s}>
            {t(`${R}.moveTo`, { state: stateLabel(s) })}
          </option>
        ))}
      </Select>
      <RegisterWaitlistDialog demandeId={data.id} hasFile={data.bundle.client !== null} open={registering} onOpenChange={setRegistering} />
      <AlertDialog open={closing} onOpenChange={setClosing}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>{t(`${R}.close.title`)}</AlertDialogTitle>
            <AlertDialogDescription>{t(`${R}.close.body`)}</AlertDialogDescription>
          </AlertDialogHeader>
          <div className="space-y-1">
            <Label htmlFor="demande-close-reason">{t(`${R}.close.reason`)}</Label>
            <Select id="demande-close-reason" value={reason} onChange={(event) => setReason(event.target.value as ClosedReason)}>
              {CLOSED_REASONS.map((r) => (
                <option key={r} value={r}>
                  {optionLabel('closedReason', r)}
                </option>
              ))}
            </Select>
          </div>
          <AlertDialogFooter>
            <AlertDialogCancel>{t('common.cancel')}</AlertDialogCancel>
            <AlertDialogAction onClick={() => move('closed', reason)}>{t(`${R}.close.action`)}</AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  )
}

/** « Conseillère »: who handles the request (or the shared inbox). */
function AssignControl({ data }: { data: DemandeRecordData }) {
  const assign = useAssignDemande(data.id)
  const d = data.bundle.demande
  return (
    <div className="space-y-1">
      <Label htmlFor="demande-assignee">{t(`${R}.assignee`)}</Label>
      <Select
        id="demande-assignee"
        value={d.assigned_to ?? ''}
        disabled={assign.isPending || d.state === 'closed'}
        onChange={(event) =>
          assign.mutate(event.target.value || null, {
            onSuccess: () => toast.success(t(`${R}.assigned`)),
            onError: (error) => toast.error(demandesError(error)),
          })
        }
        className="w-56"
      >
        <option value="">{t(`${R}.sharedInbox`)}</option>
        {data.reference.workers.map((w) => (
          <option key={w.user_id} value={w.user_id}>
            {w.display_name}
          </option>
        ))}
      </Select>
    </div>
  )
}

/** « Je m'en occupe » (a soft lock, D-13): taking over from someone else asks first. */
function HandlerControl({ bundle, id }: { bundle: DemandeBundle; id: string }) {
  const { user_id: me } = useReadyAccess()
  const handler = useSetHandler()
  const [confirm, setConfirm] = useState(false)
  const d = bundle.demande
  const mine = d.handled_by === me
  const other = d.handled_by !== null && !mine
  const run = (take: boolean) =>
    handler.mutate({ id, take, expected: take ? d.handled_by : null }, { onError: (error) => toast.error(demandesError(error)) })
  return (
    <div className="flex flex-wrap items-center gap-2">
      {other && d.handled_by_name && d.handled_at && (
        <p className="text-sm text-foreground">{t(`${R}.handledBy`, { name: d.handled_by_name, time: formatClinicTime(d.handled_at) })}</p>
      )}
      <Button
        type="button"
        variant={mine ? 'outline' : 'default'}
        aria-disabled={handler.isPending || undefined}
        onClick={ignoreWhenInactive(handler.isPending, () => (mine ? run(false) : other ? setConfirm(true) : run(true)))}
        className={cn(softDisabledClasses, 'max-sm:h-11')}
      >
        {mine ? t(`${R}.release`) : t(`${R}.take`)}
      </Button>
      <AlertDialog open={confirm} onOpenChange={setConfirm}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>{t(`${R}.takeOver.title`)}</AlertDialogTitle>
            <AlertDialogDescription>{t(`${R}.takeOver.body`, { name: d.handled_by_name ?? '' })}</AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>{t('common.cancel')}</AlertDialogCancel>
            <AlertDialogAction onClick={() => run(true)}>{t(`${R}.takeOver.action`)}</AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  )
}
