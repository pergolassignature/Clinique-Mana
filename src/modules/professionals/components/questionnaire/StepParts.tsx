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
 * A step's body from `lg`: it grows to the bottom of the window (the page, the columns and the step's
 * column grow too) and lays its children in a column, so the action bar can sit at its bottom.
 */
export const STEP_BODY = 'lg:flex lg:flex-1 lg:flex-col'
/** From `lg`, the room between the fields and the bar: 24 px at least, all that is left on a short step. */
const ACTIONS_SPACER = 'hidden !mt-0 lg:block lg:min-h-6 lg:flex-1'
const ACTIONS_BAR = cn(
  '!mt-6 flex flex-col-reverse gap-2 border-t border-border pt-4 sm:flex-row sm:items-center sm:justify-between',
  'lg:sticky lg:bottom-0 lg:z-10 lg:!mt-0 lg:!-mb-6 lg:bg-card lg:pb-6',
)

/**
 * The step's buttons: « Retour » (none on the first step), « Enregistrer le brouillon » on the
 * autosaved steps (`DraftActionContext`), and the step form's submit, « Continuer » by default
 * (« Enregistrement… » while it saves; `aria-disabled`, so focus stays on it). Full width and stacked
 * on a phone, the forward action on top; the draft button comes after the fields in the tab order.
 * The row is the same on every step: its separator, « Retour » on the column's left edge (its place
 * kept empty on the first step) and the forward action on its right edge.
 *
 * Below `lg` it follows the fields, 24 px under them (`!mt-6` wins over the form's `space-y-*`). From
 * `lg` it is the step's action bar, at the same height on every step: the step body fills the window
 * under the header (`STEP_BODY`, down from the page), a spacer of 24 px at least pushes the bar to the
 * bottom of a short step, and on a long one the bar sticks to the bottom of the window while the step
 * scrolls under it (`sticky`, so it keeps its own place after the last field: nothing stays hidden
 * behind it). Its bottom padding fills the page's own (`!-mb-6 pb-6`, `!` over the form's
 * `space-y-*`), so stuck or not it ends on the window's edge. A focused field is kept above it by
 * the page's `scroll-padding-bottom` (`[data-questionnaire-actions]`, globals.css).
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
    <>
      <div aria-hidden className={ACTIONS_SPACER} />
      <div data-questionnaire-actions="" className={ACTIONS_BAR}>
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
    </>
  )
}

/**
 * A refusal or an error of the step that names no field: above the buttons, announced; 24 px under
 * the fields on every step (`!mt-6`, like the buttons' row).
 */
export function StepAlert({ message, children }: { message: string | null; children?: ReactNode }) {
  if (!message) return null
  return (
    <Alert variant="destructive" role="alert" className="!mt-6">
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
 * « Continuer », so only the step form's own submit is handled. From `lg` it fills the step's column
 * (`STEP_BODY`), for the action bar.
 */
export function StepForm({ onSubmit, busy, className, children }: { onSubmit: (event: FormEvent) => void; busy: boolean; className?: string; children: ReactNode }) {
  return (
    <form
      id="questionnaire-step"
      noValidate
      aria-busy={busy || undefined}
      className={cn(STEP_BODY, className)}
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
