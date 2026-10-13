import { useEffect, useState } from 'react'
import { Search } from 'lucide-react'
import { t } from '@/i18n'
import { SETTINGS_BASE_PATH } from '@/core/settings/paths'
import { GuardedNavLink } from '@/shared/components/GuardedNavLink'
import { LoadError, Loading } from '@/shared/components/LoadState'
import { PageHeader } from '@/shared/components/PageHeader'
import { SectionSurface } from '@/shared/components/SettingsCard'
import { ignoreWhenInactive, softDisabledClasses } from '@/shared/components/soft-disabled'
import { formatClinicDateShort } from '@/shared/lib/timezone'
import { cn } from '@/shared/lib/utils'
import { Badge } from '@/shared/ui/badge'
import { Button } from '@/shared/ui/button'
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle, DialogTrigger } from '@/shared/ui/dialog'
import { Input } from '@/shared/ui/input'
import { toast } from '@/shared/ui/sonner'
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/shared/ui/tabs'
import { billingErrorMessage } from '../../api/errors'
import { MATCH_PAGE_SIZE, type ClientRef, type CustomerMatch, type MatchDecision, type MatchStatus } from '../../api/quickbooks'
import { useClientSearch, useDecideMatch, useMatchCounts, useMatches, useQboSettings } from '../../hooks/use-quickbooks'
import { MATCH_TABS, reasonText } from '../../lib/qbo-status'

const C = 'modules.billing.qbo.customers'
const SEARCH_DELAY_MS = 300

/** « N° 123 · Alice Tremblay ». */
const fileLabel = (client: Pick<ClientRef, 'client_number' | 'display_name'>) =>
  t(`${C}.file`, { number: String(client.client_number), name: client.display_name })

/**
 * Paramètres → Correspondance des clients QuickBooks (plan §8, FQ; `billing.settings`): each
 * customer of the QuickBooks company (those GOrendezvous made) matched to a client file with
 * Clients' own duplicate rules, so the push never makes a second customer for the same person
 * (R-30). Four views, as real tabs (decision #35): « À décider » (a possible match, several
 * files, or a file already linked to another customer), « Rattachés », « Sans correspondance »,
 * « Ignorés ». Nothing here writes to QuickBooks (FQ-4).
 */
export function QuickBooksCustomersPage() {
  const settings = useQboSettings()
  const counts = useMatchCounts()
  const [status, setStatus] = useState<MatchStatus>('to_decide')
  const [typed, setTyped] = useState('')
  const [search, setSearch] = useState('')
  const [page, setPage] = useState(0)

  useEffect(() => {
    if (typed === search) return
    const timer = setTimeout(() => {
      setSearch(typed)
      setPage(0)
    }, SEARCH_DELAY_MS)
    return () => clearTimeout(timer)
  }, [typed, search])

  const connection = settings.data?.connection ?? null
  const connected = connection !== null && connection.status !== 'disconnected'

  let body
  if (settings.isError && !settings.data) {
    body = <LoadError message={t(`${C}.loadError`)} retrying={settings.isFetching} onRetry={() => void settings.refetch()} />
  } else if (!settings.data) {
    body = <Loading />
  } else if (!connected || !connection.customers_synced_at) {
    body = (
      <p className="text-sm text-muted-foreground">
        {t(connected ? `${C}.syncFirst` : `${C}.connectFirst`)}{' '}
        <GuardedNavLink to={`${SETTINGS_BASE_PATH}/quickbooks`} className="text-link underline-offset-[3px] hover:underline">
          {t('modules.billing.qbo.title')}
        </GuardedNavLink>
      </p>
    )
  } else {
    body = (
      <div className="space-y-4">
        <p className="text-xs text-muted-foreground">{t(`${C}.readAt`, { date: formatClinicDateShort(connection.customers_synced_at) })}</p>
        <Tabs
          value={status}
          onValueChange={(next) => {
            setStatus(next as MatchStatus)
            setPage(0)
          }}
        >
          <TabsList aria-label={t(`${C}.views`)} className="flex-wrap">
            {MATCH_TABS.map((tab) => (
              <TabsTrigger key={tab} value={tab}>
                {t(`${C}.tabs.${tab}`)}
                {counts.data && <span className="tabular ml-1.5 text-muted-foreground">{counts.data[tab]}</span>}
              </TabsTrigger>
            ))}
          </TabsList>
          {MATCH_TABS.map((tab) => (
            <TabsContent key={tab} value={tab} className="space-y-4 pt-3">
              <p className="text-sm text-muted-foreground">{t(`${C}.tabHelp.${tab}`)}</p>
              <div className="relative max-w-sm">
                <Search aria-hidden className="pointer-events-none absolute left-2.5 top-1/2 size-4 -translate-y-1/2 text-muted-foreground" />
                <Input
                  type="search"
                  aria-label={t(`${C}.search`)}
                  placeholder={t(`${C}.searchPlaceholder`)}
                  value={typed}
                  onChange={(event) => setTyped(event.target.value)}
                  className="pl-8"
                  autoComplete="off"
                />
              </div>
              <MatchList status={tab} search={search} page={page} onPage={setPage} />
            </TabsContent>
          ))}
        </Tabs>
      </div>
    )
  }

  return (
    <div className="max-w-content space-y-5">
      <PageHeader level={1} title={t(`${C}.title`)} description={t(`${C}.description`)} />
      <SectionSurface>{body}</SectionSurface>
    </div>
  )
}

function MatchList({ status, search, page, onPage }: { status: MatchStatus; search: string; page: number; onPage: (page: number) => void }) {
  const matches = useMatches(status, search, page)
  if (matches.isError && !matches.data) {
    return <LoadError message={t(`${C}.listError`)} retrying={matches.isFetching} onRetry={() => void matches.refetch()} />
  }
  if (!matches.data) return <Loading />
  if (matches.data.length === 0) {
    return <p className="text-sm text-muted-foreground">{search.trim() ? t(`${C}.noResult`) : t(`${C}.empty.${status}`)}</p>
  }
  return (
    <div className="space-y-3">
      <ul aria-label={t(`${C}.tabs.${status}`)} className="divide-y divide-border-light">
        {matches.data.map((match) => (
          <MatchRow key={match.qbo_id} match={match} />
        ))}
      </ul>
      {(page > 0 || matches.data.length === MATCH_PAGE_SIZE) && (
        <div className="flex flex-wrap items-center gap-2">
          <Button type="button" variant="outline" size="sm" disabled={page === 0} onClick={() => onPage(page - 1)} className="max-sm:h-11">
            {t(`${C}.previous`)}
          </Button>
          <Button
            type="button"
            variant="outline"
            size="sm"
            disabled={matches.data.length < MATCH_PAGE_SIZE}
            onClick={() => onPage(page + 1)}
            className="max-sm:h-11"
          >
            {t(`${C}.next`)}
          </Button>
        </div>
      )}
    </div>
  )
}

/** One customer: who QuickBooks names, and what to do with it. */
function MatchRow({ match }: { match: CustomerMatch }) {
  const decide = useDecideMatch()
  const run = (decision: MatchDecision) =>
    decide.mutate(
      { qboId: match.qbo_id, decision },
      {
        onSuccess: (next) => toast.success(t(`${C}.done.${next}`, { customer: match.display_name })),
        onError: (error) => toast.error(billingErrorMessage(error)),
      },
    )
  const contact = [match.email, ...match.phones].filter(Boolean).join(' · ')
  const reasons = match.reasons.map(reasonText).filter((r): r is string => r !== null)
  const pending = decide.isPending
  const actionClass = cn(softDisabledClasses, 'max-sm:h-11')

  return (
    <li className="space-y-2 py-3 first:pt-0 last:pb-0">
      <div className="flex flex-wrap items-center gap-x-2 gap-y-1">
        <span className="min-w-0 break-words font-medium text-foreground">{match.display_name}</span>
        {!match.active && <Badge variant="outline">{t(`${C}.inactive`)}</Badge>}
        {match.status === 'to_decide' && match.level !== 'none' && (
          <Badge variant={match.level === 'high' ? 'success' : 'warning'}>{t(`${C}.levels.${match.level}`)}</Badge>
        )}
      </div>
      {contact && <p className="break-words text-xs text-muted-foreground">{contact}</p>}

      {match.status === 'linked' && match.client && (
        <p className="text-sm text-foreground">
          {t(match.source === 'manual' ? `${C}.linkedManual` : `${C}.linkedAuto`, { file: fileLabel(match.client) })}
        </p>
      )}
      {match.status === 'to_decide' && match.candidates.length > 0 && (
        <div className="space-y-1.5">
          <p className="text-sm text-foreground">{t(`${C}.candidates`)}</p>
          <ul className="space-y-1.5">
            {match.candidates.map((candidate) => (
              <li key={candidate.id} className="flex flex-wrap items-center gap-2">
                <span className="text-sm text-foreground">{fileLabel(candidate)}</span>
                {candidate.email && <span className="text-xs text-muted-foreground">{candidate.email}</span>}
                <Button
                  type="button"
                  variant="outline"
                  size="sm"
                  aria-label={t(`${C}.linkTo`, { customer: match.display_name, file: fileLabel(candidate) })}
                  aria-disabled={pending || undefined}
                  onClick={ignoreWhenInactive(pending, () => run({ decision: 'link', clientId: candidate.id }))}
                  className={actionClass}
                >
                  {t(`${C}.link`)}
                </Button>
              </li>
            ))}
          </ul>
          {reasons.length > 0 && <p className="text-xs text-muted-foreground">{t(`${C}.why`, { reasons: reasons.join(', ') })}</p>}
        </div>
      )}
      {match.status === 'ignored' && match.decided_at && (
        <p className="text-sm text-muted-foreground">{t(`${C}.ignoredOn`, { date: formatClinicDateShort(match.decided_at) })}</p>
      )}

      <div className="flex flex-wrap items-center gap-2">
        {(match.status === 'to_decide' || match.status === 'no_match') && (
          <LinkOtherDialog match={match} onPick={(clientId) => run({ decision: 'link', clientId })} pending={pending} />
        )}
        {match.status !== 'ignored' && (
          <Button
            type="button"
            variant="ghost"
            size="sm"
            aria-disabled={pending || undefined}
            onClick={ignoreWhenInactive(pending, () => run({ decision: 'ignore' }))}
            className={actionClass}
          >
            {t(`${C}.ignore`)}
          </Button>
        )}
        {(match.source === 'manual' || match.status === 'ignored') && (
          <Button
            type="button"
            variant="ghost"
            size="sm"
            aria-disabled={pending || undefined}
            onClick={ignoreWhenInactive(pending, () => run({ decision: 'reset' }))}
            className={actionClass}
          >
            {t(`${C}.reset`)}
          </Button>
        )}
      </div>
    </li>
  )
}

/** « Chercher un dossier… »: Clients' search, then « Rattacher » on a result. */
function LinkOtherDialog({ match, onPick, pending }: { match: CustomerMatch; onPick: (clientId: string) => void; pending: boolean }) {
  const [open, setOpen] = useState(false)
  const [query, setQuery] = useState('')
  const results = useClientSearch(query)
  return (
    <Dialog
      open={open}
      onOpenChange={(next) => {
        setOpen(next)
        if (!next) setQuery('')
      }}
    >
      <DialogTrigger asChild>
        <Button type="button" variant="outline" size="sm" className="max-sm:h-11">
          {t(`${C}.searchFile`)}
        </Button>
      </DialogTrigger>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>{t(`${C}.searchFileTitle`, { customer: match.display_name })}</DialogTitle>
          <DialogDescription>{t(`${C}.searchFileHelp`)}</DialogDescription>
        </DialogHeader>
        <Input
          type="search"
          aria-label={t(`${C}.searchFileLabel`)}
          placeholder={t(`${C}.searchFilePlaceholder`)}
          value={query}
          onChange={(event) => setQuery(event.target.value)}
          autoComplete="off"
          autoFocus
        />
        <div role="status" className="min-h-6 text-sm">
          {query.trim().length >= 2 && results.data && results.data.length === 0 && <p className="text-muted-foreground">{t(`${C}.searchFileNone`)}</p>}
        </div>
        {results.data && results.data.length > 0 && (
          <ul aria-label={t(`${C}.searchFileResults`)} className="divide-y divide-border-light">
            {results.data.map((client) => {
              const file = fileLabel({ client_number: client.client_number, display_name: `${client.first_name} ${client.last_name}` })
              return (
                <li key={client.id} className="flex flex-wrap items-center justify-between gap-2 py-2">
                  <span className="min-w-0 text-sm text-foreground">
                    {file}
                    {client.is_archived && <span className="ml-1 text-xs text-muted-foreground">{t(`${C}.archived`)}</span>}
                  </span>
                  <Button
                    type="button"
                    variant="outline"
                    size="sm"
                    aria-label={t(`${C}.linkTo`, { customer: match.display_name, file })}
                    aria-disabled={pending || undefined}
                    onClick={ignoreWhenInactive(pending, () => {
                      onPick(client.id)
                      setOpen(false)
                    })}
                    className={cn(softDisabledClasses, 'max-sm:h-11')}
                  >
                    {t(`${C}.link`)}
                  </Button>
                </li>
              )
            })}
          </ul>
        )}
      </DialogContent>
    </Dialog>
  )
}
