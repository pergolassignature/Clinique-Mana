import { useCallback, useEffect, useMemo, useRef, useState, type FormEvent } from 'react'
import { Paperclip, X } from 'lucide-react'
import {
  AiQuickBar,
  ComposerLayout,
  ComposerUiProvider,
  ComposerWindow,
  EmailAutocomplete,
  moveRecipient,
  TemplatePill,
  type ComposerPresentation,
  type EmailAutocompleteHandle,
  type RecipientDrag,
  type RecipientField,
} from '@pergolas-signature/email-ui/composer'
import { t } from '@/i18n'
import { useAuth } from '@/core/auth/auth-context'
import { uploadFile } from '@/core/storage/api'
import { FunctionCallError } from '@/core/supabase/functions'
import { FileDropzone } from '@/shared/components/FileDropzone'
import { useMediaQuery } from '@/shared/lib/use-media-query'
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
import { useDeleteDraft, useDeleteTemplate, useSaveDraft, useSendMail } from '../../hooks/use-composer'
import { useAiDraftStatus } from '../../hooks/use-ai'
import { hasText, htmlToText, parseAddresses, sendProblem, textToHtml } from '../../lib/compose'
import { COMPOSER_UI_PORTS } from './composer-ui-ports'
import { RichEmailEditor } from './RichEmailEditor'
import { useManaComposerAi } from './use-composer-ai'
import { useManaComposerTemplates } from './use-composer-templates'

const C = 'modules.communications.composer'
/** Below this width the composer fills the screen (the kit's « mobile » sheet); from it, it docks. */
export const SHEET_QUERY = '(max-width: 1023px)'
/** The kit's whole-composer drop zone stays off: a file is dropped on `FileDropzone` (CLAUDE.md §8). */
const NO_DROP_ZONE = { isDragging: false, handlers: { onDragOver: () => undefined, onDragLeave: () => undefined, onDrop: () => undefined } }
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

/** A field's addresses (the kit's chips) and which of them are real ones. */
function useAddressList(initial: string[]) {
  const [list, setList] = useState(initial)
  const parsed = useMemo(() => parseAddresses(list.join(', ')), [list])
  return { list, setList, ...parsed }
}

/**
 * The composer (CM3; PS Hub's `ComposerCore`): the mailbox, « À », « Cc », « Cci », « Objet », the
 * editor, the attachments (uploaded to our storage, or a forwarded message's stored copies), the
 * templates (the clinic's and one's own, « Enregistrer comme modèle »), then « Envoyer » with five
 * seconds to « Annuler l'envoi ». The draft is saved as one types (the database, never the
 * browser's storage): closing keeps it in « Brouillons ».
 *
 * Drawn by PS Hub's kit (`ComposerWindow`, `ComposerLayout`, CM-23): docked at the bottom right
 * from 1024 px (« Réduire » to a pill, « Plein écran »), the whole screen below. Échap minimizes
 * the dock and brings the full screen back to it; it never closes. The rows' contents (the
 * addresses, the mailbox, the AI bar, the attachments, the templates) stay MANA's.
 */
export function Composer({ draftId: initialDraftId, initial: initialProp, mailboxes, fileLabel, personKnown, onClose, onSent }: ComposerProps) {
  // The starting content, as it was at the opening: a parent rendering again never resets it.
  const [initial] = useState(initialProp)
  const [connectionId, setConnectionId] = useState(initial.connectionId)
  const [subject, setSubject] = useState(initial.subject)
  const [body, setBody] = useState(initial.bodyHtml)
  const [attachments, setAttachments] = useState<DraftAttachment[]>(initial.attachments)
  const to = useAddressList(initial.to)
  const cc = useAddressList(initial.cc)
  const bcc = useAddressList(initial.bcc)
  // The send reads the fields after their typed text became chips (a render later).
  const fields = useRef({ to, cc, bcc })
  fields.current = { to, cc, bcc }
  const [showCc, setShowCc] = useState(initial.cc.length > 0)
  const [showBcc, setShowBcc] = useState(initial.bcc.length > 0)
  // The copy row a toggle just opened takes the focus as it mounts (never the rows a draft reopens with).
  const [focusOnOpen, setFocusOnOpen] = useState<'cc' | 'bcc' | null>(null)
  useEffect(() => {
    if (focusOnOpen === 'cc' && showCc) ccRef.current?.focus()
    if (focusOnOpen === 'bcc' && showBcc) bccRef.current?.focus()
  }, [focusOnOpen, showCc, showBcc])
  const [replaceWith, setReplaceWith] = useState<{ html: string; version: number } | null>(null)
  const [pendingTemplate, setPendingTemplate] = useState<{ subject: string; html: string } | null>(null)
  const [templateToDelete, setTemplateToDelete] = useState<ComposeTemplate | null>(null)
  const [confirmDelete, setConfirmDelete] = useState(false)
  const [phase, setPhase] = useState<Phase>({ kind: 'editing' })
  const [problem, setProblem] = useState<string | null>(null)
  const [savedAt, setSavedAt] = useState<string | null>(null)
  const [saveFailed, setSaveFailed] = useState(false)
  const [view, setView] = useState<Exclude<ComposerPresentation, 'mobile'>>('open')
  const sheet = useMediaQuery(SHEET_QUERY)
  const userId = useAuth().session?.user.id ?? null
  // The quote under a reply or a forward: a template replaces the text above it only.
  const quote = useRef(initial.mode === 'new' ? '' : initial.bodyHtml)
  const draftId = useRef<string | null>(initialDraftId)
  const saving = useRef<Promise<void>>(Promise.resolve())
  // The send's key, and the content it was made for: the same content sends with the same key
  // (the server answers what the first « Envoyer » did, and looks in Gmail after no answer).
  const sendKey = useRef<{ key: string; content: string } | null>(null)
  const toRef = useRef<EmailAutocompleteHandle>(null)
  const ccRef = useRef<EmailAutocompleteHandle>(null)
  const bccRef = useRef<EmailAutocompleteHandle>(null)
  const bodyBox = useRef<HTMLDivElement>(null)
  const attachButton = useRef<HTMLButtonElement>(null)
  // The kit draws a hidden file input for its paperclip; MANA's paperclip opens `FileDropzone`'s.
  const unusedFileInput = useRef<HTMLInputElement>(null)
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
  // PS Hub's template picker over MANA's templates (CM-26); a deletion asks first, below.
  const templates = useManaComposerTemplates({ confirmDelete: setTemplateToDelete })
  const removeTemplate = useDeleteTemplate()
  const ai = useAiDraftStatus()

  const content: DraftContent = useMemo(
    () => ({
      ...initial,
      connectionId,
      to: to.valid,
      cc: showCc ? cc.valid : [],
      bcc: showBcc ? bcc.valid : [],
      subject,
      bodyHtml: body,
      attachments,
    }),
    [initial, connectionId, to.valid, cc.valid, bcc.valid, showCc, showBcc, subject, body, attachments],
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
    toRef.current?.focus()
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
    // Text typed and not yet a chip: a bad address is said at once; a real one becomes a chip
    // first, and the fields are read again after that render.
    const shown = [toRef, ...(showCc ? [ccRef] : []), ...(showBcc ? [bccRef] : [])]
    const typed = shown.map((field) => field.current?.pendingText() ?? '')
    const badTyped = typed.find((text) => text && parseAddresses(text).invalid.length > 0)
    if (!badTyped && typed.some(Boolean)) {
      for (const field of shown) field.current?.commitPending()
      await new Promise((resolve) => setTimeout(resolve, 0))
    }
    const now = fields.current
    const invalid = [...now.to.invalid, ...(showCc ? now.cc.invalid : []), ...(showBcc ? now.bcc.invalid : [])]
    const bad = badTyped || invalid[0]
    const why = bad ? t(`${C}.problems.badAddress`, { address: bad }) : sendProblem(latest.current)
    setProblem(why)
    if (why) return
    await saveNow()
    setPhase({ kind: 'counting', left: UNDO_SECONDS })
  }

  const applyTemplate = (template: { subject: string; html: string }) => {
    setReplaceWith((prev) => ({ html: template.html + quote.current, version: (prev?.version ?? 0) + 1 }))
    if (initial.mode === 'new' && template.subject.trim() && !subject.trim()) setSubject(template.subject)
    setPendingTemplate(null)
  }
  const chooseTemplate = (template: { subject: string; html: string }) => {
    // Replacing a text one wrote asks first.
    if (body !== quote.current && hasText(body.replace(quote.current, ''))) setPendingTemplate(template)
    else applyTemplate(template)
  }

  const totalBytes = attachments.reduce((sum, a) => sum + a.size_bytes, 0)
  const busy = phase.kind !== 'editing'
  const mailbox = mailboxes.find((m) => m.id === connectionId)
  const title =
    initial.mode === 'new' ? t(`${C}.titleNew`) : initial.mode === 'forward' ? t(`${C}.titleForward`) : t(`${C}.titleReply`)
  const presentation: ComposerPresentation = sheet ? 'mobile' : view
  const dropOn = (target: RecipientField) => (drag: RecipientDrag) => {
    const next = moveRecipient({ to: to.list, cc: cc.list, bcc: bcc.list }, drag.email, drag.from, target)
    to.setList(next.to)
    cc.setList(next.cc)
    bcc.setList(next.bcc)
  }
  // PS Hub's AI bar over MANA's server (CM-24): a reply, a new message, a refinement.
  const composerAi = useManaComposerAi({
    original: initial.mode === 'reply' ? htmlToText(quote.current) : '',
    subjectEmpty: !subject.trim(),
    clientId: initial.clientId,
    threadId: initial.threadId,
    capReached: ai.data?.cap_reached ?? false,
  })
  /** The editor's editable area: Tab from « Objet », a click in the body's margin, a change of presentation. */
  const focusBody = () => bodyBox.current?.querySelector<HTMLElement>('[contenteditable="true"]')?.focus()
  const close = () => {
    void saveNow().then(onClose)
  }
  const discard = () => {
    if (draftId.current) {
      setConfirmDelete(true)
    } else {
      // Never saved: nothing to delete, nothing to keep.
      dirty.current = false
      onClose()
    }
  }

  return (
    <ComposerUiProvider ports={COMPOSER_UI_PORTS}>
      <ComposerWindow
        presentation={presentation}
        title={subject.trim() || title}
        status={
          <span role="status" className="truncate text-xs text-muted-foreground">
            {saveFailed ? t(`${C}.saveFailed`) : savedAt ? t(`${C}.savedAt`, { time: formatClinicTime(savedAt) }) : ''}
          </span>
        }
        onMinimize={() => setView('minimized')}
        onRestore={() => setView('open')}
        onExpand={() => setView('fullscreen')}
        onShrink={() => setView('open')}
        onClose={close}
        // A send under way: closing would leave its outcome unsaid.
        closeDisabled={busy}
        closeInTabOrder={false}
        // The dock's size as the person dragged it: a convenience, never content (CM-14).
        sizeStorageKey={userId ? `mana-mail-dock-size:${userId}` : null}
        focus={{ restore: () => (to.list.length > 0 ? focusBody() : toRef.current?.focus()), body: focusBody }}
      >
        {({ roomy }) => (
          <ComposerLayout
            roomy={roomy}
            dropZone={NO_DROP_ZONE}
            banners={(padX) =>
              fileLabel ? <p className={cn('pt-2 text-xs text-muted-foreground', padX)}>{t(`${C}.aboutFile`, { file: fileLabel })}</p> : null
            }
            from={
              mailboxes.length > 1 ? (
                <Select aria-label={t(`${C}.from`)} value={connectionId} disabled={busy || initial.mode !== 'new'} onChange={(e) => setConnectionId(e.target.value)}>
                  {mailboxes.map((m) => (
                    <option key={m.id} value={m.id}>
                      {m.email_address}
                    </option>
                  ))}
                </Select>
              ) : undefined
            }
            recipients={{
              to: <AddressField name="to" label={t(`${C}.to`)} field={to} fieldRef={toRef} onDrop={dropOn('to')} disabled={busy} />,
              cc: <AddressField name="cc" label={t(`${C}.cc`)} field={cc} fieldRef={ccRef} onDrop={dropOn('cc')} disabled={busy} />,
              bcc: <AddressField name="bcc" label={t(`${C}.bcc`)} field={bcc} fieldRef={bccRef} onDrop={dropOn('bcc')} disabled={busy} />,
              showCc,
              showBcc,
              onShowCc: () => {
                setFocusOnOpen('cc')
                setShowCc(true)
              },
              onShowBcc: () => {
                setFocusOnOpen('bcc')
                setShowBcc(true)
              },
            }}
            subject={{ value: subject, onChange: (value) => setSubject(value.replace(/[\r\n]+/g, ' ')), disabled: busy, maxLength: 250 }}
            attachments={
              attachments.length > 0 ? (
                <div className={cn('py-2', roomy ? 'px-6' : 'px-4')}>
                  <AttachmentList attachments={attachments} disabled={busy} onRemove={(id) => setAttachments((list) => list.filter((a) => a.id !== id))} />
                </div>
              ) : undefined
            }
            body={
              <div ref={bodyBox} className="space-y-2">
                {ai.data?.available && (
                  <AiQuickBar
                    ai={composerAi}
                    bodyText={htmlToText(body.replace(quote.current, ''))}
                    // Whole-body only: the selection rewrite is a server MANA does not have.
                    selection={null}
                    // The proposal replaces the text above the quote; « Rétablir » gives the previous text back.
                    onReplaceAll={(text) => setReplaceWith((prev) => ({ html: textToHtml(text) + quote.current, version: (prev?.version ?? 0) + 1 }))}
                    onReplaceSelection={() => undefined}
                    parentMessage={initial.mode === 'reply' ? htmlToText(quote.current) : undefined}
                    subject={subject}
                    onSubjectChange={setSubject}
                    onRequestEditorFocus={focusBody}
                    disabled={busy}
                  />
                )}
                <RichEmailEditor initialHtml={initial.bodyHtml} replaceWith={replaceWith} onChange={setBody} label={t(`${C}.body`)} personKnown={personKnown} />
                {/* Files go through FileDropzone (CLAUDE.md §8): the kit's paperclip opens its picker. */}
                {attachments.length < MAX_ATTACHMENTS && !busy && (
                  <FileDropzone
                    buttonRef={attachButton}
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
            }
            focusBody={focusBody}
            fileInput={{ inputRef: unusedFileInput, onFiles: () => undefined }}
            notice={
              problem || phase.kind === 'counting' ? (
                <div className="space-y-2">
                  {problem && (
                    <p role="alert" className="text-sm text-destructive">
                      {problem}
                    </p>
                  )}
                  {phase.kind === 'counting' && (
                    <div role="status" className="flex flex-wrap items-center gap-3">
                      <span className="text-sm text-foreground">{t(`${C}.sendingIn`, { seconds: String(phase.left) })}</span>
                      <Button type="button" variant="outline" size="sm" autoFocus onClick={() => setPhase({ kind: 'editing' })}>
                        {t(`${C}.undo`)}
                      </Button>
                    </div>
                  )}
                </div>
              ) : null
            }
            footer={{
              onSend: () => void startSend(),
              sendDisabled: busy,
              isSending: phase.kind === 'sending',
              onAttach: () => attachButton.current?.click(),
              actions: (
                <TemplatePill
                  templates={templates}
                  iconTrigger
                  disabled={busy}
                  onApply={(templateSubject, templateBody) => chooseTemplate({ subject: templateSubject, html: templateBody.html })}
                  // « Enregistrer comme modèle »: the text written, without the quote; a reply's subject stays its own.
                  currentSubject={initial.mode === 'new' ? subject : ''}
                  currentBodyHtml={body.replace(quote.current, '')}
                  currentBody={htmlToText(body.replace(quote.current, ''))}
                />
              ),
              via: mailbox?.email_address,
              onDiscard: busy ? undefined : discard,
            }}
          />
        )}
      </ComposerWindow>

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

      <AlertDialog open={templateToDelete !== null} onOpenChange={(open) => !open && setTemplateToDelete(null)}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>{t(`${C}.deleteTemplateTitle`, { name: templateToDelete?.name ?? '' })}</AlertDialogTitle>
            <AlertDialogDescription>{t(`${C}.deleteTemplateBody`)}</AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>{t('common.cancel')}</AlertDialogCancel>
            <AlertDialogAction
              className={buttonVariants({ variant: 'destructive' })}
              onClick={() =>
                templateToDelete &&
                removeTemplate.mutate(templateToDelete.id, {
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
    </ComposerUiProvider>
  )
}

/**
 * An address field inside the kit's row: the kit's chips (PS Hub's field, CM-25), named for
 * assistive tech (the row draws the visible label), with MANA's « adresse invalide » under it for a
 * chip that is not a real address.
 */
function AddressField({
  name,
  label,
  field,
  fieldRef,
  onDrop,
  disabled,
}: {
  name: RecipientField
  label: string
  field: ReturnType<typeof useAddressList>
  fieldRef: React.Ref<EmailAutocompleteHandle>
  onDrop: (drag: RecipientDrag) => void
  disabled: boolean
}) {
  return (
    <div className="min-w-0 space-y-1">
      <EmailAutocomplete
        ref={fieldRef}
        emails={field.list}
        onChange={field.setList}
        label={label}
        disabled={disabled}
        field={name}
        onDropRecipient={onDrop}
        placeholder={name === 'to' ? undefined : ''}
      />
      {field.invalid.length > 0 && (
        <p className="text-xs text-destructive">{t(`${C}.problems.badAddress`, { address: field.invalid[0] ?? '' })}</p>
      )}
    </div>
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
