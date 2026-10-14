import { useDeferredValue, useEffect, useMemo, useRef, useState, type ClipboardEvent, type FormEvent, type ReactNode, type RefObject } from 'react'
import { Bold, ChevronDown, Heading1, Heading2, List, ListOrdered, TriangleAlert } from 'lucide-react'
import { t } from '@/i18n'
import { moduleErrorMessage } from '@/core/modules/errors'
import { Loading, LoadError } from '@/shared/components/LoadState'
import { SettingsCard } from '@/shared/components/SettingsCard'
import { SwitchField } from '@/shared/components/SwitchField'
import { ignoreWhenInactive, softDisabledClasses } from '@/shared/components/soft-disabled'
import { useUnsavedChanges } from '@/shared/lib/unsaved-changes-context'
import { formatClinicDateShort, formatClinicDateTime, formatClinicTime, formatDateOnly } from '@/shared/lib/timezone'
import { cn } from '@/shared/lib/utils'
import {
  AlertDialog,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from '@/shared/ui/alert-dialog'
import { Alert, AlertDescription } from '@/shared/ui/alert'
import { Badge } from '@/shared/ui/badge'
import { Button } from '@/shared/ui/button'
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuTrigger } from '@/shared/ui/dropdown-menu'
import { FormField } from '@/shared/ui/form-field'
import { Input } from '@/shared/ui/input'
import { Textarea } from '@/shared/ui/textarea'
import { RefusalAlert } from '@/shared/components/RefusalAlert'
import type { DocumentTemplateSummary, TemplateVersion } from './api'
import { diffLines, hasChanges } from './diff'
import { useTemplateMutations, useTemplateVersions, type TemplateMutationHandlers } from './hooks'
import { htmlToMarkup } from './paste'
import { asBody, bodyToMarkup, hasBanner, hasBlockPlaceholder, hasHeadingWith, markupToBody, previewHtml, unknownPlaceholders, type PdfBody, type PreviewText } from './markup'

const N = 'signing.templates.editor'

/**
 * What a module tells the shared editor (CC-12) about its templates. Professionnels: the
 * professional's initials, Annexe A, the « à faire valider » line, publishing here. Clients'
 * consents: the clauses' table, the « Texte provisoire » line, publishing from Paramètres →
 * Consentements (who must sign again, R-49).
 */
export interface TemplateEditorOptions {
  /** A signer whose initials the header may carry on every page, with the switch's words. */
  initials?: { role: string; label: string; help: string } | null
  /** A block placeholder the sending function fills with tables, its words and the preview's sample. */
  block?: {
    placeholder: string
    /** Publishing is refused without it alone on a line (when the template declares its variable). */
    required: boolean
    note: string
    missing: string
    blocked: string
    sample: { caption: string; columns: string[]; rows: string[][] }
  } | null
  /** A line the draft must lose before publishing (a validation or provisional line). */
  banner?: { text: string; notice: string; blocked: string } | null
  /**
   * The body's `grantsImageRights` mark (Professionnels' service contract, P4-557): shown, a switch
   * on a draft, said in the publish confirmation; publishing is refused while it is on and no heading
   * holds `article` (the database refuses it too).
   */
  imageRights?: { article: string; label: string; help: string; on: string; off: string; missing: string; blocked: string; confirm: string } | null
  /** « Publier » here (core's publish). False when the module publishes its own way. */
  canPublish?: boolean
  /** The module's error handling and what it refreshes after a publication (`useTemplateMutations`). */
  handlers?: Pick<TemplateMutationHandlers, 'onError' | 'onChanged'>
  /**
   * « Publier » opens the module's own confirmation (Clients: who must sign again, R-49) instead of
   * core's; the button is offered and blocked by the same rules.
   */
  onPublish?: (version: TemplateVersion) => void
  /** Another reason the module blocks « Publier » for now (Clients: questions not saved yet). */
  publishBlocked?: string | null
  /**
   * The text first (CC-21, Clients' consents): the body with a toolbar, the document's other
   * fields folded under « Autres réglages du document », « Comparer avec la version publiée », an
   * autosaved draft, the module's preview beside the form, and the module's part after the text.
   */
  focused?: {
    autosave: boolean
    /** The preview column, from the document's HTML (`previewHtml`): the module's own view around it. */
    preview?: (documentHtml: string, version: TemplateVersion) => ReactNode
    /** Right after the text's card (Clients' « Oui / Non » questions). */
    afterText?: (version: TemplateVersion) => ReactNode
  } | null
}

interface Draft {
  title: string
  header: string
  footer: string
  initials: boolean
  imageRights: boolean
  markup: string
  emailSubject: string
  emailMessage: string
}

function draftOf(version: TemplateVersion, body: PdfBody, initialsRole: string | null): Draft {
  return {
    title: body.title,
    header: body.header?.text ?? '',
    footer: body.footer.text,
    initials: initialsRole !== null && (body.header?.initialsFor ?? []).includes(initialsRole),
    imageRights: body.grantsImageRights === true,
    markup: bodyToMarkup(body),
    emailSubject: version.emailSubject,
    emailMessage: version.emailMessage,
  }
}

/** The body a draft makes: the markup's blocks, the fields, and the base's signature page. */
function bodyOf(draft: Draft, base: PdfBody, initialsRole: string | null, imageRights = false): PdfBody {
  const others = (base.header?.initialsFor ?? []).filter((role) => role !== initialsRole)
  const initialsFor = draft.initials && initialsRole !== null ? [initialsRole, ...others] : others
  // The image-rights mark follows the switch when the module shows it; otherwise the base's stays.
  const { grantsImageRights, ...rest } = base
  const mark = imageRights ? draft.imageRights : grantsImageRights === true
  return markupToBody(draft.markup, {
    ...rest,
    ...(mark && { grantsImageRights: true }),
    title: draft.title,
    header: { text: draft.header, ...(initialsFor.length > 0 && { initialsFor }) },
    footer: { text: draft.footer },
  })
}

/** The preview's fixed words, and the module's sample for its block placeholder. */
function previewText(block: TemplateEditorOptions['block']): PreviewText {
  return {
    ...(block && { blockSample: { placeholder: block.placeholder, ...block.sample } }),
    initials: t(`${N}.preview.initials`),
    signature: t(`${N}.preview.signature`),
    date: t(`${N}.preview.date`),
    page: t(`${N}.preview.page`),
  }
}

/** A sample as the PDF prints its kind: « 8 octobre 2026 » for a date, the clinic's time for a date and time. */
function sampleText(variable: TemplateVersion['variables'][number]): string {
  if (variable.kind === 'date' && /^\d{4}-\d{2}-\d{2}/.test(variable.sample)) return formatDateOnly(variable.sample)
  if (variable.kind === 'datetime' && !Number.isNaN(Date.parse(variable.sample))) return formatClinicDateTime(variable.sample)
  return variable.sample
}

function versionLabel(version: TemplateVersion): string {
  const n = String(version.version)
  if (version.status === 'draft') return t(`${N}.versions.draft`, { version: n, date: formatClinicDateShort(version.updatedAt) })
  if (version.status === 'published') return t(`${N}.versions.published`, { version: n, date: formatClinicDateShort(version.publishedAt ?? version.updatedAt) })
  return t(`${N}.versions.archived`, { version: n, date: formatClinicDateShort(version.archivedAt ?? version.updatedAt) })
}

/**
 * One template's versions, the shared editor of every module's document templates (CC-12; moved
 * from Professionnels' Task 4d.3, A5.7; core RPCs): the draft is edited here (title, header and
 * its initials, footer, the body as markup, Documenso's subject and message), with the variables
 * and a live preview; « Publier » (confirmed: « Les prochains envois utiliseront cette
 * version. ») is offered once the draft is saved, without the module's banner line and, when the
 * module declares a required block placeholder (Annexe A), with it. Without a draft, « Nouvelle
 * version » copies the published one. Read-only without the template's edit permission.
 */
export function DocumentTemplateEditor({
  template,
  readOnly,
  options = {},
}: {
  template: DocumentTemplateSummary
  readOnly: boolean
  options?: TemplateEditorOptions
}) {
  const versions = useTemplateVersions(template.id)
  if (versions.isPending) return <Loading />
  if (versions.data === undefined) {
    return (
      <LoadError
        message={moduleErrorMessage(versions.error, t(`${N}.loadError`), 'settings')}
        retrying={versions.isFetching}
        onRetry={() => void versions.refetch()}
      />
    )
  }
  const draft = versions.data.find((v) => v.status === 'draft') ?? null
  const published = versions.data.find((v) => v.status === 'published') ?? null
  const shown = draft ?? published ?? versions.data[0] ?? null
  if (options.focused) {
    return (
      <div className="space-y-5">
        {!readOnly && draft === null && (
          <Alert>
            <AlertDescription className="space-y-2 text-foreground">
              <span className="block">{published ? t(`${N}.focused.publishedOnly`, { version: String(published.version) }) : t(`${N}.focused.noDraft`)}</span>
              <NewVersionButton templateId={template.id} published={published} handlers={options.handlers} />
            </AlertDescription>
          </Alert>
        )}
        {shown && (
          // Keyed by the version alone: an autosave refreshes it, the text being typed stays.
          <VersionForm key={shown.id} version={shown} editable={!readOnly && shown.status === 'draft'} published={published} options={options} />
        )}
        <details className="rounded-md border border-border-light px-4 py-3 text-sm">
          <summary className="cursor-pointer font-medium text-foreground">{t(`${N}.focused.history`, { count: String(versions.data.length) })}</summary>
          <ul className="mt-2 divide-y divide-border-light">
            {versions.data.map((v) => (
              <li key={v.id} className="flex flex-wrap items-center justify-between gap-2 py-2">
                <span>{versionLabel(v)}</span>
                {v.status === 'published' && <Badge variant="success">{t(`${N}.versions.inUse`)}</Badge>}
                {v.status === 'draft' && <Badge variant="info">{t(`${N}.versions.editing`)}</Badge>}
              </li>
            ))}
          </ul>
        </details>
      </div>
    )
  }
  return (
    <div className="space-y-5">
      <SettingsCard as="section" title={t(`${N}.versions.title`)} description={t(`${N}.versions.description`)}>
        <ul className="divide-y divide-border-light border-y border-border-light text-sm">
          {versions.data.map((v) => (
            <li key={v.id} className="flex flex-wrap items-center justify-between gap-2 py-2">
              <span>{versionLabel(v)}</span>
              {v.status === 'published' && <Badge variant="success">{t(`${N}.versions.inUse`)}</Badge>}
              {v.status === 'draft' && <Badge variant="info">{t(`${N}.versions.editing`)}</Badge>}
            </li>
          ))}
        </ul>
        {!readOnly && draft === null && <NewVersionButton templateId={template.id} published={published} handlers={options.handlers} />}
      </SettingsCard>
      {shown && (
        <VersionForm key={`${shown.id}:${shown.updatedAt}`} version={shown} editable={!readOnly && shown.status === 'draft'} published={published} options={options} />
      )}
    </div>
  )
}

function NewVersionButton({
  templateId,
  published,
  handlers,
}: {
  templateId: string
  published: TemplateVersion | null
  handlers: TemplateEditorOptions['handlers']
}) {
  const [refusal, setRefusal] = useState<string | null>(null)
  const { create } = useTemplateMutations({ ...handlers, onErrorMessage: (message) => setRefusal(message) })
  return (
    <div className="space-y-2">
      <Button
        type="button"
        size="sm"
        aria-disabled={create.isPending || undefined}
        className={cn(softDisabledClasses)}
        onClick={ignoreWhenInactive(create.isPending, () => {
          setRefusal(null)
          create.mutate(templateId)
        })}
      >
        {published ? t(`${N}.newVersionFrom`, { version: String(published.version) }) : t(`${N}.newVersion`)}
      </Button>
      {refusal && <RefusalAlert message={refusal} />}
    </div>
  )
}

function VersionForm({
  version,
  editable,
  published,
  options,
}: {
  version: TemplateVersion
  editable: boolean
  published: TemplateVersion | null
  options: TemplateEditorOptions
}) {
  const initialsRole = options.initials?.role ?? null
  const block = options.block ?? null
  const rights = options.imageRights ?? null
  const canPublish = options.canPublish ?? true
  const base = useMemo(() => asBody(version.body), [version.body])
  const initial = useMemo(() => (base ? draftOf(version, base, initialsRole) : null), [base, version, initialsRole])
  const focused = options.focused ?? null
  const [draft, setDraft] = useState<Draft | null>(initial)
  // What the database holds: the version as it came, then each draft saved here (an autosave keeps
  // the form mounted, so the text being typed is never replaced by the refreshed version).
  const [saved, setSaved] = useState<Draft | null>(initial)
  const [savedAt, setSavedAt] = useState<string | null>(null)
  const [refusal, setRefusal] = useState<string | null>(null)
  const [confirming, setConfirming] = useState<'publish' | 'discard' | null>(null)
  const [comparing, setComparing] = useState(false)
  const publishRef = useRef<HTMLButtonElement>(null)
  const bodyRef = useRef<HTMLTextAreaElement>(null)
  const { save, publish, archive } = useTemplateMutations({
    ...options.handlers,
    quietSave: focused?.autosave ?? false,
    onErrorMessage: (message) => setRefusal(message),
  })
  const dirty = editable && draft !== null && saved !== null && JSON.stringify(draft) !== JSON.stringify(saved)
  useUnsavedChanges(dirty)
  // The preview follows the typing at React's pace: a keystroke never waits for the whole page.
  const deferred = useDeferredValue(draft)
  const preview = useMemo(
    () =>
      base && deferred
        ? previewHtml(bodyOf(deferred, base, initialsRole, rights !== null), Object.fromEntries(version.variables.map((v) => [v.path, sampleText(v)])), previewText(block))
        : '',
    [base, deferred, version.variables, initialsRole, block, rights],
  )
  const paths = version.variables.map((v) => v.path)
  const unknown = draft ? unknownPlaceholders([draft.title, draft.header, draft.footer, draft.markup, draft.emailSubject, draft.emailMessage], paths) : []
  const pending = save.isPending || publish.isPending || archive.isPending

  const saveDraft = () => {
    if (!editable || pending || draft === null || base === null) return
    setRefusal(null)
    if (unknown.length > 0) {
      setRefusal(t(`${N}.unknownPlaceholders`, { names: unknown.map((u) => `{{${u}}}`).join(', ') }))
      return
    }
    const snapshot = draft
    save.mutate(
      {
        versionId: version.id,
        content: {
          // The image-rights mark kept or dropped as the switch says (P4-557); never lost by an autosave.
          body: bodyOf(snapshot, base, initialsRole, rights !== null) as unknown as Record<string, unknown>,
          variables: version.variables,
          signers: version.signers,
          emailSubject: snapshot.emailSubject,
          emailMessage: snapshot.emailMessage,
        },
      },
      {
        onSuccess: () => {
          setSaved(snapshot)
          setSavedAt(new Date().toISOString())
        },
      },
    )
  }
  // The autosave: 1.5 s after the last change, when nothing is being written and every variable exists.
  const autosave = focused?.autosave === true && editable && dirty && unknown.length === 0 && !pending
  const saveRef = useRef(saveDraft)
  useEffect(() => {
    saveRef.current = saveDraft
  })
  useEffect(() => {
    if (!autosave) return
    const timer = setTimeout(() => saveRef.current(), 1500)
    return () => clearTimeout(timer)
  }, [autosave, draft])

  if (base === null || draft === null) return <RefusalAlert message={t(`${N}.unreadable`)} />

  const set = <K extends keyof Draft>(key: K, value: Draft[K]) => setDraft((d) => (d ? { ...d, [key]: value } : d))
  const banner = options.banner ? hasBanner(draft.markup, options.banner.text) : false
  // Only a template that declares the block's variable must print it (the contract; not the image consent).
  const needsBlock = block !== null && block.required && paths.includes(block.placeholder.replace(/^\{\{|\}\}$/g, ''))
  const blockPresent = !needsBlock || (block !== null && hasBlockPlaceholder(draft.markup, block.placeholder))
  // A marked contract must still hold its image-rights article (P4-557).
  const rightsArticleMissing = rights !== null && draft.imageRights && !hasHeadingWith(draft.markup, rights.article)
  const publishBlocked = dirty
    ? t(`${N}.publishBlocked.unsaved`)
    : banner && options.banner
      ? options.banner.blocked
      : !blockPresent && block
        ? block.blocked
        : rightsArticleMissing && rights
          ? rights.blocked
          : (options.publishBlocked ?? null)

  const onSave = (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault()
    saveDraft()
  }
  // A text pasted from Word or Google Docs keeps its paragraphs, headings, bold and lists (paste.ts).
  const onPaste = (event: ClipboardEvent<HTMLTextAreaElement>) => {
    const html = event.clipboardData.getData('text/html')
    const markup = html ? htmlToMarkup(html) : null
    if (markup === null) return
    event.preventDefault()
    insertBlock(event.currentTarget, markup, (value) => set('markup', value))
  }
  const onPublishClick = ignoreWhenInactive(pending || publishBlocked !== null, () => {
    setRefusal(null)
    if (options.onPublish) options.onPublish(version)
    else setConfirming('publish')
  })

  if (focused) {
    const publishedMarkup = published && published.id !== version.id ? bodyToMarkupOf(published) : null
    const statusLine = save.isPending
      ? t(`${N}.focused.saving`)
      : dirty
        ? t(focused.autosave ? `${N}.focused.unsavedAuto` : `${N}.focused.unsaved`)
        : savedAt
          ? t(`${N}.focused.savedAt`, { time: formatClinicTime(savedAt) })
          : null
    return (
      <div className="grid gap-5 xl:grid-cols-[minmax(0,1fr)_minmax(0,1fr)] xl:items-start">
        <div className="min-w-0 space-y-5">
          <SettingsCard
            title={editable ? t(`${N}.focused.titleDraft`, { version: String(version.version) }) : t(`${N}.form.titlePublished`, { version: String(version.version) })}
            description={editable ? t(focused.autosave ? `${N}.focused.descriptionAuto` : `${N}.form.descriptionDraft`) : t(`${N}.form.descriptionReadOnly`)}
            readOnly={!editable}
            pending={save.isPending}
            onSubmit={onSave}
            footer={
              <div className="flex w-full flex-wrap items-center justify-end gap-2">
                {published !== null && published.id !== version.id && (
                  <Button
                    type="button"
                    variant="ghost"
                    size="sm"
                    aria-disabled={pending || undefined}
                    className={cn(softDisabledClasses, 'mr-auto')}
                    onClick={ignoreWhenInactive(pending, () => setConfirming('discard'))}
                  >
                    {t(`${N}.discard`, { version: String(version.version) })}
                  </Button>
                )}
                <span role="status" aria-live="polite" className="text-xs text-muted-foreground">
                  {statusLine}
                </span>
                <Button type="submit" size="sm" variant="outline" aria-disabled={pending || !dirty || undefined} className={cn(softDisabledClasses)}>
                  {save.isPending ? t(`${N}.saving`) : t(`${N}.save`)}
                </Button>
                {canPublish && (
                  <Button
                    ref={publishRef}
                    type="button"
                    size="sm"
                    variant="ink"
                    aria-disabled={pending || publishBlocked !== null || undefined}
                    aria-describedby={publishBlocked ? `publish-blocked-${version.id}` : undefined}
                    className={cn(softDisabledClasses)}
                    onClick={onPublishClick}
                  >
                    {t(`${N}.publish`, { version: String(version.version) })}
                  </Button>
                )}
              </div>
            }
          >
            {banner && editable && options.banner && (
              <Alert variant="warning">
                <TriangleAlert aria-hidden />
                <AlertDescription className="text-foreground">{options.banner.notice}</AlertDescription>
              </Alert>
            )}
            {/* The banner's alert already says it: the line only describes the button then. */}
            {editable && canPublish && publishBlocked && (
              <p id={`publish-blocked-${version.id}`} className={cn('text-xs text-muted-foreground', banner && options.banner?.blocked === publishBlocked && 'sr-only')}>
                {publishBlocked}
              </p>
            )}
            <FormField label={t(`${N}.form.body`)} required help={editable ? t(`${N}.focused.bodyHelp`) : undefined}>
              {(props) => (
                <div className="space-y-1.5">
                  {editable && (
                    <BodyToolbar
                      area={bodyRef}
                      variables={version.variables.filter((v) => !block || `{{${v.path}}}` !== block.placeholder)}
                      block={block && needsBlock && !blockPresent ? block : null}
                      onChange={(value) => set('markup', value)}
                    />
                  )}
                  <Textarea
                    {...props}
                    ref={bodyRef}
                    value={draft.markup}
                    rows={20}
                    spellCheck
                    lang="fr-CA"
                    className="text-sm leading-relaxed"
                    onPaste={onPaste}
                    onChange={(e) => set('markup', e.target.value)}
                  />
                </div>
              )}
            </FormField>
            {!blockPresent && block && <p className="text-xs text-destructive">{block.missing}</p>}
            {publishedMarkup !== null && (
              <div className="space-y-2">
                <Button type="button" variant="outline" size="sm" aria-expanded={comparing} onClick={() => setComparing((v) => !v)}>
                  {t(comparing ? `${N}.focused.compareHide` : `${N}.focused.compare`, { version: String(published?.version ?? '') })}
                </Button>
                {comparing && <DiffView before={publishedMarkup} after={draft.markup} />}
              </div>
            )}
            <details className="rounded-md border border-border-light px-3 py-2">
              <summary className="cursor-pointer text-sm font-medium text-foreground">{t(`${N}.focused.other`)}</summary>
              <div className="mt-3 space-y-4">
                <p className="text-xs text-muted-foreground">{t(`${N}.focused.otherHelp`)}</p>
                <FormField label={t(`${N}.form.title`)} required>
                  {(props) => <Input {...props} value={draft.title} maxLength={200} onChange={(e) => set('title', e.target.value)} />}
                </FormField>
                <div className="grid gap-3 sm:grid-cols-2">
                  <FormField label={t(`${N}.form.header`)} help={t(`${N}.form.headerHelp`)}>
                    {(props) => <Input {...props} value={draft.header} maxLength={120} onChange={(e) => set('header', e.target.value)} />}
                  </FormField>
                  <FormField label={t(`${N}.form.footer`)} required help={t(`${N}.form.footerHelp`)}>
                    {(props) => <Input {...props} value={draft.footer} maxLength={120} onChange={(e) => set('footer', e.target.value)} />}
                  </FormField>
                </div>
                <FormField label={t(`${N}.form.emailSubject`)} required help={t(`${N}.form.emailSubjectHelp`)}>
                  {(props) => <Input {...props} value={draft.emailSubject} maxLength={200} onChange={(e) => set('emailSubject', e.target.value)} />}
                </FormField>
                <FormField label={t(`${N}.form.emailMessage`)}>
                  {(props) => <Textarea {...props} value={draft.emailMessage} rows={4} maxLength={5000} onChange={(e) => set('emailMessage', e.target.value)} />}
                </FormField>
              </div>
            </details>
            {refusal && <RefusalAlert message={refusal} />}
          </SettingsCard>
          {focused.afterText?.(version)}
        </div>
        <div className="min-w-0 xl:sticky xl:top-4">
          {focused.preview ? (
            focused.preview(preview, version)
          ) : (
            <SettingsCard as="section" title={t(`${N}.preview.title`)} description={t(`${N}.preview.description`)}>
              <iframe title={t(`${N}.preview.frameTitle`)} sandbox="" srcDoc={preview} className="h-[36rem] w-full rounded-md border border-border bg-card" />
            </SettingsCard>
          )}
        </div>
        <ConfirmDialog
          confirming={confirming}
          setConfirming={setConfirming}
          version={version}
          published={published}
          pending={pending}
          refusal={refusal}
          onConfirm={(kind) => (kind === 'publish' ? publish : archive).mutate(version.id, { onSuccess: () => setConfirming(null) })}
          returnFocus={publishRef}
          publishNote={rights && draft.imageRights ? rights.confirm : null}
        />
      </div>
    )
  }

  const title = editable
    ? t(`${N}.form.titleDraft`, { version: String(version.version) })
    : version.status === 'published'
      ? t(`${N}.form.titlePublished`, { version: String(version.version) })
      : t(`${N}.form.titleArchived`, { version: String(version.version) })

  return (
    <>
      <SettingsCard
        title={title}
        description={editable ? t(`${N}.form.descriptionDraft`) : t(`${N}.form.descriptionReadOnly`)}
        readOnly={!editable}
        pending={save.isPending}
        onSubmit={onSave}
        footer={
          <div className="flex w-full flex-wrap items-center justify-end gap-2">
            {/* Only beside a published version: without one, « Nouvelle version » would have nothing to copy. */}
            {published !== null && (
              <Button
                type="button"
                variant="ghost"
                size="sm"
                aria-disabled={pending || undefined}
                className={cn(softDisabledClasses, 'mr-auto')}
                onClick={ignoreWhenInactive(pending, () => setConfirming('discard'))}
              >
                {t(`${N}.discard`, { version: String(version.version) })}
              </Button>
            )}
            <Button
              type="button"
              variant="outline"
              size="sm"
              aria-disabled={!dirty || pending || undefined}
              className={cn(softDisabledClasses)}
              onClick={ignoreWhenInactive(!dirty || pending, () => setDraft(initial))}
            >
              {t('common.cancel')}
            </Button>
            <Button type="submit" size="sm" variant={dirty ? 'default' : 'outline'} aria-disabled={pending || !dirty || undefined} className={cn(softDisabledClasses)}>
              {save.isPending ? t(`${N}.saving`) : t(`${N}.save`)}
            </Button>
            {canPublish && (
              <Button
                ref={publishRef}
                type="button"
                size="sm"
                variant="ink"
                aria-disabled={pending || publishBlocked !== null || undefined}
                aria-describedby={publishBlocked ? `publish-blocked-${version.id}` : undefined}
                className={cn(softDisabledClasses)}
                onClick={onPublishClick}
              >
                {t(`${N}.publish`, { version: String(version.version) })}
              </Button>
            )}
          </div>
        }
      >
        {banner && editable && options.banner && (
          <Alert variant="warning">
            <TriangleAlert aria-hidden />
            <AlertDescription className="text-foreground">{options.banner.notice}</AlertDescription>
          </Alert>
        )}
        {editable && canPublish && publishBlocked && (
          <p id={`publish-blocked-${version.id}`} className="text-xs text-muted-foreground">
            {publishBlocked}
          </p>
        )}
        <FormField label={t(`${N}.form.title`)} required>
          {(props) => <Input {...props} value={draft.title} maxLength={200} onChange={(e) => set('title', e.target.value)} />}
        </FormField>
        <div className="grid gap-3 sm:grid-cols-2">
          <FormField label={t(`${N}.form.header`)} help={t(`${N}.form.headerHelp`)}>
            {(props) => <Input {...props} value={draft.header} maxLength={120} onChange={(e) => set('header', e.target.value)} />}
          </FormField>
          <FormField label={t(`${N}.form.footer`)} required help={t(`${N}.form.footerHelp`)}>
            {(props) => <Input {...props} value={draft.footer} maxLength={120} onChange={(e) => set('footer', e.target.value)} />}
          </FormField>
        </div>
        {options.initials &&
          (editable ? (
            <SwitchField label={options.initials.label} help={options.initials.help} checked={draft.initials} onCheckedChange={(checked) => set('initials', checked)} />
          ) : (
            <p className="text-sm">
              <span className="text-muted-foreground">{options.initials.label} : </span>
              {draft.initials ? t(`${N}.form.initialsOn`) : t(`${N}.form.initialsOff`)}
            </p>
          ))}
        {rights &&
          (editable ? (
            <SwitchField label={rights.label} help={rights.help} checked={draft.imageRights} onCheckedChange={(checked) => set('imageRights', checked)} />
          ) : (
            <p className="text-sm">{draft.imageRights ? rights.on : rights.off}</p>
          ))}
        {rightsArticleMissing && rights && editable && <p className="text-xs text-destructive">{rights.missing}</p>}
        <FormField label={t(`${N}.form.body`)} required help={t(`${N}.form.bodyHelp`)}>
          {(props) => (
            <Textarea {...props} value={draft.markup} rows={18} spellCheck lang="fr-CA" className="font-mono text-xs" onPaste={onPaste} onChange={(e) => set('markup', e.target.value)} />
          )}
        </FormField>
        {!blockPresent && block && <p className="text-xs text-destructive">{block.missing}</p>}
        <FormField label={t(`${N}.form.emailSubject`)} required help={t(`${N}.form.emailSubjectHelp`)}>
          {(props) => <Input {...props} value={draft.emailSubject} maxLength={200} onChange={(e) => set('emailSubject', e.target.value)} />}
        </FormField>
        <FormField label={t(`${N}.form.emailMessage`)}>
          {(props) => <Textarea {...props} value={draft.emailMessage} rows={5} maxLength={5000} onChange={(e) => set('emailMessage', e.target.value)} />}
        </FormField>
        {refusal && <RefusalAlert message={refusal} />}
      </SettingsCard>

      <SettingsCard as="section" title={t(`${N}.variables.title`)} description={t(`${N}.variables.description`)}>
        <dl className="grid gap-x-4 gap-y-1 text-sm sm:grid-cols-[minmax(0,1fr)_minmax(0,1fr)]">
          {version.variables.map((v) => (
            <div key={v.path} className="contents">
              <dt className="break-all font-mono text-xs text-foreground">{`{{${v.path}}}`}</dt>
              <dd className="text-muted-foreground">
                {v.label}
                {block && `{{${v.path}}}` === block.placeholder && <span className="block text-xs">{block.note}</span>}
              </dd>
            </div>
          ))}
        </dl>
        <p className="text-xs text-muted-foreground">{t(`${N}.variables.markup`)}</p>
      </SettingsCard>

      <SettingsCard as="section" title={t(`${N}.preview.title`)} description={t(`${N}.preview.description`)}>
        <iframe
          title={t(`${N}.preview.frameTitle`)}
          sandbox=""
          srcDoc={preview}
          className="h-[36rem] w-full rounded-md border border-border bg-card"
        />
      </SettingsCard>

      <ConfirmDialog
        confirming={confirming}
        setConfirming={setConfirming}
        version={version}
        published={published}
        pending={pending}
        refusal={refusal}
        onConfirm={(kind) => (kind === 'publish' ? publish : archive).mutate(version.id, { onSuccess: () => setConfirming(null) })}
        returnFocus={publishRef}
        publishNote={rights && draft.imageRights ? rights.confirm : null}
      />
    </>
  )
}

/** The published version's text as markup, for the comparison (an unreadable one compares as empty). */
function bodyToMarkupOf(version: TemplateVersion): string {
  const body = asBody(version.body)
  return body ? bodyToMarkup(body) : ''
}

/** Core's confirmation of « Publier » and « Supprimer le brouillon » (a module's own « Publier » replaces the first). */
function ConfirmDialog({
  confirming,
  setConfirming,
  version,
  published,
  pending,
  refusal,
  onConfirm,
  returnFocus,
  publishNote = null,
}: {
  confirming: 'publish' | 'discard' | null
  setConfirming: (value: 'publish' | 'discard' | null) => void
  version: TemplateVersion
  published: TemplateVersion | null
  pending: boolean
  refusal: string | null
  onConfirm: (kind: 'publish' | 'discard') => void
  returnFocus: RefObject<HTMLButtonElement | null>
  /** What publishing this version also means (Professionnels: the contract grants the image rights, P4-557). */
  publishNote?: string | null
}) {
  return (
    <AlertDialog open={confirming !== null} onOpenChange={(open) => !open && !pending && setConfirming(null)}>
      <AlertDialogContent
        onCloseAutoFocus={(event) => {
          event.preventDefault()
          returnFocus.current?.focus()
        }}
      >
        {confirming !== null && (
          <>
            <AlertDialogHeader>
              <AlertDialogTitle>{t(`${N}.confirm.${confirming}.title`, { version: String(version.version) })}</AlertDialogTitle>
              <AlertDialogDescription>
                {t(`${N}.confirm.${confirming}.body`, { version: String(version.version), previous: String(published?.version ?? '') })}
              </AlertDialogDescription>
              {confirming === 'publish' && publishNote && <p className="text-sm text-foreground">{publishNote}</p>}
            </AlertDialogHeader>
            {refusal && <RefusalAlert message={refusal} />}
            <AlertDialogFooter>
              <AlertDialogCancel aria-disabled={pending || undefined} className={cn(softDisabledClasses)} onClick={ignoreWhenInactive(pending)}>
                {t('common.cancel')}
              </AlertDialogCancel>
              <Button
                type="button"
                variant={confirming === 'discard' ? 'destructive' : 'default'}
                aria-disabled={pending || undefined}
                className={cn(softDisabledClasses)}
                onClick={ignoreWhenInactive(pending, () => onConfirm(confirming))}
              >
                {t(`${N}.confirm.${confirming}.action`, { version: String(version.version) })}
              </Button>
            </AlertDialogFooter>
          </>
        )}
      </AlertDialogContent>
    </AlertDialog>
  )
}

/** Puts `text` in place of the selection, then the caret after it (or `select`). */
function replaceSelection(area: HTMLTextAreaElement, text: string, onChange: (value: string) => void, select?: [number, number]) {
  const { selectionStart: start, selectionEnd: end, value } = area
  onChange(value.slice(0, start) + text + value.slice(end))
  requestAnimationFrame(() => {
    area.focus()
    const [from, to] = select ?? [start + text.length, start + text.length]
    area.setSelectionRange(from, to)
  })
}

/** Pasted or inserted blocks stand apart: a blank line before and after them, unless at an edge. */
function insertBlock(area: HTMLTextAreaElement, markup: string, onChange: (value: string) => void) {
  const before = area.value.slice(0, area.selectionStart)
  const after = area.value.slice(area.selectionEnd)
  const lead = before === '' || before.endsWith('\n\n') ? '' : before.endsWith('\n') ? '\n' : '\n\n'
  const trail = after === '' || after.startsWith('\n\n') ? '' : after.startsWith('\n') ? '\n' : '\n\n'
  replaceSelection(area, `${lead}${markup}${trail}`, onChange)
}

/** Each selected line (or the caret's) starts with `prefix` (`## `, `- `, `1. `), replacing a heading or list mark it had. */
function prefixLines(area: HTMLTextAreaElement, prefix: (index: number) => string, onChange: (value: string) => void) {
  const { value, selectionStart, selectionEnd } = area
  const start = value.lastIndexOf('\n', selectionStart - 1) + 1
  const endBreak = value.indexOf('\n', selectionEnd)
  const end = endBreak === -1 ? value.length : endBreak
  const text = value
    .slice(start, end)
    .split('\n')
    .map((line, i) => `${prefix(i)}${line.replace(/^(#{1,3} |- |\d+\. )/, '')}`)
    .join('\n')
  area.setSelectionRange(start, end)
  replaceSelection(area, text, onChange, [start, start + text.length])
}

/**
 * The body's formatting buttons (CC-21): bold, the two heading levels, the lists, and « Insérer »
 * an information of the file at the caret (by its plain name); the client's answers when the text
 * lacks them. They write the same markup as typing it would.
 */
function BodyToolbar({
  area,
  variables,
  block,
  onChange,
}: {
  area: RefObject<HTMLTextAreaElement | null>
  variables: TemplateVersion['variables']
  block: NonNullable<TemplateEditorOptions['block']> | null
  onChange: (value: string) => void
}) {
  const run = (action: (el: HTMLTextAreaElement) => void) => () => {
    if (area.current) action(area.current)
  }
  const bold = run((el) => {
    const selected = el.value.slice(el.selectionStart, el.selectionEnd).trim()
    const text = selected === '' ? t(`${N}.focused.boldSample`) : selected
    const start = el.selectionStart
    replaceSelection(el, `**${text}**`, onChange, [start + 2, start + 2 + text.length])
  })
  const tools = [
    { label: t(`${N}.focused.bold`), icon: Bold, onClick: bold },
    { label: t(`${N}.focused.heading`), icon: Heading1, onClick: run((el) => prefixLines(el, () => '## ', onChange)) },
    { label: t(`${N}.focused.subheading`), icon: Heading2, onClick: run((el) => prefixLines(el, () => '### ', onChange)) },
    { label: t(`${N}.focused.bullets`), icon: List, onClick: run((el) => prefixLines(el, () => '- ', onChange)) },
    { label: t(`${N}.focused.numbers`), icon: ListOrdered, onClick: run((el) => prefixLines(el, (i) => `${i + 1}. `, onChange)) },
  ]
  return (
    <div role="toolbar" aria-label={t(`${N}.focused.toolbar`)} className="flex flex-wrap items-center gap-1">
      {tools.map(({ label, icon: Icon, onClick }) => (
        <Button key={label} type="button" variant="ghost" size="sm" aria-label={label} title={label} onClick={onClick}>
          <Icon aria-hidden className="size-4" />
        </Button>
      ))}
      {variables.length > 0 && (
        <DropdownMenu>
          <DropdownMenuTrigger asChild>
            <Button type="button" variant="ghost" size="sm">
              {t(`${N}.focused.insert`)}
              <ChevronDown aria-hidden className="size-3.5" />
            </Button>
          </DropdownMenuTrigger>
          <DropdownMenuContent align="start">
            {variables.map((v) => (
              <DropdownMenuItem key={v.path} onSelect={() => area.current && replaceSelection(area.current, `{{${v.path}}}`, onChange)}>
                {v.label}
              </DropdownMenuItem>
            ))}
          </DropdownMenuContent>
        </DropdownMenu>
      )}
      {block && (
        <Button type="button" variant="outline" size="sm" onClick={run((el) => insertBlock(el, block.placeholder, onChange))}>
          {t(`${N}.focused.insertBlock`)}
        </Button>
      )}
    </div>
  )
}

/** « Comparer avec la version publiée »: the lines removed (struck) and added, among those kept. */
function DiffView({ before, after }: { before: string; after: string }) {
  const lines = useMemo(() => diffLines(before, after), [before, after])
  if (!hasChanges(lines)) return <p className="text-sm text-muted-foreground">{t(`${N}.focused.noChanges`)}</p>
  return (
    <ol aria-label={t(`${N}.focused.compareTitle`)} className="max-h-96 space-y-0.5 overflow-y-auto rounded-md border border-border-light p-3 text-sm">
      {lines.map((line, i) =>
        line.text === '' ? (
          <li key={i} aria-hidden className="h-2" />
        ) : (
          <li
            key={i}
            className={cn(
              'whitespace-pre-wrap break-words rounded-sm px-1.5',
              line.kind === 'removed' && 'bg-destructive/10 text-foreground line-through decoration-destructive',
              line.kind === 'added' && 'bg-success/10 text-foreground',
              line.kind === 'same' && 'text-muted-foreground',
            )}
          >
            {line.kind !== 'same' && <span className="sr-only">{t(line.kind === 'added' ? `${N}.focused.added` : `${N}.focused.removed`)}</span>}
            <span aria-hidden className="mr-1.5 select-none font-medium">
              {line.kind === 'added' ? '+' : line.kind === 'removed' ? '−' : ' '}
            </span>
            {line.text}
          </li>
        ),
      )}
    </ol>
  )
}
