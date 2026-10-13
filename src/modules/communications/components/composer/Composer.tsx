import { useCallback, useEffect, useId, useMemo, useRef, useState, type FormEvent } from 'react'
import { ChevronDown, FileText, Minus, Paperclip, Send, Trash2, X } from 'lucide-react'
import { t } from '@/i18n'
import { uploadFile } from '@/core/storage/api'
import { FunctionCallError } from '@/core/supabase/functions'
import { FileDropzone } from '@/shared/components/FileDropzone'
import { formatClinicTime } from '@/shared/lib/timezone'
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
import { Button, buttonVariants } from '@/shared/ui/button'
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from '@/shared/ui/dropdown-menu'
import { Input } from '@/shared/ui/input'
import { Label } from '@/shared/ui/label'
import { Popover, PopoverContent, PopoverTrigger } from '@/shared/ui/popover'
import { Select } from '@/shared/ui/select'
import { toast } from '@/shared/ui/sonner'
import {
  MAX_ATTACHMENTS,
  MAX_ATTACHMENTS_BYTES,
  OUTGOING_MAX_BYTES,
  OUTGOING_PURPOSE,
  OUTGOING_TYPES,
  saveDraft as saveDraftNow,
  type ComposeTemplate,
  type DraftAttachment,
  type DraftContent,
} from '../../api/composer'
import { communicationsErrorMessage } from '../../api/errors'
import type { MailConnection } from '../../api/mailboxes'
import { useDeleteDraft, useDeleteTemplate, useSaveDraft, useSaveTemplate, useSendMail, useTemplates } from '../../hooks/use-composer'
import { useAiDraftStatus } from '../../hooks/use-ai'
import { hasText, htmlToText, parseAddresses, sendProblem, textToHtml } from '../../lib/compose'
import { AiBar } from './AiBar'
import { RichEmailEditor } from './RichEmailEditor'

const C = 'modules.communications.composer'
/** « Annuler l'envoi »: the message leaves this many seconds after « Envoyer » (ADR 0063 in PS Hub). */
export const UNDO_SECONDS = 5
/** The autosave waits this long after the last change. */
export const AUTOSAVE_MS = 1_500

/** A limit the composer checks itself; its message is shown as is. */
class ComposerLimit extends Error {}

type Phase = { kind: 'editing' } | { kind: 'counting'; left: number } | { kind: 'sending' }

export interface ComposerProps {
  /** The draft already saved (reopened), or null for a new one. */
  draftId: string | null
  initial: DraftContent
  /** The mailboxes the person may send from (connected). */
  mailboxes: MailConnection[]
  /** The file the message is about (« CLI-000042 · Nom »), when known. */
  fileLabel?: string | null
  /** Whether `{{person.…}}` can be filled (a file named, or the thread linked to one). */
  personKnown: boolean
  onClose: () => void
  onSent: (threadId: string | null) => void
}

/** A field's typed text and its parsed addresses. */
function useAddressField(initial: string[]) {
  const [text, setText] = useState(initial.join(', '))
  const parsed = useMemo(() => parseAddresses(text), [text])
  return { text, setText, ...parsed }
}

/**
 * The composer (CM3; PS Hub's `ComposerCore`): the mailbox, « À », « Cc », « Cci », « Objet », the
 * editor, the attachments (uploaded to our storage, or a forwarded message's stored copies), the
 * templates (the clinic's and one's own, « Enregistrer comme modèle »), then « Envoyer » with five
 * seconds to « Annuler l'envoi ». The draft is saved as one types (the database, never the
 * browser's storage): closing keeps it in « Brouillons ».
 */
export function Composer({ draftId: initialDraftId, initial: initialProp, mailboxes, fileLabel, personKnown, onClose, onSent }: ComposerProps) {
  const ids = useId()
  // The starting content, as it was at the opening: a parent rendering again never resets it.
  const [initial] = useState(initialProp)
  const [connectionId, setConnectionId] = useState(initial.connectionId)
  const [subject, setSubject] = useState(initial.subject)
  const [body, setBody] = useState(initial.bodyHtml)
  const [attachments, setAttachments] = useState<DraftAttachment[]>(initial.attachments)
  const to = useAddressField(initial.to)
  const cc = useAddressField(initial.cc)
  const bcc = useAddressField(initial.bcc)
  const [showCopies, setShowCopies] = useState(initial.cc.length > 0 || initial.bcc.length > 0)
  const [replaceWith, setReplaceWith] = useState<{ html: string; version: number } | null>(null)
  const [pendingTemplate, setPendingTemplate] = useState<ComposeTemplate | null>(null)
  const [confirmDelete, setConfirmDelete] = useState(false)
  const [phase, setPhase] = useState<Phase>({ kind: 'editing' })
  const [problem, setProblem] = useState<string | null>(null)
  const [savedAt, setSavedAt] = useState<string | null>(null)
  const [saveFailed, setSaveFailed] = useState(false)
  const [minimized, setMinimized] = useState(false)
  // The quote under a reply or a forward: a template replaces the text above it only.
  const quote = useRef(initial.mode === 'new' ? '' : initial.bodyHtml)
  const draftId = useRef<string | null>(initialDraftId)
  const saving = useRef<Promise<void>>(Promise.resolve())
  // The send's key, and the content it was made for: the same content sends with the same key
  // (the server answers what the first « Envoyer » did, and looks in Gmail after no answer).
  const sendKey = useRef<{ key: string; content: string } | null>(null)
  const firstField = useRef<HTMLInputElement>(null)
  // A change not saved yet: kept even when the composer goes (replaced, or the page left).
  const dirty = useRef(false)
  const phaseRef = useRef<Phase>({ kind: 'editing' })

  const saveDraft = useSaveDraft()
  // The mutation object changes each render: read through a ref, so the autosave's timer is not
  // restarted (nor a save run) by a render.
  const saveDraftRef = useRef(saveDraft.mutateAsync)
  saveDraftRef.current = saveDraft.mutateAsync
  const deleteDraft = useDeleteDraft()
  const send = useSendMail()
  // The mutation object changes each render: the countdown reads it through a ref, so a render
  // during the five seconds never restarts the second under way.
  const sendRef = useRef(send)
  sendRef.current = send
  const onSentRef = useRef(onSent)
  onSentRef.current = onSent
  const templates = useTemplates()
  const ai = useAiDraftStatus()

  const content: DraftContent = useMemo(
    () => ({
      ...initial,
      connectionId,
      to: to.valid,
      cc: showCopies ? cc.valid : [],
      bcc: showCopies ? bcc.valid : [],
      subject,
      bodyHtml: body,
      attachments,
    }),
    [initial, connectionId, to.valid, cc.valid, bcc.valid, showCopies, subject, body, attachments],
  )
  const latest = useRef(content)
  latest.current = content
  const snapshot = useMemo(() => JSON.stringify(content), [content])
  // What the database holds (the opening's content until a save): nothing is saved on opening.
  const savedSnapshot = useRef(snapshot)
  phaseRef.current = phase

  /** Saves what is there now, after any save under way (so a new draft is created once). */
  const saveNow = useCallback(() => {
    saving.current = saving.current.then(async () => {
      const value = latest.current
      const text = JSON.stringify(value)
      try {
        const saved = await saveDraftRef.current({ id: draftId.current, content: value })
        draftId.current = saved.id
        savedSnapshot.current = text
        dirty.current = JSON.stringify(latest.current) !== text
        setSavedAt(saved.updatedAt)
        setSaveFailed(false)
      } catch {
        setSaveFailed(true)
      }
    })
    return saving.current
  }, [])

  // The autosave: a while after the last change, while editing; only a real change.
  useEffect(() => {
    if (snapshot === savedSnapshot.current) return
    dirty.current = true
    if (phase.kind !== 'editing') return
    const timer = setTimeout(() => void saveNow(), AUTOSAVE_MS)
    return () => clearTimeout(timer)
  }, [snapshot, phase.kind, saveNow])

  useEffect(() => {
    firstField.current?.focus()
    return () => {
      // Closed (or replaced, or the page left) during the five seconds: nothing leaves, and the
      // person is told where the message is.
      if (phaseRef.current.kind === 'counting') toast.info(t(`${C}.cancelledByClose`))
      // Unmounted with a change the autosave had not reached: saved once more, quietly.
      if (dirty.current) void saveDraftNow(draftId.current, latest.current).catch(() => undefined)
    }
  }, [])

  // « Annuler l'envoi »: the countdown, then the send.
  useEffect(() => {
    if (phase.kind !== 'counting') return
    if (phase.left === 0) {
      setPhase({ kind: 'sending' })
      const text = JSON.stringify(latest.current)
      if (sendKey.current?.content !== text) sendKey.current = { key: crypto.randomUUID(), content: text }
      sendRef.current.mutate(
        { sendKey: sendKey.current.key, draftId: draftId.current, content: latest.current },
        {
          onSuccess: (result) => {
            dirty.current = false
            toast.success(t(`${C}.sent`))
            onSentRef.current(result.thread_id)
          },
          onError: (error) => {
            setPhase({ kind: 'editing' })
            setProblem(
              error instanceof FunctionCallError && error.code === 'provider_error'
                ? error.extra.outcome === 'refused'
                  ? t(`${C}.errors.refused`)
                  : t(`${C}.errors.notConfirmed`)
                : communicationsErrorMessage(error, t(`${C}.errors.sendFailed`)),
            )
          },
        },
      )
      return
    }
    const timer = setTimeout(() => setPhase({ kind: 'counting', left: phase.left - 1 }), 1_000)
    return () => clearTimeout(timer)
  }, [phase])

  const startSend = async (event?: FormEvent) => {
    event?.preventDefault()
    if (phase.kind !== 'editing') return
    const invalid = [...to.invalid, ...(showCopies ? [...cc.invalid, ...bcc.invalid] : [])]
    const why = invalid.length > 0 ? t(`${C}.problems.badAddress`, { address: invalid[0] ?? '' }) : sendProblem(content)
    setProblem(why)
    if (why) return
    await saveNow()
    setPhase({ kind: 'counting', left: UNDO_SECONDS })
  }

  const applyTemplate = (template: ComposeTemplate) => {
    const html = template.format === 'text' ? textToHtml(template.body) : template.body
    setReplaceWith((prev) => ({ html: html + quote.current, version: (prev?.version ?? 0) + 1 }))
    if (initial.mode === 'new' && template.subject.trim() && !subject.trim()) setSubject(template.subject)
    setPendingTemplate(null)
  }
  const chooseTemplate = (template: ComposeTemplate) => {
    // Replacing a text one wrote asks first.
    if (body !== quote.current && hasText(body.replace(quote.current, ''))) setPendingTemplate(template)
    else applyTemplate(template)
  }

  const totalBytes = attachments.reduce((sum, a) => sum + a.size_bytes, 0)
  const counting = phase.kind === 'counting'
  const busy = phase.kind !== 'editing'
  const mailbox = mailboxes.find((m) => m.id === connectionId)
  const title =
    initial.mode === 'new' ? t(`${C}.titleNew`) : initial.mode === 'forward' ? t(`${C}.titleForward`) : t(`${C}.titleReply`)
  const titleId = `${ids}-title`

  return (
    <section
      role="dialog"
      aria-modal="false"
      aria-labelledby={titleId}
      className={cn(
        'fixed z-40 flex flex-col bg-card text-foreground shadow-large',
        'max-lg:inset-0',
        'lg:bottom-4 lg:right-4 lg:w-[40rem] lg:rounded-lg lg:border lg:border-border',
        minimized ? 'lg:h-auto' : 'lg:h-[min(46rem,88dvh)]',
      )}
    >
      <header className="flex items-center gap-2 border-b border-border px-3 py-2">
        <h2 id={titleId} className="min-w-0 flex-1 truncate text-sm font-semibold">
          {subject.trim() || title}
        </h2>
        <span role="status" className="text-xs text-muted-foreground">
          {saveFailed ? t(`${C}.saveFailed`) : savedAt ? t(`${C}.savedAt`, { time: formatClinicTime(savedAt) }) : ''}
        </span>
        <Button
          type="button"
          variant="ghost"
          size="sm"
          tabIndex={-1}
          aria-label={minimized ? t(`${C}.expand`) : t(`${C}.minimize`)}
          onClick={() => setMinimized((m) => !m)}
          className="h-8 w-8 p-0 max-lg:hidden"
        >
          {minimized ? <ChevronDown aria-hidden className="size-4 rotate-180" /> : <Minus aria-hidden className="size-4" />}
        </Button>
        <Button
          type="button"
          variant="ghost"
          size="sm"
          tabIndex={-1}
          aria-label={t(`${C}.close`)}
          disabled={busy}
          onClick={() => {
            void saveNow().then(onClose)
          }}
          className="h-8 w-8 p-0"
        >
          <X aria-hidden className="size-4" />
        </Button>
      </header>

      <form
        onSubmit={(event) => void startSend(event)}
        noValidate
        className={cn('flex min-h-0 flex-1 flex-col', minimized && 'lg:hidden')}
        aria-busy={busy || undefined}
      >
        <div className="min-h-0 flex-1 space-y-2 overflow-y-auto px-3 py-2">
          {fileLabel && <p className="text-xs text-muted-foreground">{t(`${C}.aboutFile`, { file: fileLabel })}</p>}
          <div className="grid grid-cols-[4.5rem_minmax(0,1fr)] items-center gap-x-2 gap-y-2">
            <Label htmlFor={`${ids}-from`} className="text-muted-foreground">
              {t(`${C}.from`)}
            </Label>
            {mailboxes.length > 1 ? (
              <Select id={`${ids}-from`} value={connectionId} disabled={busy || initial.mode !== 'new'} onChange={(e) => setConnectionId(e.target.value)}>
                {mailboxes.map((m) => (
                  <option key={m.id} value={m.id}>
                    {m.email_address}
                  </option>
                ))}
              </Select>
            ) : (
              <Input id={`${ids}-from`} readOnly value={mailbox?.email_address ?? ''} />
            )}
            <AddressRow id={`${ids}-to`} label={t(`${C}.to`)} field={to} inputRef={firstField} disabled={busy} />
            {!showCopies && (
              <div className="col-start-2">
                <Button type="button" variant="link" size="sm" className="h-auto p-0" onClick={() => setShowCopies(true)}>
                  {t(`${C}.addCopies`)}
                </Button>
              </div>
            )}
            {showCopies && <AddressRow id={`${ids}-cc`} label={t(`${C}.cc`)} field={cc} disabled={busy} />}
            {showCopies && <AddressRow id={`${ids}-bcc`} label={t(`${C}.bcc`)} field={bcc} disabled={busy} />}
            <Label htmlFor={`${ids}-subject`} className="text-muted-foreground">
              {t(`${C}.subject`)}
            </Label>
            <Input id={`${ids}-subject`} value={subject} maxLength={250} autoComplete="off" disabled={busy} onChange={(e) => setSubject(e.target.value.replace(/[\r\n]+/g, ' '))} />
          </div>

          {ai.data?.available && (
            <AiBar
              replying={initial.mode === 'reply'}
              draftText={htmlToText(body.replace(quote.current, ''))}
              originalText={initial.mode === 'reply' ? htmlToText(quote.current) : ''}
              subjectEmpty={!subject.trim()}
              clientId={initial.clientId}
              threadId={initial.threadId}
              capReached={ai.data.cap_reached}
              disabled={busy}
              onUse={(proposal) => {
                const previous = body
                setReplaceWith((prev) => ({ html: textToHtml(proposal.text) + quote.current, version: (prev?.version ?? 0) + 1 }))
                if (proposal.subject && !subject.trim()) setSubject(proposal.subject)
                toast.success(t('modules.communications.ai.used'), {
                  action: {
                    label: t('modules.communications.ai.restore'),
                    onClick: () => setReplaceWith((prev) => ({ html: previous, version: (prev?.version ?? 0) + 1 })),
                  },
                  duration: 10_000,
                })
              }}
            />
          )}
          <RichEmailEditor
            initialHtml={initial.bodyHtml}
            replaceWith={replaceWith}
            onChange={setBody}
            label={t(`${C}.body`)}
            personKnown={personKnown}
          />

          <AttachmentList
            attachments={attachments}
            disabled={busy}
            onRemove={(id) => setAttachments((list) => list.filter((a) => a.id !== id))}
          />
          {attachments.length < MAX_ATTACHMENTS && !busy && (
            <FileDropzone
              buttonLabel={t(`${C}.attach`)}
              hint={t(`${C}.attachHint`)}
              accept={OUTGOING_TYPES}
              maxBytes={OUTGOING_MAX_BYTES}
              errorMessage={(error) =>
                error instanceof ComposerLimit ? error.message : communicationsErrorMessage(error, t(`${C}.errors.uploadFailed`))
              }
              onUpload={async (file, mimeType, onStep) => {
                if (totalBytes + file.size > MAX_ATTACHMENTS_BYTES) throw new ComposerLimit(t(`${C}.problems.tooLarge`))
                // The upload's subject is the draft: saved first.
                await saveNow()
                if (!draftId.current) throw new ComposerLimit(t(`${C}.saveFailed`))
                const { fileId } = await uploadFile({ purpose: OUTGOING_PURPOSE, subjectType: 'mail_draft', subjectId: draftId.current, file, mimeType, onStep })
                setAttachments((list) => [...list, { id: fileId, name: file.name, mime_type: mimeType, size_bytes: file.size }])
              }}
            />
          )}
        </div>

        <footer className="space-y-2 border-t border-border px-3 py-2">
          {problem && (
            <p role="alert" className="text-sm text-destructive">
              {problem}
            </p>
          )}
          {counting ? (
            <div role="status" className="flex flex-wrap items-center gap-3">
              <span className="text-sm text-foreground">{t(`${C}.sendingIn`, { seconds: String(phase.left) })}</span>
              <Button type="button" variant="outline" size="sm" autoFocus onClick={() => setPhase({ kind: 'editing' })}>
                {t(`${C}.undo`)}
              </Button>
            </div>
          ) : (
            <div className="flex flex-wrap items-center gap-2">
              <Button type="submit" size="sm" disabled={busy} className="max-sm:h-11">
                <Send aria-hidden className="size-3.5" />
                {phase.kind === 'sending' ? t(`${C}.sending`) : t(`${C}.send`)}
              </Button>
              <TemplatesMenu templates={templates.data ?? []} disabled={busy} onChoose={chooseTemplate} />
              <SaveTemplateButton subject={initial.mode === 'new' ? subject : ''} body={body.replace(quote.current, '')} disabled={busy || !hasText(body.replace(quote.current, ''))} />
              <Button
                type="button"
                variant="ghost"
                size="sm"
                disabled={busy}
                className="ml-auto max-sm:h-11"
                onClick={() => {
                  if (draftId.current) {
                    setConfirmDelete(true)
                  } else {
                    // Never saved: nothing to delete, nothing to keep.
                    dirty.current = false
                    onClose()
                  }
                }}
              >
                <Trash2 aria-hidden className="size-3.5" />
                {t(`${C}.discard`)}
              </Button>
            </div>
          )}
        </footer>
      </form>

      <AlertDialog open={pendingTemplate !== null} onOpenChange={(open) => !open && setPendingTemplate(null)}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>{t(`${C}.replaceTitle`)}</AlertDialogTitle>
            <AlertDialogDescription>{t(`${C}.replaceBody`)}</AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>{t('common.cancel')}</AlertDialogCancel>
            <AlertDialogAction onClick={() => pendingTemplate && applyTemplate(pendingTemplate)}>{t(`${C}.replaceAction`)}</AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>

      <AlertDialog open={confirmDelete} onOpenChange={setConfirmDelete}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>{t(`${C}.discardTitle`)}</AlertDialogTitle>
            <AlertDialogDescription>{t(`${C}.discardBody`)}</AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>{t('common.cancel')}</AlertDialogCancel>
            <AlertDialogAction
              className={buttonVariants({ variant: 'destructive' })}
              onClick={() => {
                const id = draftId.current
                dirty.current = false
                void saving.current.then(() => {
                  if (id) deleteDraft.mutate(id)
                  toast.success(t(`${C}.discarded`))
                  onClose()
                })
              }}
            >
              {t(`${C}.discardAction`)}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </section>
  )
}

function AddressRow({
  id,
  label,
  field,
  inputRef,
  disabled,
}: {
  id: string
  label: string
  field: ReturnType<typeof useAddressField>
  inputRef?: React.Ref<HTMLInputElement>
  disabled: boolean
}) {
  const errorId = `${id}-error`
  return (
    <>
      <Label htmlFor={id} className="text-muted-foreground">
        {label}
      </Label>
      <div className="min-w-0 space-y-1">
        <Input
          id={id}
          ref={inputRef}
          type="text"
          inputMode="email"
          autoComplete="off"
          spellCheck={false}
          value={field.text}
          disabled={disabled}
          aria-invalid={field.invalid.length > 0 || undefined}
          aria-describedby={field.invalid.length > 0 ? errorId : undefined}
          onChange={(event) => field.setText(event.target.value)}
          onBlur={() => field.setText([...field.valid, ...field.invalid].join(', '))}
        />
        {field.invalid.length > 0 && (
          <p id={errorId} className="text-xs text-destructive">
            {t(`${C}.problems.badAddress`, { address: field.invalid[0] ?? '' })}
          </p>
        )}
      </div>
    </>
  )
}

/** « 1,4 Mo » / « 12 ko ». */
function size(bytes: number): string {
  if (bytes < 1024 * 1024) return t(`${C}.sizeKb`, { size: String(Math.max(1, Math.round(bytes / 1024))) })
  return t(`${C}.sizeMb`, { size: (bytes / 1024 / 1024).toLocaleString('fr-CA', { maximumFractionDigits: 1 }) })
}

function AttachmentList({ attachments, disabled, onRemove }: { attachments: DraftAttachment[]; disabled: boolean; onRemove: (id: string) => void }) {
  if (attachments.length === 0) return null
  return (
    <ul aria-label={t(`${C}.attachments`)} className="flex flex-wrap gap-2">
      {attachments.map((a) => (
        <li key={a.id} className="inline-flex max-w-[18rem] items-center gap-1.5 rounded-md border border-border px-2 py-1 text-xs">
          <Paperclip aria-hidden className="size-3 shrink-0" />
          <span className="truncate">{a.name}</span>
          <span className="tabular shrink-0 text-muted-foreground">{size(a.size_bytes)}</span>
          <Button
            type="button"
            variant="ghost"
            size="sm"
            disabled={disabled}
            aria-label={t(`${C}.removeAttachment`, { name: a.name })}
            onClick={() => onRemove(a.id)}
            className="h-6 w-6 p-0"
          >
            <X aria-hidden className="size-3" />
          </Button>
        </li>
      ))}
    </ul>
  )
}

/** « Modèles »: the clinic's starting texts, then one's own (« Mes modèles », with « Supprimer »). */
function TemplatesMenu({ templates, disabled, onChoose }: { templates: ComposeTemplate[]; disabled: boolean; onChoose: (template: ComposeTemplate) => void }) {
  const remove = useDeleteTemplate()
  const [toDelete, setToDelete] = useState<ComposeTemplate | null>(null)
  const clinic = templates.filter((x) => x.kind === 'clinic')
  const personal = templates.filter((x) => x.kind === 'personal')
  return (
    <>
      <DropdownMenu>
        <DropdownMenuTrigger asChild>
          <Button type="button" variant="outline" size="sm" disabled={disabled} className="max-sm:h-11">
            <FileText aria-hidden className="size-3.5" />
            {t(`${C}.templates`)}
          </Button>
        </DropdownMenuTrigger>
        <DropdownMenuContent align="start" className="max-h-80 overflow-y-auto">
          {templates.length === 0 && <DropdownMenuLabel>{t(`${C}.noTemplates`)}</DropdownMenuLabel>}
          {clinic.length > 0 && <DropdownMenuLabel>{t(`${C}.clinicTemplates`)}</DropdownMenuLabel>}
          {clinic.map((x) => (
            <DropdownMenuItem key={x.id} onSelect={() => onChoose(x)}>
              {x.name}
            </DropdownMenuItem>
          ))}
          {personal.length > 0 && (
            <>
              <DropdownMenuSeparator />
              <DropdownMenuLabel>{t(`${C}.myTemplates`)}</DropdownMenuLabel>
            </>
          )}
          {personal.map((x) => (
            <DropdownMenuItem key={x.id} onSelect={() => onChoose(x)}>
              {x.name}
            </DropdownMenuItem>
          ))}
          {personal.length > 0 && (
            <>
              <DropdownMenuSeparator />
              {personal.map((x) => (
                <DropdownMenuItem key={`delete-${x.id}`} onSelect={() => setToDelete(x)} className="text-destructive">
                  {t(`${C}.deleteTemplate`, { name: x.name })}
                </DropdownMenuItem>
              ))}
            </>
          )}
        </DropdownMenuContent>
      </DropdownMenu>
      <AlertDialog open={toDelete !== null} onOpenChange={(open) => !open && setToDelete(null)}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>{t(`${C}.deleteTemplateTitle`, { name: toDelete?.name ?? '' })}</AlertDialogTitle>
            <AlertDialogDescription>{t(`${C}.deleteTemplateBody`)}</AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>{t('common.cancel')}</AlertDialogCancel>
            <AlertDialogAction
              className={buttonVariants({ variant: 'destructive' })}
              onClick={() =>
                toDelete &&
                remove.mutate(toDelete.id, {
                  onSuccess: () => toast.success(t(`${C}.templateDeleted`)),
                  onError: (error) => toast.error(communicationsErrorMessage(error)),
                })
              }
            >
              {t(`${C}.deleteTemplateAction`)}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </>
  )
}

/** « Enregistrer comme modèle »: the text written (without the quote), under a name. */
function SaveTemplateButton({ subject, body, disabled }: { subject: string; body: string; disabled: boolean }) {
  const [open, setOpen] = useState(false)
  const [name, setName] = useState('')
  const [error, setError] = useState<string | null>(null)
  const save = useSaveTemplate()
  const id = useId()
  const submit = (event: FormEvent) => {
    event.preventDefault()
    event.stopPropagation()
    if (!name.trim()) {
      setError(t(`${C}.templateNameMissing`))
      return
    }
    save.mutate(
      { id: null, name: name.trim(), subject, bodyHtml: body },
      {
        onSuccess: () => {
          toast.success(t(`${C}.templateSaved`, { name: name.trim() }))
          setOpen(false)
          setName('')
        },
        onError: (failure) => setError(communicationsErrorMessage(failure)),
      },
    )
  }
  return (
    <Popover
      open={open}
      onOpenChange={(next) => {
        setOpen(next)
        setError(null)
      }}
    >
      <PopoverTrigger asChild>
        <Button type="button" variant="ghost" size="sm" disabled={disabled} className="max-sm:h-11">
          {t(`${C}.saveAsTemplate`)}
        </Button>
      </PopoverTrigger>
      <PopoverContent align="start" className="w-80">
        <form onSubmit={submit} noValidate className="space-y-2">
          <Label htmlFor={id}>{t(`${C}.templateName`)}</Label>
          <Input id={id} value={name} maxLength={80} autoFocus autoComplete="off" onChange={(e) => setName(e.target.value)} aria-invalid={error !== null || undefined} />
          {error && <p className="text-xs text-destructive">{error}</p>}
          <div className="flex justify-end">
            <Button type="submit" size="sm" disabled={save.isPending}>
              {t(`${C}.templateSave`)}
            </Button>
          </div>
        </form>
      </PopoverContent>
    </Popover>
  )
}
