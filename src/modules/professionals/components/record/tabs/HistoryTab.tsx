import { memo, useEffect, useId, useMemo, useRef, useState, type ReactNode } from 'react'
import { t } from '@/i18n'
import { useAccess } from '@/core/access/access-context'
import { emailStatusLabel } from '@/core/email/status'
import { EmptyState } from '@/shared/components/EmptyState'
import { LoadError, Loading } from '@/shared/components/LoadState'
import { SegmentedToggle } from '@/shared/components/SegmentedToggle'
import { ignoreWhenInactive, softDisabledClasses } from '@/shared/components/soft-disabled'
import { formatClinicTime } from '@/shared/lib/timezone'
import { cn } from '@/shared/lib/utils'
import { Button } from '@/shared/ui/button'
import { Card, CardContent } from '@/shared/ui/card'
import { StatusDot } from '@/shared/ui/status-dot'
import type { SubjectEmail } from '../../../api/invitations'
import { useProfessionalEmails } from '../../../hooks/use-invitations'
import { useProfessionalHistory } from '../../../hooks/use-professional-record'
import {
  buildHistoryEvents,
  buildTimeline,
  groupHistoryByDay,
  HISTORY_FILTERS,
  historyReadsOn,
  professionTitlesByRow,
  settledHistoryRows,
  type HistoryEvent,
  type HistoryFilter,
  type HistoryLine,
  type TimelineEntry,
} from '../../../lib/history'
import { onboardingActionLabel, onboardingActions, type InviteAction } from '../../../lib/onboarding'
import { InvitationDialog } from '../InvitationDialog'
import { CategoryNames, Disclosure } from '../MotifsSummary'
import { useRecordData } from '../record-context'
import { focusAfterClose } from '../status-dialog'
import { TabLink } from '../TabLink'

const H = 'modules.professionals.history'

/**
 * « Historique » (Task 4a.15): the file's audit trail as one timeline, newest first, by clinic
 * day. Each entry reads « {qui} {a fait quoi} » and unfolds to its details; nothing shows raw JSON,
 * an id or a redacted value (D5, Loi 25). Fetched when the tab opens (or on its hover), 50 rows a
 * page; « Charger plus » reads on. The emails about the professional (Task 4b.3: invitations,
 * reminders, update requests) are requested in parallel and merged by time (`buildTimeline`), each
 * with its outcome (« Envoyé », « Livré », « Adresse introuvable », « Échec »); « Tout ·
 * Modifications · Courriels » filters them.
 */
export function HistoryTab() {
  const { record, catalog } = useRecordData()
  const { data, isPending, isError, isFetching, refetch, hasNextPage, fetchNextPage, isFetchingNextPage, isFetchNextPageError } =
    useProfessionalHistory(record.professional.id)
  const emails = useProfessionalEmails(record.professional.id)
  const [filter, setFilter] = useState<HistoryFilter>('all')
  const endRef = useRef<HTMLParagraphElement>(null)
  const loadMorePressed = useRef(false)

  const pages = data?.pages
  const rows = useMemo(() => pages?.flat() ?? [], [pages])
  const settled = useMemo(() => settledHistoryRows(rows, hasNextPage), [rows, hasNextPage])
  const context = useMemo(() => ({ catalog, titleByRow: professionTitlesByRow(rows, record) }), [rows, catalog, record])
  const events = useMemo(() => buildHistoryEvents(settled, context), [settled, context])
  const emailRows = emails.data
  const timeline = useMemo(
    () => buildTimeline(events, emailRows ?? [], { filter, morePages: hasNextPage }),
    [events, emailRows, filter, hasNextPage],
  )
  const days = useMemo(() => groupHistoryByDay(timeline), [timeline])
  // « Renvoyer l'invitation » goes on the newest invitation email only, when it failed.
  const latestInvitationEmail = emailRows?.find((email) => INVITATION_TEMPLATES.has(email.templateKey))?.id

  // A last page that added nothing to the screen (the first page, or the one « Charger plus »
  // brought): only the held-back save, or rows that give no event (draft saves). Read on, page by
  // page, until something shows (P4-101). It stops on an error, an empty page or the end of the
  // history. Each new page re-runs this (`pageCount`): a quick fetch may never render as pending.
  const readsOn = useMemo(() => historyReadsOn(pages ?? [], hasNextPage, context), [pages, hasNextPage, context])
  const chaining = readsOn && !isFetchNextPageError
  const pageCount = pages?.length ?? 0
  useEffect(() => {
    if (chaining && !isFetchingNextPage) void fetchNextPage()
  }, [chaining, pageCount, isFetchingNextPage, fetchNextPage])
  const loadingMore = isFetchingNextPage || chaining

  // After « Charger plus » (and the pages it reads on) reaches the start, its button goes away:
  // focus moves to « Début de l'historique ».
  useEffect(() => {
    if (isFetchingNextPage || readsOn || !loadMorePressed.current) return
    loadMorePressed.current = false
    if (!hasNextPage) endRef.current?.focus()
  }, [hasNextPage, isFetchingNextPage, readsOn])

  const emailsFailed = emails.isError && !emails.data
  const emailsRetry = <LoadError message={t(`${H}.emailsLoadError`)} retrying={emails.isFetching} onRetry={() => void emails.refetch()} />
  let content: ReactNode
  if (filter === 'emails') {
    content = emailsFailed ? (
      emailsRetry
    ) : emails.isPending ? (
      <Loading />
    ) : days.length === 0 ? (
      <EmptyState title={t(`${H}.emptyEmails.title`)} body={t(`${H}.emptyEmails.body`, { firstName: record.professional.firstName })} />
    ) : (
      <TimelineDays days={days} latestInvitationEmail={latestInvitationEmail} />
    )
  } else if (isPending || (chaining && events.length === 0) || (filter === 'all' && emails.isPending)) {
    content = <Loading />
  } else if (isError && !data) {
    content = <LoadError message={t(`${H}.loadError`)} retrying={isFetching} onRetry={() => void refetch()} />
  } else if (readsOn && events.length === 0) {
    // The save that fills the first pages could not be read to its end: nothing to show but the retry.
    content = <LoadError message={t(`${H}.loadError`)} retrying={isFetchingNextPage} onRetry={() => void fetchNextPage()} />
  } else {
    content = (
      <>
        {filter === 'all' && emailsFailed && <div className="mb-4">{emailsRetry}</div>}
        {timeline.length === 0 && !hasNextPage && filter === 'all' ? (
          <EmptyState title={t(`${H}.empty.title`)} body={t(`${H}.empty.body`)} />
        ) : days.length === 0 ? (
          // Only a filter can empty loaded entries; without one, the list waits for « Charger plus ».
          filter !== 'all' && <EmptyState title={t(`${H}.emptyFiltered.title`)} body={t(`${H}.emptyFiltered.body`)} />
        ) : (
          <TimelineDays days={days} latestInvitationEmail={latestInvitationEmail} />
        )}
        <div className="mt-4 flex flex-wrap items-center gap-x-3 gap-y-2 border-t border-border-light pt-3 text-xs text-muted-foreground">
          {hasNextPage ? (
            <>
              <Button
                type="button"
                variant="outline"
                size="sm"
                aria-disabled={loadingMore || undefined}
                onClick={ignoreWhenInactive(loadingMore, () => {
                  loadMorePressed.current = true
                  void fetchNextPage()
                })}
                className={cn(softDisabledClasses, 'max-sm:h-11 aria-disabled:hover:border-border aria-disabled:hover:bg-card')}
              >
                {loadingMore ? t(`${H}.loadingMore`) : t(`${H}.loadMore`)}
              </Button>
              {isFetchNextPageError && !isFetchingNextPage && <p role="alert">{t(`${H}.loadMoreError`)}</p>}
            </>
          ) : (
            events.length > 0 && (
              <p ref={endRef} tabIndex={-1} className="outline-none">
                {t(`${H}.end`)}
              </p>
            )
          )}
        </div>
      </>
    )
  }

  return (
    <div className="space-y-3">
      <SegmentedToggle
        label={t(`${H}.filter.label`)}
        options={HISTORY_FILTERS.map((value) => ({ value, label: t(`${H}.filter.${value}`) }))}
        value={filter}
        onChange={setFilter}
      />
      <Card>
        <CardContent className="pt-4">{content}</CardContent>
      </Card>
    </div>
  )
}

/** The invitation's emails: a failed one can be sent again (an update request cannot, P4-267). */
const INVITATION_TEMPLATES = new Set(['professionals.invite', 'professionals.invite_reminder'])

function TimelineDays({ days, latestInvitationEmail }: { days: readonly { key: string; label: string; events: TimelineEntry[] }[]; latestInvitationEmail: string | undefined }) {
  return (
    <div className="space-y-5">
      {days.map((day) => (
        <HistoryDaySection key={day.key} label={day.label} entries={day.events} latestInvitationEmail={latestInvitationEmail} />
      ))}
    </div>
  )
}

function HistoryDaySection({ label, entries, latestInvitationEmail }: { label: string; entries: readonly TimelineEntry[]; latestInvitationEmail: string | undefined }) {
  const headingId = useId()
  return (
    <section aria-labelledby={headingId}>
      <h3 id={headingId} className="text-xs font-medium text-muted-foreground">
        {label}
      </h3>
      <ol className="mt-2 space-y-2">
        {entries.map((entry) =>
          entry.type === 'event' ? (
            <HistoryItem key={entry.key} event={entry.event} />
          ) : (
            <EmailItem key={entry.key} email={entry.email} latest={entry.email.id === latestInvitationEmail} />
          ),
        )}
      </ol>
    </section>
  )
}

/** Who sent it: the person, « Une personne qui n'a plus accès », or the system (the reminders job). */
function emailActor(email: SubjectEmail): { actor: string; byPerson: boolean } {
  if (email.sentByName) return { actor: email.sentByName, byPerson: true }
  return { actor: t(email.sentBy ? `${H}.actors.unknown` : `${H}.actors.system`), byPerson: false }
}

/**
 * An address sending again cannot reach: refused by the provider or nonexistent (`bounced`,
 * `invalid_recipient`), or whose owner marked the email as spam (`complained`: the provider stops
 * sending there).
 */
const addressRefused = (email: SubjectEmail) => email.status === 'bounced' || email.status === 'complained' || email.errorCode === 'invalid_recipient'

/** The file's address is no longer the one this email went to (corrected since, in Identité et permis). */
const addressChanged = (email: SubjectEmail, current: string) => email.toEmail !== null && email.toEmail.trim().toLowerCase() !== current.trim().toLowerCase()

/**
 * « 14:30  Admin Local a envoyé « Invitation d'un professionnel » à marie@… », then its outcome as
 * a dot and a word. When the newest invitation email failed and the user can invite on this file
 * (`professionals.invite`, no account, not inactive): « Renvoyer l'invitation » (a new link, after
 * its confirmation) where that can help — any failure, or a refused address since corrected —
 * else where to correct the address.
 */
function EmailItem({ email, latest }: { email: SubjectEmail; latest: boolean }) {
  const { record, onboarding, focusHeading } = useRecordData()
  const { can } = useAccess()
  const [dialog, setDialog] = useState<InviteAction | null>(null)
  const button = useRef<HTMLButtonElement>(null)
  const { actor, byPerson } = emailActor(email)
  const outcome = emailStatusLabel(email.status, email.errorCode)
  const failed = outcome.tone === 'error'
  const invite = latest && failed && INVITATION_TEMPLATES.has(email.templateKey) ? onboardingActions(record.professional, onboarding, can).invite : null
  // A refused address only blocks while the file still has it.
  const blocked = addressRefused(email) && !addressChanged(email, record.professional.email)
  const sentence = email.toEmail
    ? t(`${H}.email.sentTo`, { template: email.templateLabel, email: email.toEmail })
    : t(`${H}.email.sent`, { template: email.templateLabel })
  return (
    <li className="grid grid-cols-[2.75rem_minmax(0,1fr)] gap-x-2 text-sm">
      <time dateTime={email.createdAt} className="tabular-nums text-muted-foreground">
        {formatClinicTime(email.createdAt)}
      </time>
      <div className="min-w-0 pl-[18px] [overflow-wrap:anywhere]">
        <p>
          <span className={cn('font-medium', !byPerson && 'text-muted-foreground')}>{actor}</span> {sentence}
        </p>
        <div className="mt-0.5 flex flex-wrap items-center gap-x-3 gap-y-1">
          <span className="inline-flex items-center gap-1.5 text-xs font-medium text-muted-foreground">
            <StatusDot tone={outcome.tone} />
            {outcome.label}
          </span>
          {outcome.detail && <span className="text-xs text-muted-foreground">{outcome.detail}</span>}
        </div>
        {invite && blocked && (
          <p className="mt-1 text-xs text-muted-foreground">
            {t(email.status === 'complained' ? `${H}.email.markedAsSpam` : `${H}.email.notDelivered`)} {t(`${H}.email.checkAddress`)}{' '}
            <TabLink id={record.professional.id} tab="identite">
              {t(`${H}.email.identityTab`)}
            </TabLink>
            .
          </p>
        )}
        {invite && !blocked && (
          <Button ref={button} type="button" variant="outline" size="sm" className="mt-1.5 max-sm:h-11" onClick={() => setDialog(invite)}>
            {onboardingActionLabel(invite)}
          </Button>
        )}
        {dialog && (
          <InvitationDialog action={dialog} onClose={() => setDialog(null)} onCloseAutoFocus={(event) => focusAfterClose(event, [button.current], focusHeading)} />
        )}
      </div>
    </li>
  )
}

/**
 * « 14:30  Admin Local a modifié la ville », unfolding to its details when it has any. Memoised:
 * an event keeps its identity until the loaded rows change, so the loading state of « Charger
 * plus » and the filter do not re-render the entries.
 */
const HistoryItem = memo(function HistoryItem({ event }: { event: HistoryEvent }) {
  const text = (
    <>
      <span className={cn('font-medium', !event.byPerson && 'text-muted-foreground')}>{event.actor}</span> {event.sentence}
    </>
  )
  return (
    <li className="grid grid-cols-[2.75rem_minmax(0,1fr)] gap-x-2 text-sm">
      <time dateTime={event.createdAt} className="tabular-nums text-muted-foreground">
        {formatClinicTime(event.createdAt)}
      </time>
      {/* Values (emails, reasons) may be long words: they wrap anywhere rather than widen the page. */}
      <div className="min-w-0 [overflow-wrap:anywhere]">
        {event.lines.length > 0 || event.groups.length > 0 ? (
          <Disclosure label={text}>
            <HistoryDetails event={event} />
          </Disclosure>
        ) : (
          // Aligned with the text of the entries that have a chevron (14 px + 4 px gap).
          <p className="pl-[18px]">{text}</p>
        )}
      </div>
    </li>
  )
})

function lineText(line: HistoryLine): string {
  switch (line.kind) {
    case 'change':
      return t('audit.details.change', { field: line.field, before: line.before, after: line.after })
    case 'value':
      return t('audit.details.value', { field: line.field, value: line.value })
    case 'text':
      return line.text
  }
}

/**
 * The « Champ : avant → après » lines, then the names a counted sentence stands for: by category
 * for motifs, each category's title on its own line and every name under it (P4-249), as on the
 * record.
 */
function HistoryDetails({ event }: { event: HistoryEvent }) {
  return (
    <>
      {event.lines.length > 0 && (
        <ul className="space-y-0.5 text-muted-foreground">
          {event.lines.map((line, index) => (
            <li key={index}>{lineText(line)}</li>
          ))}
        </ul>
      )}
      {event.groups.length > 0 && <CategoryNames groups={event.groups} className={cn(event.lines.length > 0 && 'mt-2')} />}
    </>
  )
}
