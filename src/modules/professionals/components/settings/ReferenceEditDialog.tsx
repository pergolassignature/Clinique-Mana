import { useRef, useState, type ReactNode } from 'react'
import { useForm, type DefaultValues, type Resolver, type UseFormReturn } from 'react-hook-form'
import { zodResolver } from '@hookform/resolvers/zod'
import { CircleAlert } from 'lucide-react'
import { t } from '@/i18n'
import { SaveButton } from '@/shared/components/SaveButton'
import { ignoreWhenInactive, softDisabledClasses } from '@/shared/components/soft-disabled'
import { cn } from '@/shared/lib/utils'
import { Alert, AlertDescription } from '@/shared/ui/alert'
import { Button } from '@/shared/ui/button'
import { Dialog, DialogClose, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from '@/shared/ui/dialog'
import { FormField } from '@/shared/ui/form-field'
import { Input } from '@/shared/ui/input'
import type { ReferenceFields, ReferenceKind, ReferenceRow } from '../../api/catalog'
import { useSaveReference, type SaveReferenceVariables } from '../../hooks/use-reference-mutations'
import { referenceSchema, toReferenceFormValues, type ReferenceFormValues } from '../../schemas/reference'

/** What a list's `renderForm` receives: the dialog's form, and the row edited (null when adding). */
export interface ReferenceFormProps<K extends ReferenceKind> {
  form: UseFormReturn<ReferenceFormValues[K], unknown, ReferenceFields<K>>
  row: ReferenceRow<K> | null
}

/** The first field a dialog focuses: the first one that can be changed. */
const FIRST_FIELD = 'input:not([readonly]):not([type="hidden"]), select, textarea, button[role="checkbox"], button[role="switch"]'

interface ReferenceEditDialogProps<K extends ReferenceKind> {
  kind: K
  open: boolean
  /** The row edited, or null to add one. Kept while the dialog closes, so its content does not change. */
  row: ReferenceRow<K> | null
  /** The whole list, archived rows included: a name another row holds is refused before saving. */
  rows: readonly ReferenceRow<K>[]
  title: string
  description?: string
  /** The list's own fields, under « Nom ». */
  renderForm?: (props: ReferenceFormProps<K>) => ReactNode
  onOpenChange: (open: boolean) => void
  /** Saved (the row's id), just before the dialog closes. */
  onSaved: (id: string) => void
  /** Where focus goes once the dialog has closed (it has no trigger). */
  onCloseAutoFocus: (event: Event) => void
}

/**
 * « Ajouter » / « Modifier » of a settings list: « Nom », then the list's fields (`renderForm`),
 * checked by the list's schema (`referenceSchema`, which also refuses a name already taken). The
 * form lives inside the content, so each opening starts afresh. While it saves the dialog cannot
 * be closed, so its outcome is always seen: success closes it (toast), a refusal of the database
 * stays in it (`onErrorMessage`). X out of the tab order (Dialog); focus starts on the first field.
 */
export function ReferenceEditDialog<K extends ReferenceKind>({
  kind,
  open,
  row,
  rows,
  title,
  description,
  renderForm,
  onOpenChange,
  onSaved,
  onCloseAutoFocus,
}: ReferenceEditDialogProps<K>) {
  // The refusal shown (already through moduleErrorMessage, which reports to Sentry once).
  const [refusal, setRefusal] = useState<string | null>(null)
  const save = useSaveReference({ onErrorMessage: (message) => setRefusal(message) })
  const contentRef = useRef<HTMLDivElement>(null)

  const changeOpen = (next: boolean) => {
    if (save.isPending) return
    if (!next) {
      save.reset()
      setRefusal(null)
    }
    onOpenChange(next)
  }

  const submit = (values: ReferenceFields<K>) => {
    setRefusal(null)
    const variables = { kind, input: { ...values, id: row?.id ?? null } } as SaveReferenceVariables
    save.mutate(variables, {
      onSuccess: (id) => {
        onSaved(id)
        save.reset()
        onOpenChange(false)
      },
    })
  }

  return (
    <Dialog open={open} onOpenChange={changeOpen}>
      <DialogContent
        ref={contentRef}
        {...(description ? {} : { 'aria-describedby': undefined })}
        onOpenAutoFocus={(event) => {
          event.preventDefault()
          contentRef.current?.querySelector<HTMLElement>(FIRST_FIELD)?.focus()
        }}
        onCloseAutoFocus={onCloseAutoFocus}
      >
        <DialogHeader>
          <DialogTitle>{title}</DialogTitle>
          {description && <DialogDescription>{description}</DialogDescription>}
        </DialogHeader>
        <ReferenceForm kind={kind} row={row} rows={rows} renderForm={renderForm} pending={save.isPending} refusal={refusal} onSubmit={submit} />
      </DialogContent>
    </Dialog>
  )
}

interface ReferenceFormComponentProps<K extends ReferenceKind> {
  kind: K
  row: ReferenceRow<K> | null
  rows: readonly ReferenceRow<K>[]
  renderForm?: (props: ReferenceFormProps<K>) => ReactNode
  pending: boolean
  refusal: string | null
  onSubmit: (values: ReferenceFields<K>) => void
}

function ReferenceForm<K extends ReferenceKind>({ kind, row, rows, renderForm, pending, refusal, onSubmit }: ReferenceFormComponentProps<K>) {
  // Built once per opening (the form remounts with each one): the database refuses a duplicate
  // that another manager adds meanwhile.
  const [resolver] = useState(
    () => zodResolver(referenceSchema(kind, { rows, current: row })) as unknown as Resolver<ReferenceFormValues[K], unknown, ReferenceFields<K>>,
  )
  const form = useForm<ReferenceFormValues[K], unknown, ReferenceFields<K>>({
    resolver,
    defaultValues: toReferenceFormValues(kind, row) as DefaultValues<ReferenceFormValues[K]>,
  })
  // Every list has a name: the shared field reads the form through that one key.
  const nameForm = form as unknown as UseFormReturn<{ name: string }>
  const { errors, isDirty } = nameForm.formState
  const adding = row === null

  return (
    <form noValidate onSubmit={(event) => void form.handleSubmit(onSubmit)(event)} className="grid gap-3.5">
      <FormField label={t('modules.professionals.settings.list.dialog.name')} required error={errors.name?.message}>
        {(field) => <Input {...field} {...nameForm.register('name')} autoComplete="off" maxLength={120} />}
      </FormField>
      {renderForm?.({ form, row })}
      {refusal && (
        <Alert variant="destructive" role="alert">
          <CircleAlert aria-hidden />
          <AlertDescription className="text-foreground">{refusal}</AlertDescription>
        </Alert>
      )}
      <DialogFooter>
        <DialogClose asChild>
          <Button
            type="button"
            variant="outline"
            aria-disabled={pending || undefined}
            // While saving, the press is cancelled (Radix then does not close the dialog).
            onClick={ignoreWhenInactive(pending)}
            className={cn(softDisabledClasses, 'aria-disabled:hover:border-border aria-disabled:hover:bg-card')}
          >
            {t('common.cancel')}
          </Button>
        </DialogClose>
        {/* Outline until something is typed (brand rule), like the cards' « Enregistrer ». */}
        <SaveButton
          pending={pending}
          disabled={!isDirty}
          variant={isDirty || pending ? 'default' : 'outline'}
          {...(adding && {
            label: t('modules.professionals.settings.list.dialog.create'),
            pendingLabel: t('modules.professionals.settings.list.dialog.creating'),
          })}
        />
      </DialogFooter>
    </form>
  )
}
