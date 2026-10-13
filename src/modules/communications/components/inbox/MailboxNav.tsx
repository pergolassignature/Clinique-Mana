import { useId } from 'react'
import { FileText, Inbox, Mail, MailOpen, PenLine, Send, Star, Tag, UserRoundSearch } from 'lucide-react'
import type { LucideIcon } from 'lucide-react'
import { t } from '@/i18n'
import { cn } from '@/shared/lib/utils'
import { Button } from '@/shared/ui/button'
import { Label } from '@/shared/ui/label'
import { Select } from '@/shared/ui/select'
import type { MailConnection } from '../../api/mailboxes'
import type { MailLabel, MailView } from '../../api/inbox'
import { useDrafts } from '../../hooks/use-composer'
import { useComposerLauncher } from '../../hooks/use-composer-launcher'
import { initialContent } from '../../lib/compose'

const N = 'modules.communications.inbox.nav'

/** The views of the left pane, in Gmail's order. */
const VIEWS: { view: Exclude<MailView, 'label'>; icon: LucideIcon }[] = [
  { view: 'inbox', icon: Inbox },
  { view: 'unread', icon: MailOpen },
  { view: 'starred', icon: Star },
  { view: 'sent', icon: Send },
  { view: 'all', icon: Mail },
  // « À rattacher » (CM2b): only with `clients.view` (`showToLink`).
  { view: 'to_link', icon: UserRoundSearch },
  // « Brouillons » (CM3): the person's own drafts.
  { view: 'drafts', icon: FileText },
]

export interface ViewChoice {
  view: MailView
  labelId: string | null
}

interface MailboxNavProps {
  mailboxes: MailConnection[]
  mailboxId: string
  onMailbox: (id: string) => void
  current: ViewChoice
  onView: (choice: ViewChoice) => void
  labels: MailLabel[]
  /** « À rattacher »: the person may see files (`clients.view`, Clients enabled). */
  showToLink: boolean
  /** « Nouveau message » and « Brouillons » (CM3): inside a `ComposerHost`. */
  canCompose?: boolean
}

/** `?vue=`-style value of a choice in the phone's select: the view, or `libelle:<id>`. */
const choiceValue = (choice: ViewChoice) => (choice.view === 'label' ? `libelle:${choice.labelId}` : choice.view)

/**
 * The left pane: the mailbox (a choice when the person reads more than one), its views
 * (« Boîte de réception » with its unread count, « Non lus », « Suivis », « Envoyés », « Tous les
 * courriels », and « À rattacher » with `clients.view`) and its own labels. Each entry is a button; the current one is `aria-current`. On a
 * phone the views and labels fold into one « Dossier » choice, so the list starts at the top.
 */
export function MailboxNav({ mailboxes, mailboxId, onMailbox, current, onView, labels, showToLink, canCompose = false }: MailboxNavProps) {
  const views = VIEWS.filter(({ view }) => (view !== 'to_link' || showToLink) && (view !== 'drafts' || canCompose))
  const composer = useComposerLauncher()
  const drafts = useDrafts(canCompose)
  const draftsCount = drafts.data?.length
  const onCompose =
    canCompose && composer
      ? () => composer.open({ kind: 'content', personKnown: false, content: initialContent({ connectionId: mailboxId, mode: 'new' }) })
      : undefined
  const selectId = useId()
  const folderId = useId()
  const mailbox = mailboxes.find((m) => m.id === mailboxId)
  const entry = (key: string, active: boolean, onClick: () => void, icon: LucideIcon, text: string, count?: number) => {
    const Icon = icon
    return (
      <li key={key}>
        <button
          type="button"
          aria-current={active || undefined}
          onClick={onClick}
          className={cn(
            'flex w-full min-w-0 items-center gap-2 rounded-md px-2 py-1.5 text-left text-sm outline-none transition-colors hover:bg-muted/60 focus-visible:ring-2 focus-visible:ring-ring max-sm:min-h-11',
            active ? 'bg-muted font-medium text-foreground' : 'text-muted-foreground',
          )}
        >
          <Icon aria-hidden className="size-4 shrink-0" />
          <span className="min-w-0 flex-1 truncate">{text}</span>
          {count !== undefined && count > 0 && <span className="tabular text-xs font-semibold text-foreground">{count}</span>}
        </button>
      </li>
    )
  }
  return (
    <nav aria-label={t(`${N}.label`)} className="space-y-3 p-3">
      {onCompose && (
        <Button type="button" onClick={onCompose} className="w-full max-sm:h-11">
          <PenLine aria-hidden className="size-4" />
          {t(`${N}.newMessage`)}
        </Button>
      )}
      {mailboxes.length > 1 ? (
        <div className="space-y-1">
          <Label htmlFor={selectId}>{t(`${N}.mailbox`)}</Label>
          <Select id={selectId} value={mailboxId} onChange={(event) => onMailbox(event.target.value)}>
            {mailboxes.map((m) => (
              <option key={m.id} value={m.id}>
                {m.email_address}
              </option>
            ))}
          </Select>
        </div>
      ) : (
        <p className="truncate px-2 text-sm font-medium text-foreground" title={mailbox?.email_address}>
          {mailbox?.email_address}
        </p>
      )}
      <div className="space-y-1 lg:hidden">
        <Label htmlFor={folderId}>{t(`${N}.folder`)}</Label>
        <Select
          id={folderId}
          value={choiceValue(current)}
          onChange={(event) => {
            const value = event.target.value
            onView(value.startsWith('libelle:') ? { view: 'label', labelId: value.slice('libelle:'.length) } : { view: value as MailView, labelId: null })
          }}
        >
          {views.map(({ view }) => (
            <option key={view} value={view}>
              {view !== 'inbox' || !mailbox?.unread_count
                ? t(`${N}.views.${view}`)
                : mailbox.unread_count === 1
                  ? t(`${N}.inboxWithUnreadOne`)
                  : t(`${N}.inboxWithUnreadOther`, { count: String(mailbox.unread_count) })}
            </option>
          ))}
          {labels.length > 0 && (
            <optgroup label={t(`${N}.labels`)}>
              {labels.map((label) => (
                <option key={label.gmail_label_id} value={`libelle:${label.gmail_label_id}`}>
                  {label.name}
                </option>
              ))}
            </optgroup>
          )}
        </Select>
      </div>
      <ul className="space-y-0.5 max-lg:hidden">
        {views.map(({ view, icon }) =>
          entry(
            view,
            current.view === view,
            () => onView({ view, labelId: null }),
            icon,
            t(`${N}.views.${view}`),
            view === 'inbox' ? mailbox?.unread_count : view === 'drafts' ? draftsCount : undefined,
          ),
        )}
      </ul>
      {labels.length > 0 && (
        <div className="space-y-1 max-lg:hidden">
          <p className="px-2 text-xs font-medium text-muted-foreground">{t(`${N}.labels`)}</p>
          <ul className="space-y-0.5">
            {labels.map((label) =>
              entry(
                label.gmail_label_id,
                current.view === 'label' && current.labelId === label.gmail_label_id,
                () => onView({ view: 'label', labelId: label.gmail_label_id }),
                Tag,
                label.name,
              ),
            )}
          </ul>
        </div>
      )}
    </nav>
  )
}
