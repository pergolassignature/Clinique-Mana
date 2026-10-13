import { Paperclip } from 'lucide-react'
import { t } from '@/i18n'
import { LoadError, Loading } from '@/shared/components/LoadState'
import { formatClinicDateTime } from '@/shared/lib/timezone'
import { useDrafts } from '../../hooks/use-composer'
import { useComposerLauncher } from '../../hooks/use-composer-launcher'

const D = 'modules.communications.inbox.drafts'

/** « Brouillons »: the person's own drafts, newest first; a click reopens one in the composer. */
export function DraftList() {
  const drafts = useDrafts()
  const composer = useComposerLauncher()
  if (drafts.isError && !drafts.data) {
    return <LoadError className="p-3" message={t(`${D}.loadError`)} retrying={drafts.isFetching} onRetry={() => void drafts.refetch()} />
  }
  if (!drafts.data) return <Loading className="p-3" />
  if (drafts.data.length === 0) return <p className="p-4 text-sm text-muted-foreground">{t(`${D}.empty`)}</p>
  return (
    <ul aria-label={t(`${D}.label`)} className="min-h-0 flex-1 divide-y divide-border-light overflow-y-auto">
      {drafts.data.map((draft) => (
        <li key={draft.id}>
          <button
            type="button"
            onClick={() => composer?.open({ kind: 'draft', draftId: draft.id, personKnown: draft.client_id !== null })}
            className="flex w-full min-w-0 flex-col gap-0.5 px-3 py-2 text-left text-sm outline-none hover:bg-muted/60 focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-ring max-sm:min-h-11"
          >
            <span className="flex min-w-0 items-baseline gap-2">
              <span className="min-w-0 flex-1 truncate font-medium text-foreground">{draft.subject.trim() || t(`${D}.noSubject`)}</span>
              <span className="shrink-0 text-xs text-muted-foreground">{t(`${D}.modes.${draft.mode}`)}</span>
            </span>
            <span className="flex min-w-0 items-center gap-2 text-xs text-muted-foreground">
              <span className="min-w-0 flex-1 truncate">{draft.to_addresses.join(', ') || t(`${D}.noRecipient`)}</span>
              {draft.attachment_count > 0 && <Paperclip aria-hidden className="size-3 shrink-0" />}
              <span className="tabular shrink-0">{t(`${D}.updated`, { date: formatClinicDateTime(draft.updated_at) })}</span>
            </span>
          </button>
        </li>
      ))}
    </ul>
  )
}
