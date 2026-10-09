import { createContext, useContext, useRef, useState } from 'react'
import { useQueryClient } from '@tanstack/react-query'
import { useForm } from 'react-hook-form'
import { zodResolver } from '@hookform/resolvers/zod'
import { z } from 'zod'
import { t } from '@/i18n'
import { moduleErrorMessage, rpcErrorHint } from '@/core/modules/errors'
import { useSettingsSection } from '@/core/settings/section-context'
import { LoadError, Loading } from '@/shared/components/LoadState'
import { PageHeader } from '@/shared/components/PageHeader'
import { ReadOnlyNotice } from '@/shared/components/ReadOnlyNotice'
import { SaveButton } from '@/shared/components/SaveButton'
import { SettingsCard } from '@/shared/components/SettingsCard'
import { ignoreWhenInactive, softDisabledClasses } from '@/shared/components/soft-disabled'
import { useUnsavedChanges } from '@/shared/lib/unsaved-changes-context'
import { formatClinicDateShort } from '@/shared/lib/timezone'
import { cn } from '@/shared/lib/utils'
import { AlertDialog, AlertDialogContent, AlertDialogDescription, AlertDialogFooter, AlertDialogHeader, AlertDialogTitle } from '@/shared/ui/alert-dialog'
import { Button } from '@/shared/ui/button'
import { FormField } from '@/shared/ui/form-field'
import { Input } from '@/shared/ui/input'
import { Textarea } from '@/shared/ui/textarea'
import type { ConsentVersion, ConsentVersions } from '../../api/documents'
import { RefusalAlert } from '../../components/compensation/DatedRowParts'
import { DialogCancel, DialogRefusal } from '../../components/record/StatusDialogParts'
import { fetchCurrentConsentVersions, useConsentVersions, useDiscardConsentDraft, usePublishConsentVersion, useSaveConsentDraft } from '../../hooks/use-documents'
import { tidyText } from '../../schemas/text'

const C = 'modules.professionals.settings.consents'

/** Where focus goes when the button that opened a dialog is gone (the page's heading). */
const FocusFallback = createContext<() => void>(() => undefined)

const draftSchema = z.object({
  title: tidyText({ max: 200, requiredMessage: t(`${C}.draft.titleRequired`), tooLongMessage: t(`${C}.draft.titleTooLong`) }),
  body: z
    .string()
    .transform((v) => v.replace(/^[ \t\r\n]+|[ \t\r\n]+$/g, ''))
    .pipe(z.string().min(1, t(`${C}.draft.bodyRequired`)).max(20_000, t(`${C}.draft.bodyTooLong`))),
})
type DraftValues = z.input<typeof draftSchema>
type DraftOutput = z.output<typeof draftSchema>

/** « 3 signatures ». */
function signedLabel(count: number): string {
  if (count === 0) return t(`${C}.current.signedNone`)
  return count === 1 ? t(`${C}.current.signedOne`) : t(`${C}.current.signedOther`, { count: String(count) })
}

/** « Version 2 · publiée le 8 oct. 2026 par Julie Roy · 3 signatures ». */
function versionMeta(version: ConsentVersion): string {
  const date = version.publishedAt ? formatClinicDateShort(version.publishedAt) : ''
  const published = version.publishedByName
    ? t(`${C}.current.metaBy`, { version: String(version.version), date, name: version.publishedByName })
    : t(`${C}.current.meta`, { version: String(version.version), date })
  return `${published} · ${signedLabel(version.signedCount)}`
}

/**
 * Paramètres → Consentements (Task 4c.3, P4-452): the versions of « droit à l'image ». The version
 * in force (the latest published: every new signature uses it), the clinic's draft of the next one
 * (one at most; « Enregistrer le brouillon », « Publier la version n », « Supprimer le brouillon »),
 * and the earlier versions. A published version never changes; signatures keep the version they
 * signed. Read by whoever reads the module's lists, changed with `professionals.settings`.
 */
export function ConsentsSettingsPage() {
  const { readOnly } = useSettingsSection()
  const versions = useConsentVersions()
  const heading = useRef<HTMLDivElement>(null)
  let content
  if (versions.isPending) content = <Loading />
  else if (!versions.data) {
    content = (
      <LoadError
        message={moduleErrorMessage(versions.error, t(`${C}.loadError`), 'professionals')}
        retrying={versions.isFetching}
        onRetry={() => void versions.refetch()}
      />
    )
  }
  else {
    const data = versions.data
    content = (
      <div className="space-y-5">
        <CurrentVersionCard current={data.current} />
        <DraftCard data={data} readOnly={readOnly} />
        {data.previous.length > 0 && <PreviousVersionsCard previous={data.previous} />}
      </div>
    )
  }
  return (
    <FocusFallback.Provider value={() => heading.current?.focus()}>
      <div className="max-w-form space-y-5">
        <div ref={heading} tabIndex={-1} className="outline-none">
          <PageHeader title={t(`${C}.title`)} description={t(`${C}.description`)} />
        </div>
        {readOnly && <ReadOnlyNotice />}
        {content}
      </div>
    </FocusFallback.Provider>
  )
}

function ConsentText({ body }: { body: string }) {
  return <div className="max-h-80 overflow-y-auto whitespace-pre-line rounded-md border border-border-light bg-muted/40 p-3 text-sm text-foreground">{body}</div>
}

function CurrentVersionCard({ current }: { current: ConsentVersion | null }) {
  return (
    <SettingsCard as="section" title={t(`${C}.current.title`)} description={t(`${C}.current.description`)}>
      {current ? (
        <div className="space-y-2">
          <p className="text-sm font-medium text-foreground">{current.title}</p>
          <p className="text-xs text-muted-foreground">{versionMeta(current)}</p>
          <ConsentText body={current.body} />
        </div>
      ) : (
        <div className="space-y-1">
          <p className="text-sm font-medium text-foreground">{t(`${C}.current.none`)}</p>
          <p className="text-sm text-muted-foreground">{t(`${C}.current.noneBody`)}</p>
        </div>
      )}
    </SettingsCard>
  )
}

/** The next version's number: the draft's, else one after the newest. */
const nextVersion = (data: ConsentVersions) => data.draft?.version ?? Math.max(0, data.current?.version ?? 0, ...data.previous.map((v) => v.version)) + 1

/**
 * The draft: shown (read-only without `professionals.settings`), or, with none, « Nouvelle version »,
 * which opens the form with the text in force (nothing is saved before « Enregistrer le brouillon »).
 */
function DraftCard({ data, readOnly }: { data: ConsentVersions; readOnly: boolean }) {
  const [starting, setStarting] = useState(false)
  const draft = data.draft
  const version = nextVersion(data)
  if (readOnly) {
    if (!draft) return null
    return (
      <SettingsCard as="section" title={t(`${C}.draft.title`, { version: String(version) })} description={t(`${C}.draft.description`)}>
        <p className="text-sm font-medium text-foreground">{draft.title}</p>
        <ConsentText body={draft.body} />
      </SettingsCard>
    )
  }
  if (!draft && !starting) {
    return (
      <SettingsCard
        as="section"
        title={t(`${C}.newVersion`)}
        description={t(`${C}.newVersionHelp`)}
        footer={
          <Button type="button" variant="outline" onClick={() => setStarting(true)}>
            {t(`${C}.newVersion`)}
          </Button>
        }
      >
        {null}
      </SettingsCard>
    )
  }
  return (
    // One key for « new » and its saved draft: the first save does not remount the form (focus stays).
    <DraftForm
      key="draft"
      draft={draft}
      version={version}
      initial={draft ? { title: draft.title, body: draft.body } : { title: data.current?.title ?? '', body: data.current?.body ?? '' }}
      onCancelNew={() => setStarting(false)}
      onSaved={() => setStarting(false)}
    />
  )
}

function DraftForm({
  draft,
  version,
  initial,
  onCancelNew,
  onSaved,
}: {
  draft: ConsentVersion | null
  version: number
  initial: DraftValues
  onCancelNew: () => void
  onSaved: () => void
}) {
  const form = useForm<DraftValues, unknown, DraftOutput>({ resolver: zodResolver(draftSchema), defaultValues: initial })
  const [refusal, setRefusal] = useState<string | null>(null)
  const [dialog, setDialog] = useState<'publish' | 'discard' | null>(null)
  const publishButton = useRef<HTMLButtonElement>(null)
  const discardButton = useRef<HTMLButtonElement>(null)
  const queryClient = useQueryClient()
  const focusFallback = useContext(FocusFallback)
  const [checking, setChecking] = useState(false)
  const save = useSaveConsentDraft({
    onErrorMessage: (message, error) => {
      const hint = rpcErrorHint(error)
      if (hint === 'title' || hint === 'body') form.setError(hint, { message }, { shouldFocus: true })
      else setRefusal(message)
    },
  })
  // A new draft is unsaved from the start: its text is the version in force, not yet a draft.
  const dirty = form.formState.isDirty || draft === null
  useUnsavedChanges(form.formState.isDirty)
  const { errors } = form.formState

  /**
   * The draft as the database holds it now (P4-463): a draft written or published by a colleague
   * since this page loaded is said, and the page shows it, instead of being overwritten or
   * published unseen. Null when it is still the one on screen.
   */
  const changedElsewhere = async (): Promise<string | null> => {
    setChecking(true)
    try {
      const fresh = await fetchCurrentConsentVersions(queryClient)
      const same = draft === null ? fresh.draft === null : fresh.draft?.id === draft.id && fresh.draft.updatedAt === draft.updatedAt
      if (same) return null
      // Show what the database holds now (the page re-renders with the refetched versions).
      const shown = fresh.draft ?? fresh.current
      form.reset({ title: shown?.title ?? '', body: shown?.body ?? '' })
      return t(`${C}.draft.changedElsewhere`)
    } catch (error) {
      return moduleErrorMessage(error, t(`${C}.loadError`), 'professionals')
    } finally {
      setChecking(false)
    }
  }

  const submit = form.handleSubmit(async (values) => {
    setRefusal(null)
    const changed = await changedElsewhere()
    if (changed) return setRefusal(changed)
    save.mutate(values, {
      onSuccess: () => {
        form.reset(values)
        onSaved()
      },
    })
  })

  return (
    <SettingsCard
      title={t(`${C}.draft.title`, { version: String(version) })}
      description={t(`${C}.draft.description`)}
      pending={save.isPending || checking}
      onSubmit={(event) => void submit(event)}
      footer={
        <div className="flex w-full flex-col-reverse gap-2 sm:flex-row sm:items-center sm:justify-end">
          {draft ? (
            <Button ref={discardButton} type="button" variant="ghost" className="sm:mr-auto" onClick={() => setDialog('discard')}>
              {t(`${C}.draft.discard`)}
            </Button>
          ) : (
            <Button type="button" variant="ghost" className="sm:mr-auto" onClick={onCancelNew}>
              {t(`${C}.cancelNew`)}
            </Button>
          )}
          {draft && (
            <Button
              ref={publishButton}
              type="button"
              variant={dirty ? 'outline' : 'default'}
              onClick={async () => {
                setRefusal(null)
                if (form.formState.isDirty) return setRefusal(t(`${C}.draft.unsavedBeforePublish`))
                const changed = await changedElsewhere()
                if (changed) setRefusal(changed)
                else setDialog('publish')
              }}
            >
              {t(`${C}.draft.publish`, { version: String(version) })}
            </Button>
          )}
          <SaveButton pending={save.isPending} disabled={!dirty} variant={dirty || save.isPending ? 'default' : 'outline'} label={t(`${C}.draft.save`)} pendingLabel={t(`${C}.draft.saving`)} />
        </div>
      }
    >
      <div className="grid gap-3.5">
        <FormField label={t(`${C}.draft.titleField`)} required error={errors.title?.message}>
          {(field) => <Input {...field} {...form.register('title')} maxLength={200} autoComplete="off" />}
        </FormField>
        <FormField label={t(`${C}.draft.body`)} help={t(`${C}.draft.bodyHelp`)} required error={errors.body?.message}>
          {(field) => <Textarea {...field} {...form.register('body')} rows={12} maxLength={20_000} />}
        </FormField>
        {refusal && <RefusalAlert message={refusal} />}
      </div>
      {draft && dialog === 'publish' && (
        <ConfirmVersionDialog kind="publish" draft={draft} onClose={() => setDialog(null)} onCloseAutoFocus={(event) => focusAfter(event, publishButton.current, focusFallback)} />
      )}
      {draft && dialog === 'discard' && (
        <ConfirmVersionDialog kind="discard" draft={draft} onClose={() => setDialog(null)} onCloseAutoFocus={(event) => focusAfter(event, discardButton.current, focusFallback)} />
      )}
    </SettingsCard>
  )
}

/** Back to the button that opened the dialog, else (published, discarded: it is gone) the page's heading. */
function focusAfter(event: Event, element: HTMLElement | null, fallback: () => void) {
  event.preventDefault()
  if (element?.isConnected) element.focus()
  else fallback()
}

/** « Publier la version n » or « Supprimer le brouillon », after a confirmation that says what happens. */
function ConfirmVersionDialog({ kind, draft, onClose, onCloseAutoFocus }: { kind: 'publish' | 'discard'; draft: ConsentVersion; onClose: () => void; onCloseAutoFocus: (event: Event) => void }) {
  const [refusal, setRefusal] = useState<string | null>(null)
  const feedback = { onErrorMessage: (message: string) => setRefusal(message) }
  const publish = usePublishConsentVersion(feedback)
  const discard = useDiscardConsentDraft(feedback)
  const mutation = kind === 'publish' ? publish : discard
  const pending = mutation.isPending
  const P = kind === 'publish' ? (`${C}.publishDialog` as const) : (`${C}.discardDialog` as const)
  const values = { version: String(draft.version) }
  return (
    <AlertDialog open onOpenChange={(open) => !open && !pending && onClose()}>
      <AlertDialogContent aria-busy={pending || undefined} onCloseAutoFocus={onCloseAutoFocus}>
        <AlertDialogHeader>
          <AlertDialogTitle>{t(`${P}.title`, values)}</AlertDialogTitle>
          <AlertDialogDescription>{t(`${P}.body`)}</AlertDialogDescription>
        </AlertDialogHeader>
        <DialogRefusal message={refusal ?? undefined} />
        <AlertDialogFooter>
          <DialogCancel saving={pending} nothingToConfirm={refusal !== null} />
          {refusal === null && (
            <Button
              type="button"
              variant={kind === 'discard' ? 'destructive' : 'default'}
              aria-disabled={pending || undefined}
              onClick={ignoreWhenInactive(pending, () => mutation.mutate(draft.id, { onSuccess: onClose }))}
              className={cn(softDisabledClasses, kind === 'discard' ? 'aria-disabled:hover:bg-destructive' : 'aria-disabled:hover:bg-primary')}
            >
              {pending ? t(`${P}.pending`) : t(`${P}.confirm`, values)}
            </Button>
          )}
        </AlertDialogFooter>
      </AlertDialogContent>
    </AlertDialog>
  )
}

function PreviousVersionsCard({ previous }: { previous: ConsentVersion[] }) {
  const [shown, setShown] = useState<string | null>(null)
  return (
    <SettingsCard as="section" title={t(`${C}.previous.title`)}>
      <ul className="divide-y divide-border-light border-y border-border-light">
        {previous.map((version) => (
          <li key={version.id} className="space-y-1.5 py-3">
            <p className="text-sm font-medium text-foreground">{version.title}</p>
            <p className="text-xs text-muted-foreground">{versionMeta(version)}</p>
            <Button type="button" variant="link" size="sm" aria-expanded={shown === version.id} onClick={() => setShown(shown === version.id ? null : version.id)}>
              {shown === version.id ? t(`${C}.previous.hide`) : t(`${C}.previous.show`)}
            </Button>
            {shown === version.id && <ConsentText body={version.body} />}
          </li>
        ))}
      </ul>
    </SettingsCard>
  )
}
