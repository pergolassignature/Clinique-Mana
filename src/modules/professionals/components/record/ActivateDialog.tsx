import { useId, useRef, type RefObject } from 'react'
import { useForm, type UseFormRegisterReturn } from 'react-hook-form'
import { zodResolver } from '@hookform/resolvers/zod'
import { useQueryClient } from '@tanstack/react-query'
import { TriangleAlert } from 'lucide-react'
import { t, type TranslationKey } from '@/i18n'
import { accessKeys, useAccess } from '@/core/access/access-context'
import { rpcErrorHint } from '@/core/modules/errors'
import { ignoreWhenInactive, softDisabledClasses } from '@/shared/components/soft-disabled'
import { cn } from '@/shared/lib/utils'
import { Alert, AlertDescription, AlertTitle } from '@/shared/ui/alert'
import { AlertDialog, AlertDialogContent, AlertDialogDescription, AlertDialogFooter, AlertDialogHeader, AlertDialogTitle } from '@/shared/ui/alert-dialog'
import { Button } from '@/shared/ui/button'
import { FormField } from '@/shared/ui/form-field'
import { Textarea } from '@/shared/ui/textarea'
import type { ProfessionalRecord } from '../../api/parse'
import { professionalKeys } from '../../hooks/keys'
import { useActivateProfessional } from '../../hooks/use-professional-mutations'
import type { CatalogView } from '../../lib/catalog-view'
import { fullName, listLabel, noteReadableText } from '../../lib/display'
import { missingLabel, readinessItemLabel } from '../../lib/readiness'
import { activationMode, type ActivationMode } from '../../lib/status-actions'
import { overrideSchema, type OverrideValues } from '../../schemas/status'
import { useRecordData } from './record-context'
import { useSettled, type StatusDialogProps } from './status-dialog'
import { DialogCancel, DialogRefusal } from './StatusDialogParts'

const A = 'modules.professionals.record.activate'

/** The confirm button per mode and kind; `blocked` and `done` have none. */
const CONFIRM = {
  confirm: { activate: `${A}.confirm`, reactivate: `${A}.confirmReactivate` },
  override: { activate: `${A}.confirmOverride`, reactivate: `${A}.confirmOverrideReactivate` },
} as const satisfies Record<'confirm' | 'override', Record<'activate' | 'reactivate', TranslationKey>>

/** The confirm button while saving: « Activation… » / « Réactivation… ». */
const PENDING = { activate: `${A}.pending`, reactivate: `${A}.pendingReactivate` } as const satisfies Record<'activate' | 'reactivate', TranslationKey>

/**
 * « Activer » / « Réactiver » (4a.14, design §5.3): a complete file is confirmed as is; an incomplete
 * one, with `professionals.activate_override`, lists what is missing and asks why (« Activer quand
 * même »). Only the confirm button acts (decision #36). Refusals by HINT: `reason` under the field;
 * anything else (`status`: already active, `readiness`: incomplete without the override) above the
 * buttons, with the record refetched so the dialog shows what changed. Reactivation says when the
 * account this module disabled comes back (P4-11).
 */
export function ActivateDialog({ onClose, onCloseAutoFocus }: StatusDialogProps) {
  const { record: current, catalog } = useRecordData()
  const { can } = useAccess()
  const queryClient = useQueryClient()
  const reasonInput = useRef<HTMLTextAreaElement | null>(null)
  const form = useForm<OverrideValues, unknown, { reason: string }>({ resolver: zodResolver(overrideSchema), defaultValues: { reason: '' } })
  // Runs when the call fails, from the latest render's closure (React Query hands a pending
  // mutation the latest options): `mode` and `record`, declared below because they follow
  // `saving`, are then what was confirmed (`useSettled` holds the record while saving).
  const mutation = useActivateProfessional({
    onErrorMessage: (message, error) => {
      const hint = rpcErrorHint(error)
      if (hint === 'reason' && mode === 'override') {
        form.setError('reason', { message }, { shouldFocus: true })
        return
      }
      // A `reason` refusal without the field: the file became incomplete since the dialog opened.
      form.setError('root.server', { message: hint === 'reason' ? t(`${A}.nowIncomplete`) : message })
      void queryClient.invalidateQueries({ queryKey: professionalKeys.record(record.professional.id) })
      // `readiness` in override mode: the override was withdrawn meanwhile. The refetched access
      // turns the dialog to `blocked` (« Fermer » only) instead of offering a retry that fails again.
      if (hint === 'readiness') void queryClient.invalidateQueries({ queryKey: accessKeys.all })
    },
  })
  const saving = mutation.isPending
  const record = useSettled(current, saving)
  const mode = activationMode(record, can)
  const { professional } = record
  const kind = professional.status === 'inactive' ? 'reactivate' : 'activate'

  const confirm = () => {
    form.clearErrors('root')
    const close = { onSuccess: onClose }
    if (mode === 'confirm') mutation.mutate({ id: professional.id }, close)
    if (mode === 'override') void form.handleSubmit(({ reason }) => mutation.mutate({ id: professional.id, overrideReason: reason }, close))()
  }

  return (
    <AlertDialog open onOpenChange={(open) => !open && !saving && onClose()}>
      <AlertDialogContent
        aria-busy={saving || undefined}
        onOpenAutoFocus={(event) => {
          // A plain confirmation starts on « Annuler » (Radix); the override, in its reason.
          if (mode !== 'override') return
          event.preventDefault()
          reasonInput.current?.focus()
        }}
        onCloseAutoFocus={onCloseAutoFocus}
      >
        <AlertDialogHeader>
          <AlertDialogTitle>{t(kind === 'reactivate' ? `${A}.titleReactivate` : `${A}.title`, { name: fullName(professional) })}</AlertDialogTitle>
          <AlertDialogDescription asChild>
            <div className="grid gap-3">
              <About record={record} catalog={catalog} />
              {(mode === 'override' || mode === 'blocked') && <Missing record={record} />}
            </div>
          </AlertDialogDescription>
        </AlertDialogHeader>
        {mode === 'override' && (
          <OverrideReason
            registration={form.register('reason')}
            inputRef={reasonInput}
            error={form.formState.errors.reason?.message}
            saving={saving}
            onSuggest={(text) => form.setValue('reason', text, { shouldDirty: true, shouldValidate: form.formState.isSubmitted })}
            firstName={professional.firstName}
          />
        )}
        <DialogRefusal message={form.formState.errors.root?.server?.message} />
        <AlertDialogFooter>
          <DialogCancel saving={saving} nothingToConfirm={!isActionable(mode)} />
          {isActionable(mode) && (
            <Button
              type="button"
              aria-disabled={saving || undefined}
              onClick={ignoreWhenInactive(saving, confirm)}
              className={cn(softDisabledClasses, 'aria-disabled:hover:bg-primary aria-disabled:active:bg-primary')}
            >
              {saving ? t(PENDING[kind]) : t(CONFIRM[mode][kind])}
            </Button>
          )}
        </AlertDialogFooter>
      </AlertDialogContent>
    </AlertDialog>
  )
}

const isActionable = (mode: ActivationMode): mode is 'confirm' | 'override' => mode === 'confirm' || mode === 'override'

/** What activation changes; on reactivation, why the file was deactivated and the account coming back. */
function About({ record, catalog }: { record: ProfessionalRecord; catalog: CatalogView }) {
  const { firstName, status, deactivationReasonId, deactivationNote, deactivationDisabledAccount } = record.professional
  const reason = status === 'inactive' && deactivationReasonId ? catalog.byId.deactivationReasons.get(deactivationReasonId)?.name : undefined
  return (
    <>
      <p>
        {t(`${A}.body`, { firstName })}
        {status === 'inactive' && deactivationDisabledAccount && ` ${t(`${A}.accountBack`, { firstName })}`}
      </p>
      {reason && <p>{t(`${A}.deactivatedFor`, { reason: deactivationNote ? `${reason} — ${deactivationNote}` : reason })}</p>}
    </>
  )
}

/** « Le dossier n'est pas complet. » and, per readiness item, what it lacks. */
function Missing({ record }: { record: ProfessionalRecord }) {
  return (
    <Alert variant="warning">
      <TriangleAlert aria-hidden />
      <AlertTitle>{t(`${A}.incomplete`)}</AlertTitle>
      <AlertDescription>
        <ul>
          {record.readiness.items
            .filter((item) => !item.done)
            .map((item) => (
              <li key={item.key}>
                {item.missing.length
                  ? t(`${A}.missing`, { item: readinessItemLabel(item.key), missing: listLabel(item.missing.map(missingLabel)) })
                  : readinessItemLabel(item.key)}
              </li>
            ))}
        </ul>
      </AlertDescription>
    </Alert>
  )
}

interface OverrideReasonProps {
  registration: UseFormRegisterReturn<'reason'>
  /** Also gets the textarea: the dialog focuses it on open. */
  inputRef: RefObject<HTMLTextAreaElement | null>
  error: string | undefined
  saving: boolean
  onSuggest: (text: string) => void
  /** Named in the help: she may read the reason (P4-373). */
  firstName: string
}

/**
 * « Raison de l'activation »*, with the suggestion that fills it in one press. A `fieldset disabled`
 * while saving, as the deactivation's fields: what is being saved stays what shows.
 */
function OverrideReason({ registration, inputRef, error, saving, onSuggest, firstName }: OverrideReasonProps) {
  const suggestionLabel = useId()
  const suggestion = t(`${A}.suggestionText`)
  const { ref, ...field } = registration
  return (
    <fieldset disabled={saving} className="grid min-w-0 gap-2">
      <FormField label={t(`${A}.reason`)} required help={`${t(`${A}.reasonHelp`)} ${noteReadableText(firstName)}`} error={error}>
        {(control) => (
          <Textarea
            {...control}
            {...field}
            ref={(element) => {
              ref(element)
              inputRef.current = element
            }}
            rows={3}
            className="min-h-0"
          />
        )}
      </FormField>
      <div className="flex flex-wrap items-center gap-2">
        <span id={suggestionLabel} className="text-xs text-muted-foreground">
          {t(`${A}.suggestion`)}
        </span>
        <Button type="button" variant="outline" size="sm" aria-describedby={suggestionLabel} onClick={() => onSuggest(suggestion)} className="rounded-full">
          {suggestion}
        </Button>
      </div>
    </fieldset>
  )
}
