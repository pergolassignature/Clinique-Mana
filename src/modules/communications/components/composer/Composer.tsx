import { useEffect, useMemo, useRef, useState } from 'react'
import {
  AiQuickBar,
  AttachmentChips,
  ComposerLayout,
  ComposerUiProvider,
  ComposerWindow,
  EmailAutocomplete,
  moveRecipient,
  TemplatePill,
  useComposeEngine,
  useDiscardQueue,
  useDraftAutosave,
  useSendQueue,
  type ComposerPresentation,
  type DraftSaver,
  type EmailAutocompleteHandle,
  type RecipientDrag,
  type RecipientField,
} from '@pergolas-signature/email-ui/composer'
import { t } from '@/i18n'
import { useAuth } from '@/core/auth/auth-context'
import { uploadFile } from '@/core/storage/api'
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
import { buttonVariants } from '@/shared/ui/button'
import { Select } from '@/shared/ui/select'
import { toast } from '@/shared/ui/sonner'
import {
  MAX_ATTACHMENTS,
  MAX_ATTACHMENTS_BYTES,
  OUTGOING_MAX_BYTES,
  OUTGOING_PURPOSE,
  OUTGOING_TYPES,
  type ComposeTemplate,
  type DraftAttachment,
  type DraftContent,
} from '../../api/composer'
import { communicationsErrorMessage } from '../../api/errors'
import type { MailConnection } from '../../api/mailboxes'
import { useDeleteDraft, useDeleteTemplate, useSaveDraft, useSendMail } from '../../hooks/use-composer'
import { useComposerLauncher } from '../../hooks/use-composer-launcher'
import { useAiDraftStatus } from '../../hooks/use-ai'
import { hasText, htmlToText, parseAddresses, sendProblem, textToHtml } from '../../lib/compose'
import { COMPOSER_ENGINE_PORTS } from './composer-engine-ports'
import { COMPOSER_UI_PORTS } from './composer-ui-ports'
import { RichEmailEditor } from './RichEmailEditor'
import { useManaComposerAi } from './use-composer-ai'
import { useManaComposerTemplates } from './use-composer-templates'

const C = 'modules.communications.composer'
/** Below this width the composer fills the screen (the kit's « mobile » sheet); from it, it docks. */
export const SHEET_QUERY = '(max-width: 1023px)'
/** The kit's whole-composer drop zone stays off: a file is dropped on `FileDropzone` (CLAUDE.md §8). */
const NO_DROP_ZONE = { isDragging: false, handlers: { onDragOver: () => undefined, onDragLeave: () => undefined, onDrop: () => undefined } }
/** The autosave waits this long after the last change. */
export const AUTOSAVE_MS = 1_500

/** A limit the composer checks itself; its message is shown as is. */
class ComposerLimit extends Error {}

/** A draft as the database answers it. */
interface SavedDraft {
  id: string
  updatedAt: string
}

/** What a queued send carries (the engine's payload). */
interface QueuedSend {
  draftId: string | null
  content: DraftContent
}

// The send's key, per draft and content, for the life of the tab: the same content sends with the
// same key, also from the composer « Rouvrir » opens after a failure (the server answers what the
// first « Envoyer » did, and looks in Gmail after no answer). Memory only, never the browser's
// storage (CM-14).
const sendKeys = new Map<string, string>()
function sendKeyFor(draftId: string | null, content: DraftContent): string {
  const at = `${draftId ?? ''}|${JSON.stringify(content)}`
  let key = sendKeys.get(at)
  if (!key) {
    key = crypto.randomUUID()
    sendKeys.set(at, key)
  }
  return key
}

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
 * templates (the clinic's and one's own, « Enregistrer comme modèle »), then « Envoyer ». The draft
 * is saved as one types (the database, never the browser's storage): closing keeps it in
 * « Brouillons ».
 *
 * What happens when is PS Hub's compose engine (email-ui 0.7.0, CM-27): « Envoyer » closes the
 * composer and the message leaves five seconds later, with « Annuler » in a notice; « Supprimer le
 * brouillon » closes it and deletes the draft five seconds later, with « Annuler »; the X closes at
 * once and saves behind it. Either « Annuler » (and « Rouvrir » after a failed send) reopens the
 * composer with what it held.
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
  const [problem, setProblem] = useState<string | null>(null)
  // From « Envoyer » until the send is queued (the draft saved first): the fields are locked.
  const [sending, setSending] = useState(false)
  const [view, setView] = useState<Exclude<ComposerPresentation, 'mobile'>>('open')
  const sheet = useMediaQuery(SHEET_QUERY)
  const userId = useAuth().session?.user.id ?? null
  // The quote under a reply or a forward: a template replaces the text above it only.
  const quote = useRef(initial.mode === 'new' ? '' : initial.bodyHtml)
  const toRef = useRef<EmailAutocompleteHandle>(null)
  const ccRef = useRef<EmailAutocompleteHandle>(null)
  const bccRef = useRef<EmailAutocompleteHandle>(null)
  const bodyBox = useRef<HTMLDivElement>(null)
  const attachButton = useRef<HTMLButtonElement>(null)
  // The kit draws a hidden file input for its paperclip; MANA's paperclip opens `FileDropzone`'s.
  const unusedFileInput = useRef<HTMLInputElement>(null)

  // The mutations' functions keep their identity across renders and work once the composer is
  // gone: the engine saves behind a close and sends five seconds after it.
  const { mutateAsync: saveDraft } = useSaveDraft()
  const { mutateAsync: deleteDraft } = useDeleteDraft()
  const { mutateAsync: sendMail } = useSendMail()
  const launcher = useComposerLauncher()
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
  // What the composer opened with: nothing is saved until something differs from it.
  const opening = useRef(snapshot)

  // The draft, saved as one types (the database): one save at a time, so a new draft is created once.
  const drafts = useMemo<DraftSaver<DraftContent, SavedDraft>>(
    () => ({ save: (ref, value) => saveDraft({ id: ref?.id ?? null, content: value }), remove: (ref) => deleteDraft(ref.id) }),
    [saveDraft, deleteDraft],
  )
  const draft = useDraftAutosave({ drafts, delayMs: AUTOSAVE_MS })
  const { init: initDraft } = draft
  useEffect(() => {
    initDraft(initialDraftId ? { id: initialDraftId, updatedAt: '' } : null)
  }, [initDraft, initialDraftId])

  const transport = useMemo(
    () => ({ send: (sendKey: string, queued: QueuedSend) => sendMail({ sendKey, draftId: queued.draftId, content: queued.content }) }),
    [sendMail],
  )
  const { queueSend } = useSendQueue<QueuedSend>({ ports: COMPOSER_ENGINE_PORTS, transport, storageKey: null })
  const { queueDiscard } = useDiscardQueue({ ports: COMPOSER_ENGINE_PORTS })

  /** « Annuler », « Rouvrir »: the composer again, with what it held. */
  const reopenWith = (id: string | null, value: DraftContent) => () =>
    launcher?.open(id ? { kind: 'draft', draftId: id, content: value, personKnown, fileLabel } : { kind: 'content', content: value, personKnown, fileLabel })

  useEffect(() => {
    toRef.current?.focus()
  }, [])

  /** « Envoyer », once the typed addresses became chips: true once the send is queued. */
  const send = async (): Promise<boolean> => {
    // Text still typed after that is no address (only a real one becomes a chip).
    const shown = [toRef, ...(showCc ? [ccRef] : []), ...(showBcc ? [bccRef] : [])]
    const typed = shown.map((field) => field.current?.pendingText() ?? '').find(Boolean)
    const now = fields.current
    const invalid = [...now.to.invalid, ...(showCc ? now.cc.invalid : []), ...(showBcc ? now.bcc.invalid : [])]
    const value = latest.current
    const bad = typed || invalid[0]
    const why = bad ? t(`${C}.problems.badAddress`, { address: bad }) : sendProblem(value)
    setProblem(why)
    if (why) return false
    setSending(true)
    // Saved first, so « Annuler » and « Rouvrir » find the draft; a failed save still sends.
    const saved = await draft.saveNow(value).catch(() => null)
    const id = saved?.id ?? draft.getCurrentRef()?.id ?? null
    queueSend({
      payload: { draftId: id, content: value },
      sendKey: sendKeyFor(id, value),
      reopen: reopenWith(id, value),
      onSent: (result) => onSent((result as { thread_id: string | null }).thread_id),
    })
    return true
  }

  /** « Supprimer le brouillon »: five seconds with « Annuler », then deleted. */
  const discard = () => {
    const value = latest.current
    const id = draft.getCurrentRef()?.id ?? null
    draft.deactivate()
    // Never saved and never changed: nothing to delete, nothing to keep.
    if (!id && snapshot === opening.current) return
    queueDiscard({
      // After any save under way, or its draft would be left behind.
      discard: async () => {
        const ref = await draft.getSettledRef()
        if (ref) await deleteDraft(ref.id)
      },
      reopen: reopenWith(id, value),
    })
  }

  const engine = useComposeEngine({
    ports: COMPOSER_ENGINE_PORTS,
    open: true,
    close: onClose,
    draft,
    keepsDraft: true,
    canSaveDraft: true,
    dirty: snapshot !== opening.current,
    contentKey: snapshot,
    getDraftContent: () => latest.current,
    encodeDraftAttachments: async () => [],
    // Replaced by another composer, or the page left: saved behind, as the X does.
    saveOnUnmount: true,
    pendingRecipients: () => [toRef.current, showCc ? ccRef.current : null, showBcc ? bccRef.current : null],
    send,
    discard,
  })

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
  const busy = sending
  const savedAt = draft.status === 'saved' && draft.ref?.updatedAt ? draft.ref.updatedAt : null
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
  return (
    <ComposerUiProvider ports={COMPOSER_UI_PORTS}>
      <ComposerWindow
        presentation={presentation}
        title={subject.trim() || title}
        status={
          <span role="status" className="truncate text-xs text-muted-foreground">
            {draft.status === 'error' ? t(`${C}.saveFailed`) : savedAt ? t(`${C}.savedAt`, { time: formatClinicTime(savedAt) }) : ''}
          </span>
        }
        onMinimize={() => setView('minimized')}
        onRestore={() => setView('open')}
        onExpand={() => setView('fullscreen')}
        onShrink={() => setView('open')}
        onClose={engine.handleClose}
        // « Envoyer » under way (the draft saving before the send is queued).
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
              <AttachmentChips
                attachments={attachments}
                getName={(a) => a.name}
                getSize={(a) => size(a.size_bytes)}
                disabled={busy}
                onRemove={(gone) => setAttachments((list) => list.filter((a) => a.id !== gone.id))}
              />
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
                <RichEmailEditor
                  initialHtml={initial.bodyHtml}
                  replaceWith={replaceWith}
                  onChange={setBody}
                  label={t(`${C}.body`)}
                  personKnown={personKnown}
                  // The selection bubble rewrites a passage with the same AI (CM-29), while a draft can be asked for.
                  rewriteAi={ai.data?.available && !busy ? composerAi : undefined}
                />
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
                      const saved = await draft.saveNow(latest.current).catch(() => null)
                      const id = saved?.id ?? draft.getCurrentRef()?.id
                      if (!id) throw new ComposerLimit(t(`${C}.saveFailed`))
                      const { fileId } = await uploadFile({ purpose: OUTGOING_PURPOSE, subjectType: 'mail_draft', subjectId: id, file, mimeType, onStep })
                      setAttachments((list) => [...list, { id: fileId, name: file.name, mime_type: mimeType, size_bytes: file.size }])
                    }}
                  />
                )}
              </div>
            }
            focusBody={focusBody}
            fileInput={{ inputRef: unusedFileInput, onFiles: () => undefined }}
            notice={
              problem ? (
                <p role="alert" className="text-sm text-destructive">
                  {problem}
                </p>
              ) : null
            }
            footer={{
              onSend: engine.handleSend,
              sendDisabled: busy,
              isSending: sending,
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
              onDiscard: busy ? undefined : engine.handleDiscard,
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
