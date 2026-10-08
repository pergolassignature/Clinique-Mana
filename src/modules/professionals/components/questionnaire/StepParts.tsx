import { useContext, useId, type FormEvent, type ReactNode } from 'react'
import { CircleAlert } from 'lucide-react'
import { t } from '@/i18n'
import { LoadError } from '@/shared/components/LoadState'
import { ignoreWhenInactive, softDisabledClasses } from '@/shared/components/soft-disabled'
import { cn } from '@/shared/lib/utils'
import { Alert, AlertDescription } from '@/shared/ui/alert'
import { Button } from '@/shared/ui/button'
import { DraftActionContext } from './draft-action'
import type { OnFilePrivate } from './use-step-form'

const A = 'modules.professionals.questionnaire.actions'

/**
 * The step's buttons: « Retour » (none on the first step), « Enregistrer le brouillon » on the
 * autosaved steps (`DraftActionContext`), and the step form's submit, « Continuer » by default
 * (« Enregistrement… » while it saves; `aria-disabled`, so focus stays on it). Full width and stacked
 * on a phone, the forward action on top; the draft button comes after the fields in the tab order.
 */
export function StepActions({
  back,
  pending,
  label = t(`${A}.continue`),
  pendingLabel = t(`${A}.saving`),
  inactive = false,
  describedBy,
  onSubmitClick,
}: {
  back: (() => void) | null
  pending: boolean
  label?: string
  pendingLabel?: string
  /** Inactive for another reason than saving (« Envoyer mon profil » with steps missing). */
  inactive?: boolean
  describedBy?: string
  /** Called on a press while inactive (e.g. to point at what is missing). */
  onSubmitClick?: () => void
}) {
  const disabled = pending || inactive
  const saveDraft = useContext(DraftActionContext)
  return (
    <div className="mt-6 flex flex-col-reverse gap-2 border-t border-border pt-4 sm:flex-row sm:items-center sm:justify-between">
      {back ? (
        <Button type="button" variant="outline" className="w-full sm:w-auto" onClick={back}>
          {t(`${A}.back`)}
        </Button>
      ) : (
        <span aria-hidden className="hidden sm:block" />
      )}
      <div className="flex flex-col-reverse gap-2 sm:flex-row sm:items-center">
        {saveDraft && (
          <Button type="button" variant="ghost" className="w-full sm:w-auto" onClick={saveDraft}>
            {t('modules.professionals.questionnaire.autosave.saveDraft')}
          </Button>
        )}
        <Button
          type="submit"
          aria-disabled={disabled || undefined}
          aria-describedby={describedBy}
          onClick={(event) => {
            if (disabled) onSubmitClick?.()
            ignoreWhenInactive(disabled)(event)
          }}
          className={cn('w-full sm:w-auto', softDisabledClasses, 'aria-disabled:hover:bg-primary aria-disabled:active:bg-primary')}
        >
          {pending ? pendingLabel : label}
        </Button>
      </div>
    </div>
  )
}

/** A refusal or an error of the step that names no field: above the buttons, announced. */
export function StepAlert({ message, children }: { message: string | null; children?: ReactNode }) {
  if (!message) return null
  return (
    <Alert variant="destructive" role="alert" className="mt-4">
      <CircleAlert aria-hidden />
      <AlertDescription className="text-foreground">
        {message}
        {children}
      </AlertDescription>
    </Alert>
  )
}

/** A titled group of fields inside a step (« Fiscalité », « Limites de clientèle »…). */
export function FieldGroup({ title, description, children, className }: { title: string; description?: string; children: ReactNode; className?: string }) {
  const id = useId()
  return (
    <div role="group" aria-labelledby={id} className={cn('min-w-0 space-y-3', className)}>
      <div>
        <h3 id={id} className="text-sm font-semibold text-foreground">
          {title}
        </h3>
        {description && <p className="mt-0.5 text-xs text-muted-foreground">{description}</p>}
      </div>
      {children}
    </div>
  )
}

/**
 * The step's form. A picker sheet's form is portalled out of it in the DOM, but React bubbles its
 * submit through the component tree: that submit is the sheet's « Enregistrer », never this step's
 * « Continuer », so only the step form's own submit is handled.
 */
export function StepForm({ onSubmit, busy, className, children }: { onSubmit: (event: FormEvent) => void; busy: boolean; className?: string; children: ReactNode }) {
  return (
    <form
      id="questionnaire-step"
      noValidate
      aria-busy={busy || undefined}
      className={className}
      onSubmit={(event) => {
        if (event.target !== event.currentTarget) return
        onSubmit(event)
      }}
    >
      {children}
    </form>
  )
}

/** Two columns of fields from `sm` up, one on a phone. */
export const FIELD_GRID = 'grid gap-3 sm:grid-cols-2'

/**
 * The record's private data could not be read (`get_my_professional_private`): said where its masks
 * would be, with « Réessayer », never hidden.
 */
export function OnFileError({ onFile }: { onFile: OnFilePrivate }) {
  return <LoadError message={t('modules.professionals.questionnaire.taxBank.onFileError')} onRetry={onFile.retry} retrying={onFile.retrying} />
}
