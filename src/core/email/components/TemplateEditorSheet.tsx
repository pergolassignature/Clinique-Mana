import { useEffect, useId, useMemo, useRef, useState } from 'react'
import { useWatch } from 'react-hook-form'
import { t } from '@/i18n'
import type { EmailTemplate } from '@/core/email/api'
import { useResetEmailTemplate, useSaveEmailTemplate, useSendTestEmail } from '@/core/email/hooks'
import { templateDraftSchema, type TemplateDraftValues } from '@/core/email/schemas'
import { moduleErrorMessage } from '@/core/modules/errors'
import { FormActions } from '@/shared/components/FormActions'
import { ignoreWhenInactive, softDisabledClasses } from '@/shared/components/soft-disabled'
import { useUnsavedChanges } from '@/shared/lib/unsaved-changes-context'
import { useSettingsForm } from '@/shared/lib/use-settings-form'
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
import { Button } from '@/shared/ui/button'
import { FormField } from '@/shared/ui/form-field'
import { Input } from '@/shared/ui/input'
import { FieldsReadOnlyContext } from '@/shared/ui/read-only-context'
import { Sheet, SheetBody, SheetContent, SheetDescription, SheetFooter, SheetHeader, SheetTitle } from '@/shared/ui/sheet'
import { Textarea } from '@/shared/ui/textarea'
import { EmailPreview } from './EmailPreview'

type Field = keyof TemplateDraftValues

interface TemplateEditorSheetProps {
  /** The template to edit; null closes the sheet. */
  template: EmailTemplate | null
  /** Without `settings.email_manage`: the text and its preview, nothing to change or send. */
  readOnly: boolean
  onClose: () => void
  /** Where focus goes once the sheet has closed (the row's button). */
  returnFocus?: () => void
}

/**
 * The editor of one template (Paramètres → Courriels → Modèles): subject, text and button label,
 * the variables with « Insérer », and the live preview beside them. Staff edit words only: the
 * button's link is supplied by the application, and the layout around the text is fixed. The draft
 * is checked here with the database's rules (placeholders, braces, lengths), the database staying
 * the authority: its refusal shows under the form. Closing with unsaved changes asks first.
 */
export function TemplateEditorSheet({ template, readOnly, onClose, returnFocus }: TemplateEditorSheetProps) {
  const [dirty, setDirty] = useState(false)
  const [askLeave, setAskLeave] = useState(false)
  const leaving = useRef(false)

  const requestClose = () => {
    if (!dirty) return onClose()
    setAskLeave(true)
  }

  return (
    <Sheet open={template !== null} onOpenChange={(open) => !open && requestClose()}>
      {template && (
        <SheetContent
          // Editor and preview side by side on a wide screen (the preview is 600 px wide).
          className="max-w-[1120px]"
          onCloseAutoFocus={(event) => {
            event.preventDefault()
            returnFocus?.()
          }}
        >
          <EditorContent key={template.key} template={template} readOnly={readOnly} onDirtyChange={setDirty} />
          <AlertDialog open={askLeave} onOpenChange={setAskLeave}>
            <AlertDialogContent
              onCloseAutoFocus={(event) => {
                // « Quitter »: the sheet closes and returnFocus takes over.
                if (leaving.current) {
                  event.preventDefault()
                  leaving.current = false
                }
              }}
            >
              <AlertDialogHeader>
                <AlertDialogTitle>{t('common.unsaved.title')}</AlertDialogTitle>
                <AlertDialogDescription>{t('common.unsaved.body')}</AlertDialogDescription>
              </AlertDialogHeader>
              <AlertDialogFooter>
                {/* Radix focuses Cancel first: « Rester » is the safe default. */}
                <AlertDialogCancel>{t('common.unsaved.stay')}</AlertDialogCancel>
                <Button
                  variant="destructive"
                  onClick={() => {
                    leaving.current = true
                    setAskLeave(false)
                    onClose()
                  }}
                >
                  {t('common.unsaved.leave')}
                </Button>
              </AlertDialogFooter>
            </AlertDialogContent>
          </AlertDialog>
        </SheetContent>
      )}
    </Sheet>
  )
}

interface EditorContentProps {
  template: EmailTemplate
  readOnly: boolean
  onDirtyChange: (dirty: boolean) => void
}

function EditorContent({ template, readOnly, onDirtyChange }: EditorContentProps) {
  const paths = useMemo(() => template.variables.map((variable) => variable.path), [template.variables])
  const schema = useMemo(() => templateDraftSchema(paths), [paths])
  const values = useMemo<TemplateDraftValues>(
    () => ({ subject: template.subject, body: template.body, button_label: template.button_label ?? '' }),
    [template.subject, template.body, template.button_label],
  )
  // Follows the stored text (after a save or a reset) without losing what is being typed.
  const { form, cancel, handleSave } = useSettingsForm({ schema, values })
  const save = useSaveEmailTemplate()
  const reset = useResetEmailTemplate()
  const sendTest = useSendTestEmail()
  const [saveError, setSaveError] = useState<string | null>(null)
  const [confirmReset, setConfirmReset] = useState(false)
  const { isDirty, errors } = form.formState
  const editable = !readOnly
  useUnsavedChanges(isDirty && editable)
  // The sheet asks before closing while this form is dirty (its own check, not the page guard).
  const unsaved = isDirty && editable
  useEffect(() => {
    onDirtyChange(unsaved)
    return () => onDirtyChange(false)
  }, [unsaved, onDirtyChange])

  // The live draft: the preview renders it while it is valid, and pauses (saying why) when not.
  const watched = useWatch({ control: form.control }) as TemplateDraftValues
  const parsed = useMemo(() => schema.safeParse(watched), [schema, watched])
  const draft = parsed.success ? parsed.data : null
  const pausedReason = parsed.success ? null : (parsed.error.issues[0]?.message ?? null)

  // Where « Insérer » puts a variable: the last text field used, at its cursor.
  const fields = useRef<Partial<Record<Field, HTMLInputElement | HTMLTextAreaElement | null>>>({})
  const lastField = useRef<Field>('body')
  const registerField = (name: Field) => {
    const registration = form.register(name)
    return {
      ...registration,
      ref: (element: HTMLInputElement | HTMLTextAreaElement | null) => {
        registration.ref(element)
        fields.current[name] = element
      },
      onFocus: () => {
        lastField.current = name
      },
    }
  }
  const insert = (path: string) => {
    const name = lastField.current
    const element = fields.current[name]
    const token = `{{${path}}}`
    const current = form.getValues(name)
    const start = element?.selectionStart ?? current.length
    const end = element?.selectionEnd ?? start
    form.setValue(name, current.slice(0, start) + token + current.slice(end), { shouldDirty: true, shouldValidate: form.formState.isSubmitted })
    element?.focus()
    element?.setSelectionRange(start + token.length, start + token.length)
  }

  const onSubmit = handleSave((saved, onSaved) => {
    setSaveError(null)
    save.mutate(
      { key: template.key, draft: saved },
      {
        onSuccess: () => onSaved({ subject: saved.subject, body: saved.body, button_label: saved.button_label ?? '' }),
        // A P0001 refusal (the server's check) as is; anything else, the generic text (reported).
        onError: (error) => setSaveError(moduleErrorMessage(error, t('settings.email.editor.saveError'), 'settings')),
      },
    )
  })

  const onSendTest = () => {
    if (draft === null) {
      // Show the errors on the fields, the first one focused.
      void form.trigger(undefined, { shouldFocus: true })
      return
    }
    sendTest.mutate({ key: template.key, draft })
  }

  return (
    <form
      // Read-only: « Entrée » in a field must not try a save the database would refuse.
      onSubmit={readOnly ? (event) => event.preventDefault() : (event) => void onSubmit(event)}
      noValidate aria-busy={save.isPending || undefined} className="flex min-h-0 flex-1 flex-col">
      <SheetHeader>
        <SheetTitle>{template.label}</SheetTitle>
        <SheetDescription>{template.description}</SheetDescription>
      </SheetHeader>
      <SheetBody className="grid content-start gap-6 pt-2 xl:grid-cols-[minmax(320px,1fr)_602px]">
        <div className="min-w-0 space-y-4">
          <FieldsReadOnlyContext.Provider value={readOnly}>
            <FormField label={t('settings.email.editor.subject')} required error={errors.subject?.message}>
              {(field) => <Input {...field} {...registerField('subject')} autoComplete="off" />}
            </FormField>
            <FormField label={t('settings.email.editor.body')} required help={t('settings.email.editor.bodyHelp')} error={errors.body?.message}>
              {(field) => <Textarea {...field} {...registerField('body')} className="min-h-60" />}
            </FormField>
            <FormField label={t('settings.email.editor.button')} help={t('settings.email.editor.buttonHelp')} error={errors.button_label?.message}>
              {(field) => <Input {...field} {...registerField('button_label')} autoComplete="off" />}
            </FormField>
          </FieldsReadOnlyContext.Provider>
          <Variables template={template} onInsert={editable ? insert : null} />
          {saveError && (
            <p role="alert" className="text-sm text-destructive">
              {saveError}
            </p>
          )}
        </div>
        <EmailPreview templateKey={template.key} draft={draft} pausedReason={pausedReason} />
      </SheetBody>
      {editable && (
        <SheetFooter className="sm:justify-between">
          <div className="flex flex-col-reverse gap-2 sm:flex-row">
            {template.is_custom && (
              <Button type="button" variant="outline" onClick={() => setConfirmReset(true)}>
                {t('settings.email.editor.reset')}
              </Button>
            )}
            <Button
              type="button"
              variant="outline"
              aria-disabled={sendTest.isPending || undefined}
              onClick={ignoreWhenInactive(sendTest.isPending, onSendTest)}
              className={cn(softDisabledClasses, 'aria-disabled:hover:border-border aria-disabled:hover:bg-card')}
            >
              {sendTest.isPending ? t('settings.email.editor.sendingTest') : t('settings.email.editor.sendTest')}
            </Button>
          </div>
          <div className="flex flex-col-reverse gap-2 sm:flex-row">
            <FormActions onCancel={cancel} onReset={() => form.setFocus('subject')} dirty={isDirty} pending={save.isPending} />
          </div>
        </SheetFooter>
      )}
      <AlertDialog open={confirmReset} onOpenChange={setConfirmReset}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>{t('settings.email.editor.resetTitle')}</AlertDialogTitle>
            <AlertDialogDescription>{t('settings.email.editor.resetBody')}</AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>{t('common.cancel')}</AlertDialogCancel>
            <AlertDialogAction
              onClick={() => {
                // Edits are dropped first, so the default text replaces every field once it arrives.
                cancel()
                setSaveError(null)
                reset.mutate(template.key)
              }}
            >
              {t('settings.email.editor.resetConfirm')}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </form>
  )
}

/** The template's variables: what each one is, how to write it, and « Insérer » (null: read-only). */
function Variables({ template, onInsert }: { template: EmailTemplate; onInsert: ((path: string) => void) | null }) {
  const headingId = useId()
  if (template.variables.length === 0) return null
  return (
    <section aria-labelledby={headingId} className="space-y-2">
      <h3 id={headingId} className="text-sm font-semibold text-foreground">
        {t('settings.email.editor.variables')}
      </h3>
      <p className="text-xs text-muted-foreground">{t(onInsert ? 'settings.email.editor.variablesHelp' : 'settings.email.editor.variablesReadOnly')}</p>
      <ul className="divide-y divide-border rounded-lg border border-border">
        {template.variables.map((variable) => (
          <li key={variable.path} className="flex flex-wrap items-center justify-between gap-x-3 gap-y-1 px-3 py-2">
            <div className="min-w-0">
              <p className="text-sm text-foreground">{variable.label}</p>
              <code className="break-all text-xs text-muted-foreground">{`{{${variable.path}}}`}</code>
            </div>
            {onInsert && (
              <Button
                type="button"
                variant="outline"
                size="sm"
                aria-label={t('settings.email.editor.insert', { label: variable.label })}
                onClick={() => onInsert(variable.path)}
                className="max-sm:h-11"
              >
                {t('settings.email.editor.insertShort')}
              </Button>
            )}
          </li>
        ))}
      </ul>
    </section>
  )
}
