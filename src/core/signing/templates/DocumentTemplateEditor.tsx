import { useDeferredValue, useMemo, useRef, useState, type FormEvent } from 'react'
import { TriangleAlert } from 'lucide-react'
import { t } from '@/i18n'
import { moduleErrorMessage } from '@/core/modules/errors'
import { Loading, LoadError } from '@/shared/components/LoadState'
import { SettingsCard } from '@/shared/components/SettingsCard'
import { SwitchField } from '@/shared/components/SwitchField'
import { ignoreWhenInactive, softDisabledClasses } from '@/shared/components/soft-disabled'
import { useUnsavedChanges } from '@/shared/lib/unsaved-changes-context'
import { formatClinicDateShort, formatClinicDateTime, formatDateOnly } from '@/shared/lib/timezone'
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
import { FormField } from '@/shared/ui/form-field'
import { Input } from '@/shared/ui/input'
import { Textarea } from '@/shared/ui/textarea'
import { RefusalAlert } from '@/shared/components/RefusalAlert'
import type { DocumentTemplateSummary, TemplateVersion } from './api'
import { useTemplateMutations, useTemplateVersions, type TemplateMutationHandlers } from './hooks'
import { asBody, bodyToMarkup, hasBanner, hasBlockPlaceholder, markupToBody, previewHtml, unknownPlaceholders, type PdfBody, type PreviewText } from './markup'

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
  /** « Publier » here (core's publish). False when the module publishes its own way. */
  canPublish?: boolean
  /** The module's error handling and what it refreshes after a publication (`useTemplateMutations`). */
  handlers?: Pick<TemplateMutationHandlers, 'onError' | 'onChanged'>
}

interface Draft {
  title: string
  header: string
  footer: string
  initials: boolean
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
    markup: bodyToMarkup(body),
    emailSubject: version.emailSubject,
    emailMessage: version.emailMessage,
  }
}

/** The body a draft makes: the markup's blocks, the fields, and the base's signature page. */
function bodyOf(draft: Draft, base: PdfBody, initialsRole: string | null): PdfBody {
  const others = (base.header?.initialsFor ?? []).filter((role) => role !== initialsRole)
  const initialsFor = draft.initials && initialsRole !== null ? [initialsRole, ...others] : others
  return markupToBody(draft.markup, {
    ...base,
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
  const canPublish = options.canPublish ?? true
  const base = useMemo(() => asBody(version.body), [version.body])
  const initial = useMemo(() => (base ? draftOf(version, base, initialsRole) : null), [base, version, initialsRole])
  const [draft, setDraft] = useState<Draft | null>(initial)
  const [refusal, setRefusal] = useState<string | null>(null)
  const [confirming, setConfirming] = useState<'publish' | 'discard' | null>(null)
  const publishRef = useRef<HTMLButtonElement>(null)
  const { save, publish, archive } = useTemplateMutations({ ...options.handlers, onErrorMessage: (message) => setRefusal(message) })
  const dirty = editable && draft !== null && initial !== null && JSON.stringify(draft) !== JSON.stringify(initial)
  useUnsavedChanges(dirty)
  // The preview follows the typing at React's pace: a keystroke never waits for the whole page.
  const deferred = useDeferredValue(draft)
  const preview = useMemo(
    () =>
      base && deferred
        ? previewHtml(bodyOf(deferred, base, initialsRole), Object.fromEntries(version.variables.map((v) => [v.path, sampleText(v)])), previewText(block))
        : '',
    [base, deferred, version.variables, initialsRole, block],
  )

  if (base === null || draft === null) return <RefusalAlert message={t(`${N}.unreadable`)} />

  const set = <K extends keyof Draft>(key: K, value: Draft[K]) => setDraft((d) => (d ? { ...d, [key]: value } : d))
  const body = bodyOf(draft, base, initialsRole)
  const paths = version.variables.map((v) => v.path)
  const unknown = unknownPlaceholders([draft.title, draft.header, draft.footer, draft.markup, draft.emailSubject, draft.emailMessage], paths)
  const banner = options.banner ? hasBanner(draft.markup, options.banner.text) : false
  // Only a template that declares the block's variable must print it (the contract; not the image consent).
  const needsBlock = block !== null && block.required && paths.includes(block.placeholder.replace(/^\{\{|\}\}$/g, ''))
  const blockPresent = !needsBlock || (block !== null && hasBlockPlaceholder(draft.markup, block.placeholder))
  const pending = save.isPending || publish.isPending || archive.isPending
  const publishBlocked = dirty
    ? t(`${N}.publishBlocked.unsaved`)
    : banner && options.banner
      ? options.banner.blocked
      : !blockPresent && block
        ? block.blocked
        : null

  const onSave = (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault()
    if (!editable || pending) return
    setRefusal(null)
    if (unknown.length > 0) {
      setRefusal(t(`${N}.unknownPlaceholders`, { names: unknown.map((u) => `{{${u}}}`).join(', ') }))
      return
    }
    save.mutate({
      versionId: version.id,
      content: { body: body as unknown as Record<string, unknown>, variables: version.variables, signers: version.signers, emailSubject: draft.emailSubject, emailMessage: draft.emailMessage },
    })
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
                onClick={ignoreWhenInactive(pending || publishBlocked !== null, () => {
                  setRefusal(null)
                  setConfirming('publish')
                })}
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
        <FormField label={t(`${N}.form.body`)} required help={t(`${N}.form.bodyHelp`)}>
          {(props) => (
            <Textarea {...props} value={draft.markup} rows={18} spellCheck lang="fr-CA" className="font-mono text-xs" onChange={(e) => set('markup', e.target.value)} />
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

      <AlertDialog open={confirming !== null} onOpenChange={(open) => !open && !pending && setConfirming(null)}>
        <AlertDialogContent
          onCloseAutoFocus={(event) => {
            event.preventDefault()
            publishRef.current?.focus()
          }}
        >
          {confirming !== null && (
            <>
              <AlertDialogHeader>
                <AlertDialogTitle>{t(`${N}.confirm.${confirming}.title`, { version: String(version.version) })}</AlertDialogTitle>
                <AlertDialogDescription>
                  {t(`${N}.confirm.${confirming}.body`, { version: String(version.version), previous: String(published?.version ?? '') })}
                </AlertDialogDescription>
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
                  onClick={ignoreWhenInactive(pending, () => {
                    const mutation = confirming === 'publish' ? publish : archive
                    mutation.mutate(version.id, { onSuccess: () => setConfirming(null) })
                  })}
                >
                  {t(`${N}.confirm.${confirming}.action`, { version: String(version.version) })}
                </Button>
              </AlertDialogFooter>
            </>
          )}
        </AlertDialogContent>
      </AlertDialog>
    </>
  )
}
