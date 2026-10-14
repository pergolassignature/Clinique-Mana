import { useEffect, useState } from 'react'
import { Plus } from 'lucide-react'
import { t } from '@/i18n'
import { useAccess } from '@/core/access/access-context'
import { EmptyState } from '@/shared/components/EmptyState'
import { LoadError, Loading } from '@/shared/components/LoadState'
import { PageHeader } from '@/shared/components/PageHeader'
import { usePageTitle } from '@/shared/lib/use-page-title'
import { cn } from '@/shared/lib/utils'
import { SegmentedToggle } from '@/shared/components/SegmentedToggle'
import { Button } from '@/shared/ui/button'
import { Input } from '@/shared/ui/input'
import { useUrlParams } from '@/shared/lib/use-url-params'
import { ConsentDialog } from '../components/sms/ConsentDialog'
import { ThreadList } from '../components/sms/ThreadList'
import { ThreadView } from '../components/sms/ThreadView'
import { SMS_VIEWS, type SmsConsentStatus, type SmsView } from '../api/sms'
import { useFollowSmsNotices, useSmsMessagePhone, useSmsThreads } from '../hooks/use-sms'

const S = 'modules.communications.sms'
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i

/**
 * « Textos » (batch SM, communications.sms): the conversations with the clinic's SMS number, newest
 * first, and the one open. Side by side from `lg`; on a phone, the list, then the thread with
 * « Retour aux conversations ». A notice's link (`/textos?message=<id>`) opens that text's thread:
 * the number is never in the URL (personal data), only the text's id. No timer: the page follows
 * the bell's polled count (`useFollowSmsNotices`).
 */
export function SmsPage() {
  usePageTitle(t(`${S}.title`))
  useFollowSmsNotices()
  const { can } = useAccess()
  // SM-15: « À rattacher » and the search by a file's name need clients.view.
  const files = can('clients.view')
  const [view, setView] = useState<SmsView>('all')
  const [search, setSearch] = useState('')
  const threads = useSmsThreads(files ? view : 'all', search)
  // The consent of the thread opened, kept when a filter hides its row.
  const [openedConsent, setOpenedConsent] = useState<SmsConsentStatus | null>(null)
  const { params: searchParams, update: updateParams } = useUrlParams()
  const param = searchParams.get('message')
  const messageId = param && UUID.test(param) ? param : null
  const fromNotice = useSmsMessagePhone(messageId)
  const [selected, setSelected] = useState<string | null>(null)

  // A notice's text: its thread opens once its number is known.
  useEffect(() => {
    if (fromNotice.data) setSelected(fromNotice.data)
  }, [fromNotice.data])

  const select = (phone: string | null) => {
    setSelected(phone)
    setOpenedConsent(threads.data?.find((thread) => thread.phone === phone)?.consent ?? null)
    if (messageId) updateParams({ message: null })
  }

  const rows = threads.data
  const consent = rows?.find((thread) => thread.phone === selected)?.consent ?? openedConsent
  const notFound = messageId !== null && fromNotice.isSuccess && fromNotice.data === null

  return (
    <div className="space-y-4">
      <PageHeader
        level={1}
        title={t(`${S}.title`)}
        count={rows ? (rows.length === 1 ? t(`${S}.threads.countOne`) : t(`${S}.threads.countOther`, { count: String(rows.length) })) : undefined}
        description={t(`${S}.description`)}
        actions={
          can('communications.sms') ? (
            <ConsentDialog
              status="opted_in"
              onSaved={(phone) => select(phone)}
              trigger={
                <Button>
                  <Plus aria-hidden />
                  {t(`${S}.consent.newNumber`)}
                </Button>
              }
            />
          ) : undefined
        }
      />
      <div className="flex flex-wrap items-end gap-3">
        {files && (
          <SegmentedToggle
            label={t(`${S}.views.label`)}
            value={view}
            onChange={setView}
            options={SMS_VIEWS.map((value) => ({ value, label: t(`${S}.views.${value}`) }))}
          />
        )}
        <div className="w-full max-w-xs">
          <label htmlFor="sms-search" className="sr-only">
            {t(files ? `${S}.search.label` : `${S}.search.labelDigits`)}
          </label>
          <Input
            id="sms-search"
            type="search"
            autoComplete="off"
            placeholder={t(files ? `${S}.search.label` : `${S}.search.labelDigits`)}
            value={search}
            onChange={(event) => setSearch(event.target.value)}
          />
        </div>
      </div>
      {notFound && (
        <p role="status" className="text-sm text-muted-foreground">
          {t(`${S}.thread.notFound`)}
        </p>
      )}
      {threads.isError && !rows ? (
        <LoadError message={t(`${S}.threads.loadError`)} retrying={threads.isFetching} onRetry={() => void threads.refetch()} />
      ) : !rows ? (
        <Loading />
      ) : rows.length === 0 && selected === null ? (
        search.trim() || view !== 'all' ? (
          <EmptyState title={t(view === 'to_link' && !search.trim() ? `${S}.threads.emptyToLink` : `${S}.threads.emptySearch`)} />
        ) : (
          <EmptyState title={t(`${S}.threads.emptyTitle`)} body={t(`${S}.threads.emptyBody`)} />
        )
      ) : (
        <div className="overflow-hidden rounded-lg border border-border bg-card lg:grid lg:h-[calc(100dvh-13rem)] lg:min-h-[30rem] lg:grid-cols-[20rem_minmax(0,1fr)]">
          <div className={cn('min-h-0 overflow-y-auto lg:border-r lg:border-border', selected !== null && 'max-lg:hidden')}>
            <ThreadList threads={rows} selected={selected} onSelect={select} />
          </div>
          {selected !== null ? (
            <div className="flex min-h-0 min-w-0 flex-col">
              <ThreadView phone={selected} consent={consent} onBack={() => select(null)} />
            </div>
          ) : (
            <div className="hidden items-center justify-center p-6 text-sm text-muted-foreground lg:flex">{t(`${S}.thread.select`)}</div>
          )}
        </div>
      )}
    </div>
  )
}
