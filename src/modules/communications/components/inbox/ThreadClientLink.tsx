import { useId, useState } from 'react'
import { Link } from 'react-router-dom'
import { FolderSearch, UserRound } from 'lucide-react'
import { t } from '@/i18n'
import { Button } from '@/shared/ui/button'
import { Input } from '@/shared/ui/input'
import { Label } from '@/shared/ui/label'
import { Popover, PopoverContent, PopoverTrigger } from '@/shared/ui/popover'
import { FILE_SEARCH_MIN_CHARS, type LinkedFile, type ThreadLink } from '../../api/client-links'
import { useFileSearch, useMailThreadLink, useSetThreadLink } from '../../hooks/use-client-links'
import { fileLabel } from '../../lib/inbox-format'

const L = 'modules.communications.inbox.link'

const recordPath = (id: string) => `/clients/${id}`

/**
 * The thread's file (CM2b, CM-12), under the thread's actions, for whoever holds `clients.view`:
 * the file it is linked to (its number and name, opening the record) with « Détacher » and
 * « Changer de dossier »; to review, the files matching the sender, each with « Rattacher »; else
 * « Rattacher à un dossier ». A person's choice is never undone by the sync.
 */
export function ThreadClientLink({ threadId }: { threadId: string }) {
  const link = useMailThreadLink(threadId, true)
  const setLink = useSetThreadLink(threadId)
  if (link.isPending) return null
  if (link.isError && !link.data) return <p className="text-xs text-muted-foreground">{t(`${L}.loadError`)}</p>
  if (!link.data) return null
  return <ClientLinkBox data={link.data} busy={setLink.isPending} onChoose={(clientId) => setLink.mutate(clientId)} />
}

interface ClientLinkBoxProps {
  data: ThreadLink
  busy: boolean
  /** A file's id to link, null to unlink (« Détacher »). */
  onChoose: (clientId: string | null) => void
  /** The `sourceAuto` wording: « trouvé par l'adresse de l'expéditeur » or, for a text, « … par le numéro ». */
  autoLabel?: string
}

/** The link's box, shared by « Courriels » (CM2b) and « Textos » (SM-15): what the thread is linked to, and how to change it. */
export function ClientLinkBox({ data, busy, onChoose, autoLabel }: ClientLinkBoxProps) {
  const choose = (clientId: string) => onChoose(clientId)

  return (
    <div role="group" aria-label={t(`${L}.label`)} className="space-y-2 rounded-md bg-muted/50 px-3 py-2 text-sm">
      {data.status === 'linked' && data.client ? (
        <div className="flex flex-wrap items-center gap-x-2 gap-y-1">
          <UserRound aria-hidden className="size-4 shrink-0 text-muted-foreground" />
          <span className="text-muted-foreground">{t(`${L}.linkedTo`)}</span>
          <Link to={recordPath(data.client.id)} className="font-medium text-link underline-offset-[3px] hover:underline">
            {fileLabel(data.client.client_number, data.client.display_name)}
          </Link>
          {data.source === 'auto' && <span className="text-xs text-muted-foreground">{autoLabel ?? t(`${L}.auto`)}</span>}
          <span className="flex flex-wrap gap-2">
            <Button type="button" variant="outline" size="sm" className="max-sm:h-11" disabled={busy} onClick={() => onChoose(null)}>
              {t(`${L}.unlink`)}
            </Button>
            <FilePicker triggerText={t(`${L}.change`)} excludeId={data.client.id} disabled={busy} onChoose={choose} />
          </span>
        </div>
      ) : data.status === 'needs_review' && data.candidates.length > 0 ? (
        <>
          <p className="text-foreground">{t(`${L}.candidates`)}</p>
          <ul className="space-y-1">
            {data.candidates.map((file) => (
              <CandidateRow key={file.id} file={file} disabled={busy} onChoose={choose} />
            ))}
          </ul>
          <FilePicker triggerText={t(`${L}.other`)} disabled={busy} onChoose={choose} />
        </>
      ) : (
        <div className="flex flex-wrap items-center gap-x-2 gap-y-1">
          <UserRound aria-hidden className="size-4 shrink-0 text-muted-foreground" />
          <span className="text-muted-foreground">{t(`${L}.none`)}</span>
          <FilePicker triggerText={t(`${L}.link`)} disabled={busy} onChoose={choose} />
        </div>
      )}
    </div>
  )
}

function CandidateRow({ file, disabled, onChoose }: { file: LinkedFile; disabled: boolean; onChoose: (id: string) => void }) {
  const label = fileLabel(file.client_number, file.display_name)
  return (
    <li className="flex flex-wrap items-center gap-2">
      <Link to={recordPath(file.id)} className="text-link underline-offset-[3px] hover:underline">
        {label}
      </Link>
      <Button
        type="button"
        variant="outline"
        size="sm"
        className="max-sm:h-11"
        disabled={disabled}
        aria-label={t(`${L}.linkToLabel`, { file: label })}
        onClick={() => onChoose(file.id)}
      >
        {t(`${L}.linkTo`)}
      </Button>
    </li>
  )
}

interface FilePickerProps {
  triggerText: string
  excludeId?: string
  disabled: boolean
  onChoose: (clientId: string) => void
}

/** A search of the clinic's files (name, email, number or phone) in a popover; a click links. */
function FilePicker({ triggerText, excludeId, disabled, onChoose }: FilePickerProps) {
  const [open, setOpen] = useState(false)
  const [query, setQuery] = useState('')
  const inputId = useId()
  const search = useFileSearch(open ? query : '')
  const results = (search.data ?? []).filter((file) => file.id !== excludeId)
  const short = query.trim().length < FILE_SEARCH_MIN_CHARS

  let body
  if (short) body = <p className="text-xs text-muted-foreground">{t(`${L}.searchHint`)}</p>
  else if (search.isError) body = <p className="text-xs text-destructive">{t(`${L}.searchError`)}</p>
  else if (search.isPending) body = <p className="text-xs text-muted-foreground">{t(`${L}.searching`)}</p>
  else if (results.length === 0) body = <p className="text-xs text-muted-foreground">{t(`${L}.noResult`)}</p>
  else {
    body = (
      <ul aria-label={t(`${L}.results`)} className="max-h-64 space-y-0.5 overflow-y-auto">
        {results.map((file) => (
          <li key={file.id}>
            <button
              type="button"
              onClick={() => {
                setOpen(false)
                setQuery('')
                onChoose(file.id)
              }}
              className="flex w-full min-w-0 items-baseline gap-2 rounded-md px-2 py-1.5 text-left text-sm outline-none hover:bg-muted/60 focus-visible:ring-2 focus-visible:ring-ring max-sm:min-h-11"
            >
              <span className="min-w-0 flex-1 truncate">{fileLabel(file.clientNumber, file.name)}</span>
              {file.isArchived && <span className="shrink-0 text-xs text-muted-foreground">{t(`${L}.archived`)}</span>}
            </button>
          </li>
        ))}
      </ul>
    )
  }

  return (
    <Popover
      open={open}
      onOpenChange={(next) => {
        setOpen(next)
        if (!next) setQuery('')
      }}
    >
      <PopoverTrigger asChild>
        <Button type="button" variant="outline" size="sm" className="max-sm:h-11" disabled={disabled}>
          <FolderSearch aria-hidden />
          {triggerText}
        </Button>
      </PopoverTrigger>
      <PopoverContent align="start" className="w-80 space-y-2">
        <Label htmlFor={inputId}>{t(`${L}.searchLabel`)}</Label>
        <Input
          id={inputId}
          type="search"
          autoFocus
          autoComplete="off"
          placeholder={t(`${L}.searchPlaceholder`)}
          value={query}
          onChange={(event) => setQuery(event.target.value)}
        />
        <div aria-live="polite">{body}</div>
      </PopoverContent>
    </Popover>
  )
}
