import { useEffect, useState } from 'react'
import { useSearchParams } from 'react-router-dom'
import { Plus } from 'lucide-react'
import { t } from '@/i18n'
import { useAccess } from '@/core/access/access-context'
import { EmptyState } from '@/shared/components/EmptyState'
import { LoadError, Loading } from '@/shared/components/LoadState'
import { PageHeader } from '@/shared/components/PageHeader'
import { usePageTitle } from '@/shared/lib/use-page-title'
import { cn } from '@/shared/lib/utils'
import { Button } from '@/shared/ui/button'
import { ConsentDialog } from '../components/sms/ConsentDialog'
import { ThreadList } from '../components/sms/ThreadList'
import { ThreadView } from '../components/sms/ThreadView'
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
  const threads = useSmsThreads()
  const [searchParams, setSearchParams] = useSearchParams()
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
    if (messageId) setSearchParams({}, { replace: true })
  }

  const rows = threads.data
  const consent = rows?.find((thread) => thread.phone === selected)?.consent ?? null
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
        <EmptyState title={t(`${S}.threads.emptyTitle`)} body={t(`${S}.threads.emptyBody`)} />
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
